import { hasHostBlock, hostKeyCandidates, selectVersion } from "@dentvega/miniapp-contract";
import type { ResolveRequest, ResolveResponse } from "@dentvega/miniapp-contract";
import type { ControlManifestClient } from "./controlManifestClient.js";
import type { FlagsClient } from "./FlagsClient.js";
import { ResolveFallbackError } from "./ResolveFallbackError.js";
import type { ResolveClient } from "./ResolveClient.js";

/**
 * Resolve guiado por el manifiesto de control firmado: flags (kill switch / canal) → versión
 * del manifiesto para este host y plataforma. El bloque del host se busca como
 * `host@contractVersion` y, si no está (control plane anterior al campo host), como
 * `contractVersion`. Sin ninguno, delega en el resolve legacy. Ignora `req.version`.
 */
export function manifestResolveClient(opts: {
  manifests: ControlManifestClient;
  flags: FlagsClient;
  legacy: ResolveClient;
  hostContractVersion: string;
  /** Nombre del host ("mi-banco"); sin él, solo la clave pelada. */
  host?: string;
  subject: () => string | null;
}): ResolveClient {
  const keys = hostKeyCandidates(opts.host, opts.hostContractVersion);
  return {
    async resolve(req: ResolveRequest): Promise<ResolveResponse> {
      const flags = await opts.flags.evaluate(req.id, opts.subject());
      if (!flags.available) throw new ResolveFallbackError("disabled", `${req.id} deshabilitada`);

      const body = await opts.manifests.current();
      if (!hasHostBlock(body, keys)) return opts.legacy.resolve(req);

      const selected = selectVersion(
        body,
        keys,
        req.id,
        flags.channel,
        req.platform ?? "android",
      );
      if (selected === null) {
        throw new ResolveFallbackError(
          "no-compatible-version",
          `${req.id} sin versión para el host ${keys[0]}`,
        );
      }
      const { artifact, entry, version } = selected;
      return {
        id: req.id,
        version,
        url: artifact.url,
        manifest: {
          ...entry.manifest,
          integrity: artifact.integrity,
          ...(artifact.signature !== undefined ? { signature: artifact.signature } : {}),
        },
      };
    },
  };
}
