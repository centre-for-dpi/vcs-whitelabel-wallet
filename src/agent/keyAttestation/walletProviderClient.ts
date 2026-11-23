import { KeyAttestationError } from './requirements';

export type RequestKeyAttestationOptions = {
  walletProviderUrl: string;
  attestedKey: Record<string, unknown>;
  nonce: string;
  keyStorage: string;
  timeoutMs?: number;
};

function decodeJwtPart(part: string): Record<string, any> {
  let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const json = typeof TextDecoder !== 'undefined' ? new TextDecoder().decode(bytes) : binary;
  return JSON.parse(json);
}

const invalid = (detail: string) =>
  new KeyAttestationError('invalid_attestation', `La key attestation recibida no es válida: ${detail}.`);

function validateAttestation(jwt: unknown, opts: RequestKeyAttestationOptions): string {
  if (typeof jwt !== 'string') throw invalid('falta key_attestation en la respuesta');
  const parts = jwt.split('.');
  if (parts.length !== 3) throw invalid('formato JWT incorrecto');
  let header: Record<string, any>;
  let payload: Record<string, any>;
  try {
    header = decodeJwtPart(parts[0]);
    payload = decodeJwtPart(parts[1]);
  } catch {
    throw invalid('no se pudo decodificar');
  }
  if (header.typ !== 'key-attestation+jwt') throw invalid('typ inesperado');
  if (typeof payload.nonce !== 'string' || payload.nonce === '' || payload.nonce !== opts.nonce) throw invalid('el nonce no coincide');
  const keys = payload.attested_keys;
  if (!Array.isArray(keys) || keys.length !== 1) throw invalid('la clave atestiguada no coincide');
  const echoed = keys[0] ?? {};
  const sent = opts.attestedKey;
  if (typeof sent.kid !== 'string' || typeof echoed.kid !== 'string' || echoed.kid !== sent.kid) {
    throw invalid('el kid de la clave atestiguada no coincide');
  }
  for (const field of ['kty', 'crv', 'x', 'y'] as const) {
    const required = field === 'kty' || field === 'x';
    if (sent[field] === undefined && !required) {
      if (echoed[field] !== undefined) throw invalid('la clave atestiguada no coincide');
      continue;
    }
    if (typeof sent[field] !== 'string' || typeof echoed[field] !== 'string' || echoed[field] !== sent[field]) {
      throw invalid('la clave atestiguada no coincide');
    }
  }
  const storage = payload.key_storage;
  if (!Array.isArray(storage) || storage.length !== 1 || storage[0] !== opts.keyStorage) {
    throw invalid('key_storage no coincide con el nivel declarado');
  }
  return jwt;
}

export async function requestKeyAttestation(opts: RequestKeyAttestationOptions): Promise<string> {
  if (typeof opts.nonce !== 'string' || opts.nonce === '') {
    throw new KeyAttestationError(
      'nonce_unavailable',
      'No hay un nonce (c_nonce) del emisor para solicitar la key attestation.'
    );
  }
  const url = `${opts.walletProviderUrl.replace(/\/+$/, '')}/key-attestation`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  let body: any;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attested_keys: [opts.attestedKey],
        nonce: opts.nonce,
        key_storage: [opts.keyStorage],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new KeyAttestationError(
        'provider_error',
        `El proveedor de la wallet respondió ${res.status} al pedir la key attestation.`
      );
    }
    try {
      body = await res.json();
    } catch {
      throw new KeyAttestationError('provider_error', 'El proveedor de la wallet devolvió una respuesta ilegible.');
    }
  } catch (e) {
    if (e instanceof KeyAttestationError) throw e;
    throw new KeyAttestationError(
      'provider_error',
      'No se pudo contactar al proveedor de la wallet (red o tiempo de espera agotado).'
    );
  } finally {
    clearTimeout(timer);
  }
  return validateAttestation(body?.key_attestation, opts);
}
