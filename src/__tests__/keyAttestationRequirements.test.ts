import { getKeyAttestationRequirement, shouldAttachKeyAttestation, assertCanSatisfy, KeyAttestationError } from '../agent/keyAttestation/requirements';

const cfg = { enabled: true, walletProviderUrl: 'https://wp.test', keyStorage: 'iso_18045_basic', attachWhen: 'required' } as const;
const req = (r?: object) => ({ jwt: { supportedSignatureAlgorithms: ['ES256'], keyAttestationsRequired: r }, attestation: undefined }) as any;

test('prefers attestation proof type requirement over jwt', () => {
  const pt = { jwt: { supportedSignatureAlgorithms: ['ES256'], keyAttestationsRequired: { keyStorage: ['a'] } },
               attestation: { supportedSignatureAlgorithms: ['ES256'], keyAttestationsRequired: { keyStorage: ['b'] } } } as any;
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
])('assertCanSatisfy(%j)', (r, c, code) => {
  if (!code) return expect(() => assertCanSatisfy(r, c as any)).not.toThrow();
  let thrown: unknown;
  try { assertCanSatisfy(r, c as any); } catch (e) { thrown = e; }
  expect(thrown).toBeInstanceOf(KeyAttestationError);
  expect((thrown as KeyAttestationError).code).toBe(code);
});
