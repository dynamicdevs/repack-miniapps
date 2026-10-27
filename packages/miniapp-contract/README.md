# @dentvega/miniapp-contract

The shared contract of a [Re.Pack](https://re-pack.dev/) / Module Federation miniapp platform:
the types and pure functions that the **mobile host**, the **miniapps** and the **registry**
(the backend that serves miniapp versions) all agree on.

- **Types** for the manifest a miniapp publishes, the registry's resolve request/response, the
  host's platform contract, and the props the host injects into a miniapp.
- **Guards** to validate JSON that comes from an untrusted source (`isManifest`,
  `isHostContract`, `parseSemVer`, `parseMiniappId`).
- **Compatibility checks** to decide, before mounting or at publish time, whether a miniapp can
  run on a given host: shared-dependency version skew + native-module presence.

No UI, no network, no React. Its only dependency is `semver`. It runs the same in a React Native
host, a Node.js backend, and a CI script.

## Install

```bash
npm install @dentvega/miniapp-contract
```

ESM only. MIT.

## Concepts

| Type | What it is |
| --- | --- |
| `Manifest` | Metadata of one published miniapp version: `id`, `version`, `entry` (the Module Federation exposed module, e.g. `"./Entry"`), `shared` deps it requires, `capabilities` it needs, and optional `integrity`, `signature` and `minHostContract`. |
| `SharedDepSpec` | A shared dependency: `name`, `requiredRange` (semver range) and whether it must be a `singleton`. |
| `HostContract` | What a host binary provides: `contractVersion`, `reactNative` version, `shared` singletons (name → concrete version) and `nativeModules` compiled in. The source of truth for compatibility. |
| `ResolveRequest` / `ResolveResponse` | Host → registry: "which version of miniapp `id` should I load?" (optionally for a `platform` and `version`). Registry → host: `version`, chunk `url` and its `manifest`. |
| `Capability` / `CapabilityGrant` | Scoped, revocable permissions the host grants a miniapp (`"accounts:read"`, `"session:whoami"`). Never a raw credential: the grant exposes `granted` and `isRevoked()`. |
| `MiniappEntryProps` | The props the host passes to a miniapp's exposed `Entry` component (`{ capabilities }`). |
| `MiniappId` / `SemVer` | Branded strings, produced only by `parseMiniappId` / `parseSemVer`. |

## Usage

### Validate data from the network

```ts
import { isManifest, isHostContract, parseMiniappId } from "@dentvega/miniapp-contract";

const res = await fetch(`${registry}/api/resolve?id=account_dashboard`);
const body = (await res.json()) as { manifest?: unknown };
if (!isManifest(body.manifest)) throw new Error("invalid manifest");
// body.manifest is now typed as Manifest

const id = parseMiniappId("account_dashboard"); // MiniappId | null
```

### Check a miniapp against a host

```ts
import { checkCompatibility, type HostContract } from "@dentvega/miniapp-contract";

const host: HostContract = {
  contractVersion: "0.1.0",
  reactNative: "0.76.6",
  shared: { react: "18.3.1", "react-native": "0.76.6", "@tanstack/react-query": "5.101.2" },
  nativeModules: ["react-native-screens"],
};

const report = checkCompatibility(
  host,
  manifest.shared,               // what the miniapp requires
  ["react-native-screens"],      // native modules the miniapp autolinks
);

report.compatible;      // true only if both checks pass
report.skew.entries;    // per dependency: "ok" | "missing" | "incompatible"
report.native.missing;  // native modules the host binary lacks
```

The two checks are also exported on their own:

- `satisfiesShared(hostProvided, miniappShared)` — resolves real semver ranges (compound,
  `||`, x-ranges) with the `semver` package.
- `checkNativeModules(hostNativeModules, miniappNativeModules)` — a native module only runs if it
  is compiled into the host binary.

### Implement a miniapp entry

```tsx
import type { MiniappEntryProps } from "@dentvega/miniapp-contract";

export default function Entry({ capabilities }: MiniappEntryProps) {
  if (capabilities.isRevoked() || !capabilities.granted.includes("accounts:read")) {
    return <PermissionScreen />;
  }
  return <Dashboard />;
}
```

## Related packages

- [`@dentvega/miniapp-runtime`](https://www.npmjs.com/package/@dentvega/miniapp-runtime) — host-side
  runtime that resolves, verifies and mounts miniapps using this contract.
- [`@dentvega/miniapp-storage`](https://www.npmjs.com/package/@dentvega/miniapp-storage) —
  multi-cloud storage for the published chunks.

## License

MIT
