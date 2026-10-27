import { describe, expect, it } from "vitest";
import { gcsStorage, gcsConfigFromEnv } from "../gcs.js";
import { availableProviders } from "../provider.js";
import type { FetchInit, SignedFetch } from "../types.js";

const env = {
  GCS_BUCKET: "my-bucket",
  GCS_HMAC_ACCESS_KEY_ID: "GOOG1EXAMPLE",
  GCS_HMAC_SECRET: "sk",
};

describe("gcsConfigFromEnv", () => {
  it("null si falta alguna var", () => {
    expect(gcsConfigFromEnv({ GCS_BUCKET: "b" })).toBeNull();
  });
  it("sin public base explícito, cae a la URL pública de GCS", () => {
    expect(gcsConfigFromEnv(env)!.publicBaseUrl).toBe("https://storage.googleapis.com/my-bucket");
  });
});

describe("gcsStorage", () => {
  it("escribe al endpoint XML de GCS con region auto", async () => {
    const calls: { url: string; init: FetchInit }[] = [];
    const fake: SignedFetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => "" };
    };
    const res = await gcsStorage(
      {
        bucket: "my-bucket",
        accessKeyId: "GOOG1EXAMPLE",
        secretAccessKey: "sk",
        publicBaseUrl: "https://storage.googleapis.com/my-bucket",
      },
      fake,
    ).putMany("app/1.0.0", [{ path: "a.bundle", data: new Uint8Array([1]) }]);
    expect(calls[0]!.url).toBe("https://storage.googleapis.com/my-bucket/app/1.0.0/a.bundle");
    expect(res.baseUrl).toBe("https://storage.googleapis.com/my-bucket/app/1.0.0");
  });
});

describe("availableProviders con GCS", () => {
  it("detecta gcs", () => {
    expect(availableProviders(env)).toEqual(["gcs", "fs"]);
  });
});

describe("gcsConfigFromEnv con variables vacías (Docker Compose)", () => {
  it("GCS_PUBLIC_BASE_URL vacía cae a la URL pública de GCS", () => {
    expect(gcsConfigFromEnv({ ...env, GCS_PUBLIC_BASE_URL: "" })!.publicBaseUrl).toBe(
      "https://storage.googleapis.com/my-bucket",
    );
  });
});
