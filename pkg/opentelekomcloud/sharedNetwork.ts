export const TCLOUD_NETWORK_TYPE = 'infrastructure.otc.t-systems.com.tcloudclusternetwork';
export const NETWORK_ANNOTATION = 'infrastructure.otc.t-systems.com/cluster-network';
export const NETWORK_POLICY_ANNOTATION = 'infrastructure.otc.t-systems.com/network-policy';

export type NetworkPolicy = 'Managed' | 'Observe' | 'Adopt';

export interface SharedNetworkContext {
  machinePools: any[];
  credentialId: string;
  policy: NetworkPolicy;
  region: string;
  projectName: string;
  vpc: { id?: string; name?: string; cidr?: string };
  subnet: { id?: string; name?: string; cidr?: string; gatewayIP?: string; availabilityZone?: string };
  securityGroup: { id?: string; name?: string; sshAllowedCIDRs?: string[]; cni?: string };
}

const contexts = new WeakMap<object, SharedNetworkContext>();

export function setSharedNetworkContext(cluster: object, context: SharedNetworkContext) {
  contexts.set(cluster, context);
}

export function getSharedNetworkContext(cluster: object): SharedNetworkContext | undefined {
  return contexts.get(cluster);
}

export function activePools(machinePools: any[]): any[] {
  return (machinePools || []).filter((entry) => !entry.remove && Number(entry.pool?.quantity || 0) > 0);
}

export function nodeCount(machinePools: any[]): number {
  return activePools(machinePools).reduce((total, entry) => total + Number(entry.pool?.quantity || 0), 0);
}

export function networkResourceName(clusterName: string): string {
  const normalized = `${ clusterName || 'cluster' }-network`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');

  return normalized || 'tcloud-cluster-network';
}

export function credentialSecretReference(credentialId: string): { namespace: string; name: string } {
  const separator = credentialId.indexOf(':');

  if (separator < 1 || separator === credentialId.length - 1) {
    throw new Error('The selected T-Cloud Public credential does not reference a namespaced Secret.');
  }

  return {
    namespace: credentialId.slice(0, separator),
    name:      credentialId.slice(separator + 1),
  };
}
