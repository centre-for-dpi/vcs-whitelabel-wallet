# Key Attestations (OID4VCI 1.0 Appendix D) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la wallet adjunte una key attestation firmada por un Wallet Provider
(nivel `iso_18045_basic`) al pedir credenciales OID4VCI, activable con un toggle
en `branding.config.ts`, para cumplir el requisito de KPTDP.

**Architecture:** Nuevo módulo `src/agent/keyAttestation/` con tres piezas: la
config/validación de requisitos, un cliente HTTP hacia el Wallet Provider, y su
integración en `credentialBindingResolver` (que hoy solo devuelve `jwk`/`did`).
Credo 0.6.3 ya sabe consumir una binding `{ method: 'attestation', keyAttestationJwt }`:
elige el proof type `attestation` si la attestation trae `nonce`, o firma un proof
`jwt` con header `key_attestation` usando `attested_keys[0]`. Nosotros solo generamos
la clave, pedimos la attestation y la devolvemos. Las rutas manuales (Inji/legacy,
`buildProofJwt`) reciben el header por separado. El Wallet Provider de producción
queda **fuera de este plan**; aquí solo hay un Wallet Provider de desarrollo para
probar de punta a punta.

**Tech Stack:** Expo SDK 54, React Native 0.81.5, Credo-TS 0.6.3 (`@credo-ts/openid4vc`,
`@openid4vc/openid4vci` 0.4.6), Jest (`jest-expo`), Node ≥ 20 (`node:crypto` WebCrypto)
para el Wallet Provider de desarrollo.

**Spec:** OID4VCI 1.0 §8.2.1.1 / Appendix D (Key Attestations) y D.2 (niveles
ISO 18045); requisito KPTDP "Key storage step" (reportar nivel máximo; > Enhanced-basic
exige documento de evaluación). Las decisiones de esta conversación están resumidas
en *Global Constraints*.

## Global Constraints

- Nivel declarado: `iso_18045_basic` únicamente. Las claves viven en Askar (software), así que no declaramos `enhanced-basic` ni superior.
- Toggle por defecto **apagado** (`enabled: false`): los despliegues actuales no cambian de comportamiento.
- Header JWT de la attestation: `typ: "key-attestation+jwt"`; payload con `iat`, `exp`, `attested_keys`, `key_storage`, y `nonce` = `c_nonce` del emisor.
- Cada JWK de `attested_keys` lleva `kid` = `keyId` del KMS de Credo. Credo lo usa para mapear thumbprint → clave y firmar con ella.
- Una sola clave por attestation (`attested_keys.length === 1`); batch queda fuera.
- Los mensajes de error al usuario van en español, como el resto de `src/agent`.
- No se agregan dependencias nuevas a la app.
- Push directo a `main`, sin PRs (flujo del repo).

## Preguntas abiertas a Adam → qué cambian

| # | Pregunta | Si la respuesta difiere de lo asumido, cambia |
|---|----------|----------------------------------------------|
| 1 | ¿Operamos el Wallet Provider o KPTDP provee uno? | Solo `walletProviderClient.ts` (contrato HTTP). Si es nuestro, se abre un plan aparte para el backend de producción. |
| 2 | Trust anchor / CA | Backend (otro plan) y el `x5c` del Wallet Provider de desarrollo. La app no cambia. |
| 3 | Emisores que exigen attestation | Si ninguno pasa por las rutas legacy, Task 4 se puede saltar. |
| 4 | Proof type `jwt` vs `attestation` | Nada: Credo elige el proof type. Mandamos `nonce` siempre. |
| 5 | ¿Basic alcanza? ¿piden `user_authentication`? | `requirements.ts`: hoy `user_authentication` requerido ⇒ error claro. |
| 6 | Play Integrity / App Attest | Tarea futura `deviceIntegrity.ts` + campo `integrity` en el request. No está en este plan. |
| 7 | Wallet/client attestation | Feature aparte (`walletAttestationJwt` de Credo). No está en este plan. |

## Review Focus

1. Emisor exige attestation y el toggle está apagado → error claro en español que diga que el emisor exige key attestation, no un fallo genérico de Credo. *(Test en Task 3.)*
2. El emisor pide un nivel que no declaramos (p. ej. solo `iso_18045_high`) → error claro antes de llamar al Wallet Provider, sin generar claves de más. *(Tests en Task 1 y Task 3.)*
3. Wallet Provider caído, lento o devuelve 500/HTML → error claro con el status, con timeout de 15 s y sin quedarse colgado. *(Test en Task 2.)*
4. El Wallet Provider devuelve una attestation con otro `nonce` u otra clave → se rechaza localmente y no se envía al emisor. *(Test en Task 2.)*
5. El toggle está encendido con `attachWhen: 'required'` y el emisor no pide nada → el flujo actual (`jwk`/`did`) queda idéntico. *(Test en Task 3.)*

