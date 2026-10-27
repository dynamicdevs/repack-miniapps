/**
 * Value objects of the miniapp federation contract.
 * Framework-free, no runtime deps — this is the ubiquitous language shared by
 * the mobile host, the miniapps, and the Backstage registry (see model.md).
 */

/** Branded miniapp identifier (non-empty kebab/snake string). */
export type MiniappId = string & { readonly __brand: "MiniappId" };

/** Branded semantic version string "MAJOR.MINOR.PATCH". */
export type SemVer = string & { readonly __brand: "SemVer" };

/** A shared dependency the host provides or a miniapp requires. */
export interface SharedDepSpec {
  /** Package name, e.g. "react-native" or "zustand". */
  readonly name: string;
  /** Semver range the consumer requires, e.g. "^18.3.0". */
  readonly requiredRange: string;
  /** Whether the dependency must be a single shared instance across chunks. */
  readonly singleton: boolean;
}

/**
 * Scoped, revocable permissions the host grants a miniapp.
 * NEVER a raw credential. Extend the set as new miniapps need it.
 */
export type Capability = "accounts:read" | "session:whoami";

/** A capability grant handed to a mounted miniapp entry. */
export interface CapabilityGrant {
  readonly granted: readonly Capability[];
  /** True once the host has revoked the grant (miniapp must stop using it). */
  readonly isRevoked: () => boolean;
}

/** Metadata describing one published version of a miniapp. */
export interface Manifest {
  readonly id: MiniappId;
  readonly version: SemVer;
  /** Module Federation exposed entry, e.g. "./Entry". */
  readonly entry: string;
  readonly shared: readonly SharedDepSpec[];
  readonly capabilities: readonly Capability[];
  /**
   * Integrity descriptor (sha256 of the chunk). Optional in the manifest; the
   * contract does not validate its content, the host verifies it on download.
   */
  readonly integrity?: string;
  /**
   * Ed25519 signature (base64url) over `${id}:${platform}:${integrity}`. Proves
   * authenticity (who published), on top of the integrity hash. The host verifies
   * it against the miniapp's public key from the root-signed trust bundle. Optional/additive.
   */
  readonly signature?: string;
  /** Minimum host contract this manifest was built against (compat with older hosts). */
  readonly minHostContract?: { readonly reactNative: string; readonly contractVersion: string };
}

/** Host → Backstage resolve request. */
export interface ResolveRequest {
  readonly id: MiniappId;
  readonly hostVersion?: SemVer;
  /** Versión exacta a resolver (la que el catálogo sirve). Habilita el cache por-versión. */
  readonly version?: SemVer;
  /** Plataforma del host ("ios"/"android") — el registry sirve el chunk correcto. */
  readonly platform?: "ios" | "android";
}

/** Backstage → host resolve response. */
export interface ResolveResponse {
  readonly id: MiniappId;
  readonly version: SemVer;
  /** URL of the federated chunk to download. */
  readonly url: string;
  readonly manifest: Manifest;
}

/** Props the host injects into a miniapp's exposed `./Entry` component. */
export interface MiniappEntryProps {
  readonly capabilities: CapabilityGrant;
}

/** The Host Platform Contract: what the host provides (source of truth for compat). */
export interface HostContract {
  /** SemVer that bumps when the platform contract changes. */
  contractVersion: string;
  /** react-native version of the host. */
  reactNative: string;
  /** Singletons the host provides: name → concrete version. */
  shared: Readonly<Record<string, string>>;
  /** Native modules without a JS API compiled into the binary (presence only). */
  nativeModules: readonly string[];
  /** Procedencia (opcional): ISO timestamp de cuándo se generó este contract. */
  readonly generatedAt?: string;
  /** Procedencia (opcional): git sha del host build que lo generó. */
  readonly hostCommit?: string;
  /** Procedencia (opcional): en qué contractVersion se introdujo cada capability. */
  readonly capabilitySince?: {
    readonly shared: Readonly<Record<string, string>>;
    readonly native: Readonly<Record<string, string>>;
  };
}
