import { s3Compatible } from "./s3compat.js";
import type { ChunkStorage, SignedFetch } from "./types.js";

export interface GcsConfig {
  readonly bucket: string;
  /** Access key HMAC de interoperabilidad (empieza con "GOOG"). */
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly publicBaseUrl: string;
}

/** Config de GCS desde un env; null si falta alguna de las 3 obligatorias. */
export function gcsConfigFromEnv(env: Record<string, string | undefined>): GcsConfig | null {
  const bucket = env.GCS_BUCKET;
  const accessKeyId = env.GCS_HMAC_ACCESS_KEY_ID;
  const secretAccessKey = env.GCS_HMAC_SECRET;
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: env.GCS_PUBLIC_BASE_URL || `https://storage.googleapis.com/${bucket}`,
  };
}

/**
 * Google Cloud Storage vía su XML API en modo interoperabilidad: habla SigV4 con claves
 * HMAC, así que reusa el mismo motor que S3 y R2. Limitación conocida: las claves HMAC son
 * estáticas — organizaciones que exijan workload identity necesitan un adapter nativo.
 */
export function gcsStorage(config: GcsConfig, fetchImpl?: SignedFetch): ChunkStorage {
  return s3Compatible(
    {
      endpoint: `https://storage.googleapis.com/${config.bucket}`,
      region: "auto",
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      publicBaseUrl: config.publicBaseUrl,
    },
    fetchImpl,
  );
}
