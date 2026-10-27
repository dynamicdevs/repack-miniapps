import { s3Compatible } from "./s3compat.js";
import type { ChunkStorage, SignedFetch } from "./types.js";

export interface S3Config {
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** De dónde lee el host: el bucket público, o un CloudFront delante. */
  readonly publicBaseUrl: string;
}

/** Config de AWS S3 desde un env; null si falta alguna de las 4 obligatorias. */
export function s3ConfigFromEnv(env: Record<string, string | undefined>): S3Config | null {
  const bucket = env.AWS_S3_BUCKET;
  const region = env.AWS_REGION;
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  if (!bucket || !region || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    // Sin CDN explícito, se lee del propio bucket (requiere que sea público).
    publicBaseUrl: env.AWS_S3_PUBLIC_BASE_URL || `https://${bucket}.s3.${region}.amazonaws.com`,
  };
}

/** AWS S3, endpoint virtual-hosted. No necesita el pin de content-length que pide R2. */
export function s3Storage(config: S3Config, fetchImpl?: SignedFetch): ChunkStorage {
  return s3Compatible(
    {
      endpoint: `https://${config.bucket}.s3.${config.region}.amazonaws.com`,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      publicBaseUrl: config.publicBaseUrl,
    },
    fetchImpl,
  );
}
