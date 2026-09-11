<script>
import Loading from '@shell/components/Loading';
import { Banner } from '@components/Banner';
import CreateEditView from '@shell/mixins/create-edit-view';
import LabeledSelect from '@shell/components/form/LabeledSelect';
import { LabeledInput } from '@components/Form/LabeledInput';
import { NORMAN, SECRET } from '@shell/config/types';
import { stringify } from '@shell/utils/error';
import { _VIEW } from '@shell/config/query-params';
import FileSelector from '../components/FileSelector';
import CreateNetworkResourceForm from '../components/CreateNetworkResourceForm';
import { OpenTelekomCloud } from '../opentelekomcloud.ts';
import {
  NETWORK_POLICY_ANNOTATION,
  NETWORK_ANNOTATION,
  TCLOUD_NETWORK_TYPE,
  clearSharedNetworkContext,
  nodeCount,
  setSharedNetworkContext,
} from '../sharedNetwork';
import {
  CREATE_NEW_NETWORK,
  addCreateNewOption,
  cancelCreate,
  selectByName,
  gatewayFromCidr,
  isValidCidr,
} from '../helpers/networkResourceOptions';

function initOptions() {
  return {
    options:  [],
    selected: null,
    busy:     false,
    enabled:  false,
  };
}

export default {
  components: {
    Banner, CreateNetworkResourceForm, FileSelector, Loading, LabeledInput, LabeledSelect
  },

  mixins: [CreateEditView],

  props: {
    uuid: {
      type:     String,
      required: true,
    },

    cluster: {
      type:    Object,
      default: () => ({})
    },

    credentialId: {
      type:     String,
      required: true,
    },

    disabled: {
      type:    Boolean,
      default: false
    },

    busy: {
      type:    Boolean,
      default: false
    },

    provider: {
      type:     String,
      required: true,
    },

    machinePools: {
      type:    Array,
      default: () => [],
    },

    poolId: {
      type:    String,
      default: '',
    }
  },

  async fetch() {
    this.errors = [];
    if ( !this.credentialId ) {
      return;
    }

    if (this.mode === _VIEW) {
      this.initForViewMode();

      return;
    }

    if (this.sharedNetworkRequired) {
      this.applySharedNetworkConfig();
    }

    try {
      this.credential = await this.$store.dispatch('rancher/find', { type: NORMAN.CLOUD_CREDENTIAL, id: this.credentialId });
    } catch (e) {
      this.credential = null;
    }

    // Populate basic auth fields from the cloud credential config and annotations
    const credCfg = this.credential?.opentelekomcloudcredentialConfig || {};
    const ann = this.credential?.annotations || {};

    // credentialConfig fields may not include all custom fields, so fall back to annotations
    this.authMethod = credCfg.authMethod || ann['opentelekomcloud.cattle.io/authMethod'] || 'password';
    this.username = credCfg.username || ann['opentelekomcloud.cattle.io/username'] || '';
    this.domainName = credCfg.domainName || ann['opentelekomcloud.cattle.io/domainName'] || '';
    this.projectName = credCfg.projectName || ann['opentelekomcloud.cattle.io/projectName'] || '';
    this.projectId = credCfg.projectId || ann['opentelekomcloud.cattle.io/projectId'] || '';
    this.region = credCfg.region || ann['opentelekomcloud.cattle.io/region'] || '';
    this.endpoint = credCfg.authUrl || ann['opentelekomcloud.cattle.io/authUrl'] || '';

    // AK/SK values are loaded only from the referenced Kubernetes Secret below.
    this.accessKey = '';
    this.secretKey = '';

    // Try and get the secret for the Cloud Credential as we need the plain-text password
    try {
      const id = this.credentialId.replace(':', '/');
      const secret = await this.$store.dispatch('management/find', { type: SECRET, id });
      const credPassword = secret.data['opentelekomcloudcredentialConfig-password'];
      const credAccessKey = secret.data['opentelekomcloudcredentialConfig-accessKey'];
      const credSecretKey = secret.data['opentelekomcloudcredentialConfig-secretKey'];

      if (credPassword) {
        this.password = atob(credPassword);
        this.havePassword = true;
      } else {
        this.password = '';
        this.havePassword = false;
      }

      if (credAccessKey) {
        this.accessKey = atob(credAccessKey);
      }
      if (credSecretKey) {
        this.secretKey = atob(credSecretKey);
      }

      this.ready = true;
    } catch (e) {
      // this.credential = null;
      this.password = '';
      this.havePassword = false;
      console.error(e); // eslint-disable-line no-console
    }

    this.authenticating = true;

    const otc = new OpenTelekomCloud(this.$store, {
      endpoint:    this.endpoint,
      authMethod:  this.authMethod,
      domainName:  this.domainName,
      username:    this.username,
      password:    this.password,
      accessKey:   this.accessKey,
      secretKey:   this.secretKey,
      projectName: this.projectName,
      projectId:   this.projectId,
      region:      this.region,
    });

    this.otc = otc;

    // Fetch a token - if this succeeds, kick off async fetching the lists we need
    this.otc.getToken().then((res) => {
      if (res.error) {
        this.authenticating = false;
        this.$emit('validationChanged', false);

        this.errors.push('Unable to authenticate with the T-Cloud Public server');

        return;
      }

      this.authenticating = false;

      otc.getFlavors(this.flavors, this.value?.flavorName);
      otc.getImages(this.images, this.value?.imageName);
      otc.getKeyPairs(this.keyPairs, this.value?.keypairName);
      const sharedConfig = this.sharedNetworkConfig;
      const securityGroup = this.value?.secGroups || sharedConfig?.secGroups;
      const vpc = this.value?.vpcId || this.value?.vpcName || sharedConfig?.vpcId || sharedConfig?.vpcName;

      this.initialSubnet = this.value?.subnetId || this.value?.subnetName || sharedConfig?.subnetId || sharedConfig?.subnetName;

      otc.getSecurityGroups(this.securityGroups, securityGroup);
      otc.getFloatingIpPools(this.floatingIpPools, this.value?.floatingipPool);
      otc.getVpcs(this.vpcs, vpc).then(() => {
        addCreateNewOption(this.vpcs, 'VPC', CREATE_NEW_NETWORK.VPC);
      });
      otc.getAvailabilityZones(this.availabilityZones, this.value?.availabilityZone);
    });

    this.$emit('validationChanged', false);
  },

  data() {
    const annotations = this.cluster?.metadata?.annotations || {};
    const hasExistingNetwork = this.machinePools.some((entry) => entry.config?.vpcId && entry.config?.subnetId && entry.config?.secGroups);
    const defaultNetworkPolicy = hasExistingNetwork ? 'Observe' : this.cluster?.status?.ready === true ? 'Adopt' : 'Managed';

    return {
      authenticating:      false,
      ready:               false,
      otc:                 null,
      authMethod:          'password',
      username:            '',
      endpoint:            '',
      domainName:          '',
      projectName:         '',
      projectId:           '',
      region:              '',
      password:            null,
      havePassword:        false,
      accessKey:           '',
      secretKey:           '',
      flavors:             initOptions(),
      images:              initOptions(),
      keyPairs:            initOptions(),
      securityGroups:      initOptions(),
      floatingIpPools:     initOptions(),
      vpcs:                initOptions(),
      subnets:             initOptions(),
      availabilityZones:   initOptions(),
      sshUser:             this.value?.sshUser || 'ubuntu',
      privateKeyFile:      this.value?.privateKeyFile || '',
      filename:            this.value?.privateKeyFile ? 'Private Key Provided' : '',
      privateKeyFieldType: 'password',
      errors:              null,
      creatingVpc:         false,
      createVpcError:      null,
      creatingSubnet:      false,
      createSubnetError:   null,
      initialSubnet:       null,
      networkPolicy:       annotations[NETWORK_POLICY_ANNOTATION] || defaultNetworkPolicy,
      managedVpcCIDR:      annotations['infrastructure.otc.t-systems.com/vpc-cidr'] || '192.168.0.0/16',
      managedSubnetCIDR:   annotations['infrastructure.otc.t-systems.com/subnet-cidr'] || '192.168.0.0/24',
      managedGatewayIP:    annotations['infrastructure.otc.t-systems.com/gateway-ip'] || '192.168.0.1',
      managedSSHCIDRs:     annotations['infrastructure.otc.t-systems.com/ssh-allowed-cidrs'] || '',
    };
  },

  computed: {
    activeMachinePools() {
      return this.machinePools.filter((entry) => !entry.remove && Number(entry.pool?.quantity || 0) > 0);
    },

    sharedNetworkRequired() {
      const alreadyShared = !!this.cluster?.metadata?.annotations?.[NETWORK_ANNOTATION];

      return alreadyShared || nodeCount(this.machinePools) > 1;
    },

    controllerAvailable() {
      return !!this.$store.getters['management/schemaFor'](TCLOUD_NETWORK_TYPE);
    },

    managedNetwork() {
      return this.networkPolicy === 'Managed';
    },

    adoptingNetwork() {
      return this.networkPolicy === 'Adopt';
    },

    controllerOwnedNetwork() {
      return this.managedNetwork || this.adoptingNetwork;
    },

    networkPolicies() {
      return [
        {
          label:    'Managed — create and clean up with the controller',
          value:    'Managed',
          disabled: !this.controllerAvailable,
        },
        { label: 'Existing — observe resources without deleting them', value: 'Observe' },
      ];
    },

    sharedNetworkConfig() {
      const entry = this.activeMachinePools.find((pool) => {
        const config = pool.config;

        return pool.id !== this.poolId && config?.vpcId && config?.subnetId && config?.secGroups;
      });

      return entry?.config || null;
    },

    sharedNetworkMismatch() {
      if (!this.sharedNetworkRequired || this.controllerOwnedNetwork) {
        return false;
      }

      const configs = this.activeMachinePools.map((entry) => entry.config).filter((config) => config?.vpcId && config?.subnetId && config?.secGroups);
      const networks = new Set(configs.map((config) => `${ config.vpcId }/${ config.subnetId }/${ config.secGroups }`));

      return networks.size > 1;
    },
  },

  watch: {
    'credentialId'() {
      this.$fetch();
    },
    'vpcs.selected'(newVpc) {
      if (newVpc === CREATE_NEW_NETWORK.VPC) {
        this.creatingVpc = true;

        return;
      }

      this.creatingVpc = false;
      this.createVpcError = null;

      if (newVpc && newVpc.id && this.otc) {
        this.value.vpcName = newVpc.name;
        this.value.vpcId = newVpc.id;
        this.subnets.enabled = true;
        this.otc.getSubnets(this.subnets, newVpc.id, this.initialSubnet).then(() => {
          this.initialSubnet = null;
          addCreateNewOption(this.subnets, 'Subnet', CREATE_NEW_NETWORK.SUBNET);
        });
      } else {
        // No VPC selected: clear and disable subnets
        this.subnets.enabled = false;
        this.subnets.options = [];
        this.subnets.selected = null;
      }
    },
    'subnets.selected'(newSubnet) {
      if (newSubnet === CREATE_NEW_NETWORK.SUBNET) {
        this.creatingSubnet = true;

        return;
      }

      this.creatingSubnet = false;
      this.createSubnetError = null;

      if (newSubnet?.id) {
        this.value.subnetName = newSubnet.name;
        this.value.subnetId = newSubnet.id;
      }
    },
    'securityGroups.selected'(newSecurityGroup) {
      if (newSecurityGroup?.name) {
        this.value.secGroups = newSecurityGroup.name;
      }
    },
    sharedNetworkRequired(required) {
      if (required) {
        this.applySharedNetworkConfig();
      } else {
        this.applyMachineNetworkConfig();
      }
      this.syncSharedNetworkContext();
    },
    networkPolicy() {
      this.syncSharedNetworkContext();
    },
  },

  methods: {
    stringify,

    applySharedNetworkConfig() {
      const config = this.sharedNetworkConfig;

      this.activeMachinePools.forEach((entry) => {
        if (entry.config) {
          entry.config.networkScope = 'shared';
          entry.config.skipDefaultSg = true;
        }
      });

      if (!config) {
        return;
      }

      this.value.vpcName ||= config.vpcName;
      this.value.vpcId ||= config.vpcId;
      this.value.subnetName ||= config.subnetName;
      this.value.subnetId ||= config.subnetId;
      this.value.secGroups ||= config.secGroups;
    },

    applyMachineNetworkConfig() {
      this.activeMachinePools.forEach((entry) => {
        if (entry.config?.networkScope === 'shared') {
          entry.config.networkScope = 'machine';
          entry.config.skipDefaultSg = false;
        }
      });
    },

    validateNetwork() {
      if (!this.sharedNetworkRequired) {
        return [];
      }

      const errors = [];

      if (!this.controllerAvailable) {
        errors.push('Shared networking requires the T-Cloud Public Rancher Network Controller. Install it and reload Rancher.');
      }

      if (this.controllerOwnedNetwork) {
        const cni = this.cluster.spec?.rkeConfig?.machineGlobalConfig?.cni || 'canal';

        if (this.managedNetwork && (!this.managedVpcCIDR || !this.managedSubnetCIDR || !this.managedGatewayIP)) {
          errors.push('Managed shared networking requires VPC CIDR, subnet CIDR, and gateway IP.');
        }
        if (this.managedNetwork && this.managedVpcCIDR && !isValidCidr(this.managedVpcCIDR)) {
          errors.push('VPC CIDR must use IPv4 CIDR notation.');
        }
        if (this.managedNetwork && this.managedSubnetCIDR && !isValidCidr(this.managedSubnetCIDR)) {
          errors.push('Subnet CIDR must use IPv4 CIDR notation.');
        }
        if (!this.managedSSHCIDRs.split(',').some((cidr) => cidr.trim())) {
          errors.push('Controller-owned shared networking requires at least one SSH source CIDR.');
        }
        if (!['canal', 'flannel', 'calico'].includes(cni)) {
          errors.push(`Controller-owned T-Cloud Public security-group rules currently support canal, flannel, or calico, not ${ cni }.`);
        }

        return errors;
      }

      const incompletePool = this.activeMachinePools.some((entry) => !entry.config?.vpcId || !entry.config?.subnetId || !entry.config?.secGroups);

      if (incompletePool) {
        errors.push('Every active machine pool must select a shared VPC, subnet, and security group.');
      }
      if (this.sharedNetworkMismatch) {
        errors.push('All machine pools must use the same VPC, subnet, and security group.');
      }

      return errors;
    },

    syncSharedNetworkContext() {
      if (!this.cluster) {
        return;
      }

      if (!this.sharedNetworkRequired) {
        clearSharedNetworkContext(this.cluster);
        const annotations = this.cluster.metadata?.annotations;

        if (annotations) {
          delete annotations[NETWORK_POLICY_ANNOTATION];
          delete annotations['infrastructure.otc.t-systems.com/vpc-cidr'];
          delete annotations['infrastructure.otc.t-systems.com/subnet-cidr'];
          delete annotations['infrastructure.otc.t-systems.com/gateway-ip'];
          delete annotations['infrastructure.otc.t-systems.com/ssh-allowed-cidrs'];
        }

        return;
      }

      this.cluster.metadata = this.cluster.metadata || {};
      this.cluster.metadata.annotations = this.cluster.metadata.annotations || {};
      const annotations = this.cluster.metadata.annotations;

      annotations[NETWORK_POLICY_ANNOTATION] = this.networkPolicy;
      annotations['infrastructure.otc.t-systems.com/vpc-cidr'] = this.managedVpcCIDR;
      annotations['infrastructure.otc.t-systems.com/subnet-cidr'] = this.managedSubnetCIDR;
      annotations['infrastructure.otc.t-systems.com/gateway-ip'] = this.managedGatewayIP;
      annotations['infrastructure.otc.t-systems.com/ssh-allowed-cidrs'] = this.managedSSHCIDRs;

      setSharedNetworkContext(this.cluster, {
        machinePools:  this.machinePools,
        credentialId: this.credentialId,
        policy:       this.networkPolicy,
        region:       this.region,
        projectName:  this.projectName,
        vpc:          this.managedNetwork ? {
          name: this.cluster.metadata.name,
          cidr: this.managedVpcCIDR,
        } : this.adoptingNetwork ? {} : {
          id:   this.vpcs.selected?.id,
          name: this.vpcs.selected?.name,
        },
        subnet: this.managedNetwork ? {
          name:             `${ this.cluster.metadata.name }-subnet`,
          cidr:             this.managedSubnetCIDR,
          gatewayIP:        this.managedGatewayIP,
          availabilityZone: this.availabilityZones.selected?.name,
        } : this.adoptingNetwork ? {} : {
          id:   this.subnets.selected?.id,
          name: this.subnets.selected?.name,
        },
        securityGroup: this.controllerOwnedNetwork ? {
          name:            `${ this.cluster.metadata.name }-rke2`,
          cni:             this.cluster.spec?.rkeConfig?.machineGlobalConfig?.cni || 'canal',
          sshAllowedCIDRs: this.managedSSHCIDRs.split(',').map((cidr) => cidr.trim()).filter(Boolean),
        } : {
          id:   this.securityGroups.selected?.id,
          name: this.securityGroups.selected?.name,
        },
      });
    },

    initForViewMode() {
      this.fakeSelectOptions(this.flavors, this.value?.flavorName);
      this.fakeSelectOptions(this.images, this.value?.imageName);
      this.fakeSelectOptions(this.keyPairs, this.value?.keypairName);
      this.fakeSelectOptions(this.securityGroups, this.value?.secGroups);
      this.fakeSelectOptions(this.floatingIpPools, this.value?.floatingipPool);
      this.fakeSelectOptions(this.vpcs, this.value?.vpcName);
      this.fakeSelectOptions(this.subnets, this.value?.subnetName);
      this.fakeSelectOptions(this.availabilityZones, this.value?.availabilityZone);
    },

    fakeSelectOptions(list, value) {
      list.busy = false;
      list.enabled = false;
      list.options = [];

      if (value) {
        list.options.push({
          label: value,
          value,
        });
      }

      list.selected = value;
    },

    onPrivateKeyFileSelected(v) {
      this.filename = v.file.name;
      this.privateKeyFile = v.data;

      // On initial load, filename is shown as a password as we don't know what the filename was that was used - we just want to indicate there is a vlue
      // When a file is chosen, change the type to text, so that the user can see the filename of the file that they chose
      this.privateKeyFieldType = 'text';

      this.$emit('validationChanged', true);
    },

    syncValue() {
      // Copy auth values from the Cloud Credential into the machine config, so they are
      // passed as flags (opentelekomcloud-*) to the docker-machine driver.
      // Only pass fields that the Go driver recognizes as valid flags.
      this.value.authUrl = this.endpoint;
      this.value.domainName = this.domainName;
      this.value.username = this.username;
      this.value.region = this.region;

      if (this.authMethod === 'aksk') {
        this.value.projectName = '';
        this.value.projectId = this.projectId;
      } else {
        this.value.projectName = this.projectName;
        this.value.projectId = '';
      }

      if (this.havePassword && this.password) {
        this.value.password = this.password;
      }

      this.value.authMethod = this.authMethod;
      this.value.accessKey = this.accessKey;
      this.value.secretKey = this.secretKey;
      // Copy the values from the form to the correct places on the value
      this.value.availabilityZone = this.availabilityZones.selected?.name;
      this.value.flavorName = this.flavors.selected?.name;
      this.value.imageName = this.images.selected?.name;
      this.value.floatingipPool = this.floatingIpPools.selected?.name;
      this.value.keypairName = this.keyPairs.selected?.name;
      this.value.vpcName = this.vpcs.selected?.name;
      this.value.vpcId = this.vpcs.selected?.id;
      this.value.subnetName = this.subnets.selected?.name;
      this.value.subnetId = this.subnets.selected?.id;
      this.value.secGroups = this.securityGroups.selected?.name;
      this.value.sshUser = this.sshUser;
      this.value.privateKeyFile = this.privateKeyFile;

      if (this.sharedNetworkRequired) {
        this.value.networkScope = 'shared';
        this.value.skipDefaultSg = true;
      } else {
        this.value.networkScope = 'machine';
        this.value.skipDefaultSg = false;
      }

      this.syncSharedNetworkContext();

      // Not configurable
      this.value.endpointType = 'publicURL';
      this.value.insecure = true;
      this.value.bootFromVolume = false;
      this.value.sshPort = '22';
    },

    test() {
      this.syncValue();

      const errors = this.validateNetwork();

      this.$emit('validationChanged', errors.length === 0);

      return errors.length ? { errors } : true;
    },

    async handleCreateVpc({ name, cidr }) {
      this.createVpcError = null;
      this.vpcs.busy = true;

      try {
        await this.otc.createVPC(name, cidr);
        await this.otc.getVpcs(this.vpcs, name);
        addCreateNewOption(this.vpcs, 'VPC', CREATE_NEW_NETWORK.VPC);
        selectByName(this.vpcs, name);
        this.creatingVpc = false;
      } catch (e) {
        this.createVpcError = e instanceof Error ? e.message : 'Failed to create VPC';
      } finally {
        this.vpcs.busy = false;
      }
    },

    cancelCreateVpc() {
      this.creatingVpc = false;
      this.createVpcError = null;
      cancelCreate(this.vpcs, CREATE_NEW_NETWORK.VPC);
    },

    async handleCreateSubnet({ name, cidr }) {
      if (!this.vpcs.selected?.id) {
        return;
      }

      this.createSubnetError = null;
      this.subnets.busy = true;

      try {
        await this.otc.createSubnet(this.vpcs.selected.id, name, cidr, gatewayFromCidr(cidr));
        await this.otc.getSubnets(this.subnets, this.vpcs.selected.id, name);
        addCreateNewOption(this.subnets, 'Subnet', CREATE_NEW_NETWORK.SUBNET);
        selectByName(this.subnets, name);
        this.creatingSubnet = false;
      } catch (e) {
        this.createSubnetError = e instanceof Error ? e.message : 'Failed to create Subnet';
      } finally {
        this.subnets.busy = false;
      }
    },

    cancelCreateSubnet() {
      this.creatingSubnet = false;
      this.createSubnetError = null;
      cancelCreate(this.subnets, CREATE_NEW_NETWORK.SUBNET);
    },
  }
};
</script>

