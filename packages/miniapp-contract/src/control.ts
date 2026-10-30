/**
 * Manifiesto de control de la torre: qué versión de cada miniapp sirve cada host
 * y por qué canal. Lo firma el servidor (Ed25519) y el host lo verifica.
 * Puro — sin fs/red/crypto. Lo consumen el runtime (RN) y el servidor (Next.js).
 */
import type { Manifest, SemVer } from "./types.js";

export type Channel = "stable" | "candidate";
/** Canal que pide el flag; `lib` es la copia embebida (en fase 1 equivale a `stable`). */
export type FlagChannel = Channel | "lib";

export interface PlatformArtifact {
  readonly url: string;
  readonly integrity: string;
  readonly signature?: string;
}

export interface ManifestVersionEntry {
  readonly manifest: Manifest;
  readonly android: PlatformArtifact;
  readonly ios?: PlatformArtifact;
}

export interface ChannelPointers {
  readonly stable?: SemVer;
  readonly candidate?: SemVer;
}

export interface ControlManifestBody {
  readonly schema: 1;
  /** Creciente: el host rechaza un seq menor al mayor visto (anti-replay). */
  readonly seq: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  /** Clave del host (`hostKey`: `host@contractVersion` o `contractVersion`) → id → punteros. */
  readonly hosts: Readonly<Record<string, Readonly<Record<string, ChannelPointers>>>>;
  /** id → versión → entrada. Solo versiones NO retiradas. */
  readonly versions: Readonly<Record<string, Readonly<Record<string, ManifestVersionEntry>>>>;
}

export interface SignedControlManifest {
  readonly body: ControlManifestBody;
  /** Ed25519 base64url sobre `controlManifestMessage(body)`. */
  readonly signature: string;
}

export const CONTROL_MANIFEST_PREFIX = "miniapps-manifest:v1:";

/** JSON determinista: claves ordenadas recursivamente, sin espacios, arrays en orden. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] === undefined) continue; // como JSON.stringify
    parts.push(`${JSON.stringify(key)}:${canonicalJson(obj[key])}`);
  }
  return `{${parts.join(",")}}`;
}

/** Mensaje exacto que se firma y se verifica. */
export function controlManifestMessage(body: ControlManifestBody): string {
  return CONTROL_MANIFEST_PREFIX + canonicalJson(body);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Guard de forma (no verifica la firma): schema 1, seq numérico, fechas, signature string. */
export function isSignedControlManifest(v: unknown): v is SignedControlManifest {
  if (!isRecord(v)) return false;
  if (typeof v.signature !== "string" || v.signature === "") return false;
  const b = v.body;
  if (!isRecord(b)) return false;
  return (
    b.schema === 1 &&
    typeof b.seq === "number" &&
    Number.isFinite(b.seq) &&
    typeof b.issuedAt === "string" &&
    typeof b.expiresAt === "string" &&
    isRecord(b.hosts) &&
    isRecord(b.versions)
  );
}

export interface SelectedVersion {
  readonly version: SemVer;
  readonly entry: ManifestVersionEntry;
  readonly artifact: PlatformArtifact;
  /** Canal efectivamente usado (una candidata sin artefacto cae a `stable`). */
  readonly channelUsed: Channel;
}

/**
 * Clave del bloque de este host: la primera de `keys` que el manifiesto trae (ver
 * `hostKeyCandidates`), o null. Un string se toma como una sola clave.
 */
export function findHostKey(body: ControlManifestBody, keys: string | readonly string[]): string | null {
  for (const key of typeof keys === "string" ? [keys] : keys) {
    if (Object.prototype.hasOwnProperty.call(body.hosts, key)) return key;
  }
  return null;
}

/** ¿El manifiesto trae bloque para este host? (`keys`: su clave o sus candidatas en orden). */
export function hasHostBlock(body: ControlManifestBody, keys: string | readonly string[]): boolean {
  return findHostKey(body, keys) !== null;
}

function pick(
  body: ControlManifestBody,
  id: string,
  version: SemVer | undefined,
  platform: "android" | "ios",
): { version: SemVer; entry: ManifestVersionEntry; artifact: PlatformArtifact } | null {
  if (version === undefined) return null;
  const versions = body.versions[id];
  const entry = versions !== undefined && Object.prototype.hasOwnProperty.call(versions, version)
    ? versions[version]
    : undefined;
  if (entry === undefined) return null; // puntero a versión retirada/ausente
  const artifact = entry[platform];
  if (artifact === undefined) return null;
  return { version, entry, artifact };
}

/**
 * Elige la versión a cargar para un host/miniapp/canal/plataforma.
 * `candidate`: la candidata si existe y tiene artefacto; si no, la estable.
 * `stable` y `lib`: la estable. `null` si no hay ninguna.
 */
export function selectVersion(
  body: ControlManifestBody,
  hostKeys: string | readonly string[],
  id: string,
  channel: FlagChannel,
  platform: "android" | "ios",
): SelectedVersion | null {
  const key = findHostKey(body, hostKeys);
  if (key === null) return null;
  const block = body.hosts[key];
  const pointers = block !== undefined && Object.prototype.hasOwnProperty.call(block, id) ? block[id] : undefined;
  if (pointers === undefined) return null;

  if (channel === "candidate") {
    const c = pick(body, id, pointers.candidate, platform);
    if (c !== null) return { ...c, channelUsed: "candidate" };
  }
  const s = pick(body, id, pointers.stable, platform);
  return s === null ? null : { ...s, channelUsed: "stable" };
}
