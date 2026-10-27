# @dentvega/miniapp-runtime

Host-side runtime for React Native apps that load miniapps with Re.Pack / Module Federation:
**resolve → verify → mount → fallback**.

- Resolves the served version from your registry (`httpResolveClient`, with a per-version cache).
- Checks shared-dependency skew and `minHostContract` before mounting.
- Verifies chunk integrity (SHA-256) and Ed25519 signatures against a signed trust bundle
  (`warn` or `enforce`).
- Auto-retries transient failures, reports metrics, and falls back without crashing.

It is **headless**: it ships no design system. Bring your own loading and error UI, and your own
`ChunkLoader` (the Re.Pack / Module Federation wiring stays in your app).

## Install

```bash
npm install @dentvega/miniapp-runtime @dentvega/miniapp-contract
```

`@dentvega/miniapp-contract` is a dependency of this package, but install it explicitly: the
usage example below imports `parseMiniappId`/`parseSemVer` and contract types directly from it,
and a transitive dependency isn't importable under pnpm's (or any strict installer's) default
node_modules layout.

`react` (>=18) and `react-native` (>=0.76) are peer dependencies.

## Usage

```tsx
import { useEffect, useMemo } from "react";
import {
  MiniappHost,
  httpResolveClient,
  sha256Verifier,
  createScopedGrant,
  type ChunkLoader,
  type HostProvided,
} from "@dentvega/miniapp-runtime";
import { parseMiniappId, parseSemVer } from "@dentvega/miniapp-contract";

const resolveClient = httpResolveClient("https://registry.example.com");

const chunkLoader: ChunkLoader = {
  async load(resolved) {
    // Your Re.Pack / Module Federation container loader: use `resolved.url` and
    // `resolved.manifest.entry` (e.g. "./Entry") to load and return the miniapp's
    // exposed Entry component. This wiring stays in your app.
    throw new Error("TODO: implement your ChunkLoader");
  },
};

const version = (v: string) => parseSemVer(v)!;
const hostProvided: HostProvided = {
  react: version("19.1.0"),
  "react-native": version("0.80.0"),
};

export function MiniappScreen({ id }: { id: string }) {
  // Wrap in useMemo: `capabilities` is compared by reference (isRevoked closes over
  // `revoked`), so a new grant on every render would make the entry remount. Keep the
  // `revoke` function too — call it (e.g. on unmount, or when the user's permissions
  // change) to invalidate the grant the miniapp is holding.
  const { grant, revoke } = useMemo(() => createScopedGrant(["accounts:read"]), []);
  useEffect(() => revoke, [revoke]);
  const miniappId = parseMiniappId(id);
  if (miniappId === null) return null; // invalid id, handle as you see fit

  return (
    <MiniappHost
      id={miniappId}
      resolveClient={resolveClient}
      chunkLoader={chunkLoader}
      hostProvided={hostProvided}
      capabilities={grant}
      integrity={sha256Verifier()}
      render={{ loading: MyLoading, error: MyError }}
    />
  );
}
```

### Custom UI

```ts
render?: {
  loading?: ComponentType<{ retrying: boolean }>;
  error?: ComponentType<{ reason: FallbackReason; retryable: boolean; onRetry: () => void }>;
}
```

Without `render`, plain React Native primitives are used, with the English messages in
`DEFAULT_FALLBACK_MESSAGES`.

`loading`/`error` must be stable references — declare them at module level (like `MyLoading`/
`MyError` above) or wrap them in `useMemo`/`useCallback` if you build them inline. Passing a new
component identity on every render of your screen makes React unmount and remount the miniapp's
loading/error view on every render.

## Registry API

The clients in this package call the following endpoints on the `baseUrl` you pass them
(the registry is referred to as "Backstage" in the code and docs below):

| Client | Method | Path | Notes |
| --- | --- | --- | --- |
| `httpResolveClient` (`src/ResolveClient.ts`) | `GET` | `/api/resolve` | Query params: `id` (required), `hostVersion?`, `version?`, `platform?`. |
| `httpCatalogClient` (`src/CatalogClient.ts`) | `GET` | `/api/miniapps` | No params. Returns `{ miniapps: MiniappSummary[] }`. |
| `httpMetricsClient` (`src/MetricsClient.ts`) | `POST` | `/api/metrics` | Body `{ events: [MetricEvent] }`. Fire-and-forget: errors are swallowed. |
| `httpTrustBundleClient` (`src/trustBundle.ts`) | `GET` | `/api/trust-bundle` | No params. Returns a `{ bundle, signature }` envelope signed by the root key. |

## Signature verification

Signature verification is **off by default**. It only runs when you pass a `signature` client to
`MiniappHost`/`useMiniapp` (built with `signatureVerifier(httpTrustBundleClient(baseUrl,
rootPublicKey))`, where `rootPublicKey` is your pinned root Ed25519 public key, base64url-encoded).

```ts
import {
  signatureVerifier,
  httpTrustBundleClient,
} from "@dentvega/miniapp-runtime";

const signature = signatureVerifier(
  httpTrustBundleClient("https://registry.example.com", rootPublicKeyB64url),
);
```

`signatureMode` controls what happens on a bad or missing signature once a `signature` client is
passed (default `"warn"`):

- `"warn"` — mounts the miniapp anyway and reports a `fallback` metric with the reason
  (`invalid-signature` or `unknown-key`), so you can see rollout issues without breaking users.
- `"enforce"` — blocks the mount and shows the fallback UI with that reason.

With no `signature` client, verification is skipped entirely (`SignatureResult` is `"skip"`) and
nothing mounts or blocks on it.

## License

MIT
