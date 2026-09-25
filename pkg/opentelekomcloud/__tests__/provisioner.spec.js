/* global describe, expect, it, jest */

import TCloudProvisioner from '../provisioner';
import { setSharedNetworkContext } from '../sharedNetwork';

jest.mock('../assets/icon-opentelekomcloud.svg', () => 'tcloud-icon');

const networkID = 'fleet-default/demo-network';

function cluster() {
  return {
    metadata: {
      name:        'demo',
      namespace:   'fleet-default',
      annotations: {},
    },
  };
}

function context() {
  return {
    machinePools:  [{ pool: { quantity: 1 }, config: {} }],
    credentialId:  'cattle-global-data:cc-test',
    policy:        'Managed',
    region:        'eu-de',
    projectName:   'project',
    vpc:           { name: 'demo', cidr: '192.168.0.0/16' },
    subnet:        {
      name: 'demo-subnet', cidr: '192.168.0.0/24', gatewayIP: '192.168.0.1'
    },
    securityGroup: {
      name: 'demo-rke2', managementPolicy: 'Managed', cni: 'canal', sshAllowedCIDRs: ['0.0.0.0/0'],
    },
  };
}

function failedNetwork(message = 'VPC quota exceeded (HTTP 409)') {
  return {
    metadata: { generation: 1 },
    spec:     { managementPolicy: 'Managed' },
    status:   {
      conditions: [{
        type: 'Ready', status: 'False', reason: 'VPCCreationFailed', message
      }]
    },
  };
}

function provisioner(dispatch) {
  return new TCloudProvisioner({
    dispatch,
    getters: { 'management/schemaFor': () => ({}) },
  });
}

describe('TCloudProvisioner managed network rollback', () => {
  it('removes a network created by the failing save attempt and preserves the cloud error', async() => {
    const value = cluster();
    const remove = jest.fn().mockResolvedValue(undefined);
    const saved = { remove };
    let findCalls = 0;
    const dispatch = jest.fn(async(action) => {
      if (action === 'management/find' && findCalls++ === 0) {
        const notFound = new Error('not found');

        notFound.status = 404;
        throw notFound;
      }
      if (action === 'management/create') {
        return { save: jest.fn().mockResolvedValue(saved) };
      }

      return failedNetwork();
    });

    setSharedNetworkContext(value, context());

    await expect(provisioner(dispatch).prepareSharedNetwork(value)).rejects.toThrow('VPC quota exceeded (HTTP 409)');
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('does not remove a network that existed before the save attempt', async() => {
    const value = cluster();
    const remove = jest.fn();
    const existing = {
      ...failedNetwork(),
      remove,
      save: jest.fn(),
      spec: {
        managementPolicy:    'Managed',
        credentialSecretRef: { namespace: 'cattle-global-data', name: 'cc-test' },
        network:             {
          securityGroup: {
            name: 'demo-rke2', managementPolicy: 'Managed', cni: 'canal', sshAllowedCIDRs: ['0.0.0.0/0'],
          },
        },
      },
    };
    const dispatch = jest.fn().mockResolvedValue(existing);

    setSharedNetworkContext(value, context());

    await expect(provisioner(dispatch).prepareSharedNetwork(value)).rejects.toThrow('VPC quota exceeded (HTTP 409)');
    expect(remove).not.toHaveBeenCalled();
  });

  it('reports both the cloud failure and a rollback failure', async() => {
    const value = cluster();
    const saved = { remove: jest.fn().mockRejectedValue(new Error('delete denied')) };
    let findCalls = 0;
    const dispatch = jest.fn(async(action) => {
      if (action === 'management/find' && findCalls++ === 0) {
        const notFound = new Error('not found');

        notFound.status = 404;
        throw notFound;
      }
      if (action === 'management/create') {
        return { save: jest.fn().mockResolvedValue(saved) };
      }

      return failedNetwork();
    });

    setSharedNetworkContext(value, context());

    await expect(provisioner(dispatch).prepareSharedNetwork(value)).rejects.toThrow(
      `VPC quota exceeded (HTTP 409) Rollback of the newly created cluster network ${ networkID } also failed: delete denied`
    );
  });
});
