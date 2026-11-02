export type {
  MiniappId,
  SemVer,
  SharedDepSpec,
  Capability,
  CapabilityGrant,
  Manifest,
  ResolveRequest,
  ResolveResponse,
  MiniappEntryProps,
  HostContract,
} from "./types.js";

export { parseSemVer, parseMiniappId, isManifest, isHostContract } from "./guards.js";
export { isHostName, hostKey, parseHostKey, hostKeyCandidates } from "./host-key.js";

export type { SkewStatus, SkewEntry, SkewResult } from "./shared.js";
export { gteVersion, satisfiesRange, satisfiesShared } from "./shared.js";

export type { NativeCheckResult, CompatReport } from "./compat.js";
export { checkNativeModules, checkCompatibility, hostCompatReport } from "./compat.js";

export type {
  Channel,
  FlagChannel,
  PlatformArtifact,
  ManifestVersionEntry,
  ChannelPointers,
  ControlManifestBody,
  SignedControlManifest,
  SelectedVersion,
} from "./control.js";
export {
  CONTROL_MANIFEST_PREFIX,
  canonicalJson,
  controlManifestMessage,
  isSignedControlManifest,
  findHostKey,
  hasHostBlock,
  selectVersion,
} from "./control.js";