---

### Task 1: Config del toggle + validación de requisitos

**Files:**
- Modify: `branding.config.ts` (agregar `keyAttestationConfig` después de `discoveryConfig`)
- Create: `src/agent/keyAttestation/requirements.ts`
- Test: `src/__tests__/keyAttestationRequirements.test.ts`

**Interfaces:**
- Produces (en `branding.config.ts`):
  ```ts
  export type Iso18045Level = 'iso_18045_basic' | 'iso_18045_enhanced-basic' | 'iso_18045_moderate' | 'iso_18045_high';
  export type KeyAttestationConfig = {
    enabled: boolean;
    walletProviderUrl: string;      // sin barra final
    keyStorage: Iso18045Level;      // nivel que declara nuestro Wallet Provider
    attachWhen: 'required' | 'always';
  };
  export const keyAttestationConfig: KeyAttestationConfig = {
    enabled: false, walletProviderUrl: '', keyStorage: 'iso_18045_basic', attachWhen: 'required',
  };
  ```
- Produces (en `requirements.ts`):
  ```ts
  export type KeyAttestationRequirement = { keyStorage?: string[]; userAuthentication?: string[] };
  export type KeyAttestationErrorCode = 'disabled' | 'key_storage_level' | 'user_authentication' | 'not_configured' | 'provider_error' | 'invalid_attestation';
  export class KeyAttestationError extends Error { constructor(public code: KeyAttestationErrorCode, message: string) }
  export function getKeyAttestationRequirement(proofTypes: OpenId4VciCredentialBindingOptions['proofTypes']): KeyAttestationRequirement | undefined;
  export function shouldAttachKeyAttestation(req: KeyAttestationRequirement | undefined, config: KeyAttestationConfig): boolean;
  export function assertCanSatisfy(req: KeyAttestationRequirement | undefined, config: KeyAttestationConfig): void;
  ```

Semántica fijada:
- `getKeyAttestationRequirement`: usa `proofTypes.attestation?.keyAttestationsRequired` y, si no hay, `proofTypes.jwt?.keyAttestationsRequired`. Si no hay ninguno, devuelve `undefined`.
- `shouldAttachKeyAttestation`: `false` si `!config.enabled`. Si está habilitado, `true` cuando `req` está definido o `attachWhen === 'always'`.
- `assertCanSatisfy` (no hace nada si `req` es `undefined`), en este orden:
  - `!config.enabled` → `disabled`.
  - `!config.walletProviderUrl` → `not_configured`.
  - `req.userAuthentication?.length` → `user_authentication` (todavía no la declaramos).
  - `req.keyStorage?.length && !req.keyStorage.includes(config.keyStorage)` → `key_storage_level`. Según la spec, la lista son los valores aceptados, así que basta con la inclusión, sin ordenar niveles.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
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
  try { assertCanSatisfy(r, c as any); fail('should throw'); }
  catch (e) { expect(e).toBeInstanceOf(KeyAttestationError); expect((e as KeyAttestationError).code).toBe(code); }
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx jest src/__tests__/keyAttestationRequirements.test.ts`
Expected: FAIL, `Cannot find module '../agent/keyAttestation/requirements'`

- [ ] **Step 3: Agregar `keyAttestationConfig` a `branding.config.ts` e implementar `requirements.ts`**

Pon un comentario encima de `keyAttestationConfig`, con el mismo estilo de `discoveryConfig`, que explique: qué es, que Basic es el nivel honesto porque las claves están en Askar, y qué hace cada valor de `attachWhen`. `requirements.ts` importa el tipo de `../../../branding.config` y solo hace `import type` de `@credo-ts/openid4vc`.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx jest src/__tests__/keyAttestationRequirements.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add branding.config.ts src/agent/keyAttestation/requirements.ts src/__tests__/keyAttestationRequirements.test.ts
git commit -m "feat(key-attestation): add config toggle and issuer requirement checks"
```

---

### Task 2: Cliente del Wallet Provider

**Files:**
- Create: `src/agent/keyAttestation/walletProviderClient.ts`
- Test: `src/__tests__/walletProviderClient.test.ts`

