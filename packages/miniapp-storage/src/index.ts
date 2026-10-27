export type {
  ChunkStorage,
  StorageFile,
  SignedFetch,
  PlainFetch,
  FetchInit,
  FetchResponse,
  PutCall,
} from "./types.js";
export { StorageError } from "./types.js";
export { s3Compatible, contentType, signedFetchFor, type S3CompatConfig } from "./s3compat.js";
export { r2Storage, r2ConfigFromEnv, type R2Config } from "./r2.js";
export { s3Storage, s3ConfigFromEnv, type S3Config } from "./s3.js";
export { gcsStorage, gcsConfigFromEnv, type GcsConfig } from "./gcs.js";
export { azureStorage, azureConfigFromEnv, type AzureConfig } from "./azure.js";
export { fsStorage } from "./fs.js";
export { mockStorage } from "./mock.js";
export {
  availableProviders,
  selectStorage,
  isStorageProvider,
  type StorageProvider,
} from "./provider.js";
// blobStorage NO se exporta aquí: vive en "@dentvega/miniapp-storage/vercel-blob"
// porque @vercel/blob es un peer opcional.
