import { contentType } from "./s3compat.js";
import { StorageError, type ChunkStorage, type PlainFetch } from "./types.js";

export interface AzureConfig {
  readonly account: string;
  readonly container: string;
  /** SAS token SIN el "?" inicial. Es lo que autentica cada request. */
  readonly sasToken: string;
  readonly publicBaseUrl: string;
}

/** Config de Azure desde un env; null si falta alguna de las 3 obligatorias. */
export function azureConfigFromEnv(
  env: Record<string, string | undefined>,
): AzureConfig | null {
  const account = env.AZURE_STORAGE_ACCOUNT;
  const container = env.AZURE_STORAGE_CONTAINER;
  const raw = env.AZURE_STORAGE_SAS_TOKEN;
  if (!account || !container || !raw) return null;
  return {
    account,
    container,
    sasToken: raw.replace(/^\?/, ""),
    publicBaseUrl:
      env.AZURE_STORAGE_PUBLIC_BASE_URL ||
      `https://${account}.blob.core.windows.net/${container}`,
  };
}

/**
 * Azure Blob Storage. NO es S3-compatible, así que no reusa el motor s3Compatible:
 * autentica por SAS token en la querystring (sin firmar nada), marca cada blob con
 * `x-ms-blob-type: BlockBlob`, y su XML de listado usa <Name> en vez de <Key>.
 */
export function azureStorage(config: AzureConfig, fetchImpl?: PlainFetch): ChunkStorage {
  const doFetch: PlainFetch =
    fetchImpl ??
    (async (url, init) => {
      const res = await fetch(url, init as RequestInit);
      return { ok: res.ok, status: res.status, text: () => res.text() };
    });
  const base = `https://${config.account}.blob.core.windows.net/${config.container}`;
  const publicBase = config.publicBaseUrl.replace(/\/+$/, "");
  const sas = config.sasToken;
  return {
    async putMany(prefix, files): Promise<{ baseUrl: string }> {
      if (files.length === 0) throw new StorageError("no files to upload");
      try {
        for (const file of files) {
          const res = await doFetch(`${base}/${prefix}/${file.path}?${sas}`, {
            method: "PUT",
            body: file.data,
            headers: {
              "x-ms-blob-type": "BlockBlob",
              "content-type": contentType(file.path),
              "content-length": String(file.data.byteLength),
            },
          });
          if (!res.ok) throw new StorageError(`Azure PUT failed: HTTP ${res.status}`);
        }
      } catch (err) {
        if (err instanceof StorageError) throw err;
        throw new StorageError(err instanceof Error ? err.message : "Azure upload failed");
      }
      return { baseUrl: `${publicBase}/${prefix}` };
    },
    async deletePrefix(prefix): Promise<void> {
      // Listado del container por prefijo → DELETE por blob. Best-effort, igual que S3.
      const listUrl =
        `${base}?restype=container&comp=list` +
        `&prefix=${encodeURIComponent(`${prefix}/`)}&${sas}`;
      const listRes = await doFetch(listUrl, { method: "GET" });
      if (!listRes.ok) return;
      const xml = await listRes.text();
      const names = [...xml.matchAll(/<Name>([^<]+)<\/Name>/g)].map((m) => m[1]!);
      for (const name of names) {
        await doFetch(`${base}/${name}?${sas}`, { method: "DELETE" });
      }
    },
  };
}
