import type { IClusterProvisioner, RegisterClusterSaveHook } from '@shell/core/types';
import {
  NETWORK_ANNOTATION,
  NETWORK_POLICY_ANNOTATION,
  TCLOUD_PROVIDER_ID,
  TCLOUD_NETWORK_TYPE,
  UI_PROVIDER_ANNOTATION,
  activePools,
  credentialSecretReference,
  getSharedNetworkContext,
  networkResourceName,
} from './sharedNetwork';

const READY_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;

interface ProvisionerOptions {
  dispatch: (action: string, payload: any) => Promise<any>;
  getters: Record<string, any>;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readyCondition(resource: any): any {
  return resource?.status?.conditions?.find((condition: any) => condition.type === 'Ready');
}

function sameStrings(left: string[] = [], right: string[] = []): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();

  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index]);
}

export default class TCloudProvisioner implements IClusterProvisioner {
  id = 'opentelekomcloud';

  label = 'T-Cloud Public';

  detailTabs = {
    machines:     true,
    logs:         true,
    registration: true,
    snapshots:    true,
    related:      true,
    events:       true,
    conditions:   true,
  };

  private dispatch: ProvisionerOptions['dispatch'];

  private getters: ProvisionerOptions['getters'];

  constructor(options: ProvisionerOptions) {
    this.dispatch = options.dispatch;
    this.getters = options.getters;
  }

  registerSaveHooks(registerBeforeHook: RegisterClusterSaveHook, _registerAfterHook: RegisterClusterSaveHook, cluster: any) {
    cluster.metadata.annotations = cluster.metadata.annotations || {};
    cluster.metadata.annotations[UI_PROVIDER_ANNOTATION] = TCLOUD_PROVIDER_ID;

    // Rancher saves machine-pool configs at priority 1. Use a truthy, lower
    // priority because Rancher's hook registry normalizes priority 0 to 99.
    registerBeforeHook(() => this.prepareSharedNetwork(cluster), 'prepare-tcloud-shared-network', -1, this);
  }

  private async prepareSharedNetwork(cluster: any): Promise<void> {
    const context = getSharedNetworkContext(cluster);

    if (!context) {
      return;
    }
    if (!this.getters['management/schemaFor'](TCLOUD_NETWORK_TYPE)) {
      throw new Error('Shared networking requires the T-Cloud Public Rancher Network Controller CRD. Install the controller and reload Rancher.');
    }

    const namespace = cluster.metadata?.namespace || 'fleet-default';
    const clusterName = cluster.metadata?.name;

    if (!clusterName) {
      throw new Error('Set the cluster name before saving T-Cloud Public shared networking.');
    }

    cluster.metadata.annotations = cluster.metadata.annotations || {};
    const annotations = cluster.metadata.annotations;
    const name = annotations[NETWORK_ANNOTATION] || networkResourceName(clusterName);
    const id = `${ namespace }/${ name }`;
    let resource;

    try {
      resource = await this.dispatch('management/find', {
        type: TCLOUD_NETWORK_TYPE,
        id,
        opt:  { force: true, watch: false },
      });
    } catch (error: any) {
      if (error?.response?.status !== 404 && error?.status !== 404) {
        throw error;
      }
    }

    if (!resource) {
      resource = await this.dispatch('management/create', this.networkResource(cluster, name, namespace, context));
      resource = await resource.save();
    } else {
      if (resource.spec?.managementPolicy !== context.policy) {
        throw new Error(`The cluster network ${ id } already uses ${ resource.spec?.managementPolicy }; its ownership policy cannot be changed.`);
      }
      if (context.securityGroup.managementPolicy === 'Managed') {
        const securityGroup = resource.spec.network.securityGroup;
        const desiredCIDRs = context.securityGroup.sshAllowedCIDRs;
        const desiredCNI = context.securityGroup.cni || 'canal';
        const desiredName = context.securityGroup.name || `${ cluster.metadata.name }-rke2`;

        if (securityGroup.managementPolicy === 'Observe') {
          throw new Error(`The cluster network ${ id } already uses an existing security group; its ownership policy cannot be changed.`);
        }
        if (!sameStrings(securityGroup.sshAllowedCIDRs, desiredCIDRs) || securityGroup.cni !== desiredCNI || securityGroup.name !== desiredName) {
          securityGroup.sshAllowedCIDRs = desiredCIDRs;
          securityGroup.cni = desiredCNI;
          securityGroup.name = desiredName;
          securityGroup.managementPolicy = 'Managed';
          resource = await resource.save();
        }
      } else if (resource.spec.network.securityGroup.managementPolicy === 'Managed') {
        throw new Error(`The cluster network ${ id } already uses a controller-managed security group; its ownership policy cannot be changed.`);
      }
    }

    annotations[NETWORK_ANNOTATION] = name;
    annotations[NETWORK_POLICY_ANNOTATION] = context.policy;

    const ready = await this.waitUntilReady(id);

    this.applyNetworkToPools(context.machinePools, ready);
  }

