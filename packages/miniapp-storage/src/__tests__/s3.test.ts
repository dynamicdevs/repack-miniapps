import { describe, expect, it } from "vitest";
import { s3Storage, s3ConfigFromEnv } from "../s3.js";
import { availableProviders } from "../provider.js";
import type { FetchInit, SignedFetch } from "../types.js";

describe("s3ConfigFromEnv", () => {
  it("null si falta alguna var", () => {
    expect(s3ConfigFromEnv({ AWS_S3_BUCKET: "b" })).toBeNull();
  });
  it("usa el public base explícito si está", () => {
    expect(
      s3ConfigFromEnv({
        AWS_S3_BUCKET: "b",
        AWS_REGION: "us-east-1",
        AWS_ACCESS_KEY_ID: "ak",
        AWS_SECRET_ACCESS_KEY: "sk",
        AWS_S3_PUBLIC_BASE_URL: "https://cdn.example.com",
      })!.publicBaseUrl,
    ).toBe("https://cdn.example.com");
  });
  it("sin public base explícito, cae a la URL del bucket", () => {
    expect(
      s3ConfigFromEnv({
        AWS_S3_BUCKET: "b",
        AWS_REGION: "us-east-1",
        AWS_ACCESS_KEY_ID: "ak",
        AWS_SECRET_ACCESS_KEY: "sk",
      })!.publicBaseUrl,
    ).toBe("https://b.s3.us-east-1.amazonaws.com");
  });
});

describe("s3Storage", () => {
  it("escribe al endpoint virtual-hosted de la región, sin pinear content-length", async () => {
    const calls: { url: string; init: FetchInit }[] = [];
    const fake: SignedFetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => "" };
    };
    await s3Storage(
      {
        bucket: "my-bucket",
        region: "eu-west-1",
        accessKeyId: "ak",
        secretAccessKey: "sk",
        publicBaseUrl: "https://cdn.example.com",
      },
      fake,
    ).putMany("app/1.0.0", [{ path: "a.bundle", data: new Uint8Array([1]) }]);
    expect(calls[0]!.url).toBe("https://my-bucket.s3.eu-west-1.amazonaws.com/app/1.0.0/a.bundle");
    // AWS acepta chunked: pinear content-length es un workaround de R2, no va aquí.
    expect(calls[0]!.init.headers!["content-length"]).toBeUndefined();
  });
});

describe("availableProviders con S3", () => {
  it("detecta s3 y lo pone antes que fs", () => {
    expect(
      availableProviders({
        AWS_S3_BUCKET: "b",
        AWS_REGION: "us-east-1",
        AWS_ACCESS_KEY_ID: "ak",
        AWS_SECRET_ACCESS_KEY: "sk",
      }),
    ).toEqual(["s3", "fs"]);
  });
});