**Interfaces:**
- Consumes: `KeyAttestationError` (Task 1).
- Produces:
  ```ts
  export type RequestKeyAttestationOptions = {
    walletProviderUrl: string;
    attestedKey: Record<string, unknown>;   // JWK pública, con kid
    nonce: string;                          // c_nonce del emisor
    keyStorage: string;                     // p. ej. 'iso_18045_basic'
    timeoutMs?: number;                     // default 15_000
  };
  export async function requestKeyAttestation(opts: RequestKeyAttestationOptions): Promise<string>; // JWT compacto
  ```

Contrato HTTP. Lo definimos nosotros y está pendiente de la pregunta 1; si KPTDP provee el Wallet Provider, solo cambia este archivo:
- `POST ${walletProviderUrl}/key-attestation`, `Content-Type: application/json`
- Body: `{ "attested_keys": [<jwk>], "nonce": "<c_nonce>", "key_storage": ["iso_18045_basic"] }`
- 200: `{ "key_attestation": "<jwt>" }`

Validación local antes de devolver (si falla, `KeyAttestationError('invalid_attestation')`). Solo decodifica, sin verificar la firma: eso lo hace el emisor.
- Header: `typ === 'key-attestation+jwt'`.
- Payload: `nonce === opts.nonce`, `attested_keys.length === 1` y `attested_keys[0].x === opts.attestedKey.x`. Para claves EdDSA (OKP) basta `x`.
- Errores de red/timeout o respuestas no-2xx → `KeyAttestationError('provider_error', 'El proveedor de la wallet respondió <status> al pedir la key attestation.')`.

Usa un `AbortController` local para el timeout. Los `fetchWithTimeout` existentes son privados de cada módulo y no se exportan para esto.

- [ ] **Step 1: Escribir los tests que fallan**

Helper en el test: `makeJwt(header, payload)` arma `b64url(header).b64url(payload).sig`.

```ts
test('POSTs keys, nonce and key_storage to /key-attestation and returns the jwt', ...)
  // assert fetch url === 'https://wp.test/key-attestation'
  // assert JSON body equals { attested_keys: [jwk], nonce: 'n-1', key_storage: ['iso_18045_basic'] }
  // assert result === returned jwt
test('rejects attestation with a different nonce', ...)       // code 'invalid_attestation'
test('rejects attestation attesting a different key', ...)    // code 'invalid_attestation'
test('rejects wrong typ header', ...)                         // code 'invalid_attestation'
test('maps 500 / html body to provider_error with status in message', ...) // message contains '500'
test('aborts after timeoutMs', ...)                           // fetch never resolves until aborted; timeoutMs: 10 → 'provider_error'
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx jest src/__tests__/walletProviderClient.test.ts`
Expected: FAIL, módulo no encontrado

- [ ] **Step 3: Implementar `requestKeyAttestation` en `walletProviderClient.ts`**

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx jest src/__tests__/walletProviderClient.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agent/keyAttestation/walletProviderClient.ts src/__tests__/walletProviderClient.test.ts
git commit -m "feat(key-attestation): add Wallet Provider client with local attestation checks"
```

---

### Task 3: Integración en `credentialBindingResolver` (ruta Credo)

**Files:**
- Modify: `src/agent/credentialBinding.ts`
- Test: `src/__tests__/credentialBindingKeyAttestation.test.ts`

**Interfaces:**
- Consumes: `getKeyAttestationRequirement`, `shouldAttachKeyAttestation`, `assertCanSatisfy` (Task 1); `requestKeyAttestation` (Task 2); `keyAttestationConfig` de `branding.config.ts`.
- Produces: la misma firma exportada `credentialBindingResolver(options: OpenId4VciCredentialBindingOptions): Promise<OpenId4VcCredentialHolderBinding>`. `requestCredentials.ts` no cambia.

Comportamiento al principio del resolver, antes de las ramas `jwk`/`did`:
1. `req = getKeyAttestationRequirement(proofTypes)`.
2. Si `req` existe, llama `assertCanSatisfy(req, keyAttestationConfig)` aunque el toggle esté apagado. Así el usuario ve "este emisor exige key attestation y esta wallet la tiene desactivada" en vez del error genérico de Credo.
3. Si `shouldAttachKeyAttestation(req, keyAttestationConfig)`:
   - Algoritmo: el primero de `(proofTypes.attestation ?? proofTypes.jwt)?.supportedSignatureAlgorithms`, o `'EdDSA'` si no hay ninguno.
   - `const { publicJwk, keyId } = await kms.createKeyForSignatureAlgorithm({ algorithm })`.
   - `attestedKey = { ...publicJwk, kid: keyId }`.
   - `keyAttestationJwt = await requestKeyAttestation({ walletProviderUrl, attestedKey, nonce: cNonce, keyStorage })`.
   - Devuelve `{ method: 'attestation', keyAttestationJwt }`.
4. Si no corresponde adjuntar, sigue el flujo actual sin cambios. Con `attachWhen: 'always'` y un emisor que solo acepta `did`, no adjunta: Credo no permite attestation con DID (ver issue OID4VCI #475 en los tipos de Credo).

Mocking: el mismo patrón de `requestCredentialsAuthHeader.test.ts`. Hace `jest.mock('@credo-ts/core', …)` con `Kms.PublicJwk.fromUnknown` (identidad), `jest.mock('../agent/keyAttestation/walletProviderClient')` y `jest.mock('../../branding.config', …)` para variar `keyAttestationConfig` por test (con `jest.isolateModules` o un objeto mutable exportado por el mock).

- [ ] **Step 1: Escribir los tests que fallan**

```ts
test('issuer requires basic + toggle on → returns attestation binding with kid = KMS keyId', ...)
  // expect(requestKeyAttestation).toHaveBeenCalledWith(expect.objectContaining({
  //   attestedKey: expect.objectContaining({ kid: 'kms-key-1' }), nonce: 'c-nonce-1', keyStorage: 'iso_18045_basic' }))
  // expect(result).toEqual({ method: 'attestation', keyAttestationJwt: 'att.jwt.sig' })
