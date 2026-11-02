/**
 * Identidad de un host en la plataforma: `host@contractVersion` cuando el contract dice de qué host
 * es, o el `contractVersion` pelado (contracts anteriores al campo `host`). La usan el store de
 * contracts, los bloques de canales y el manifiesto de control.
 */
import type { HostContract } from "./types.js";

const HOST_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Nombre de host válido: minúsculas, dígitos y guiones (nunca `@`). */
export function isHostName(x: unknown): x is string {
  return typeof x === "string" && HOST_NAME.test(x);
}

/** Clave del contract: `host@contractVersion`, o `contractVersion` si no trae host. */
export function hostKey(contract: Pick<HostContract, "host" | "contractVersion">): string {
  return contract.host ? `${contract.host}@${contract.contractVersion}` : contract.contractVersion;
}

/** Inversa de `hostKey`. */
export function parseHostKey(key: string): { host: string | undefined; contractVersion: string } {
  const at = key.indexOf("@");
  return at === -1
    ? { host: undefined, contractVersion: key }
    : { host: key.slice(0, at), contractVersion: key.slice(at + 1) };
}

/**
 * Claves con las que un binario busca su bloque, en orden: la suya con host y la pelada (lo que
 * publica un control plane anterior al campo `host`).
 */
export function hostKeyCandidates(host: string | undefined, contractVersion: string): string[] {
  return host ? [`${host}@${contractVersion}`, contractVersion] : [contractVersion];
}
