import {
  CONTROL_MANIFEST_PREFIX,
  canonicalJson,
  controlManifestMessage,
  hasHostBlock,
  isSignedControlManifest,
  selectVersion,
  type ControlManifestBody,
  type ManifestVersionEntry,
} from "../control.js";
import { hostCompatReport } from "../compat.js";
import type { HostContract, Manifest } from "../types.js";

const mf = (version: string): Manifest =>
  ({ id: "minima", version, entry: "./Entry", shared: [], capabilities: [] }) as unknown as Manifest;

const entry = (version: string, ios: boolean): ManifestVersionEntry => ({
  manifest: mf(version),
  android: { url: `https://x/${version}/android`, integrity: "sha256-a" },
  ...(ios ? { ios: { url: `https://x/${version}/ios`, integrity: "sha256-i" } } : {}),
});

const body: ControlManifestBody = {
  schema: 1,
  seq: 1761050000000,
  issuedAt: "2026-10-21T12:00:00.000Z",
  expiresAt: "2026-10-28T12:00:00.000Z",
  hosts: { "0.2.0": { minima: { stable: "0.1.7" as never, candidate: "0.1.8" as never } } },
  versions: { minima: { "0.1.7": entry("0.1.7", true), "0.1.8": entry("0.1.8", false) } },
};

describe("canonicalJson", () => {
  it("ordena claves recursivamente, sin espacios, arrays en orden", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
  });
  it("omite claves undefined", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe("controlManifestMessage", () => {
  it("lleva el prefijo y no depende del orden de claves", () => {
    const m = controlManifestMessage(body);
    expect(m.startsWith(CONTROL_MANIFEST_PREFIX)).toBe(true);
    expect(CONTROL_MANIFEST_PREFIX).toBe("miniapps-manifest:v1:");
    const reordered = {
      versions: body.versions, hosts: body.hosts, expiresAt: body.expiresAt,
      issuedAt: body.issuedAt, seq: body.seq, schema: body.schema,
    } as ControlManifestBody;
    expect(controlManifestMessage(reordered)).toBe(m);
  });
});

describe("isSignedControlManifest", () => {
  it("válido", () => expect(isSignedControlManifest({ body, signature: "abc" })).toBe(true));
  it("sin signature", () => expect(isSignedControlManifest({ body })).toBe(false));
  it("schema 2", () => expect(isSignedControlManifest({ body: { ...body, schema: 2 }, signature: "a" })).toBe(false));
  it("seq no numérico", () => expect(isSignedControlManifest({ body: { ...body, seq: "1" }, signature: "a" })).toBe(false));
  it("no objeto", () => expect(isSignedControlManifest(null)).toBe(false));
});

describe("selectVersion", () => {
  it("candidate con artefacto android", () => {
    const r = selectVersion(body, "0.2.0", "minima", "candidate", "android");
    expect(r?.version).toBe("0.1.8");
    expect(r?.channelUsed).toBe("candidate");
  });
  it("candidate en ios sin artefacto → estable", () => {
    const r = selectVersion(body, "0.2.0", "minima", "candidate", "ios");
    expect(r?.version).toBe("0.1.7");
    expect(r?.channelUsed).toBe("stable");
    expect(r?.artifact.url).toContain("ios");
  });
  it("lib → estable", () => {
    expect(selectVersion(body, "0.2.0", "minima", "lib", "android")?.version).toBe("0.1.7");
  });
  it("stable sin stable → null", () => {
    const b = { ...body, hosts: { "0.2.0": { minima: { candidate: "0.1.8" as never } } } };
    expect(selectVersion(b, "0.2.0", "minima", "stable", "android")).toBeNull();
  });
  it("id desconocido o host sin bloque → null", () => {
    expect(selectVersion(body, "0.2.0", "nope", "stable", "android")).toBeNull();
    expect(selectVersion(body, "9.9.9", "minima", "stable", "android")).toBeNull();
  });
  it("candidata retirada → cae a la estable", () => {
    const { "0.1.8": _r, ...rest } = body.versions.minima!;
    const b = { ...body, versions: { minima: rest } };
    expect(selectVersion(b, "0.2.0", "minima", "candidate", "android")?.version).toBe("0.1.7");
  });
  it("estable retirada → null", () => {
    const { "0.1.7": _r, ...rest } = body.versions.minima!;
    const b = { ...body, versions: { minima: rest } };
    expect(selectVersion(b, "0.2.0", "minima", "stable", "android")).toBeNull();
  });
});

describe("hasHostBlock", () => {
  it("true/false", () => {
    expect(hasHostBlock(body, "0.2.0")).toBe(true);
    expect(hasHostBlock(body, "9.9.9")).toBe(false);
  });
});

describe("hostCompatReport", () => {
  const contract: HostContract = {
    contractVersion: "0.2.0", reactNative: "0.76.6",
    shared: { react: "18.3.1" }, nativeModules: ["react-native-screens"],
  };
  const m = (over: object = {}) =>
    ({ ...mf("0.1.0"), shared: [{ name: "react", requiredRange: "^18.0.0", singleton: true }],
       nativeModules: ["react-native-screens"], ...over }) as Manifest & { nativeModules?: readonly string[] };

  it("caso feliz", () => {
    expect(hostCompatReport(contract, m())).toEqual({ compatible: true, reasons: [] });
  });
  it("falta dependencia compartida", () => {
    const r = hostCompatReport(contract, m({ shared: [{ name: "zustand", requiredRange: "^4.0.0", singleton: true }] }));
    expect(r.compatible).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(0);
  });
  it("falta módulo nativo", () => {
    const r = hostCompatReport(contract, m({ nativeModules: ["react-native-svg"] }));
    expect(r.compatible).toBe(false);
  });
  it("minHostContract mayor que el host", () => {
    const r = hostCompatReport(contract, m({ minHostContract: { reactNative: "0.76.0", contractVersion: "0.3.0" } }));
    expect(r.compatible).toBe(false);
  });
  it("minHostContract reactNative mayor que el host", () => {
    const r = hostCompatReport(contract, m({ minHostContract: { reactNative: "0.80.0", contractVersion: "0.1.0" } }));
    expect(r.compatible).toBe(false);
  });
});