test('issuer requires + toggle off → KeyAttestationError disabled, no key created', ...)
  // expect(kms.createKeyForSignatureAlgorithm).not.toHaveBeenCalled()
test('issuer requires only iso_18045_high → key_storage_level, provider not called', ...)
test('toggle on, attachWhen required, issuer requires nothing → jwk binding unchanged', ...)
  // expect(result.method).toBe('jwk'); expect(requestKeyAttestation).not.toHaveBeenCalled()
test('attachWhen always, issuer supports jwk → attestation binding', ...)
test('uses algorithm from attestation proof type when only attestation is offered', ...)
  // proofTypes = { jwt: undefined, attestation: { supportedSignatureAlgorithms: ['ES256'] } }
  // expect(kms.createKeyForSignatureAlgorithm).toHaveBeenCalledWith({ algorithm: 'ES256' })
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx jest src/__tests__/credentialBindingKeyAttestation.test.ts`
Expected: FAIL (el resolver devuelve `jwk` donde se espera `attestation`)

- [ ] **Step 3: Implementar el bloque de attestation en `credentialBindingResolver`**

- [ ] **Step 4: Correr toda la suite (el resolver se mockea en otros tests)**

Run: `npx jest`
Expected: PASS, todos los tests, incluidos los existentes de `requestCredentials*`.

- [ ] **Step 5: Commit**

```bash
git add src/agent/credentialBinding.ts src/__tests__/credentialBindingKeyAttestation.test.ts
git commit -m "feat(key-attestation): return attestation binding from credentialBindingResolver"
```

---

### Task 4: Header `key_attestation` en las rutas manuales (Inji/legacy)

> Solo si la pregunta 3 confirma que algún emisor con attestation pasa por `isLegacyEndpoint` (`/draft13`, `/draft14`, `/v1/certify/`, http). Si no, salta esta tarea.

**Files:**
- Modify: `src/agent/oid4vci/requestCredentials.ts`: `ProofOptions`, `proofOptionsFromConfig` (~L293), `buildProofJwt` (~L323) y sus tres llamadas (~L408, L449, L493).
- Test: `src/__tests__/requestCredentialsKeyAttestation.test.ts`

**Interfaces:**
- Consumes: `shouldAttachKeyAttestation`, `assertCanSatisfy` (Task 1); `requestKeyAttestation` (Task 2).
- Produces:
  - `ProofOptions` gana `keyAttestationRequired?: KeyAttestationRequirement`, que `proofOptionsFromConfig` lee de `config.proof_types_supported.jwt.key_attestations_required` (`key_storage` → `keyStorage`, `user_authentication` → `userAuthentication`).
  - `buildProofJwt` mantiene su firma.

Comportamiento: dentro de `buildProofJwt`, solo en la rama `useJwk`, si `shouldAttachKeyAttestation(...)` da `true`, se llama a `assertCanSatisfy`, se pide la attestation de la clave recién creada (`nonce: cNonce`) y se agrega `key_attestation: <jwt>` al header protegido del proof. Si hace falta adjuntar y la rama es DID, se lanza `KeyAttestationError('disabled', 'El emisor exige key attestation pero solo acepta vinculación por DID, que no es compatible.')`.

- [ ] **Step 1: Escribir los tests que fallan** (mocks como en `requestCredentialsAuthHeader.test.ts`)

```ts
test('legacy jwk path adds key_attestation to proof header when issuer requires it', ...)
  // decode proof.jwt header from the captured POST body → header.key_attestation === 'att.jwt.sig'
