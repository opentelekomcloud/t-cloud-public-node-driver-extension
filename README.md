# T-Cloud Public Node Driver Extension for Rancher

This repository contains a **Rancher UI Extension** that integrates the **T-Cloud Public machine driver** into Rancher (RKE2).
It provides a complete UI for configuring T-Cloud Public machines, managing cloud credentials, and provisioning RKE2 clusters using T-Cloud Public instances.

This extension replaces the legacy node-driver UI and implements Rancher's new **UI Extensions Framework** (v3+).

## Shared cluster networking

New multi-node clusters use one controller-coordinated VPC, subnet, and security
group from initial provisioning so they can scale safely across machine pools.
A new single-node cluster initially uses its driver-created network. When it is
scaled up, the extension automatically adopts that network before Rancher creates
the additional machines. After a cluster enters shared mode, that mode is kept
during scale-down so a remaining node can never reclaim ownership of
cluster-scoped resources. The extension exposes these ownership choices:

- **Managed** creates a `TCloudClusterNetwork` before Rancher saves the machine
  configs. The network controller creates the resources and deletes them after
  the Rancher cluster and its cloud machines are deleted.
- **Existing** creates an `Observe` network object for selected resource IDs.
  The controller validates and tracks them but never deletes them.

`Adopt` is an internal automatic transition for a single-node cluster when it
first scales up; it is not a user-selectable ownership option. The controller
discovers the driver-created network from Rancher's machine state, adds the
required CNI rules, and assumes cleanup responsibility.

Managed mode is disabled when the
`tcloudclusternetworks.infrastructure.otc.t-systems.com` CRD is unavailable.
Install the
[T-Cloud Public Rancher Network Controller](https://github.com/opentelekomcloud/t-cloud-public-rancher-network-controller)
before provisioning a multi-node cluster. The extension waits for `Ready=True`,
copies the returned resource IDs and names into every active machine pool, sets
the driver network scope to `shared`, and annotates the Rancher Cluster with the
network object name.

The installed docker-machine driver must support `networkScope=shared` and
`skipDefaultSg=true`. In that scope the driver must not delete the shared VPC,
subnet, or security group; cleanup belongs exclusively to the controller.

---

## Building and running locally

You can build and run the extensions locally, to do so:

- Run `yarn install`
- Set the `API` environment variable to point to a Rancher backend
- Run Rancher in development mode with `yarn dev`
- Open a web browser to `https://127.0.0.1:8005`

Once you log in, you should see Rancher load with the extensions automatically loaded. You can edit the code for the extensions
and then should hot-reload within the browser.

## Releasing an extension

Currently, releasing works through GitHub pages (need to create more secure way of releasing https://extensions.rancher.io/extensions/next/publishing) [[issue](https://github.com/opentelekomcloud/opentelekomcloud-node-driver-extension/issues/1)]
```bash
yarn publish-pkgs -s "opentelekomcloud/opentelekomcloud-node-driver-extension" -b "gh-pages"
```

Then Open `//rancher.instance/dashboard/c/_/uiplugins` -> `Manage Repositories` -> Create

### Bugs & Issues
Please submit bugs and issues to [opentelekomcloud/opentelekomcloud-node-driver-extension](https://github.com/opentelekomcloud/opentelekomcloud-node-driver-extension/issues).

Or just [click here](https://github.com/opentelekomcloud/opentelekomcloud-node-driver-extension/issues/new) to create a new issue.

License
=======
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

[http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0)

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
