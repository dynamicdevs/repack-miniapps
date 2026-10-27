# @dentvega/miniapp-storage

Multi-cloud storage for the chunks of a [Re.Pack](https://re-pack.dev/) / Module Federation
miniapp platform. One small interface, interchangeable adapters:

| Adapter | Provider | Auth |
| --- | --- | --- |
| `r2Storage` | Cloudflare R2 | S3 API (SigV4) |
| `s3Storage` | AWS S3 (optionally behind CloudFront) | SigV4 |
| `gcsStorage` | Google Cloud Storage | HMAC interoperability keys (SigV4) |
| `azureStorage` | Azure Blob Storage | SAS token |
| `blobStorage` | Vercel Blob (subpath `@dentvega/miniapp-storage/vercel-blob`) | `BLOB_READ_WRITE_TOKEN` |
| `fsStorage` | Local filesystem (development) | — |
| `mockStorage` | In-memory (tests) | — |

Requests are signed with [`aws4fetch`](https://github.com/mhart/aws4fetch) instead of the cloud
SDKs, so the package stays small and runs on Node.js and edge/serverless runtimes alike.

## Install

```bash
npm install @dentvega/miniapp-storage
```

ESM only. Node.js >= 20. MIT. `@vercel/blob` is an **optional** peer dependency: install it only
if you use the Vercel Blob adapter.

## The interface

Every adapter implements the same two methods, so switching providers is a config change:

```ts
interface ChunkStorage {
  /** Uploads every file under `prefix/` and returns the public base URL of that prefix. */
  putMany(prefix: string, files: readonly StorageFile[]): Promise<{ baseUrl: string }>;
  /** Deletes every object under `prefix/` (best-effort; used to prune old versions). */
  deletePrefix(prefix: string): Promise<void>;
}

interface StorageFile {
  path: string;      // relative to the prefix, e.g. "ios/my-app.container.js.bundle"
  data: Uint8Array;
}
```

Failures throw a `StorageError` (`code: "STORAGE_ERROR"`).

## Usage

```ts
import { r2Storage } from "@dentvega/miniapp-storage";

const storage = r2Storage({
  accountId: process.env.R2_ACCOUNT_ID!,
  accessKeyId: process.env.R2_ACCESS_KEY_ID!,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  bucket: "miniapps",
  publicBaseUrl: "https://pub-xxxx.r2.dev", // where the app downloads from
});

const { baseUrl } = await storage.putMany("account_dashboard/0.1.19", [
  { path: "account_dashboard.container.js.bundle", data: androidBundle },
  { path: "ios/account_dashboard.container.js.bundle", data: iosBundle },
]);
// baseUrl → "https://pub-xxxx.r2.dev/account_dashboard/0.1.19"
```

`publicBaseUrl` is where the host **reads** from, and can differ from the write endpoint (an R2
public domain, a CloudFront distribution, a CDN).

### Configuration from environment variables

Each cloud adapter has a `...ConfigFromEnv(env)` helper that returns its config, or `null` when
the variables are missing:

| Provider | Variables |
| --- | --- |
| R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` |
| S3 | `AWS_S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_S3_PUBLIC_BASE_URL` |
| GCS | `GCS_BUCKET`, `GCS_HMAC_ACCESS_KEY_ID`, `GCS_HMAC_SECRET`, optional `GCS_PUBLIC_BASE_URL` |
| Azure | `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER`, `AZURE_STORAGE_SAS_TOKEN`, optional `AZURE_STORAGE_PUBLIC_BASE_URL` |
| Vercel Blob | `BLOB_READ_WRITE_TOKEN` |

```ts
import { r2ConfigFromEnv, r2Storage } from "@dentvega/miniapp-storage";

const config = r2ConfigFromEnv(process.env);
if (config) storage = r2Storage(config);
```

### Picking a provider

When several providers are configured, `availableProviders(env)` lists them in precedence order
(`s3`, `r2`, `gcs`, `azure`, `blob`, and always `fs` last), and `selectStorage` picks the
effective one:

```ts
import { availableProviders, selectStorage } from "@dentvega/miniapp-storage";

const available = availableProviders(process.env);
// per-miniapp override → global preference → first available
const provider = selectStorage(available, globalPreference, miniappOverride);
```

A preference or override that isn't configured is ignored, so the caller is never left without
storage.

### Vercel Blob

```ts
import { blobStorage } from "@dentvega/miniapp-storage/vercel-blob";

const storage = blobStorage(); // uses BLOB_READ_WRITE_TOKEN, or pass a token
```

### Local development and tests

```ts
import { fsStorage, mockStorage } from "@dentvega/miniapp-storage";

const local = fsStorage("./public/chunks", "http://localhost:3000/chunks");
const fake = mockStorage(); // fake.puts / fake.deletes record every call
```

## Related packages

- [`@dentvega/miniapp-contract`](https://www.npmjs.com/package/@dentvega/miniapp-contract) — the
  manifest and compatibility contract of the platform.
- [`@dentvega/miniapp-runtime`](https://www.npmjs.com/package/@dentvega/miniapp-runtime) — the
  host-side runtime that downloads and verifies these chunks.

## License

MIT
