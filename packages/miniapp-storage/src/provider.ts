import { r2ConfigFromEnv } from "./r2.js";
import { s3ConfigFromEnv } from "./s3.js";
import { gcsConfigFromEnv } from "./gcs.js";
import { azureConfigFromEnv } from "./azure.js";
import { modyoConfigFromEnv } from "./modyo.js";

export type StorageProvider = "s3" | "r2" | "gcs" | "azure" | "modyo" | "blob" | "fs";

const ALL: readonly StorageProvider[] = ["s3", "r2", "gcs", "azure", "modyo", "blob", "fs"];

export function isStorageProvider(v: unknown): v is StorageProvider {
  return typeof v === "string" && (ALL as readonly string[]).includes(v);
}

/** Providers configurados por env, en orden de precedencia. `fs` siempre está. */
export function availableProviders(env: Record<string, string | undefined>): StorageProvider[] {
  const out: StorageProvider[] = [];
  if (s3ConfigFromEnv(env) !== null) out.push("s3");
  if (r2ConfigFromEnv(env) !== null) out.push("r2");
  if (gcsConfigFromEnv(env) !== null) out.push("gcs");
  if (azureConfigFromEnv(env) !== null) out.push("azure");
  if (modyoConfigFromEnv(env) !== null) out.push("modyo");
  if (env.BLOB_READ_WRITE_TOKEN) out.push("blob");
  out.push("fs");
  return out;
}

/**
 * Provider efectivo: override de la miniapp → preferencia global → primero del env-order.
 * Un valor que no esté en `available` se ignora (nunca deja al consumidor sin storage).
 */
export function selectStorage(
  available: readonly StorageProvider[],
  preference: StorageProvider | null,
  override: StorageProvider | null,
): StorageProvider {
  if (override !== null && available.includes(override)) return override;
  if (preference !== null && available.includes(preference)) return preference;
  return available[0]!;
}
