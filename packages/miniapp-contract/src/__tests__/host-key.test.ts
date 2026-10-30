import { hostKey, hostKeyCandidates, isHostName, parseHostKey } from "../host-key.js";
import { isHostContract, isManifest } from "../guards.js";
import { hasHostBlock, selectVersion, type ControlManifestBody } from "../control.js";
import { hostCompatReport } from "../compat.js";
import type { HostContract, Manifest } from "../types.js";

const base: HostContract = {
  contractVersion: "1.2.0",
  reactNative: "0.80.0",
  shared: { react: "19.1.0", "react-native": "0.80.0" },
  nativeModules: ["react-native-config"],
};

describe("isHostName", () => {
  it("minúsculas, dígitos y guiones, empezando por letra o dígito", () => {
    expect(isHostName("mi-banco")).toBe(true);
    expect(isHostName("banco-lab")).toBe(true);
    expect(isHostName("host2")).toBe(true);
  });
  it("rechaza vacío, @, mayúsculas, espacios y guion inicial", () => {
    for (const bad of ["", "mi@banco", "MiBanco", "mi banco", "-x", "mi_banco"]) {
      expect(isHostName(bad)).toBe(false);
    }
  });
});

describe("hostKey / parseHostKey / hostKeyCandidates", () => {
  it("con host: host@contractVersion", () => {
    expect(hostKey({ ...base, host: "mi-banco" })).toBe("mi-banco@1.2.0");
  });
  it("sin host: la clave de siempre", () => {
    expect(hostKey(base)).toBe("1.2.0");
  });
  it("parseHostKey separa host y versión", () => {
    expect(parseHostKey("mi-banco@1.2.0")).toEqual({ host: "mi-banco", contractVersion: "1.2.0" });
    expect(parseHostKey("1.1.0")).toEqual({ host: undefined, contractVersion: "1.1.0" });
  });
  it("candidatas: primero con host y después la pelada", () => {
    expect(hostKeyCandidates("mi-banco", "1.2.0")).toEqual(["mi-banco@1.2.0", "1.2.0"]);
    expect(hostKeyCandidates(undefined, "1.2.0")).toEqual(["1.2.0"]);
    expect(hostKeyCandidates("", "1.2.0")).toEqual(["1.2.0"]);
  });
});

describe("isHostContract con host", () => {
  it("host opcional válido", () => {
    expect(isHostContract({ ...base, host: "mi-banco" })).toBe(true);
    expect(isHostContract(base)).toBe(true);
  });
  it("host con formato inválido o no string", () => {
    expect(isHostContract({ ...base, host: "mi@banco" })).toBe(false);
    expect(isHostContract({ ...base, host: 3 })).toBe(false);
  });
});

const manifest = {
  id: "customizacion",
  version: "0.1.1",
  entry: "./Entry",
  shared: [],
  capabilities: [],
} as unknown as Manifest;

describe("isManifest: hosts y minHostContracts", () => {
  it("válidos", () => {
    expect(
      isManifest({
        ...manifest,
        hosts: ["mi-banco"],
        minHostContracts: { "mi-banco": { reactNative: "0.80.0", contractVersion: "1.2.0" } },
      }),
    ).toBe(true);
  });
  it("hosts con nombre inválido o no array", () => {
    expect(isManifest({ ...manifest, hosts: ["Mi Banco"] })).toBe(false);
    expect(isManifest({ ...manifest, hosts: "mi-banco" })).toBe(false);
  });
  it("minHostContracts mal formado", () => {
    expect(isManifest({ ...manifest, minHostContracts: { "mi-banco": { reactNative: "0.80.0" } } })).toBe(false);
    expect(isManifest({ ...manifest, minHostContracts: { "x@y": { reactNative: "1", contractVersion: "1" } } })).toBe(false);
  });
});

describe("bloque del host con fallback a la clave pelada", () => {
  const body: ControlManifestBody = {
    schema: 1,
    seq: 1,
    issuedAt: "2026-10-30T00:00:00.000Z",
    expiresAt: "2026-11-06T00:00:00.000Z",
    hosts: {
      "1.2.0": { customizacion: { stable: "0.1.0" as never } },
      "mi-banco@1.2.0": { customizacion: { stable: "0.1.1" as never } },
    },
    versions: {
      customizacion: {
        "0.1.0": { manifest, android: { url: "https://x/0.1.0", integrity: "sha256-a" } },
        "0.1.1": { manifest, android: { url: "https://x/0.1.1", integrity: "sha256-b" } },
      },
    },
  };

  it("prefiere host@cv", () => {
    const keys = hostKeyCandidates("mi-banco", "1.2.0");
    expect(hasHostBlock(body, keys)).toBe(true);
    expect(selectVersion(body, keys, "customizacion", "stable", "android")?.version).toBe("0.1.1");
  });
  it("sin bloque host@cv usa la pelada (control plane viejo)", () => {
    const { "mi-banco@1.2.0": _drop, ...hosts } = body.hosts;
    const old = { ...body, hosts };
    expect(selectVersion(old, hostKeyCandidates("mi-banco", "1.2.0"), "customizacion", "stable", "android")?.version)
      .toBe("0.1.0");
  });
  it("ninguna candidata → sin bloque", () => {
    expect(hasHostBlock(body, hostKeyCandidates("banco-lab", "9.9.9"))).toBe(false);
    expect(selectVersion(body, ["9.9.9"], "customizacion", "stable", "android")).toBeNull();
  });
});

describe("hostCompatReport: minHostContract por host", () => {
  const miBanco: HostContract = { ...base, host: "mi-banco" };
  const bancoLab: HostContract = { ...base, host: "banco-lab", contractVersion: "0.2.0" };

  it("contra un host con nombre usa su entrada de minHostContracts", () => {
    const m = { ...manifest, minHostContracts: { "mi-banco": { reactNative: "0.80.0", contractVersion: "1.3.0" } } };
    expect(hostCompatReport(miBanco, m).reasons).toEqual([
      "requiere contractVersion >= 1.3.0 (host mi-banco@1.2.0)",
    ]);
  });
  it("no compara el número de contrato de otro host", () => {
    const m = {
      ...manifest,
      minHostContract: { reactNative: "0.80.0", contractVersion: "1.2.0" },
      minHostContracts: { "mi-banco": { reactNative: "0.80.0", contractVersion: "1.2.0" } },
    };
    expect(hostCompatReport(bancoLab, m)).toEqual({ compatible: true, reasons: [] });
  });
  it("con host y sin entrada propia: solo reactNative del minHostContract de siempre", () => {
    const m = { ...manifest, minHostContract: { reactNative: "0.81.0", contractVersion: "9.0.0" } };
    expect(hostCompatReport(miBanco, m).reasons).toEqual([
      "requiere react-native >= 0.81.0 (host mi-banco@1.2.0)",
    ]);
  });
  it("sin host: como siempre", () => {
    const m = { ...manifest, minHostContract: { reactNative: "0.80.0", contractVersion: "1.3.0" } };
    expect(hostCompatReport(base, m).reasons).toEqual(["requiere contractVersion >= 1.3.0 (host 1.2.0)"]);
  });
});
