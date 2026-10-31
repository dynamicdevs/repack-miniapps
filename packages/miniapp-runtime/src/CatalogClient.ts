/** The host asks Backstage for the published catalog to render a dynamic home. */
import { hostKey } from "@dentvega/miniapp-contract";

/** One row of the catalog (Backstage `GET /api/miniapps`). */
export interface MiniappSummary {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  /** Highest published version, or null if none is published yet. */
  readonly latestVersion: string | null;
  /**
   * Version the host actually serves (pinnedVersion ?? latest). Optional para
   * tolerar backends viejos que aún no lo exponen → el host cae a latestVersion.
   */
  readonly servedVersion?: string | null;
  readonly versionCount: number;
}

export interface CatalogClient {
  list(): Promise<readonly MiniappSummary[]>;
}

/**
 * HTTP client hitting Backstage `GET /api/miniapps`. Con `host`, pide estable y candidata de este
 * binario (`?host=host@contractVersion`), las mismas que su bloque del manifiesto.
 */
export function httpCatalogClient(
  baseUrl: string,
  host?: { hostContractVersion: string; host?: string },
): CatalogClient {
  const query =
    host !== undefined
      ? `?host=${encodeURIComponent(hostKey({ host: host.host, contractVersion: host.hostContractVersion }))}`
      : "";
  return {
    async list(): Promise<readonly MiniappSummary[]> {
      const url = `${baseUrl.replace(/\/+$/, "")}/api/miniapps${query}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`catalog failed: HTTP ${res.status}`);
      }
      const body = (await res.json()) as { miniapps?: MiniappSummary[] };
      return body.miniapps ?? [];
    },
  };
}
