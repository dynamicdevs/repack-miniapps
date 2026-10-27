/**
 * Version-skew detection for shared singletons.
 * Reused by the host loader AND by Backstage to validate
 * compatibility at publish time.
 *
 * `satisfiesShared` resolves real semver ranges (compound `>=x <y`, `||`,
 * x-ranges, etc.) via the `semver` package. `satisfiesRange` below is a
 * *minimal* range satisfier (exact | caret ^ | tilde ~ | any *) kept
 * exported for the (cheaper, approximate) drift badge.
 */
import semver from "semver";
import type { SemVer, SharedDepSpec } from "./types.js";

export type SkewStatus = "ok" | "missing" | "incompatible";

export interface SkewEntry {
  readonly name: string;
  readonly status: SkewStatus;
  readonly requiredRange: string;
  readonly providedVersion?: SemVer;
}

export interface SkewResult {
  readonly compatible: boolean;
  readonly entries: readonly SkewEntry[];
}

type Triple = readonly [number, number, number];

function parseTriple(version: string): Triple | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (m === null) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Does a concrete version satisfy a (minimal) range? */
export function satisfiesRange(version: string, range: string): boolean {
  const trimmed = range.trim();
  if (trimmed === "" || trimmed === "*") return true;

  const provided = parseTriple(version);
  if (provided === null) return false;

  const operator = trimmed[0];
  const bare = operator === "^" || operator === "~" ? trimmed.slice(1) : trimmed;
  const required = parseTriple(bare);
  if (required === null) return false;

  const [pMajor, pMinor, pPatch] = provided;
  const [rMajor, rMinor, rPatch] = required;

  // provided must be >= required within the allowed window
  const gte =
    pMajor > rMajor ||
    (pMajor === rMajor && pMinor > rMinor) ||
    (pMajor === rMajor && pMinor === rMinor && pPatch >= rPatch);
  if (!gte) return false;

  if (operator === "^") return pMajor === rMajor;
  if (operator === "~") return pMajor === rMajor && pMinor === rMinor;
  // exact
  return pMajor === rMajor && pMinor === rMinor && pPatch === rPatch;
}

/** a >= b (semver). Parse inválido → false. Usado por el runtime guard host-too-old. */
export function gteVersion(a: string, b: string): boolean {
  const pa = parseTriple(a);
  const pb = parseTriple(b);
  if (pa === null || pb === null) return false;
  if (pa[0] !== pb[0]) return pa[0] > pb[0];
  if (pa[1] !== pb[1]) return pa[1] > pb[1];
  return pa[2] >= pb[2];
}

/**
 * Compare what the host provides (name → concrete version) against what a
 * miniapp requires. Compatible only when every required dep is present and in range.
 */
export function satisfiesShared(
  hostProvided: Readonly<Record<string, SemVer>>,
  miniappShared: readonly SharedDepSpec[],
): SkewResult {
  const entries: SkewEntry[] = miniappShared.map((dep) => {
    const providedVersion = hostProvided[dep.name];
    if (providedVersion === undefined) {
      return { name: dep.name, status: "missing", requiredRange: dep.requiredRange };
    }
    const inRange = semver.satisfies(providedVersion, dep.requiredRange, { includePrerelease: false });
    const status: SkewStatus = inRange ? "ok" : "incompatible";
    return { name: dep.name, status, requiredRange: dep.requiredRange, providedVersion };
  });

  return { compatible: entries.every((e) => e.status === "ok"), entries };
}