test('legacy path without requirement leaves header unchanged', ...)
  // header has no key_attestation; requestKeyAttestation not called
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx jest src/__tests__/requestCredentialsKeyAttestation.test.ts`
Expected: FAIL (el header no tiene `key_attestation`)

- [ ] **Step 3: Implementarlo en `proofOptionsFromConfig` y `buildProofJwt`**

- [ ] **Step 4: Correr toda la suite**

Run: `npx jest`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/oid4vci/requestCredentials.ts src/__tests__/requestCredentialsKeyAttestation.test.ts
git commit -m "feat(key-attestation): attach key_attestation header on legacy manual proof path"
```

---

### Task 5: Wallet Provider de desarrollo + prueba de punta a punta

Es solo para desarrollo. No es el Wallet Provider de producción (eso va en otro plan cuando Adam responda 1 y 2).

**Files:**
- Create: `scripts/dev-wallet-provider.mjs`
- Modify: `README.md` (sección corta "Key attestations (dev)")

**Interfaces:**
- Consumes: el contrato HTTP de Task 2.
- Produces: `node scripts/dev-wallet-provider.mjs [--port 8787]`, que escucha en `POST /key-attestation` y `GET /health`.

Detalles fijados:
- Solo `node:http` y `node:crypto` (`webcrypto.subtle`, ES256 / P-256), sin dependencias nuevas.
- Genera un par de claves al arrancar e imprime la JWK pública. Header: `{ alg: 'ES256', typ: 'key-attestation+jwt', jwk: <pública> }`. Usa `jwk` en vez de `x5c` porque el trust anchor real está pendiente de la pregunta 2.
- Payload: `{ iss: 'cdpi-dev-wallet-provider', iat, exp: iat + 300, attested_keys, key_storage, nonce }`.
- Body inválido (sin `attested_keys` o sin `nonce`) → 400 `{ error: 'invalid_request' }`.

- [ ] **Step 1: Escribir el script**

- [ ] **Step 2: Verificar el contrato con curl**

Run (con el script corriendo):
```bash
curl -s -X POST localhost:8787/key-attestation -H 'content-type: application/json' \
  -d '{"attested_keys":[{"kty":"OKP","crv":"Ed25519","x":"abc","kid":"k1"}],"nonce":"n1","key_storage":["iso_18045_basic"]}'
```
Expected: `{"key_attestation":"eyJ..."}`. Si decodificas el header, debe tener `typ: key-attestation+jwt` y el payload `nonce: "n1"`.

Run: `curl -s -X POST localhost:8787/key-attestation -H 'content-type: application/json' -d '{}' -o /dev/null -w '%{http_code}'`
Expected: `400`

- [ ] **Step 3: Prueba manual en dispositivo**

Configura `keyAttestationConfig = { enabled: true, walletProviderUrl: 'http://<IP-LAN>:8787', keyStorage: 'iso_18045_basic', attachWhen: 'always' }` y emite una credencial SD-JWT desde un emisor Credo/walt.id que acepte `jwk`.
Expected:
- El log del script muestra el POST.
- La credencial se guarda.
- En el log `[oid4vci]` el request de credencial lleva `proofs.attestation` o un `proofs.jwt` cuyo header incluye `key_attestation`.

Vuelve a dejar `enabled: false` antes de commitear.

- [ ] **Step 4: Commit**

```bash
git add scripts/dev-wallet-provider.mjs README.md
git commit -m "chore(key-attestation): add dev Wallet Provider for end-to-end testing"
```

---

## Fuera de este plan (planes futuros, según respuestas de Adam)

- **Wallet Provider de producción** (preguntas 1–2): servicio con HSM/KMS, cadena `x5c` del trust anchor KPTDP, verificación de integridad, rate limiting y revocación si la piden (pregunta 12).
- **Integridad de dispositivo** (pregunta 6): `src/agent/keyAttestation/deviceIntegrity.ts` con Play Integrity / App Attest, más un campo `integrity` en el request de Task 2.
- **Wallet/client attestation** (pregunta 7): pasar `walletAttestationJwt` a `holder.requestToken` / `requestCredentials`.
- **Niveles > Basic**: claves en Secure Enclave / StrongBox (KMS nativo) más el documento de evaluación.
- **Toggle visible al usuario** en Ajustes: hoy el toggle es de despliegue, en `branding.config.ts`.
