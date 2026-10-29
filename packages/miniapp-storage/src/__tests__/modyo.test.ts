import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { modyoStorage, modyoConfigFromEnv, modyoWidgetName } from "../modyo.js";
import { availableProviders } from "../provider.js";
import { StorageError } from "../types.js";
import type { FetchInit, PlainFetch } from "../types.js";

const config = {
  accountUrl: "https://banco.modyo.cloud",
  siteId: "42",
  token: "tok",
  apiPath: "api/admin",
  publicUrlTemplate: "https://cdn.banco.cl/widgets/{widgetId}/",
  widgetPrefix: "miniapp",
};

const env = {
  MODYO_ACCOUNT_URL: "https://banco.modyo.cloud/",
  MODYO_SITE_ID: "42",
  MODYO_TOKEN: "tok",
  MODYO_PUBLIC_URL_TEMPLATE: "https://cdn.banco.cl/widgets/{widgetId}",
};

type Call = { url: string; init: FetchInit };

/** Fake de la API de Modyo: responde según método y ruta; `widgets` es lo que devuelve la búsqueda. */
function modyoFake(opts: { widgets?: { id: number; name: string }[]; fail?: string } = {}) {
  const calls: Call[] = [];
  const json = (status: number, body: unknown) => ({
    ok: status < 400,
    status,
    text: async () => JSON.stringify(body),
  });
  const fake: PlainFetch = async (url, init) => {
    calls.push({ url, init });
    const step = init.method === "GET" ? "search" : url.endsWith("/publish") ? "publish"
      : init.method === "POST" ? "create" : "update";
    if (opts.fail === step) return json(500, { error: "boom" });
    if (step === "search") return json(200, { widget_definitions: opts.widgets ?? [] });
    if (step === "create") return json(201, { id: 7 });
    return json(200, { id: 7 });
  };
  return { calls, fake };
}

/** Separa un multipart/form-data en sus partes: nombre del campo → bytes. */
function parseMultipart(body: Uint8Array, contentTypeHeader: string): Record<string, Uint8Array> {
  const boundary = contentTypeHeader.split("boundary=")[1]!;
  const raw = Buffer.from(body);
  const sep = Buffer.from(`--${boundary}`);
  const parts: Record<string, Uint8Array> = {};
  let start = raw.indexOf(sep) + sep.length;
  for (;;) {
    const next = raw.indexOf(sep, start);
    if (next === -1) break;
    const part = raw.subarray(start + 2, next - 2); // sin el CRLF de cada lado
    const headerEnd = part.indexOf("\r\n\r\n");
    const headers = part.subarray(0, headerEnd).toString();
    const name = /name="([^"]+)"/.exec(headers)![1]!;
    parts[name] = new Uint8Array(part.subarray(headerEnd + 4));
    start = next + sep.length;
  }
  return parts;
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("modyoConfigFromEnv", () => {
  it("null si falta alguna de las obligatorias", () => {
    expect(modyoConfigFromEnv({})).toBeNull();
    for (const key of Object.keys(env)) {
      expect(modyoConfigFromEnv({ ...env, [key]: "" })).toBeNull();
    }
  });
  it("por defecto Modyo 10 (api/admin) y nombres con prefijo miniapp", () => {
    const cfg = modyoConfigFromEnv(env)!;
    expect(cfg.accountUrl).toBe("https://banco.modyo.cloud");
    expect(cfg.apiPath).toBe("api/admin");
    expect(cfg.widgetPrefix).toBe("miniapp");
  });
  it("Modyo 8 usa api/v1 y una versión desconocida deja el provider sin configurar", () => {
    expect(modyoConfigFromEnv({ ...env, MODYO_VERSION: "8" })!.apiPath).toBe("api/v1");
    expect(modyoConfigFromEnv({ ...env, MODYO_VERSION: "7" })).toBeNull();
  });
  it("la plantilla de URL pública tiene que llevar {widgetId} o {name}", () => {
    expect(
      modyoConfigFromEnv({ ...env, MODYO_PUBLIC_URL_TEMPLATE: "https://cdn.banco.cl/widgets" }),
    ).toBeNull();
  });
});

describe("modyoWidgetName", () => {
  it("un widget por prefijo versionado, sin barras", () => {
    expect(modyoWidgetName("miniapp", "lab_saludo/0.1.18/ios")).toBe("miniapp-lab_saludo-0.1.18-ios");
  });
});

