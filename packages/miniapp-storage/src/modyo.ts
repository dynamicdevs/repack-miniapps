import { zipSync } from "fflate";
import { StorageError, type ChunkStorage, type FetchResponse, type PlainFetch } from "./types.js";

export interface ModyoConfig {
  /** URL de la cuenta, sin barra final (p. ej. https://banco.modyo.cloud). */
  readonly accountUrl: string;
  readonly siteId: string;
  /** Token de acceso a la API de administración de Modyo. */
  readonly token: string;
  /** "api/admin" en Modyo 9 y 10; "api/v1" en Modyo 8. */
  readonly apiPath: string;
  /**
   * URL pública de los archivos de un widget, con {widgetId} y/o {name}. Modyo no la devuelve
   * en la API, así que se fija por configuración tras ver dónde sirve un widget publicado.
   */
  readonly publicUrlTemplate: string;
  /** Inicio del nombre de cada widget, para distinguirlos en el sitio. */
  readonly widgetPrefix: string;
}

const API_PATHS: Record<string, string> = { "8": "api/v1", "9": "api/admin", "10": "api/admin" };

/** Config de Modyo desde un env; null si falta alguna de las 4 obligatorias o no es válida. */
export function modyoConfigFromEnv(
  env: Record<string, string | undefined>,
): ModyoConfig | null {
  const accountUrl = env.MODYO_ACCOUNT_URL;
  const siteId = env.MODYO_SITE_ID;
  const token = env.MODYO_TOKEN;
  const template = env.MODYO_PUBLIC_URL_TEMPLATE;
  if (!accountUrl || !siteId || !token || !template) return null;
  const apiPath = API_PATHS[env.MODYO_VERSION || "10"];
  if (apiPath === undefined) return null;
  if (!template.includes("{widgetId}") && !template.includes("{name}")) return null;
  return {
    accountUrl: accountUrl.replace(/\/+$/, ""),
    siteId,
    token,
    apiPath,
    publicUrlTemplate: template,
    widgetPrefix: env.MODYO_WIDGET_PREFIX || "miniapp",
  };
}

/** Un widget por prefijo versionado: "lab_saludo/0.1.18/ios" → "miniapp-lab_saludo-0.1.18-ios". */
export function modyoWidgetName(widgetPrefix: string, prefix: string): string {
  return `${widgetPrefix}-${prefix.replaceAll("/", "-")}`;
}

/** Cuerpo multipart/form-data con campos de texto y un archivo. */
function multipart(
  fields: Record<string, string>,
  file: { field: string; name: string; type: string; data: Uint8Array },
): { body: Uint8Array; contentType: string } {
  const boundary = `----miniapp${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      enc.encode(
        `--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    enc.encode(
      `--${boundary}\r\ncontent-disposition: form-data; name="${file.field}"; ` +
        `filename="${file.name}"\r\ncontent-type: ${file.type}\r\n\r\n`,
    ),
    file.data,
    enc.encode(`\r\n--${boundary}--\r\n`),
  );
  const body = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const p of parts) {
    body.set(p, offset);
    offset += p.byteLength;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * Modyo, con la misma API que usa `modyo-cli push --zip`: cada prefijo versionado es un widget
 * (buscar o crear → PUT con el zip → publicar). No se usa el CLI porque su zip solo lleva
 * .js/.json/.css/.wasm del primer nivel y descarta los .bundle de Re.Pack.
 *
 * deletePrefix no hace nada: la API no documenta el borrado de widgets y el prune no debe
 * tocar recursos del sitio a ciegas. Las versiones podadas quedan publicadas en Modyo.
 */
export function modyoStorage(config: ModyoConfig, fetchImpl?: PlainFetch): ChunkStorage {
  const doFetch: PlainFetch =
    fetchImpl ??
    (async (url, init) => {
      const res = await fetch(url, init as RequestInit);
      return { ok: res.ok, status: res.status, text: () => res.text() };
    });
  const api = `${config.accountUrl}/${config.apiPath}/sites/${config.siteId}/widget_definitions`;
  const auth = { authorization: `Bearer ${config.token}`, accept: "application/json" };
  const enc = new TextEncoder();

  /** JSON de la respuesta; error si el HTTP falla, si no es JSON o si trae errors/error. */
  async function readJson(res: FetchResponse, step: string): Promise<Record<string, unknown>> {
    if (!res.ok) throw new StorageError(`Modyo ${step} failed: HTTP ${res.status}`);
    const raw = await res.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new StorageError(`Modyo ${step} failed: the response is not JSON`);
    }
    if (json.errors !== undefined || json.error !== undefined) {
      throw new StorageError(
        `Modyo ${step} failed: ${JSON.stringify(json.errors ?? json.error)}`,
      );
    }
    return json;
  }

  function sendJson(url: string, method: string, body: unknown) {
    return doFetch(url, {
      method,
      body: enc.encode(JSON.stringify(body)),
      headers: { ...auth, "content-type": "application/json" },
    });
  }

  async function widgetId(name: string): Promise<string> {
    const found = await readJson(
      await doFetch(`${api}?query=${encodeURIComponent(name)}`, { method: "GET", headers: auth }),
      "search",
    );
    const list = (found.widget_definitions ?? []) as { id: number | string; name: string }[];
    const existing = list.find((w) => w.name === name);
    if (existing !== undefined) return String(existing.id);
    const created = await readJson(
      await sendJson(api, "POST", { name, read_only: true, public: true }),
      "create",
    );
    return String(created.id);
  }

  return {
    async putMany(prefix, files): Promise<{ baseUrl: string }> {
      if (files.length === 0) throw new StorageError("no files to upload");
      const name = modyoWidgetName(config.widgetPrefix, prefix);
      try {
        const id = await widgetId(name);
        const entries: Record<string, Uint8Array> = {};
        for (const file of files) entries[file.path] = file.data;
        // El CLI siempre sube un index.html; se mantiene por si Modyo lo exige en el zip.
        entries["index.html"] ??= enc.encode("<!doctype html><title>miniapp</title>\n");
        const entryJs = files.find((f) => f.path.endsWith(".container.js.bundle"))?.path ?? "";
        const { body, contentType } = multipart(
          { id, public: "true", entry_js: entryJs, entry_css: "" },
          { field: "file", name: "widget.zip", type: "application/zip", data: zipSync(entries) },
        );
        await readJson(
          await doFetch(`${api}/${id}`, {
            method: "PUT",
            body,
            headers: { ...auth, "content-type": contentType },
          }),
          "update",
        );
        await readJson(
          await sendJson(`${api}/${id}/publish`, "POST", {
            widget: { publish_at: "", unpublish_at: "" },
          }),
          "publish",
        );
        const baseUrl = config.publicUrlTemplate
          .replaceAll("{widgetId}", id)
          .replaceAll("{name}", name)
          .replace(/\/+$/, "");
        return { baseUrl };
      } catch (err) {
        if (err instanceof StorageError) throw err;
        throw new StorageError(err instanceof Error ? err.message : "Modyo upload failed");
      }
    },
    async deletePrefix(): Promise<void> {},
  };
}
