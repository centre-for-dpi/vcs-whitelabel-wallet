import type { OpenId4VciCredentialBindingOptions } from '@credo-ts/openid4vc';
import type { KeyAttestationConfig } from '../../../branding.config';

export type KeyAttestationRequirement = { keyStorage?: string[]; userAuthentication?: string[] };

export type KeyAttestationErrorCode =
  | 'disabled'
  | 'key_storage_level'
  | 'user_authentication'
  | 'not_configured'
  | 'provider_error'
  | 'invalid_attestation';

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
  return proofTypes?.attestation?.keyAttestationsRequired ?? proofTypes?.jwt?.keyAttestationsRequired ?? undefined;
}

export function shouldAttachKeyAttestation(
  req: KeyAttestationRequirement | undefined,
  config: KeyAttestationConfig
): boolean {
  if (!config.enabled) return false;
  return req !== undefined || config.attachWhen === 'always';
}

export function assertCanSatisfy(req: KeyAttestationRequirement | undefined, config: KeyAttestationConfig): void {
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
