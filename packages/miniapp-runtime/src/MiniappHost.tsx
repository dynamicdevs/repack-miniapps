import React, { type ComponentType } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { CapabilityGrant, MiniappId } from "@dentvega/miniapp-contract";
import { useMiniapp } from "./useMiniapp.js";
import type { ResolveClient } from "./ResolveClient.js";
import type { MetricsClient } from "./MetricsClient.js";
import type { ChunkLoader } from "./ChunkLoader.js";
import type { HostProvided } from "./evaluate.js";
import type { IntegrityVerifier } from "./integrity.js";
import type { SignatureVerifier } from "./signature.js";
import type { SignatureMode } from "./signatureGate.js";
import { isRetryable, type FallbackReason } from "./loaderState.js";

export interface MiniappLoadingProps {
  retrying: boolean;
}

export interface MiniappErrorProps {
  reason: FallbackReason;
  retryable: boolean;
  onRetry: () => void;
}

/**
 * Componentes de UI que inyecta el host. Sin ellos se usan primitivas RN sin estilo propio.
 *
 * `loading`/`error` deben ser referencias estables (definidas a nivel de módulo, o memoizadas
 * con `useMemo`/`useCallback` si se arman inline) — una función/objeto literal nuevo en cada
 * render de tu componente padre hace que React desmonte y remonte el loading/error en cada render.
 */
export interface MiniappHostRender {
  loading?: ComponentType<MiniappLoadingProps>;
  error?: ComponentType<MiniappErrorProps>;
}

export interface MiniappHostProps {
  id: MiniappId;
  resolveClient: ResolveClient;
  chunkLoader: ChunkLoader;
  hostProvided: HostProvided;
  capabilities: CapabilityGrant;
  integrity?: IntegrityVerifier;
  /** Verificador de firma del chunk (autenticidad). Opcional → sin verificación. */
  signature?: SignatureVerifier;
  /** warn (monta + métrica) | enforce (bloquea). Default warn. */
  signatureMode?: SignatureMode;
  onRetry?: () => void;
  retry?: { maxAuto?: number; backoffMs?: number };
  /** contractVersion del host — habilita el guard host-too-old (minHostContract). */
  hostContractVersion?: string;
  /** Nombre del host ("mi-banco"): elige su mínimo en `minHostContracts`. */
  host?: string;
  /** Versión servida (del catálogo) — habilita el cache por-versión del resolve. */
  resolveVersion?: string;
  /** Telemetría de runtime (best-effort). */
  metrics?: MetricsClient;
  /** UI de carga y error. Opcional → primitivas RN por defecto. */
  render?: MiniappHostRender;
}

export const DEFAULT_FALLBACK_MESSAGES: Record<FallbackReason, string> = {
  "resolve-failed": "We could not locate this miniapp.",
  "download-failed": "We could not download this miniapp.",
  "invalid-manifest": "This miniapp has an invalid manifest.",
  skew: "This miniapp is not compatible with this version of the app. Update the app to use it.",
  "integrity-failed": "We could not verify the integrity of this miniapp.",
  "host-too-old": "Update the app to use this miniapp.",
  "invalid-signature": "We could not verify the signature of this miniapp.",
  "unknown-key": "This miniapp is not authorized to run.",
  disabled: "This miniapp is temporarily unavailable.",
  "no-compatible-version": "There is no version of this miniapp compatible with this version of the app. Update the app to use it.",
};

function DefaultLoading({ retrying }: MiniappLoadingProps): React.JSX.Element {
  return (
    <View testID="miniapp-loading" style={styles.center}>
      <ActivityIndicator />
      {retrying ? <Text>Retrying…</Text> : null}
    </View>
  );
}

function DefaultError({ reason, retryable, onRetry }: MiniappErrorProps): React.JSX.Element {
  return (
    <View style={styles.center}>
      <Text accessibilityRole="header">Miniapp unavailable</Text>
      <Text>{DEFAULT_FALLBACK_MESSAGES[reason]}</Text>
      {retryable ? (
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function MiniappHost(props: MiniappHostProps): React.JSX.Element {
  const { state, Entry, reload, retrying } = useMiniapp({
    id: props.id,
    resolveClient: props.resolveClient,
    chunkLoader: props.chunkLoader,
    hostProvided: props.hostProvided,
    integrity: props.integrity,
    signature: props.signature,
    signatureMode: props.signatureMode,
    retry: props.retry,
    hostContractVersion: props.hostContractVersion,
    host: props.host,
    resolveVersion: props.resolveVersion,
    metrics: props.metrics,
  });

  if (state.status === "fallback") {
    const ErrorView = props.render?.error ?? DefaultError;
    return (
      <ErrorView
        reason={state.reason}
        retryable={isRetryable(state.reason)}
        onRetry={props.onRetry ?? reload}
      />
    );
  }

  if (state.status === "mounted" && Entry !== null) {
    const MountedEntry = Entry;
    return <MountedEntry capabilities={props.capabilities} />;
  }

  const LoadingView = props.render?.loading ?? DefaultLoading;
  return <LoadingView retrying={retrying} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
});
