/** Pure validation / parsing for the contract. */
import type { Capability, HostContract, Manifest, MiniappId, SemVer, SharedDepSpec } from "./types.js";

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MINIAPP_ID_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

const KNOWN_CAPABILITIES: readonly Capability[] = ["accounts:read", "session:whoami"];

/** Parse & validate a semver string; returns null when malformed. */
export function parseSemVer(value: string): SemVer | null {
  return SEMVER_RE.test(value) ? (value as SemVer) : null;
}

/** Validate a miniapp id; returns null when malformed. */
export function parseMiniappId(value: string): MiniappId | null {
  return value.length > 0 && MINIAPP_ID_RE.test(value) ? (value as MiniappId) : null;
}

function isSharedDepSpec(x: unknown): x is SharedDepSpec {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.name === "string" &&
    o.name.length > 0 &&
    typeof o.requiredRange === "string" &&
    o.requiredRange.length > 0 &&
    typeof o.singleton === "boolean"
  );
}

function isCapability(x: unknown): x is Capability {
  return typeof x === "string" && (KNOWN_CAPABILITIES as readonly string[]).includes(x);
}

/** Structural type guard for a Manifest coming from an untrusted source. */
export function isManifest(x: unknown): x is Manifest {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;

  if (typeof o.id !== "string" || parseMiniappId(o.id) === null) return false;
  if (typeof o.version !== "string" || parseSemVer(o.version) === null) return false;
  if (typeof o.entry !== "string" || o.entry.length === 0) return false;
  if (!Array.isArray(o.shared) || !o.shared.every(isSharedDepSpec)) return false;
  if (!Array.isArray(o.capabilities) || !o.capabilities.every(isCapability)) return false;
  if (o.integrity !== undefined && typeof o.integrity !== "string") return false;
  if (o.signature !== undefined && typeof o.signature !== "string") return false;

  if (o.minHostContract !== undefined) {
    const mh = o.minHostContract as Record<string, unknown>;
    if (
      typeof mh !== "object" ||
      mh === null ||
      typeof mh.reactNative !== "string" ||
      typeof mh.contractVersion !== "string"
    ) {
      return false;
    }
  }

  return true;
}

/** Structural type guard for a HostContract coming from an untrusted source. */
export function isHostContract(v: unknown): v is HostContract {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  if (
    typeof c.contractVersion !== "string" ||
    typeof c.reactNative !== "string" ||
    typeof c.shared !== "object" ||
    c.shared === null ||
    Array.isArray(c.shared) ||
    !Array.isArray(c.nativeModules) ||
    !c.nativeModules.every((n) => typeof n === "string")
  ) {
    return false;
  }
  return Object.values(c.shared as Record<string, unknown>).every((x) => typeof x === "string");
}