describe("modyoStorage.putMany", () => {
  const files = [
    { path: "lab_saludo.container.js.bundle", data: new Uint8Array([1, 2, 3]) },
    { path: "src_Entry.chunk.bundle", data: new Uint8Array([4, 5]) },
  ];

  it("crea el widget, sube el zip, lo publica y devuelve la URL de la plantilla", async () => {
    const { calls, fake } = modyoFake();
    const res = await modyoStorage(config, fake).putMany("lab_saludo/0.1.18", files);

    const api = "https://banco.modyo.cloud/api/admin/sites/42/widget_definitions";
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      `GET ${api}?query=miniapp-lab_saludo-0.1.18`,
      `POST ${api}`,
      `PUT ${api}/7`,
      `POST ${api}/7/publish`,
    ]);
    for (const c of calls) expect(c.init.headers!.authorization).toBe("Bearer tok");
    expect(JSON.parse(text(calls[1]!.init.body!))).toEqual({
      name: "miniapp-lab_saludo-0.1.18",
      read_only: true,
      public: true,
    });
    expect(res.baseUrl).toBe("https://cdn.banco.cl/widgets/7");
  });

  it("reusa el widget si ya existe con ese nombre exacto", async () => {
    const { calls, fake } = modyoFake({
      widgets: [
        { id: 3, name: "miniapp-lab_saludo-0.1.18-ios" },
        { id: 9, name: "miniapp-lab_saludo-0.1.18" },
      ],
    });
    await modyoStorage(config, fake).putMany("lab_saludo/0.1.18", files);
    expect(calls.map((c) => c.init.method)).toEqual(["GET", "PUT", "POST"]);
    expect(calls[1]!.url).toMatch(/\/widget_definitions\/9$/);
  });

  it("el zip lleva los archivos sin tocar y un index.html", async () => {
    const { calls, fake } = modyoFake();
    await modyoStorage(config, fake).putMany("lab_saludo/0.1.18", files);
    const put = calls[2]!;
    const parts = parseMultipart(put.init.body!, put.init.headers!["content-type"]!);
    expect(text(parts.id!)).toBe("7");
    expect(text(parts.public!)).toBe("true");
    expect(text(parts.entry_js!)).toBe("lab_saludo.container.js.bundle");
    const zip = unzipSync(parts.file!);
    expect(Object.keys(zip).sort()).toEqual([
      "index.html",
      "lab_saludo.container.js.bundle",
      "src_Entry.chunk.bundle",
    ]);
    expect([...zip["lab_saludo.container.js.bundle"]!]).toEqual([1, 2, 3]);
  });

  it("la plantilla puede usar el nombre del widget", async () => {
    const { fake } = modyoFake();
    const res = await modyoStorage(
      { ...config, publicUrlTemplate: "https://banco.cl/assets/{name}" },
      fake,
    ).putMany("lab_saludo/0.1.18/ios", files);
    expect(res.baseUrl).toBe("https://banco.cl/assets/miniapp-lab_saludo-0.1.18-ios");
  });

  it("sin archivos lanza StorageError", async () => {
    const { fake } = modyoFake();
    await expect(modyoStorage(config, fake).putMany("x/1.0.0", [])).rejects.toThrow(
      "no files to upload",
    );
  });

  for (const step of ["search", "create", "update", "publish"]) {
    it(`un error HTTP al ${step === "search" ? "buscar" : step} lanza StorageError`, async () => {
      const { fake } = modyoFake({ fail: step });
      await expect(
        modyoStorage(config, fake).putMany("lab_saludo/0.1.18", files),
      ).rejects.toBeInstanceOf(StorageError);
    });
  }

  it("una respuesta 200 con errors también es un fallo", async () => {
    const fake: PlainFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ errors: ["name taken"] }),
    });
    await expect(
      modyoStorage(config, fake).putMany("lab_saludo/0.1.18", files),
    ).rejects.toThrow(/name taken/);
  });

  it("una respuesta que no es JSON (proxy o WAF) es un fallo", async () => {
    const fake: PlainFetch = async () => ({ ok: true, status: 200, text: async () => "<html>" });
    await expect(
      modyoStorage(config, fake).putMany("lab_saludo/0.1.18", files),
    ).rejects.toBeInstanceOf(StorageError);
  });
});

describe("modyoStorage.deletePrefix", () => {
  it("no llama a Modyo: las versiones viejas se quedan publicadas", async () => {
    const { calls, fake } = modyoFake();
    await modyoStorage(config, fake).deletePrefix("lab_saludo/0.1.18");
    expect(calls).toEqual([]);
  });
});

describe("availableProviders con Modyo", () => {
  it("aparece solo con sus variables, detrás de s3", () => {
    expect(availableProviders({})).not.toContain("modyo");
    const s3Env = {
      AWS_ACCESS_KEY_ID: "a",
      AWS_SECRET_ACCESS_KEY: "b",
      AWS_REGION: "us-east-1",
      AWS_S3_BUCKET: "c",
    };
    expect(availableProviders({ ...s3Env, ...env })).toEqual(["s3", "modyo", "fs"]);
  });
});