  private networkResource(cluster: any, name: string, namespace: string, context: any): any {
    const secret = credentialSecretReference(context.credentialId);
    const managed = context.policy === 'Managed';
    const adopt = context.policy === 'Adopt';

    return {
      type:       TCLOUD_NETWORK_TYPE,
      apiVersion: 'infrastructure.otc.t-systems.com/v1alpha1',
      kind:       'TCloudClusterNetwork',
      metadata:   { name, namespace },
      spec:       {
        clusterRef:          { name: cluster.metadata.name, namespace },
        credentialSecretRef: secret,
        managementPolicy:    context.policy,
        region:              context.region,
        projectName:         context.projectName,
        endpointType:        'public',
        network:             {
          vpc: managed ? {
            name: context.vpc.name || cluster.metadata.name,
            cidr: context.vpc.cidr,
          } : adopt ? {} : { id: context.vpc.id },
          subnet: managed ? {
            name:             context.subnet.name || `${ cluster.metadata.name }-subnet`,
            cidr:             context.subnet.cidr,
            gatewayIP:        context.subnet.gatewayIP,
            availabilityZone: context.subnet.availabilityZone,
          } : adopt ? {} : { id: context.subnet.id },
          securityGroup: managed ? {
            name:             context.securityGroup.name || `${ cluster.metadata.name }-rke2`,
            managementPolicy: 'Managed',
            cni:              context.securityGroup.cni || 'canal',
            sshAllowedCIDRs:  context.securityGroup.sshAllowedCIDRs,
          } : adopt ? {
            managementPolicy: 'Managed',
            cni:              context.securityGroup.cni || 'canal',
            sshAllowedCIDRs:  context.securityGroup.sshAllowedCIDRs,
          } : context.securityGroup.managementPolicy === 'Managed' ? {
            name:             context.securityGroup.name || `${ cluster.metadata.name }-rke2`,
            managementPolicy: 'Managed',
            cni:              context.securityGroup.cni || 'canal',
            sshAllowedCIDRs:  context.securityGroup.sshAllowedCIDRs,
          } : { id: context.securityGroup.id, managementPolicy: 'Observe' },
        },
      },
    };
  }

  private async waitUntilReady(id: string): Promise<any> {
    const deadline = Date.now() + READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const resource = await this.dispatch('management/find', {
        type: TCLOUD_NETWORK_TYPE,
        id,
        opt:  { force: true, watch: false },
      });
      const condition = readyCondition(resource);

      if (condition?.status === 'True' && resource.status?.observedGeneration === resource.metadata?.generation) {
        return resource;
      }
      if (condition?.status === 'False') {
        if (resource.spec?.managementPolicy === 'Adopt' && condition.reason === 'NetworkAdoptionFailed') {
          await sleep(POLL_INTERVAL_MS);

          continue;
        }
        throw new Error(`T-Cloud Public shared network is not ready: ${ condition.message || condition.reason || 'controller reconciliation failed' }`);
      }
      await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(`Timed out waiting for T-Cloud Public shared network ${ id } to become ready.`);
  }

  private applyNetworkToPools(machinePools: any[], resource: any) {
    const resources = resource.status?.resources;

    if (!resources?.vpc?.id || !resources?.subnet?.id || !resources?.securityGroup?.name) {
      throw new Error('The T-Cloud Public network controller reported Ready without complete resource status.');
    }

    activePools(machinePools).forEach((entry) => {
      entry.config.vpcId = resources.vpc.id;
      entry.config.vpcName = resources.vpc.name;
      entry.config.subnetId = resources.subnet.id;
      entry.config.subnetName = resources.subnet.name;
      entry.config.secGroups = resources.securityGroup.name;
      entry.config.networkScope = 'shared';
      entry.config.skipDefaultSg = true;
    });
  }
}
