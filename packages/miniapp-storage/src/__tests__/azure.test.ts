import { describe, expect, it } from "vitest";
import { azureStorage, azureConfigFromEnv } from "../azure.js";
import { availableProviders } from "../provider.js";
import { StorageError } from "../types.js";
import type { FetchInit, PlainFetch } from "../types.js";

const config = {
  account: "myaccount",
  container: "chunks",
  sasToken: "sv=2024-01-01&sig=abc",
  publicBaseUrl: "https://myaccount.blob.core.windows.net/chunks",
};

function recorder(listXml?: string) {
  const calls: { url: string; init: FetchInit }[] = [];
  const fake: PlainFetch = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "GET") {
      return { ok: true, status: 200, text: async () => listXml ?? "" };
    }
    return { ok: true, status: 200, text: async () => "" };
  };
  return { calls, fake };
}

describe("azureConfigFromEnv", () => {
  it("null si falta alguna var", () => {
    expect(azureConfigFromEnv({ AZURE_STORAGE_ACCOUNT: "a" })).toBeNull();
  });
  it("arma el public base por defecto", () => {
    expect(
      azureConfigFromEnv({
        AZURE_STORAGE_ACCOUNT: "myaccount",
        AZURE_STORAGE_CONTAINER: "chunks",
        AZURE_STORAGE_SAS_TOKEN: "sv=x",
      })!.publicBaseUrl,
    ).toBe("https://myaccount.blob.core.windows.net/chunks");
  });
  it("acepta el SAS con '?' adelante y lo normaliza", () => {
    expect(
      azureConfigFromEnv({
        AZURE_STORAGE_ACCOUNT: "a",
        AZURE_STORAGE_CONTAINER: "c",
        AZURE_STORAGE_SAS_TOKEN: "?sv=x",
      })!.sasToken,
    ).toBe("sv=x");
  });
});

describe("azureStorage.putMany", () => {
  it("PUTea con x-ms-blob-type y el SAS en la querystring", async () => {
    const { calls, fake } = recorder();
    const res = await azureStorage(config, fake).putMany("app/1.0.0", [
      { path: "a.bundle", data: new Uint8Array([1, 2]) },
    ]);
    expect(calls[0]!.url).toBe(
      "https://myaccount.blob.core.windows.net/chunks/app/1.0.0/a.bundle?sv=2024-01-01&sig=abc",
    );
    expect(calls[0]!.init.method).toBe("PUT");
    expect(calls[0]!.init.headers!["x-ms-blob-type"]).toBe("BlockBlob");
    expect(calls[0]!.init.headers!["content-type"]).toBe("application/javascript");
    expect(res.baseUrl).toBe("https://myaccount.blob.core.windows.net/chunks/app/1.0.0");
  });

  it("tira StorageError si no hay archivos", async () => {
    const { fake } = recorder();
    await expect(azureStorage(config, fake).putMany("p", [])).rejects.toThrow(StorageError);
  });

  it("tira StorageError si el PUT devuelve no-ok", async () => {
    const fake: PlainFetch = async () => ({ ok: false, status: 403, text: async () => "" });
    await expect(
      azureStorage(config, fake).putMany("p", [{ path: "a", data: new Uint8Array([1]) }]),
    ).rejects.toThrow(/403/);
  });
});

describe("azureStorage.deletePrefix", () => {
  it("lista el container por prefijo y borra cada blob por su Name", async () => {
    const xml =
      "<EnumerationResults><Blobs>" +
      "<Blob><Name>app/1.0.0/a.bundle</Name></Blob>" +
      "<Blob><Name>app/1.0.0/b.bundle</Name></Blob>" +
      "</Blobs></EnumerationResults>";
    const { calls, fake } = recorder(xml);
    await azureStorage(config, fake).deletePrefix("app/1.0.0");
    expect(calls[0]!.url).toContain("restype=container&comp=list");
    expect(calls[0]!.url).toContain(encodeURIComponent("app/1.0.0/"));
    const deletes = calls.filter((c) => c.init.method === "DELETE").map((c) => c.url);
    expect(deletes).toEqual([
      "https://myaccount.blob.core.windows.net/chunks/app/1.0.0/a.bundle?sv=2024-01-01&sig=abc",
      "https://myaccount.blob.core.windows.net/chunks/app/1.0.0/b.bundle?sv=2024-01-01&sig=abc",
    ]);
  });

  it("no borra nada si el listado falla (best-effort)", async () => {
    const methods: string[] = [];
    const fake: PlainFetch = async (_url, init) => {
      methods.push(init.method);
      return { ok: false, status: 500, text: async () => "" };
    };
    await azureStorage(config, fake).deletePrefix("p");
    expect(methods).toEqual(["GET"]);
  });
});

describe("availableProviders con Azure", () => {
  it("detecta azure", () => {
    expect(
      availableProviders({
        AZURE_STORAGE_ACCOUNT: "a",
        AZURE_STORAGE_CONTAINER: "c",
        AZURE_STORAGE_SAS_TOKEN: "sv=x",
      }),
    ).toEqual(["azure", "fs"]);
  });
});

describe("azureConfigFromEnv con variables vacías (Docker Compose)", () => {
  it("AZURE_STORAGE_PUBLIC_BASE_URL vacía cae a la URL del contenedor", () => {
    const cfg = azureConfigFromEnv({
      AZURE_STORAGE_ACCOUNT: "acct",
      AZURE_STORAGE_CONTAINER: "chunks",
      AZURE_STORAGE_SAS_TOKEN: "sv=1",
      AZURE_STORAGE_PUBLIC_BASE_URL: "",
    });
    expect(cfg!.publicBaseUrl).toBe("https://acct.blob.core.windows.net/chunks");
  });
});
