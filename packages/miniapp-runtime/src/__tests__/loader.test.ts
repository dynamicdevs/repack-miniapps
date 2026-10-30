import type {Manifest, MiniappId, SemVer} from '@dentvega/miniapp-contract';
import {initialLoaderState, isRetryable, nextLoaderState} from '../loaderState.js';
import {evaluateManifest, type HostProvided} from '../evaluate.js';

const resolved = {
  id: 'account_dashboard' as MiniappId,
  version: '0.1.0' as SemVer,
  url: 'http://h/chunk',
  manifest: {} as Manifest,
};

describe('nextLoaderState', () => {
  it('idle → resolving on start', () => {
    expect(nextLoaderState(initialLoaderState, {type: 'start'}).status).toBe('resolving');
  });
  it('resolving → downloading on resolved', () => {
    const s = nextLoaderState({status: 'resolving'}, {type: 'resolved', resolved});
    expect(s.status).toBe('downloading');
  });
  it('downloading → mounted on mounted', () => {
    const s = nextLoaderState({status: 'downloading', resolved}, {type: 'mounted'});
    expect(s.status).toBe('mounted');
  });
  it('any → fallback on fail', () => {
    const s = nextLoaderState({status: 'resolving'}, {type: 'fail', reason: 'skew'});
    expect(s).toMatchObject({status: 'fallback', reason: 'skew'});
  });
  it('ignores mounted when not downloading', () => {
    expect(nextLoaderState({status: 'resolving'}, {type: 'mounted'}).status).toBe('resolving');
  });
});

describe('evaluateManifest', () => {
  const hostProvided: HostProvided = {
    react: '18.3.1' as SemVer,
    'react-native': '0.76.6' as SemVer,
    '@shopify/flash-list': '1.8.3' as SemVer,
  };
  const validManifest = {
    id: 'account_dashboard',
    version: '0.1.0',
    entry: './Entry',
    shared: [
      {name: 'react-native', requiredRange: '^0.76.0', singleton: true},
      {name: '@shopify/flash-list', requiredRange: '^1.7.0', singleton: true},
    ],
    capabilities: ['accounts:read'],
  };

  it('accepts a valid, compatible manifest', () => {
    const res = evaluateManifest(validManifest, hostProvided);
    expect(res.ok).toBe(true);
  });
  it('rejects a malformed manifest', () => {
    const res = evaluateManifest({nope: true}, hostProvided);
    expect(res).toMatchObject({ok: false, reason: 'invalid-manifest'});
  });
  it('rejects on singleton skew (missing dep)', () => {
    const res = evaluateManifest(
      {...validManifest, shared: [{name: 'zustand', requiredRange: '^5.0.0', singleton: true}]},
      hostProvided,
    );
    expect(res).toMatchObject({ok: false, reason: 'skew'});
  });
  it('rejects on singleton skew (incompatible version)', () => {
    const res = evaluateManifest(
      {...validManifest, shared: [{name: 'react-native', requiredRange: '^0.80.0', singleton: true}]},
      hostProvided,
    );
    expect(res).toMatchObject({ok: false, reason: 'skew'});
  });

  const withMin = (rn: string, cv: string) => ({
    ...validManifest,
    minHostContract: {reactNative: rn, contractVersion: cv},
  });

  it('host más nuevo/igual que el minHostContract → ok', () => {
    expect(evaluateManifest(withMin('0.76.0', '0.1.0'), hostProvided, '0.1.0')).toMatchObject({ok: true});
  });
  it('host viejo en contractVersion → host-too-old', () => {
    expect(evaluateManifest(withMin('0.76.0', '0.2.0'), hostProvided, '0.1.0')).toMatchObject({
      ok: false,
      reason: 'host-too-old',
    });
  });
  it('host viejo en react-native → host-too-old', () => {
    expect(evaluateManifest(withMin('0.80.0', '0.1.0'), hostProvided, '0.1.0')).toMatchObject({
      ok: false,
      reason: 'host-too-old',
    });
  });
  it('sin hostContractVersion → no-op (ok)', () => {
    expect(evaluateManifest(withMin('0.80.0', '0.2.0'), hostProvided)).toMatchObject({ok: true});
  });
  it('host con nombre: usa su entrada de minHostContracts', () => {
    const m = {...validManifest, minHostContracts: {'mi-banco': {reactNative: '0.76.0', contractVersion: '1.3.0'}}};
    expect(evaluateManifest(m, hostProvided, '1.2.0', 'mi-banco')).toMatchObject({ok: false, reason: 'host-too-old'});
    expect(evaluateManifest(m, hostProvided, '1.3.0', 'mi-banco')).toMatchObject({ok: true});
  });
  it('host con nombre sin entrada propia: no compara el contractVersion de otro host', () => {
    const m = {
      ...withMin('0.76.0', '9.0.0'),
      minHostContracts: {'banco-lab': {reactNative: '0.76.0', contractVersion: '9.0.0'}},
    };
    expect(evaluateManifest(m, hostProvided, '1.2.0', 'mi-banco')).toMatchObject({ok: true});
  });
  it('host con nombre sin entrada propia: sí compara react-native', () => {
    expect(evaluateManifest(withMin('0.80.0', '0.1.0'), hostProvided, '1.2.0', 'mi-banco')).toMatchObject({
      ok: false,
      reason: 'host-too-old',
    });
  });
  it('sin minHostContract → ok', () => {
    expect(evaluateManifest(validManifest, hostProvided, '0.1.0')).toMatchObject({ok: true});
  });
});

describe('isRetryable', () => {
  it('transitorias son retryable', () => {
    expect(isRetryable('resolve-failed')).toBe(true);
    expect(isRetryable('download-failed')).toBe(true);
    expect(isRetryable('integrity-failed')).toBe(true);
  });
  it('permanentes no son retryable', () => {
    expect(isRetryable('skew')).toBe(false);
    expect(isRetryable('invalid-manifest')).toBe(false);
  });
});
