import type { ControlManifestBody, ResolveResponse, SemVer, MiniappId, Manifest } from "@dentvega/miniapp-contract";
import { manifestResolveClient } from "../manifestResolveClient.js";
import type { FlagsClient, FlagsResult } from "../FlagsClient.js";
import type { ResolveClient } from "../ResolveClient.js";

const ID = "acc" as MiniappId;
const HOST = "0.2.0";
const m = (v: string): Manifest => ({
  id: ID,
  version: v as SemVer,
  entry: "./Entry",
  shared: [],
  capabilities: [],
});
const body: ControlManifestBody = {
  schema: 1,
  seq: 1,
  issuedAt: "2026-10-21T00:00:00.000Z",
  expiresAt: "2026-10-28T00:00:00.000Z",
  hosts: { [HOST]: { acc: { stable: "1.0.0" as SemVer, candidate: "1.1.0" as SemVer } } },
  versions: {
    acc: {
      "1.0.0": {
        manifest: m("1.0.0"),
        android: { url: "http://a/1.0.0-android", integrity: "sha256-A1", signature: "SA1" },
        ios: { url: "http://a/1.0.0-ios", integrity: "sha256-I1" },
      },
      "1.1.0": {
        manifest: m("1.1.0"),
        android: { url: "http://a/1.1.0-android", integrity: "sha256-A2", signature: "SA2" },
      },
    },
  },
};
const legacyResp: ResolveResponse = { id: ID, version: "9.9.9" as SemVer, url: "http://legacy", manifest: m("9.9.9") };

function make(flags: FlagsResult, b: ControlManifestBody = body, host = HOST, hostName?: string) {
  let legacyCalls = 0;
  const legacy: ResolveClient = {
    resolve: async () => {
      legacyCalls++;
      return legacyResp;
    },
  };
  const flagsClient: FlagsClient = { evaluate: async () => flags };
  const client = manifestResolveClient({
    manifests: { current: async () => b },
    flags: flagsClient,
    legacy,
    hostContractVersion: host,
    ...(hostName !== undefined ? { host: hostName } : {}),
    subject: () => "u1",
  });
  return { client, legacyCalls: () => legacyCalls };
}

describe("manifestResolveClient", () => {
  it("available=false → disabled", async () => {
    const { client } = make({ available: false, channel: "stable" });
    await expect(client.resolve({ id: ID, platform: "android" })).rejects.toMatchObject({ reason: "disabled" });
  });

  it("con host: usa el bloque host@cv antes que el pelado", async () => {
    const b = { ...body, hosts: { ...body.hosts, "mi-banco@0.2.0": { acc: { stable: "1.1.0" as SemVer } } } };
    const { client } = make({ available: true, channel: "stable" }, b, HOST, "mi-banco");
    expect((await client.resolve({ id: ID, platform: "android" })).version).toBe("1.1.0");
  });

  it("con host y control plane viejo (solo bloque pelado) → usa el pelado", async () => {
    const { client, legacyCalls } = make({ available: true, channel: "stable" }, body, HOST, "mi-banco");
    expect((await client.resolve({ id: ID, platform: "android" })).version).toBe("1.0.0");
    expect(legacyCalls()).toBe(0);
  });

  it("sin bloque para el host → delega en legacy", async () => {
    const { client, legacyCalls } = make({ available: true, channel: "stable" }, body, "0.1.0");
    expect(await client.resolve({ id: ID })).toBe(legacyResp);
    expect(legacyCalls()).toBe(1);
  });

  it("candidate → url, integridad y firma del artefacto candidato", async () => {
    const { client } = make({ available: true, channel: "candidate" });
    const r = await client.resolve({ id: ID, platform: "android" });
    expect(r.version).toBe("1.1.0");
    expect(r.url).toBe("http://a/1.1.0-android");
    expect(r.manifest).toMatchObject({ integrity: "sha256-A2", signature: "SA2", version: "1.1.0" });
  });

  it("iOS sin artefacto candidato → la estable, sin clave signature si no la trae", async () => {
    const { client } = make({ available: true, channel: "candidate" });
    const r = await client.resolve({ id: ID, platform: "ios" });
    expect(r.version).toBe("1.0.0");
    expect(r.url).toBe("http://a/1.0.0-ios");
    expect(r.manifest.integrity).toBe("sha256-I1");
    expect("signature" in r.manifest).toBe(false);
  });

  it("platform por defecto android e ignora req.version", async () => {
    const { client } = make({ available: true, channel: "stable" });
    const r = await client.resolve({ id: ID, version: "1.1.0" as SemVer });
    expect(r.version).toBe("1.0.0");
    expect(r.url).toBe("http://a/1.0.0-android");
  });

  it("sin versión compatible → no-compatible-version", async () => {
    const { client } = make({ available: true, channel: "stable" });
    await expect(client.resolve({ id: "otra" as MiniappId })).rejects.toMatchObject({
      reason: "no-compatible-version",
    });
  });
});