<template>
  <div>
    <Loading
      v-if="$fetchState.pending"
      :delayed="true"
    />
    <div v-if="errors.length">
      <div
        v-for="(err, idx) in errors"
        :key="idx"
      >
        <Banner
          color="error"
          :label="stringify(err)"
        />
      </div>
    </div>
    <div>
      <Banner
        v-if="sharedNetworkRequired"
        color="info"
      >
        This cluster uses one controller-coordinated VPC, subnet, and security
        group so it can scale safely across nodes and machine pools.
      </Banner>
      <Banner
        v-if="sharedNetworkRequired && !controllerAvailable"
        color="error"
      >
        Shared networking is unavailable because the T-Cloud Public Rancher Network
        Controller CRD is not installed. Install the controller and reload this
        page. Managed mode remains disabled until the CRD is detected.
      </Banner>
      <Banner
        v-if="sharedNetworkMismatch"
        color="error"
      >
        The machine pools use different networks. Select the same VPC, subnet,
        and security group for every pool.
      </Banner>
      <Banner
        v-if="sharedNetworkRequired && adoptingNetwork"
        color="info"
      >
        The controller will adopt the oldest ready machine's driver-created
        VPC, subnet, and security group before Rancher provisions more nodes.
      </Banner>
      <div class="opentelekomcloud-config">
        <div class="title">
          T-Cloud Public Configuration
        </div>
        <div
          v-if="authenticating"
          class="loading"
        >
          <i class="icon-spinner icon-spin icon-lg" />
          <span>
            Authenticating with the T-Cloud Public server ...
          </span>
        </div>
      </div>
      <div
        v-if="sharedNetworkRequired"
        class="row mt-10"
      >
        <div class="col span-6">
          <LabeledSelect
            v-model:value="networkPolicy"
            label="Shared Network Ownership"
            :options="networkPolicies"
            :placeholder="adoptingNetwork ? 'Automatic adoption; select to override' : ''"
            :disabled="busy"
            :searchable="false"
          />
        </div>
      </div>
      <template v-if="sharedNetworkRequired && controllerOwnedNetwork">
        <div
          v-if="managedNetwork"
          class="row mt-10"
        >
          <div class="col span-4">
            <LabeledInput
              v-model:value="managedVpcCIDR"
              label="VPC CIDR"
              :mode="mode"
              :disabled="busy"
              :required="true"
            />
          </div>
          <div class="col span-4">
            <LabeledInput
              v-model:value="managedSubnetCIDR"
              label="Subnet CIDR"
              :mode="mode"
              :disabled="busy"
              :required="true"
            />
          </div>
          <div class="col span-4">
            <LabeledInput
              v-model:value="managedGatewayIP"
              label="Gateway IP"
              :mode="mode"
              :disabled="busy"
              :required="true"
            />
          </div>
        </div>
        <div class="row mt-10">
          <div class="col span-12">
            <LabeledInput
              v-model:value="managedSSHCIDRs"
              label="SSH Allowed CIDRs (comma-separated)"
              placeholder="203.0.113.10/32"
              :mode="mode"
              :disabled="busy"
              :required="true"
            />
          </div>
        </div>
      </template>
      <div class="row mt-10">
        <div class="col span-6">
          <LabeledSelect
            v-model:value="flavors.selected"
            label="Flavor"
            :options="flavors.options"
            :disabled="!flavors.enabled || busy"
            :loading="flavors.busy"
            :searchable="false"
          />
        </div>

        <div class="col span-6">
          <LabeledSelect
            v-model:value="images.selected"
            label="Image"
            :options="images.options"
            :disabled="!images.enabled || busy"
            :loading="images.busy"
            :searchable="false"
          />
        </div>
      </div>
      <div class="row mt-10">
        <div class="col span-6">
          <LabeledSelect
            v-model:value="keyPairs.selected"
            label="Key Pair"
            :options="keyPairs.options"
            :disabled="!keyPairs.enabled || busy"
            :loading="keyPairs.busy"
            :searchable="false"
          />
        </div>
        <div class="col span-6">
          <LabeledInput
            v-model:value="filename"
            label="Private Key"
            :mode="mode"
            :type="privateKeyFieldType"
            :disabled="busy"
            :required="true"
          >
            <template v-slot:suffix>
              <div class="file-button">
                <FileSelector
                  label="..."
                  :mode="mode"
                  :include-file="true"
                  :disabled="busy"
                  class="btn-sm"
                  @selected="onPrivateKeyFileSelected"
                />
              </div>
            </template>
          </LabeledInput>
        </div>
      </div>
      <div
        v-if="!sharedNetworkRequired || !controllerOwnedNetwork"
        class="row mt-10"
      >
        <div class="col span-6">
          <LabeledSelect
            v-model:value="securityGroups.selected"
            label="Security Groups"
            :options="securityGroups.options"
            :disabled="!securityGroups.enabled || busy"
            :loading="securityGroups.busy"
            :searchable="false"
          />
        </div>
      </div>
      <div class="row mt-10">
        <div class="col span-6">
          <LabeledSelect
            v-model:value="availabilityZones.selected"
            label="Availability Zone"
            :options="availabilityZones.options"
            :disabled="!availabilityZones.enabled || busy"
            :loading="availabilityZones.busy"
            :searchable="false"
          />
        </div>
      </div>
      <div class="row mt-10">
        <div class="col span-6">
          <LabeledSelect
            v-model:value="floatingIpPools.selected"
            label="Floating IP Pools"
            :options="floatingIpPools.options"
            :disabled="!floatingIpPools.enabled || busy"
            :loading="floatingIpPools.busy"
            :searchable="false"
          />
        </div>
      </div>
      <div
        v-if="!sharedNetworkRequired || !controllerOwnedNetwork"
        class="row mt-10"
      >
        <div class="col span-6">
          <LabeledSelect
            v-model:value="vpcs.selected"
            label="VPCs"
            :options="vpcs.options"
            :disabled="!vpcs.enabled || busy || creatingVpc"
            :loading="vpcs.busy"
            :searchable="false"
          />
        </div>
        <div class="col span-6">
          <LabeledSelect
            v-model:value="subnets.selected"
            label="Subnets"
            :options="subnets.options"
            :disabled="!subnets.enabled || busy || creatingSubnet"
            :loading="subnets.busy"
            :searchable="false"
          />
        </div>
      </div>
      <CreateNetworkResourceForm
        v-if="creatingVpc && (!sharedNetworkRequired || !controllerOwnedNetwork)"
        resource-label="VPC"
        default-cidr="192.168.0.0/16"
        :busy="vpcs.busy"
        :error="createVpcError"
        @submit="handleCreateVpc"
        @cancel="cancelCreateVpc"
      />
      <CreateNetworkResourceForm
        v-if="creatingSubnet && (!sharedNetworkRequired || !controllerOwnedNetwork)"
        resource-label="Subnet"
        default-cidr="192.168.0.0/24"
        :busy="subnets.busy"
        :error="createSubnetError"
        @submit="handleCreateSubnet"
        @cancel="cancelCreateSubnet"
      />
      <div class="row mt-10">
        <div class="col span-6">
          <LabeledInput
            v-model:value="sshUser"
            :mode="mode"
            :disabled="busy"
            :required="true"
            label="SSH User ID"
          />
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped lang="scss">
.file-button {
  align-items: center;
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  display: flex;

  > .file-selector {
    height: calc($input-height - 2px);
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
}

.opentelekomcloud-config {
  display: flex;
  align-items: center;

  > .title {
    font-weight: bold;
    padding: 4px 0;
  }

  > .loading {
    margin-left: 20px;
    display: flex;
    align-items: center;

    > i {
      margin-right: 4px;;
    }
  }
}
</style>
