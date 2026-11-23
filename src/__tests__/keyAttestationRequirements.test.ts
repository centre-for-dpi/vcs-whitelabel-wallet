import type { KeyAttestationConfig } from '../../branding.config';
import { getKeyAttestationRequirement, shouldAttachKeyAttestation, assertCanSatisfy, planKeyAttestation, KeyAttestationError } from '../agent/keyAttestation/requirements';

const cfg: KeyAttestationConfig = { enabled: true, walletProviderUrl: 'https://wp.test', keyStorage: 'iso_18045_basic', attachWhen: 'required' };
const req = (r?: object) => ({ jwt: { supportedSignatureAlgorithms: ['ES256'], keyAttestationsRequired: r }, attestation: undefined }) as any;

// When a plain jwt proof type is offered, only ITS requirement blocks (Credo's own check
// looks only at jwt); the attestation proof type's requirement matters only when no jwt is offered.
test('jwt offered → only the jwt requirement counts, attestation requirement ignored', () => {
  const pt = { jwt: { supportedSignatureAlgorithms: ['ES256'], keyAttestationsRequired: { keyStorage: ['a'] } },
               attestation: { supportedSignatureAlgorithms: ['ES256'], keyAttestationsRequired: { keyStorage: ['b'] } } } as any;
  expect(getKeyAttestationRequirement(pt)).toEqual({ keyStorage: ['a'] });
});
test('jwt offered without requirement, attestation requires → undefined', () => {
  const pt = { jwt: { supportedSignatureAlgorithms: ['ES256'] },
               attestation: { supportedSignatureAlgorithms: ['ES256'], keyAttestationsRequired: { keyStorage: ['b'] } } } as any;
  expect(getKeyAttestationRequirement(pt)).toBeUndefined();
});
test('no jwt offered → attestation requirement counts', () => {
  const pt = { attestation: { supportedSignatureAlgorithms: ['ES256'], keyAttestationsRequired: { keyStorage: ['b'] } } } as any;
  expect(getKeyAttestationRequirement(pt)).toEqual({ keyStorage: ['b'] });
});
test('no requirement → undefined', () => expect(getKeyAttestationRequirement(req(undefined))).toBeUndefined());
test('disabled never attaches', () => expect(shouldAttachKeyAttestation({}, { ...cfg, enabled: false })).toBe(false));
test('required mode attaches only when issuer requires', () => {
  expect(shouldAttachKeyAttestation(undefined, cfg)).toBe(false);
  expect(shouldAttachKeyAttestation({}, cfg)).toBe(true);
});
test('always mode attaches without requirement', () => expect(shouldAttachKeyAttestation(undefined, { ...cfg, attachWhen: 'always' })).toBe(true));
test.each([
  [{ keyStorage: ['iso_18045_basic'] }, cfg, undefined],
  [{ keyStorage: ['iso_18045_high'] }, cfg, 'key_storage_level'],
  [{ userAuthentication: ['iso_18045_basic'] }, cfg, 'user_authentication'],
  [{}, { ...cfg, enabled: false }, 'disabled'],
  [{}, { ...cfg, walletProviderUrl: '' }, 'not_configured'],
  [{}, { ...cfg, keyStorage: 'iso_18045_high' } as any, 'not_configured'],
  [{ keyStorage: ['iso_18045_basic'] }, { ...cfg, keyStorage: 'iso_18045_high' } as any, 'not_configured'],
])('assertCanSatisfy(%j)', (r, c, code) => {
  if (!code) return expect(() => assertCanSatisfy(r, c as any)).not.toThrow();
  let thrown: unknown;
  try { assertCanSatisfy(r, c as any); } catch (e) { thrown = e; }
  expect(thrown).toBeInstanceOf(KeyAttestationError);
  expect((thrown as KeyAttestationError).code).toBe(code);
});

describe('walletProviderUrl validation (enabled)', () => {
  const codeOf = (r: any, c: any) => {
    try { assertCanSatisfy(r, c); } catch (e) { return (e as KeyAttestationError).code; }
    return undefined;
  };
  const always = { ...cfg, attachWhen: 'always' as const };
  test('enabled/always/empty URL, no requirement -> not_configured', () => {
    expect(codeOf(undefined, { ...always, walletProviderUrl: '' })).toBe('not_configured');
  });
  test.each(['/relative/path', 'garbage', 'wp.test'])('invalid URL %s -> not_configured', (u) => {
    expect(codeOf(undefined, { ...always, walletProviderUrl: u })).toBe('not_configured');
  });
  test('https URL OK without requirement', () => {
    expect(codeOf(undefined, always)).toBeUndefined();
  });
  test('http allowed under __DEV__ (jest)', () => {
    expect((global as any).__DEV__).toBe(true);
    expect(codeOf(undefined, { ...always, walletProviderUrl: 'http://wp.test' })).toBeUndefined();
  });
  test('http rejected when __DEV__ is false', () => {
    const g = global as any;
    const prev = g.__DEV__;
    g.__DEV__ = false;
    try {
      expect(codeOf(undefined, { ...always, walletProviderUrl: 'http://wp.test' })).toBe('not_configured');
      expect(codeOf(undefined, always)).toBeUndefined();
    } finally { g.__DEV__ = prev; }
  });
  test('disabled config ignores URL', () => {
    expect(codeOf(undefined, { ...cfg, enabled: false, walletProviderUrl: '' })).toBeUndefined();
  });
});

describe('planKeyAttestation', () => {
  const base = { supportsJwk: true };
  test('required + jwk -> attach', () => {
    expect(planKeyAttestation({ ...base, req: {}, config: cfg })).toEqual({ attach: true });
  });
  test('toggle off + requirement -> disabled', () => {
    expect(() => planKeyAttestation({ ...base, req: {}, config: { ...cfg, enabled: false } })).toThrow(expect.objectContaining({ code: 'disabled' }));
  });
  test('toggle off, no requirement -> no attach', () => {
    expect(planKeyAttestation({ ...base, req: undefined, config: { ...cfg, enabled: false } })).toEqual({ attach: false });
  });
  test('requirement + DID-only + enabled -> did_binding_unsupported', () => {
    expect(() => planKeyAttestation({ supportsJwk: false, req: {}, config: cfg })).toThrow(expect.objectContaining({ code: 'did_binding_unsupported' }));
  });
  test('no requirement + always + DID-only -> no attach', () => {
    expect(planKeyAttestation({ supportsJwk: false, req: undefined, config: { ...cfg, attachWhen: 'always' } })).toEqual({ attach: false });
  });
  test('always-only + unsatisfiable attestation proof requirement -> no attach', () => {
    expect(planKeyAttestation({ ...base, req: undefined, attestationProofReq: { keyStorage: ['iso_18045_high'] }, config: { ...cfg, attachWhen: 'always' } })).toEqual({ attach: false });
  });
  test('always-only + satisfiable attestation proof requirement -> attach', () => {
    expect(planKeyAttestation({ ...base, req: undefined, attestationProofReq: { keyStorage: ['iso_18045_basic'] }, config: { ...cfg, attachWhen: 'always' } })).toEqual({ attach: true });
  });
  test('blocking jwt requirement + unsatisfiable attestation proof requirement -> throws', () => {
    expect(() => planKeyAttestation({ ...base, req: {}, attestationProofReq: { keyStorage: ['iso_18045_high'] }, config: cfg })).toThrow(expect.objectContaining({ code: 'key_storage_level' }));
  });
});
