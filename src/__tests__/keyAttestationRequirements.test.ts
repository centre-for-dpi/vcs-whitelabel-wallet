import type { KeyAttestationConfig } from '../../branding.config';
import { getKeyAttestationRequirement, shouldAttachKeyAttestation, assertCanSatisfy, KeyAttestationError } from '../agent/keyAttestation/requirements';

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
