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
  | 'did_binding_unsupported';

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

export function assertCanSatisfy(req: KeyAttestationRequirement | undefined, config: KeyAttestationConfig): void {
  // Runtime guard in case the literal type is bypassed: software keys may only claim basic.
  if (config.enabled && (config.keyStorage as string) !== 'iso_18045_basic') {
    throw new KeyAttestationError('not_configured', 'La wallet solo puede declarar el nivel iso_18045_basic para sus claves de software; revisa keyAttestationConfig.keyStorage.');
  }
  if (!req) return;
  if (!config.enabled) {
    throw new KeyAttestationError('disabled', 'Este emisor exige una key attestation y esta wallet la tiene desactivada.');
  }
  if (!config.walletProviderUrl) {
    throw new KeyAttestationError('not_configured', 'Este emisor exige una key attestation, pero la wallet no tiene configurado un Wallet Provider.');
  }
  if (req.userAuthentication?.length) {
    throw new KeyAttestationError('user_authentication', 'Este emisor exige un nivel de autenticación de usuario que esta wallet todavía no declara.');
  }
  if (req.keyStorage?.length && !req.keyStorage.includes(config.keyStorage)) {
    throw new KeyAttestationError('key_storage_level', 'Este emisor exige un nivel de almacenamiento de claves que esta wallet no puede garantizar.');
  }
}
