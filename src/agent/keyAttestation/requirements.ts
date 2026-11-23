import type { OpenId4VciCredentialBindingOptions } from '@credo-ts/openid4vc';
import type { KeyAttestationConfig } from '../../../branding.config';

export type KeyAttestationRequirement = { keyStorage?: string[]; userAuthentication?: string[] };

export type KeyAttestationErrorCode =
  | 'disabled'
  | 'key_storage_level'
  | 'user_authentication'
  | 'not_configured'
  | 'provider_error'
  | 'invalid_attestation'
  | 'did_binding_unsupported'
  | 'nonce_unavailable';

export class KeyAttestationError extends Error {
  constructor(public code: KeyAttestationErrorCode, message: string) {
    super(message);
    this.name = 'KeyAttestationError';
    Object.setPrototypeOf(this, KeyAttestationError.prototype);
  }
}

export function getKeyAttestationRequirement(
  proofTypes: OpenId4VciCredentialBindingOptions['proofTypes']
): KeyAttestationRequirement | undefined {
  // If a plain jwt proof type is offered, only ITS requirement blocks: Credo's own check
  // (OpenId4VciHolderService) looks only at jwt, and a jwt proof is accepted by the issuer.
  // The attestation proof type's requirement matters only when no jwt proof type is offered.
  if (proofTypes?.jwt) return proofTypes.jwt.keyAttestationsRequired ?? undefined;
  return proofTypes?.attestation?.keyAttestationsRequired ?? undefined;
}

export function shouldAttachKeyAttestation(
  req: KeyAttestationRequirement | undefined,
  config: KeyAttestationConfig
): boolean {
  if (!config.enabled) return false;
  return req !== undefined || config.attachWhen === 'always';
}

function assertWalletProviderUrl(raw: string): void {
  const notConfigured = (msg: string) => new KeyAttestationError('not_configured', msg);
  if (!raw) {
    throw notConfigured('La key attestation está activada, pero la wallet no tiene configurado un Wallet Provider.');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw notConfigured('La URL del Wallet Provider configurado no es una URL absoluta válida.');
  }
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  if (url.protocol !== 'https:' && !(isDev && url.protocol === 'http:')) {
    throw notConfigured('El Wallet Provider configurado debe usar https.');
  }
}

export function assertCanSatisfy(req: KeyAttestationRequirement | undefined, config: KeyAttestationConfig): void {
  // Runtime guard in case the literal type is bypassed: software keys may only claim basic.
  if (config.enabled && (config.keyStorage as string) !== 'iso_18045_basic') {
    throw new KeyAttestationError('not_configured', 'La wallet solo puede declarar el nivel iso_18045_basic para sus claves de software; revisa keyAttestationConfig.keyStorage.');
  }
  if (config.enabled) assertWalletProviderUrl(config.walletProviderUrl);
  if (!req) return;
  if (!config.enabled) {
    throw new KeyAttestationError('disabled', 'Este emisor exige una key attestation y esta wallet la tiene desactivada.');
  }
  if (req.userAuthentication?.length) {
    throw new KeyAttestationError('user_authentication', 'Este emisor exige un nivel de autenticación de usuario que esta wallet todavía no declara.');
  }
  if (req.keyStorage?.length && !req.keyStorage.includes(config.keyStorage)) {
    throw new KeyAttestationError('key_storage_level', 'Este emisor exige un nivel de almacenamiento de claves que esta wallet no puede garantizar.');
  }
}

function canSatisfy(req: KeyAttestationRequirement | undefined, config: KeyAttestationConfig): boolean {
  try {
    assertCanSatisfy(req, config);
    return true;
  } catch (e) {
    if (e instanceof KeyAttestationError) return false;
    throw e;
  }
}

export type PlanKeyAttestationInput = {
  /** Blocking requirement from the issuer (see getKeyAttestationRequirement). */
  req: KeyAttestationRequirement | undefined;
  /** Requirement of the `attestation` proof type when it is offered alongside jwt (Credo path only). */
  attestationProofReq?: KeyAttestationRequirement | undefined;
  /** Whether the binding can be JWK-based (supportsJwk / useJwk). */
  supportsJwk: boolean;
  config: KeyAttestationConfig;
};

/**
 * Single decision point shared by the Credo binding resolver and the legacy proof builder.
 * Throws a KeyAttestationError when the issuer's requirement cannot be met; otherwise says
 * whether an attestation must be attached. Runs before any key is created.
 */
export function planKeyAttestation(input: PlanKeyAttestationInput): { attach: boolean } {
  const { req, attestationProofReq, supportsJwk, config } = input;
  assertCanSatisfy(req, config);
  if (req && config.enabled && !supportsJwk) {
    throw new KeyAttestationError(
      'did_binding_unsupported',
      'El emisor exige key attestation pero solo acepta vinculación por DID, que no es compatible.'
    );
  }
  const attach = shouldAttachKeyAttestation(req, config) && supportsJwk;
  if (attach && attestationProofReq !== undefined) {
    // Credo sends the `attestation` proof type whenever offered, so its requirement matters too.
    if (req) assertCanSatisfy(attestationProofReq, config);
    else if (!canSatisfy(attestationProofReq, config)) return { attach: false };
  }
  return { attach };
}
