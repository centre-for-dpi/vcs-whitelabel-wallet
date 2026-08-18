# Módulo holder mDL (ISO/IEC 18013-5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir a `cdpi-wallet` la capacidad de recibir, almacenar y (más adelante,
solo tras Fase 0) presentar por BLE una credencial mDL — generando una clave de
dispositivo real vía Askar/Credo-TS y probando su posesión ante el endpoint nuevo
de `verifiably`, en vez de depender de la clave de prueba embebida que usó la
iteración anterior del issuer.

**Architecture:** Nuevo módulo `src/agent/mdl/`, paralelo a `oid4vci/` y `oid4vp/`
existentes. Reusa `Kms.KeyManagementApi` de Credo-TS (la misma API que ya usa
`credentialBinding.ts`/`requestCredentials.ts` para generar claves y firmar) en
vez de introducir criptografía propia para la clave de dispositivo. `app/receive.tsx`
se extiende con una bifurcación que detecta ofertas `mso_mdoc` y sigue el camino
nuevo, siguiendo el mismo patrón de despacho por tipo que `storeCredential.ts` ya
usa para distinguir SD-JWT de W3C. El transporte BLE y la presentación
(`presentMdoc.ts`) se construyen en este plan pero **no se pueden validar** hasta
que Fase 0 corra en hardware real — es justamente el vehículo para esa prueba.

**Tech Stack:** Expo SDK 54, React Native 0.81.5, Credo-TS 0.6.3. **Corrección tras
revisión: Credo-TS 0.6.3 ya tiene soporte mdoc nativo** — `agent.mdoc` (`MdocApi`)
y `agent.kms` (`KeyManagementApi`) están disponibles directamente en `BaseAgent`
sin tocar `setup.ts`, y `@animo-id/mdoc@0.5.2` (la dependencia real detrás de
`agent.mdoc`, no `@owf/mdoc`) **ya está instalado** como dependencia de
`@credo-ts/core`. Esto elimina la necesidad de instalar `@owf/mdoc`, de escribir
un `MdocRecord` propio, y reduce sustancialmente lo que `MdocContext` necesita
implementar a mano. `@noble/curves`/`@noble/hashes` (ya presentes en
`node_modules`, v2.2.0, arrastrados por Credo — no se instalan de nuevo),
`expo-mdoc-data-transfer@0.2.0-alpha.5` (nuevo, transporte BLE), Jest
(`jest-expo`, ya configurado).

**Spec:** `docs/superpowers/specs/2026-08-17-mdl-iso18013-5-poc-design.md`
(§C.7.3 — holder; §C.7.0 — Fase 0, alcance revisado a matriz Android+iOS; §S-1 a
§S-4 — especificación criptográfica de sesión y device auth).

**Contrato con el otro repo:** este plan consume el endpoint
`POST /api/v1/credentials/mdl/issue` de `verifiably`, documentado en
`docs/superpowers/plans/2026-08-18-mdl-issuance-endpoint.md` de ese repo. El
formato del proof-of-possession JWT (header `{alg, jwk, typ}`, payload
`{nonce, aud, iat}`) debe coincidir byte a byte con lo que ese endpoint valida —
Task 2 de este plan replica exactamente el patrón que `requestCredentials.ts`
(este mismo repo) ya usa para el flujo OID4VCI existente, no una construcción
nueva.

**Sobre el `aud`:** el servidor deriva el `aud` esperado de su propia base URL
pública (`publicBase(r) + "/api/v1/credentials/mdl/issue"`, ver el plan del otro
repo) — **no** es un literal fijo. Este plan construye el proof con
`aud = "{issuerBaseUrl}/api/v1/credentials/mdl/issue"` (Task 3), que es
exactamente ese valor cuando `issuerBaseUrl` es la base pública real del
servidor. No hace falta ningún ajuste de este lado; se documenta aquí porque una
versión previa de ambos planes tenía esto desalineado (el servidor usaba un
literal distinto) y se corrigió centralizando la derivación en el servidor.

## Global Constraints

- Expo SDK 54 / RN 0.81.5 / React 19.1.0 — no cambiar versiones del proyecto.
- **No se instala `@owf/mdoc` ni se toca la versión de `@noble/curves`/`@noble/hashes`
  que Credo-TS ya trae (v2.2.0).** El flujo de recepción/almacenamiento (Tasks 1-7)
  usa exclusivamente `agent.mdoc`/`agent.kms`, ya presentes en `@credo-ts/core`
  0.6.3 — no hay dependencia nueva que instalar para esa parte. El polyfill de
  `TextDecoder` que una versión previa de este plan requería para `@owf/mdoc` ya
  no aplica a Tasks 1-7; si Task 8 (BLE) necesita invocar `@animo-id/mdoc`
  directamente, revisar entonces si ese paquete lo requiere.
- **No se hace upgrade de Credo-TS.** Sigue siendo la restricción vigente para
  cualquier trabajo futuro que sí necesite una versión más nueva de
  `@animo-id/mdoc`/`@owf/mdoc` — el spec descartó el upgrade porque
  `@credo-ts/core` 0.7.0 pinea `@owf/mdoc` ^0.6.0 (no resuelve a 0.7.0) y
  arrastraría cambios de askar.
- **Curva P-256, algoritmo ES256** en toda la generación/firma de claves de
  dispositivo — coincide con lo que el endpoint Go espera.
- **`@cdpi/mdl-core` (si se extrae en el futuro) debe quedar aislable de deps
  nativas** — para este plan, todo el código vive en `src/agent/mdl/` dentro del
  wallet, sin publicarse como paquete aparte todavía.
- Conventional commits **sin scope** (`feat:`, `fix:`, `test:`) — convención de
  este repo, distinta de `verifiably`.
- **Nunca loguear el `access_token` del ciudadano ni PII de la credencial.**
- **La regla de binding (§AD-2):** la `deviceKey` que se envía en el proof debe ser
  la misma que queda comprometida en el MSO devuelto — este módulo no tiene control
  sobre eso del lado servidor, pero debe verificar que el `keyId` usado para firmar
  el proof es el mismo en toda la sesión de emisión (no generar una clave nueva a
  mitad de flujo).
- **`presentMdoc.ts` (BLE) se construye pero no se prueba en este plan** — su
  validación real es Fase 0, que requiere hardware físico y está fuera del alcance
  de tareas ejecutables por un agente.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/agent/mdl/generateDeviceKey.ts` | Genera el par de claves P-256 vía `Kms.createKeyForSignatureAlgorithm`, devuelve `keyId` + JWK pública limpia. |
| `src/agent/mdl/buildPossessionProof.ts` | Construye el JWT de proof-of-possession firmando con `kms.sign`, replicando el patrón de `buildProofJwt` en `requestCredentials.ts`. |
| `src/agent/mdl/requestMdl.ts` | Orquesta las dos llamadas HTTP al endpoint `mdl/issue` de `verifiably`. |
| `src/agent/mdl/storeMdoc.ts` | Usa `agent.mdoc.fromBase64Url` + `MdocRecord.fromMdoc` (**nativos de Credo-TS**, no un record propio) para parsear y persistir el mdoc, con el `keyId` de la clave de dispositivo grabado en `credentialInstances[0].kmsKeyId` — el binding que cierra §AD-2 del lado wallet. |
| `src/agent/mdl/isMdocOffer.ts` | Helper de detección: ¿esta oferta OID4VCI es para `mso_mdoc`? |
| `src/agent/mdl/mdocContext.ts` | (Solo si Task 8/BLE lo necesita) implementación mínima de `MdocContext` de `@animo-id/mdoc` sobre `@noble/curves`/`@noble/hashes` — ver Task 8, alcance reducido tras revisión. |
| `src/agent/mdl/presentMdoc.ts` | (Construido, no probado en este plan) sesión BLE, consentimiento, filtrado, firma `DeviceAuthenticationBytes`. |
| `app/receive.tsx` | Modificar: bifurcación al inicio de `acceptOID4VCI` que detecta `isMdocOffer` y sigue el camino nuevo. |

> **No se instala `@owf/mdoc`.** El paquete real que Credo-TS ya usa internamente
> es `@animo-id/mdoc@0.5.2`, presente en `node_modules` sin ninguna acción de este
> plan. `agent.mdoc` (la API pública de Credo) es la interfaz que este plan
> consume — no se llama a `@animo-id/mdoc` directamente salvo donde se indique
> explícitamente (Task 8).

Cada archivo de `src/agent/mdl/` es pequeño y de una sola responsabilidad —
misma convención que `oid4vci/` (`normalizeOffer.ts`, `requestCredentials.ts`,
`storeCredential.ts` son también archivos de una función/responsabilidad).

---

## Task 1: Generación de la clave de dispositivo

**Files:**
- Create: `src/agent/mdl/generateDeviceKey.ts`
- Test: `src/__tests__/generateDeviceKey.test.ts`

**Interfaces:**
- Consumes: `Kms.KeyManagementApi` (de `@credo-ts/core`, ya en `package.json`).
- Produces:
  - `type DeviceKey = { keyId: string; publicJwk: { kty: string; crv: string; x: string; y: string } }`
  - `async function generateDeviceKey(agent: WalletAgent): Promise<DeviceKey>`

**Nota sobre el nivel de seguridad (§S-4 del spec):** este task **no** decide ni
verifica si la clave queda hardware-backed — eso es responsabilidad de Fase 0
(medirlo en dispositivo real). Aquí solo se genera la clave con la API estándar de
Credo-TS; el nivel de respaldo depende del wrapper de askar en el dispositivo, no
de este código.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/__tests__/generateDeviceKey.test.ts`:

```ts
import { generateDeviceKey } from '../agent/mdl/generateDeviceKey';

function fakeAgent(overrides: Partial<{ createKeyForSignatureAlgorithm: jest.Mock }> = {}) {
  const createKeyForSignatureAlgorithm = overrides.createKeyForSignatureAlgorithm ??
    jest.fn().mockResolvedValue({
      keyId: 'key-abc',
      publicJwk: { kty: 'EC', crv: 'P-256', x: 'xval', y: 'yval', kid: 'internal', use: 'sig' },
    });
  const kms = { createKeyForSignatureAlgorithm };
  return {
    dependencyManager: { resolve: jest.fn().mockReturnValue(kms) },
  } as unknown as import('../agent/setup').WalletAgent;
}

describe('generateDeviceKey', () => {
  test('requests a P-256 key from the KMS', async () => {
    const agent = fakeAgent();
    await generateDeviceKey(agent);
    const kms = (agent.dependencyManager.resolve as jest.Mock).mock.results[0].value;
    expect(kms.createKeyForSignatureAlgorithm).toHaveBeenCalledWith({ algorithm: 'ES256' });
  });

  test('returns the keyId and a JWK stripped of Credo-internal fields', async () => {
    const agent = fakeAgent();
    const result = await generateDeviceKey(agent);
    expect(result.keyId).toBe('key-abc');
    // kid/use/key_ops/ext are Credo bookkeeping — the server-side proof
    // verifier only expects kty/crv/x/y, and INJI-style strict parsers
    // reject unknown jwk header fields (same reason requestCredentials.ts
    // strips them before sending).
    expect(result.publicJwk).toEqual({ kty: 'EC', crv: 'P-256', x: 'xval', y: 'yval' });
    expect(result.publicJwk).not.toHaveProperty('kid');
    expect(result.publicJwk).not.toHaveProperty('use');
  });

  test('propagates a KMS failure instead of swallowing it', async () => {
    const agent = fakeAgent({
      createKeyForSignatureAlgorithm: jest.fn().mockRejectedValue(new Error('kms unavailable')),
    });
    await expect(generateDeviceKey(agent)).rejects.toThrow('kms unavailable');
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm test -- generateDeviceKey`
Expected: FAIL — `Cannot find module '../agent/mdl/generateDeviceKey'`

- [ ] **Step 3: Escribir la implementación**

Crear `src/agent/mdl/generateDeviceKey.ts`:

```ts
import { Kms } from '@credo-ts/core';
import type { WalletAgent } from '../setup';

export type DeviceKey = {
  keyId: string;
  publicJwk: { kty: string; crv: string; x: string; y: string };
};

/**
 * Generates the ES256/P-256 key pair that will be bound into the mDL's MSO
 * (deviceKeyInfo). Uses the same Kms.KeyManagementApi Credo-TS exposes for
 * the existing OID4VCI credential binding — see credentialBinding.ts and
 * requestCredentials.ts's buildProofJwt, which this module's proof builder
 * mirrors exactly.
 *
 * The returned JWK is stripped of Credo-internal bookkeeping fields (kid,
 * key_ops, use, ext): the server-side proof verifier expects a bare
 * kty/crv/x/y object, and strict JWT parsers on the issuer side (as with
 * INJI in the existing OID4VCI flow) reject unrecognized jwk fields.
 */
export async function generateDeviceKey(agent: WalletAgent): Promise<DeviceKey> {
  const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi);
  const { keyId, publicJwk } = await kms.createKeyForSignatureAlgorithm({ algorithm: 'ES256' });
  const { kty, crv, x, y } = publicJwk as { kty: string; crv: string; x: string; y: string };
  return { keyId, publicJwk: { kty, crv, x, y } };
}
```

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `npm test -- generateDeviceKey`
Expected: PASS — los tres tests.

- [ ] **Step 5: Commit**

```bash
git add src/agent/mdl/generateDeviceKey.ts src/__tests__/generateDeviceKey.test.ts
git commit -m "feat: generate ES256 device key for mDL via Credo-TS KMS"
```

---

## Task 2: Construcción del proof de posesión

**Files:**
- Create: `src/agent/mdl/buildPossessionProof.ts`
- Test: `src/__tests__/buildPossessionProof.test.ts`

**Interfaces:**
- Consumes: `Kms.KeyManagementApi` (mismo patrón); `DeviceKey` de Task 1.
- Produces: `async function buildPossessionProof(agent, deviceKey: DeviceKey, issuerUrl: string, nonce: string): Promise<string>` — el JWT compacto.

**Formato exacto** (debe coincidir con lo que
`internal/handlers/mdl_proof.go` de `verifiably` verifica — ver el plan de ese
repo): header `{"alg":"ES256","typ":"openid4vci-proof+jwt","jwk":{kty,crv,x,y}}`,
payload `{"aud":issuerUrl,"nonce":nonce,"iat":<unix>}`. Es literalmente el mismo
shape que ya construye `buildProofJwt` en `requestCredentials.ts` para el flujo
OID4VCI existente — este task lo replica para mdl en vez de reimplementarlo desde
cero, con la única diferencia de que el `nonce` viene de la respuesta del paso 1
del endpoint nuevo, no de un `token_endpoint` OAuth estándar.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/__tests__/buildPossessionProof.test.ts`:

```ts
import { buildPossessionProof } from '../agent/mdl/buildPossessionProof';

function fakeAgent(sign = jest.fn().mockResolvedValue({ signature: new Uint8Array(64).fill(7) })) {
  const kms = { sign };
  return {
    dependencyManager: { resolve: jest.fn().mockReturnValue(kms) },
  } as unknown as import('../agent/setup').WalletAgent;
}

const deviceKey = {
  keyId: 'key-abc',
  publicJwk: { kty: 'EC', crv: 'P-256', x: 'xval', y: 'yval' },
};

describe('buildPossessionProof', () => {
  test('produces a three-segment compact JWT', async () => {
    const agent = fakeAgent();
    const jwt = await buildPossessionProof(agent, deviceKey, 'https://issuer.example/mdl', 'nonce-1');
    expect(jwt.split('.')).toHaveLength(3);
  });

  test('header carries alg, typ and the stripped JWK', async () => {
    const agent = fakeAgent();
    const jwt = await buildPossessionProof(agent, deviceKey, 'https://issuer.example/mdl', 'nonce-1');
    const [h64] = jwt.split('.');
    // TypedArrayEncoder.fromBase64 decodes standard base64, not base64url —
    // the proof is built with toBase64URL, so decode with Buffer's base64url
    // mode here, not TypedArrayEncoder (which has no fromBase64URL method).
    const header = JSON.parse(Buffer.from(h64, 'base64url').toString('utf-8'));
    expect(header).toEqual({
      alg: 'ES256',
      typ: 'openid4vci-proof+jwt',
      jwk: { kty: 'EC', crv: 'P-256', x: 'xval', y: 'yval' },
    });
  });

  test('payload carries aud and the exact nonce passed in', async () => {
    const agent = fakeAgent();
    const jwt = await buildPossessionProof(agent, deviceKey, 'https://issuer.example/mdl', 'nonce-xyz');
    const [, p64] = jwt.split('.');
    const payload = JSON.parse(Buffer.from(p64, 'base64url').toString('utf-8'));
    expect(payload.aud).toBe('https://issuer.example/mdl');
    expect(payload.nonce).toBe('nonce-xyz');
    expect(typeof payload.iat).toBe('number');
  });

  test('signs with the exact same keyId the device key carries', async () => {
    const sign = jest.fn().mockResolvedValue({ signature: new Uint8Array(64) });
    const agent = fakeAgent(sign);
    await buildPossessionProof(agent, deviceKey, 'https://issuer.example/mdl', 'nonce-1');
    expect(sign).toHaveBeenCalledWith(expect.objectContaining({ keyId: 'key-abc', algorithm: 'ES256' }));
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm test -- buildPossessionProof`
Expected: FAIL — `Cannot find module '../agent/mdl/buildPossessionProof'`

- [ ] **Step 3: Escribir la implementación**

Crear `src/agent/mdl/buildPossessionProof.ts`:

```ts
import { Kms, TypedArrayEncoder } from '@credo-ts/core';
import type { WalletAgent } from '../setup';
import type { DeviceKey } from './generateDeviceKey';

/**
 * Builds the OID4VCI proof-of-possession JWT for the mDL issuance endpoint.
 * Mirrors buildProofJwt in ../oid4vci/requestCredentials.ts (same header/
 * payload shape, same jwk-binding path) so the wallet has exactly one
 * pattern for "prove I hold this key" rather than two subtly different ones.
 *
 * The server (verifiably-go, internal/handlers/mdl_proof.go) verifies this
 * exact shape: header {alg, typ, jwk}, payload {aud, nonce, iat}.
 */
export async function buildPossessionProof(
  agent: WalletAgent,
  deviceKey: DeviceKey,
  issuerUrl: string,
  nonce: string,
): Promise<string> {
  const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi);

  const header = { alg: 'ES256', typ: 'openid4vci-proof+jwt', jwk: deviceKey.publicJwk };
  const payload = { aud: issuerUrl, nonce, iat: Math.floor(Date.now() / 1000) };

  const h64 = TypedArrayEncoder.toBase64URL(TypedArrayEncoder.fromString(JSON.stringify(header)));
  const p64 = TypedArrayEncoder.toBase64URL(TypedArrayEncoder.fromString(JSON.stringify(payload)));

  const { signature } = await kms.sign({
    keyId: deviceKey.keyId,
    algorithm: 'ES256',
    data: TypedArrayEncoder.fromString(`${h64}.${p64}`),
  });

  return `${h64}.${p64}.${TypedArrayEncoder.toBase64URL(signature)}`;
}
```

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `npm test -- buildPossessionProof`
Expected: PASS — los cuatro tests.

- [ ] **Step 5: Commit**

```bash
git add src/agent/mdl/buildPossessionProof.ts src/__tests__/buildPossessionProof.test.ts
git commit -m "feat: build OID4VCI proof-of-possession JWT for mDL issuance"
```

---

## Task 3: Orquestación de la emisión (`requestMdl`)

**Files:**
- Create: `src/agent/mdl/requestMdl.ts`
- Test: `src/__tests__/requestMdl.test.ts`

**Interfaces:**
- Consumes: `generateDeviceKey` (Task 1), `buildPossessionProof` (Task 2).
- Produces:
  - `type MdlIssueResult = { credentialBase64Url: string; keyId: string }`
  - `async function requestMdl(agent: WalletAgent, issuerBaseUrl: string, accessToken: string): Promise<MdlIssueResult>`

**Contrato HTTP exacto** (del plan del endpoint en `verifiably`):
paso 1 `POST {issuerBaseUrl}/api/v1/credentials/mdl/issue` con
`{"access_token": accessToken}` → `{"c_nonce": "...", "c_nonce_expires_in": 300}`;
paso 2 misma ruta con
`{"access_token": accessToken, "proof": {"proof_type": "jwt", "jwt": "..."}}` →
`{"credential": "<base64url>"}`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/__tests__/requestMdl.test.ts`:

```ts
import { requestMdl } from '../agent/mdl/requestMdl';
import * as generateDeviceKeyModule from '../agent/mdl/generateDeviceKey';
import * as buildPossessionProofModule from '../agent/mdl/buildPossessionProof';

const ISSUER_BASE = 'https://issuer.example';
const ENDPOINT = `${ISSUER_BASE}/api/v1/credentials/mdl/issue`;

function fakeAgent() {
  return {} as unknown as import('../agent/setup').WalletAgent;
}

beforeEach(() => {
  jest.spyOn(generateDeviceKeyModule, 'generateDeviceKey').mockResolvedValue({
    keyId: 'key-abc',
    publicJwk: { kty: 'EC', crv: 'P-256', x: 'xval', y: 'yval' },
  });
  jest.spyOn(buildPossessionProofModule, 'buildPossessionProof').mockResolvedValue('header.payload.sig');
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  (global.fetch as jest.Mock | undefined)?.mockRestore?.();
});

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let call = 0;
  global.fetch = jest.fn().mockImplementation(() => {
    const r = responses[call];
    call += 1;
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: () => Promise.resolve(r.body),
      text: () => Promise.resolve(JSON.stringify(r.body)),
    });
  }) as unknown as typeof fetch;
}

describe('requestMdl', () => {
  test('does step 1 then step 2 against the exact endpoint', async () => {
    mockFetchSequence([
      { status: 200, body: { c_nonce: 'nonce-1', c_nonce_expires_in: 300 } },
      { status: 200, body: { credential: 'YmFzZTY0dXJs' } },
    ]);

    const result = await requestMdl(fakeAgent(), ISSUER_BASE, 'access-token-123');

    expect(result.credentialBase64Url).toBe('YmFzZTY0dXJs');
    expect(result.keyId).toBe('key-abc');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [step1Call, step2Call] = (global.fetch as jest.Mock).mock.calls;
    expect(step1Call[0]).toBe(ENDPOINT);
    expect(JSON.parse(step1Call[1].body)).toEqual({ access_token: 'access-token-123' });
    expect(step2Call[0]).toBe(ENDPOINT);
    expect(JSON.parse(step2Call[1].body)).toEqual({
      access_token: 'access-token-123',
      proof: { proof_type: 'jwt', jwt: 'header.payload.sig' },
    });
  });

  test('passes the nonce from step 1 into buildPossessionProof', async () => {
    mockFetchSequence([
      { status: 200, body: { c_nonce: 'nonce-specific', c_nonce_expires_in: 300 } },
      { status: 200, body: { credential: 'abc' } },
    ]);
    await requestMdl(fakeAgent(), ISSUER_BASE, 'token');
    expect(buildPossessionProofModule.buildPossessionProof).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ keyId: 'key-abc' }),
      `${ISSUER_BASE}/api/v1/credentials/mdl/issue`,
      'nonce-specific',
    );
  });

  test('throws with the server error message when step 1 fails', async () => {
    mockFetchSequence([{ status: 401, body: { error: 'token verification failed' } }]);
    await expect(requestMdl(fakeAgent(), ISSUER_BASE, 'bad-token')).rejects.toThrow(/token verification failed/);
  });

  test('throws with the server error message when step 2 fails', async () => {
    mockFetchSequence([
      { status: 200, body: { c_nonce: 'nonce-1', c_nonce_expires_in: 300 } },
      { status: 400, body: { error: 'nonce is invalid, expired, or already used' } },
    ]);
    await expect(requestMdl(fakeAgent(), ISSUER_BASE, 'token')).rejects.toThrow(/nonce is invalid/);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm test -- requestMdl`
Expected: FAIL — `Cannot find module '../agent/mdl/requestMdl'`

- [ ] **Step 3: Escribir la implementación**

Crear `src/agent/mdl/requestMdl.ts`:

```ts
import type { WalletAgent } from '../setup';
import { generateDeviceKey } from './generateDeviceKey';
import { buildPossessionProof } from './buildPossessionProof';

/* eslint-disable no-console */
const log = __DEV__ ? console.log.bind(console) : () => {};

export type MdlIssueResult = {
  credentialBase64Url: string;
  keyId: string;
};

type StepOneResponse = { c_nonce: string; c_nonce_expires_in: number };
type StepTwoResponse = { credential: string };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    let message = `mDL issuance request failed (${resp.status})`;
    try {
      const errBody = await resp.json() as { error?: string };
      if (errBody.error) message = errBody.error;
    } catch {
      // response body wasn't JSON — keep the generic message
    }
    throw new Error(message);
  }
  return resp.json() as Promise<T>;
}

/**
 * Runs the full two-step OID4VCI proof-of-possession flow against
 * verifiably-go's POST /api/v1/credentials/mdl/issue:
 *   1. Send the access_token alone, get back a c_nonce.
 *   2. Generate a device key, prove possession of it over that exact nonce,
 *      send the proof, get back the signed mdoc.
 *
 * The device key generated here is the one bound into the returned
 * credential's MSO (deviceKeyInfo) — the server never sees any other key for
 * this request, which is what keeps the §AD-2 binding rule true from the
 * wallet's side.
 */
export async function requestMdl(
  agent: WalletAgent,
  issuerBaseUrl: string,
  accessToken: string,
): Promise<MdlIssueResult> {
  const endpoint = `${issuerBaseUrl}/api/v1/credentials/mdl/issue`;

  log('[mdl] requesting c_nonce, endpoint:', endpoint);
  const step1 = await postJson<StepOneResponse>(endpoint, { access_token: accessToken });

  const deviceKey = await generateDeviceKey(agent);
  const proofJwt = await buildPossessionProof(agent, deviceKey, endpoint, step1.c_nonce);

  log('[mdl] submitting proof for keyId:', deviceKey.keyId);
  const step2 = await postJson<StepTwoResponse>(endpoint, {
    access_token: accessToken,
    proof: { proof_type: 'jwt', jwt: proofJwt },
  });

  return { credentialBase64Url: step2.credential, keyId: deviceKey.keyId };
}
```

> **Nota sobre el `aud` del proof:** el test asume que `issuerUrl` pasado a
> `buildPossessionProof` es la URL completa del endpoint
> (`{issuerBaseUrl}/api/v1/credentials/mdl/issue`), coincidiendo con la constante
> `mdlIssuerIdentifier` del lado servidor (que hoy es un literal fijo, marcado
> `TODO(mdl)` en ese plan). **Si al integrar contra el servidor real el `aud`
> esperado no es la URL del endpoint sino otra cosa (p. ej. la base URL del
> issuer sin el path), ajustar el segundo argumento de `postJson`/
> `buildPossessionProof` en consecuencia — es un valor de configuración, no un
> cambio de diseño.**

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `npm test -- requestMdl`
Expected: PASS — los cuatro tests.

- [ ] **Step 5: Commit**

```bash
git add src/agent/mdl/requestMdl.ts src/__tests__/requestMdl.test.ts
git commit -m "feat: orchestrate the two-step mDL issuance request"
```

---

## Task 4: Detección de oferta mdoc

**Files:**
- Create: `src/agent/mdl/isMdocOffer.ts`
- Test: `src/__tests__/isMdocOffer.test.ts`

**Interfaces:**
- Consumes: nada nuevo — opera sobre el objeto `offer` que produce `normalizeOffer`
  (`offer.offeredCredentialConfigurations`, ya usado en `app/receive.tsx`).
- Produces: `function isMdocOffer(offer: { offeredCredentialConfigurations?: Record<string, unknown> }): boolean`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/__tests__/isMdocOffer.test.ts`:

```ts
import { isMdocOffer } from '../agent/mdl/isMdocOffer';

describe('isMdocOffer', () => {
  test('true when any offered config has format mso_mdoc', () => {
    const offer = {
      offeredCredentialConfigurations: {
        'org.iso.18013.5.1.mDL': { format: 'mso_mdoc', doctype: 'org.iso.18013.5.1.mDL' },
      },
    };
    expect(isMdocOffer(offer)).toBe(true);
  });

  test('false for a normal SD-JWT offer', () => {
    const offer = {
      offeredCredentialConfigurations: {
        PID: { format: 'dc+sd-jwt', vct: 'https://issuer.example/PID' },
      },
    };
    expect(isMdocOffer(offer)).toBe(false);
  });

  test('false when offeredCredentialConfigurations is missing', () => {
    expect(isMdocOffer({})).toBe(false);
  });

  test('true when mso_mdoc is mixed with other formats in the same offer', () => {
    const offer = {
      offeredCredentialConfigurations: {
        PID: { format: 'dc+sd-jwt' },
        mDL: { format: 'mso_mdoc' },
      },
    };
    expect(isMdocOffer(offer)).toBe(true);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm test -- isMdocOffer`
Expected: FAIL — `Cannot find module '../agent/mdl/isMdocOffer'`

- [ ] **Step 3: Escribir la implementación**

Crear `src/agent/mdl/isMdocOffer.ts`:

```ts
/**
 * Detects whether a normalized OID4VCI offer includes an mso_mdoc (ISO/IEC
 * 18013-5) credential configuration, so app/receive.tsx can branch into the
 * mDL path instead of the standard VC path — same dispatch-by-type
 * principle storeCredential.ts already uses for SD-JWT vs W3C records.
 */
export function isMdocOffer(offer: { offeredCredentialConfigurations?: Record<string, unknown> }): boolean {
  const configs = offer.offeredCredentialConfigurations ?? {};
  return Object.values(configs).some((c) => (c as { format?: string })?.format === 'mso_mdoc');
}
```

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `npm test -- isMdocOffer`
Expected: PASS — los cuatro tests.

- [ ] **Step 5: Commit**

```bash
git add src/agent/mdl/isMdocOffer.ts src/__tests__/isMdocOffer.test.ts
git commit -m "feat: detect mso_mdoc credential offers"
```

---

## Task 5 — ELIMINADA tras revisión: `agent.mdoc` ya hace lo que esta tarea iba a construir

**Corrección importante.** La versión previa de este plan afirmaba *"no hay
`MdocRecord` nativo en Credo-TS 0.6.3"* y planeaba instalar `@owf/mdoc` +
escribir un `MdocContext` a mano sobre `@noble/*`. **Ambas afirmaciones eran
falsas**, verificado leyendo directamente `node_modules/@credo-ts/core`:

- `BaseAgent` expone `readonly mdoc: MdocApi` y `readonly genericRecords`
  directamente — sin tocar `setup.ts`.
- `MdocApi` ya tiene `fromBase64Url(base64Url)`, `store({record})`, `update(record)`,
  `verify(mdoc, options)` — cubre exactamente lo que `storeMdoc.ts` necesita.
- `MdocRecord` ya existe, con `credentialInstances[0].kmsKeyId` — el campo que
  registra el binding a la clave de dispositivo (§AD-2).
- El paquete detrás de todo esto es `@animo-id/mdoc@0.5.2`, **ya instalado**
  como dependencia de `@credo-ts/core` — no `@owf/mdoc`, que nunca hizo falta
  instalar.

Esto elimina la necesidad de un `MdocContext` escrito a mano para el flujo de
recepción/almacenamiento: Credo hace esa criptografía internamente. Task 6
(reescrita abajo) usa `agent.mdoc` directamente. `MdocContext` solo reaparece,
de forma acotada, en Task 8 — únicamente si el trabajo de BLE necesita invocar
`@animo-id/mdoc` para algo que `agent.mdoc` no cubre (filtrado por
`DeviceRequest`, construcción de `DeviceResponse`), y con una interfaz mínima,
no la que este plan asumía antes.

---

## Task 6: Almacenamiento del mdoc recibido (vía `agent.mdoc`, no un record propio)

**Files:**
- Create: `src/agent/mdl/storeMdoc.ts`
- Test: `src/__tests__/storeMdoc.test.ts`

**Interfaces:**
- Consumes: `agent.mdoc.fromBase64Url`, `MdocRecord.fromMdoc`, `agent.mdoc.store`,
  `agent.mdoc.update` (todos nativos de `@credo-ts/core`, confirmados arriba).
- Produces:
  - `async function storeMdoc(agent: WalletAgent, credentialBase64Url: string, keyId: string, meta: { issuerName: string }): Promise<void>`

**Diferencia respecto a la versión anterior de este plan: `storeMdoc` ahora
recibe `keyId`.** La versión previa lo omitía — `requestMdl` (Task 3) genera y
devuelve el `keyId` de la clave de dispositivo, pero nada lo persistía junto al
mdoc. Sin ese vínculo, `presentMdoc.ts` (Task 8) no tendría con qué firmar la
presentación más adelante, y la regla de binding de §AD-2 quedaría satisfecha
del lado servidor pero rota del lado wallet. `MdocRecord.credentialInstances[0].kmsKeyId`
es exactamente el campo que Credo-TS reservó para esto.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/__tests__/storeMdoc.test.ts`:

```ts
import { storeMdoc } from '../agent/mdl/storeMdoc';

// Building a structurally real IssuerSigned-shaped CBOR is out of scope for
// a unit test here — that's exactly what the cross-repo interop vectors
// (verifiably-go's internal/mdl/testdata/vectors/mdl_full.cbor) are for.
// This test verifies the STORAGE contract against Credo's real API shape:
// given a base64url string, agent.mdoc is asked to parse and store it, and
// the resulting record carries the device key binding and issuer tag.
function fakeAgent(mdocOverrides: Partial<{ docType: string }> = {}) {
  const fakeMdoc = { docType: mdocOverrides.docType ?? 'org.iso.18013.5.1.mDL' };
  const fromBase64Url = jest.fn().mockReturnValue(fakeMdoc);
  const store = jest.fn().mockResolvedValue({
    credentialInstances: [{ issuerSignedBase64Url: 'x', kmsKeyId: undefined }],
    setTag: jest.fn(),
  });
  const update = jest.fn().mockResolvedValue(undefined);
  return {
    mdoc: { fromBase64Url, store, update },
  } as unknown as import('../agent/setup').WalletAgent;
}

describe('storeMdoc', () => {
  test('parses via agent.mdoc.fromBase64Url and stores the result', async () => {
    const agent = fakeAgent();
    await storeMdoc(agent, 'YmFzZTY0dXJs', 'key-abc', { issuerName: 'INTRANT' });

    expect(agent.mdoc.fromBase64Url).toHaveBeenCalledWith('YmFzZTY0dXJs');
    expect(agent.mdoc.store).toHaveBeenCalled();
  });

  test('binds the stored record to the exact keyId that requested it', async () => {
    const agent = fakeAgent();
    await storeMdoc(agent, 'YmFzZTY0dXJs', 'key-abc', { issuerName: 'INTRANT' });

    const storeCall = (agent.mdoc.store as jest.Mock).mock.calls[0][0];
    expect(storeCall.record.credentialInstances[0].kmsKeyId).toBe('key-abc');
  });

  test('tags the record with the issuer name and calls update to persist tags', async () => {
    const agent = fakeAgent();
    await storeMdoc(agent, 'YmFzZTY0dXJs', 'key-abc', { issuerName: 'INTRANT' });

    const stored = await (agent.mdoc.store as jest.Mock).mock.results[0].value;
    expect(stored.setTag).toHaveBeenCalledWith('issuerName', 'INTRANT');
    expect(agent.mdoc.update).toHaveBeenCalledWith(stored);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm test -- storeMdoc`
Expected: FAIL — `Cannot find module '../agent/mdl/storeMdoc'`

- [ ] **Step 3: Confirmar `MdocRecord.fromMdoc` y el shape de `credentialInstances`**

```bash
grep -n "fromMdoc\|credentialInstances" node_modules/@credo-ts/core/build/modules/mdoc/repository/MdocRecord.d.mts
```

Confirmado (verificado al escribir este plan): `MdocRecord.fromMdoc(mdoc)` es un
método estático que construye el record a partir de un `Mdoc` ya parseado, y
`credentialInstances` es `NonEmptyArray<{issuerSignedBase64Url: string; kmsKeyId?: string}>`
— el primer elemento (`[0]`) es el que se rellena con el `keyId`.

- [ ] **Step 4: Escribir `storeMdoc.ts`**

Crear `src/agent/mdl/storeMdoc.ts`:

```ts
import { MdocRecord } from '@credo-ts/core';
import type { WalletAgent } from '../setup';

/**
 * Parses and stores an mdoc received from verifiably's mDL issuance
 * endpoint, using Credo-TS's native mdoc support (agent.mdoc / MdocRecord) —
 * NOT a hand-rolled record type. Credo-TS 0.6.3 already has this; an earlier
 * draft of this module assumed it didn't and planned to reinvent it, which
 * would have silently dropped the keyId binding below.
 *
 * The keyId is the device key generateDeviceKey() created for this exact
 * issuance (Task 1/3) — recording it in credentialInstances[0].kmsKeyId is
 * what lets a later presentation (Task 8) find the right signing key for
 * this credential. Without it, the binding the server enforces (§AD-2) would
 * have no counterpart on the wallet side.
 */
export async function storeMdoc(
  agent: WalletAgent,
  credentialBase64Url: string,
  keyId: string,
  meta: { issuerName: string },
): Promise<void> {
  const mdoc = agent.mdoc.fromBase64Url(credentialBase64Url);
  const record = MdocRecord.fromMdoc(mdoc);
  record.credentialInstances[0].kmsKeyId = keyId;

  const stored = await agent.mdoc.store({ record });
  stored.setTag('issuerName', meta.issuerName);
  await agent.mdoc.update(stored);
}
```

- [ ] **Step 5: Ejecutar los tests y verificar que pasan**

Run: `npm test -- storeMdoc`
Expected: PASS — los tres tests.

- [ ] **Step 6: Commit**

```bash
git add src/agent/mdl/storeMdoc.ts src/__tests__/storeMdoc.test.ts
git commit -m "feat: parse and persist received mdocs via Credo-TS native MdocApi"
```

---

## Task 7: Integración con `app/receive.tsx`

**Files:**
- Modify: `app/receive.tsx`

**Interfaces:**
- Consumes: `isMdocOffer` (Task 4), `requestMdl` (Task 3), `storeMdoc` (Task 6).
- Produces: nada nuevo — modifica el flujo existente.

Este task no tiene test unitario propio: `receive.tsx` es un componente de pantalla
sin tests existentes en el repo (confirmado: no hay `receive.test.tsx` en
`src/__tests__/`), y las piezas que integra ya están probadas por separado en los
Tasks 3, 4 y 6. La verificación de este task es de integración manual (Step 3).

- [ ] **Step 1: Localizar el punto de bifurcación**

En `app/receive.tsx`, dentro de `acceptOID4VCI`, justo después de la comprobación
`if (agentState.status !== 'ready' || !normalizedOffer || !offerInfo) return;` y
antes de `if (offerInfo.txCodeRequired && !txCode.trim()) return;`.

- [ ] **Step 2: Añadir la bifurcación**

Añadir el import al principio del archivo, junto a los demás imports de
`../src/agent/oid4vci/...`:

```ts
import { isMdocOffer } from '../src/agent/mdl/isMdocOffer';
import { requestMdl } from '../src/agent/mdl/requestMdl';
import { storeMdoc } from '../src/agent/mdl/storeMdoc';
```

Dentro de `acceptOID4VCI`, después del guard existente y antes del resto de la
función:

```ts
  const acceptOID4VCI = async () => {
    if (agentState.status !== 'ready' || !normalizedOffer || !offerInfo) return;
    if (offerInfo.txCodeRequired && !txCode.trim()) return;
    const { agent } = agentState;
    setStep('accepting');
    try {
      if (isMdocOffer(normalizedOffer)) {
        // mDL path: the issuer's mdl/issue endpoint takes the access_token
        // directly (no separate token endpoint round-trip) and returns the
        // signed mdoc after the proof-of-possession exchange requestMdl
        // orchestrates. This bypasses the OID4VCI credential-request path
        // below — mso_mdoc has its own proof/binding flow, not the
        // jwt-vc/sd-jwt one requestOid4VciCredentials handles.
        const issuerMeta = (normalizedOffer.metadata as Record<string, unknown>)
          ?.credentialIssuer as Record<string, unknown> | undefined;
        const issuerUrl = (issuerMeta?.credential_issuer as string | undefined)?.replace(/\/$/, '');
        if (!issuerUrl) throw new Error('credential_issuer missing from mDL offer');

        // The mDL endpoint's step 1 IS the token step for this flow — it
        // takes the citizen's OIDC access_token directly, not a pre-auth
        // code exchanged at a separate token_endpoint. This app does not
        // yet expose a citizen OIDC session to this screen (see the plan's
        // closing notes) — DEV_MDL_ACCESS_TOKEN is a development-only
        // escape hatch, never a real citizen credential, and its absence
        // fails loudly instead of silently reusing an unrelated field
        // (an earlier draft of this code reused `txCode`, which is
        // semantically a pre-auth tx_code, not an access_token — fixed
        // before this landed).
        const accessTokenForMdl = process.env.EXPO_PUBLIC_DEV_MDL_ACCESS_TOKEN;
        if (!accessTokenForMdl) {
          throw new Error(
            'mDL issuance needs the citizen\'s OIDC access_token, and this screen ' +
            'has no session source for it yet. Set EXPO_PUBLIC_DEV_MDL_ACCESS_TOKEN ' +
            'for local/Fase-0 testing, or wire a real session source before shipping.',
          );
        }
        const result = await requestMdl(agent, issuerUrl, accessTokenForMdl);
        // result.keyId is passed through so the stored record carries the
        // §AD-2 binding — see storeMdoc.ts (Task 6) for why this must not be
        // dropped here.
        await storeMdoc(agent, result.credentialBase64Url, result.keyId, { issuerName: offerInfo.issuer });

        setStep('done');
        return;
      }

      // existing OID4VCI path, unchanged below
```

> **Nota que hay que resolver antes de que esto funcione contra un flujo real de
> ciudadano (no bloquea los Tasks 1-6, sí bloquea probar Task 7 con un flujo
> completo):** el endpoint `mdl/issue` espera el `access_token` OIDC del
> ciudadano, que en el flujo `self-issue` existente (`self_issue.go` del lado
> servidor) viene de una sesión OIDC ya autenticada de la app. Esta pantalla no
> expone hoy ninguna sesión de ese tipo — el código de arriba lo resuelve con una
> variable de entorno de desarrollo que **falla explícitamente** si no está
> configurada, en vez de reusar por error un campo semánticamente distinto
> (`txCode`, que es el `tx_code` de un pre-auth OID4VCI, no un `access_token`).
> **Antes de considerar este task terminado contra un caso de uso real**, hay
> que decidir de dónde saca `receive.tsx` la sesión OIDC del ciudadano (¿existe
> ya un contexto de sesión en la app? Revisar si `useAgentState`/algún otro
> contexto ya lo expone) y sustituir esta variable de entorno por esa fuente
> real. Para Fase 0, la variable de entorno es suficiente y deliberada.

- [ ] **Step 3: Verificación manual de integración**

Sin un flujo de sesión OIDC de ciudadano ya resuelto (ver nota del Step 2), la
verificación completa de este task queda **parcial**: se puede confirmar que el
código compila, que `isMdocOffer` clasifica correctamente una oferta de prueba, y
que `requestMdl`/`storeMdoc` se invocan — pero el flujo de punta a punta contra el
endpoint real de `verifiably` no se puede ejercitar hasta resolver de dónde viene
el `access_token`. Documentar este estado en el commit.

```bash
npx tsc --noEmit
```

Expected: sin errores de tipo nuevos introducidos por este cambio.

- [ ] **Step 4: Commit**

```bash
git add app/receive.tsx
git commit -m "feat: branch receive flow to the mDL path for mso_mdoc offers

Known gap: the access_token source for the citizen's OIDC session in this
flow is not yet resolved — see the inline note in acceptOID4VCI. Blocks a
real end-to-end test against verifiably's mdl/issue endpoint; does not
block Tasks 1-6 or the BLE work in later tasks of this plan."
```

---

## Task 8: Transporte BLE (holder) — construido, no probado en este plan

**Corrección tras revisión — alcance de este task, con precisión:**

1. **Las Interfaces declaradas anteriormente
   (`announceForPresentation`/`respondToRequest`) no se implementan en este
   task.** Lo que sí se construye son cuatro funciones más pequeñas
   (`buildSessionTranscript`, `buildDeviceAuthenticationBytes`,
   `deriveSessionKey`, `filterByRequest`) — la orquestación de sesión BLE
   completa (`announceForPresentation`/`respondToRequest`) queda para cuando
   Fase 0 confirme que el transporte funciona; construirla antes sería
   ensamblar contra un paquete (`expo-mdoc-data-transfer`) que este task
   instala pero **no llega a usar** en ningún punto de su código.
2. **La pantalla de consentimiento (criterio (c) del spec: "no se envía sin
   aprobación del usuario") NO estaba en el plan anterior y es un hueco real** —
   a diferencia del transporte BLE, una pantalla de React Native no depende de
   hardware de Fase 0 y es perfectamente construible y testeable ahora. Se
   añade como entregable explícito de este task (ver Step 6).
3. **`filterByRequest` implementa solo coincidencia exacta por nombre de
   campo** — no la semántica de proximidad de `age_over_NN` ("el atestado más
   cercano ≥ NN") que el spec describe en §C.7.2. Implementar esa semántica
   exige conocer la relación de orden entre nombres de atestados
   (`age_over_18` < `age_over_21`, etc.), que es lógica de negocio del dataset,
   no de filtrado genérico — se declara explícitamente **fuera de alcance de
   este task** en vez de fingirse con un test que no la ejercita.

**Este sigue siendo el único task de este plan cuya validación de transporte real
depende de hardware (Fase 0, §C.7.0 del spec)** — eso no cambia. El código se
escribe completo para lo que sí es testeable sin BLE real, pero no se declara
"funcionando" hasta que Fase 0 confirme device engagement real en los dispositivos
físicos disponibles (Android + iPhone, según el alcance revisado del spec).

**Files:**
- Modify: `package.json`
- Create: `src/agent/mdl/presentMdoc.ts`
- Create: `app/present-mdl.tsx` (pantalla de consentimiento — Step 6)
- Test: `src/__tests__/presentMdoc.test.ts`

**Interfaces:**
- Consumes: `storeMdoc`'s stored `MdocRecord` (Task 6, vía `agent.mdoc.findAllByQuery`
  o `agent.mdoc.getAll`); `expo-mdoc-data-transfer` (instalado, no invocado en
  este task).
- Produces:
  - `function buildSessionTranscript(deviceEngagementBytes, eReaderKeyBytes, handover): [Uint8Array, Uint8Array, unknown]`
  - `function buildDeviceAuthenticationBytes(sessionTranscript, docType, deviceNameSpacesBytes): Uint8Array` — **placeholder, no CBOR real, ver nota**
  - `async function deriveSessionKey(sharedSecret, sessionTranscriptBytes, info): Promise<Uint8Array>`
  - `function filterByRequest(stored, requestedElements): Record<string, unknown>` — **coincidencia exacta únicamente**

**Especificación criptográfica exacta a implementar** (§S-1 y §S-2 del spec,
verbatim):

```
SessionTranscript = [DeviceEngagementBytes, EReaderKeyBytes, Handover]
DeviceAuthentication = ["DeviceAuthentication", SessionTranscript, DocType, DeviceNameSpacesBytes]
DeviceAuthenticationBytes = #6.24(bstr .cbor DeviceAuthentication)
DeviceSignature = COSE_Sign1 con payload=nil, contenido detached = DeviceAuthenticationBytes

sharedSecret = ECDH(EDeviceKey.Priv, EReaderKey.Pub)
salt         = SHA-256(SessionTranscriptBytes)   ← el digest, no los bytes crudos
SKDevice     = HKDF-SHA256(sharedSecret, salt, info="SKDevice", 32 bytes)
IV = 4B ceros ‖ 00000001 (mdoc) ‖ contador BE de 4B empezando en 1
cifrado = AES-256-GCM
```

- [ ] **Step 1: Instalar el paquete de transporte BLE, pineado**

```bash
npm install expo-mdoc-data-transfer@0.2.0-alpha.5
```

Es la **única versión publicada** del paquete desescopado de OWF Labs — no hay
rango que pinear, se pinea exacto porque es alpha.

- [ ] **Step 2: Escribir los tests de lo que es testeable sin BLE real**

Crear `src/__tests__/presentMdoc.test.ts`:

```ts
import { buildSessionTranscript, buildDeviceAuthenticationBytes, filterByRequest } from '../agent/mdl/presentMdoc';

describe('buildSessionTranscript', () => {
  test('produces a 3-element array with DeviceEngagement, EReaderKey and Handover', () => {
    const deviceEngagementBytes = new Uint8Array([1, 2, 3]);
    const eReaderKeyBytes = new Uint8Array([4, 5, 6]);
    const transcript = buildSessionTranscript(deviceEngagementBytes, eReaderKeyBytes, null);
    expect(transcript).toHaveLength(3);
  });
});

describe('buildDeviceAuthenticationBytes', () => {
  test('array starts with the literal tag "DeviceAuthentication"', () => {
    const sessionTranscript = [new Uint8Array(), new Uint8Array(), null] as const;
    const bytes = buildDeviceAuthenticationBytes(sessionTranscript, 'org.iso.18013.5.1.mDL', new Uint8Array([9]));
    // Decoding fully is exercised in the cross-repo interop pass (Task 9
    // note); here we confirm the CBOR-24-tagged wrapper is non-empty and
    // deterministic for the same inputs.
    expect(bytes.length).toBeGreaterThan(0);
    const again = buildDeviceAuthenticationBytes(sessionTranscript, 'org.iso.18013.5.1.mDL', new Uint8Array([9]));
    expect(Buffer.from(bytes).equals(Buffer.from(again))).toBe(true);
  });
});

describe('filterByRequest', () => {
  test('returns only the requested elements, dropping the rest', () => {
    const stored = { family_name: 'Pérez', given_name: 'Ana', document_number: '123' };
    const requested = ['family_name', 'given_name'];
    const filtered = filterByRequest(stored, requested);
    expect(Object.keys(filtered).sort()).toEqual(['family_name', 'given_name']);
    expect(filtered).not.toHaveProperty('document_number');
  });

  test('age_over_NN: matches only the exact attestation name requested', () => {
    // filterByRequest does ONLY exact-name matching. Spec §C.7.2 describes a
    // richer semantics ("closest attestation present that is >= NN") that
    // this function does NOT implement — that requires knowing the ordering
    // between age_over_NN names, which is dataset-specific logic, not
    // generic filtering. Declared out of scope for this task (see the note
    // above the Files list). This test documents the actual behavior:
    // requesting age_over_18 when only age_over_21 is stored returns nothing,
    // even though age_over_21 implies age_over_18.
    const stored = { age_over_21: true };
    const filtered = filterByRequest(stored, ['age_over_18']);
    expect(filtered).toEqual({});
  });

  test('never returns an element that was not requested, even if present', () => {
    const stored = { family_name: 'Pérez', birth_date: '1990-03-15' };
    const filtered = filterByRequest(stored, ['family_name']);
    expect(filtered).not.toHaveProperty('birth_date');
  });
});
```

- [ ] **Step 3: Ejecutar el test y verificar que falla**

Run: `npm test -- presentMdoc`
Expected: FAIL — `Cannot find module '../agent/mdl/presentMdoc'`

- [ ] **Step 4: Escribir la implementación**

Crear `src/agent/mdl/presentMdoc.ts`:

```ts
import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';

/**
 * SessionTranscript per spec §S-1 / ISO 18013-5 clause 9.1.5.1.
 * The reader's EReaderKey must be fresh per session — reusing it across
 * sessions repeats the transcript and enables replay. That freshness is the
 * caller's responsibility (whoever supplies eReaderKeyBytes); this function
 * only assembles the structure correctly.
 */
export function buildSessionTranscript(
  deviceEngagementBytes: Uint8Array,
  eReaderKeyBytes: Uint8Array,
  handover: unknown,
): [Uint8Array, Uint8Array, unknown] {
  return [deviceEngagementBytes, eReaderKeyBytes, handover];
}

/**
 * DeviceAuthenticationBytes per spec §S-1: the detached payload that
 * DeviceSignature is computed over. This is NOT the SessionTranscript
 * itself — it's a 4-element array naming it alongside the docType and the
 * disclosed namespaces, then tag-24-wrapped. Getting this wrong (e.g.
 * signing the SessionTranscript directly) produces a signature no
 * conformant reader accepts — the exact class of bug the previous plan's
 * Task 7 caught for IssuerAuth.
 */
export function buildDeviceAuthenticationBytes(
  sessionTranscript: readonly [Uint8Array, Uint8Array, unknown],
  docType: string,
  deviceNameSpacesBytes: Uint8Array,
): Uint8Array {
  // TODO(mdl): replace with a real CBOR encoder (matching internal/mdl's
  // EncMode canonical settings on the Go side) once this is wired against
  // an actual reader session. This placeholder concatenation is deliberately
  // NOT a valid CBOR encoding — it exists only so buildSessionTranscript's
  // determinism can be unit-tested before Fase 0 hardware is available.
  // Flagged explicitly rather than left silent: do not build on top of this
  // function's output as if it were spec-correct CBOR until this is done.
  const parts = [sessionTranscript[0], sessionTranscript[1], deviceNameSpacesBytes];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * Derives SKDevice per spec §S-2. sharedSecret must come from ECDH between
 * the device's ephemeral private key and the reader's ephemeral public key
 * — that ECDH step lives wherever the transport module (expo-mdoc-data-transfer)
 * exposes it, not here; this function only does the HKDF step once a shared
 * secret exists.
 */
export async function deriveSessionKey(
  sharedSecret: Uint8Array,
  sessionTranscriptBytes: Uint8Array,
  info: 'SKDevice' | 'SKReader',
): Promise<Uint8Array> {
  const salt = sha256(sessionTranscriptBytes); // the DIGEST, not the raw bytes — §S-2
  return hkdf(sha256, sharedSecret, salt, new TextEncoder().encode(info), 32);
}

/**
 * Filters stored mdoc elements down to exactly what a DeviceRequest asked
 * for — the wallet must never disclose more than requested (spec §S-3).
 */
export function filterByRequest(
  stored: Record<string, unknown>,
  requestedElements: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of requestedElements) {
    if (key in stored) out[key] = stored[key];
  }
  return out;
}
```

> **La función `buildDeviceAuthenticationBytes` de arriba NO produce CBOR
> válido** — es una simplificación deliberada y marcada como tal (ver el
> `TODO(mdl)` en el propio código) para que Task 8 sea testeable sin bloquear en
> una librería CBOR completa antes de Fase 0. **No cerrar este task como "listo
> para producción"**: el reemplazo por una codificación CBOR real (reusando
> `@owf/mdoc` o una librería CBOR equivalente en RN) es trabajo de seguimiento
> obligatorio antes de que `presentMdoc.ts` participe en cualquier sesión BLE
> real, y debe hacerse en el mismo plan/PR donde se integre `expo-mdoc-data-transfer`
> de verdad (Fase 0 en adelante), no antes — hacerlo antes sería construir contra
> un transporte que todavía no sabemos si funciona en el hardware disponible.

- [ ] **Step 5: Ejecutar los tests y verificar que pasan**

Run: `npm test -- presentMdoc`
Expected: PASS — los cinco tests. (`deriveSessionKey` no tiene test unitario en
este task porque requiere un `sharedSecret` real de una sesión ECDH que no existe
sin hardware; se prueba en Fase 0 con datos de una sesión real, no aquí.)

- [ ] **Step 6: Pantalla de consentimiento**

Este es el entregable que la revisión encontró ausente del plan anterior — el
criterio (c) del spec ("no se envía sin aprobación del usuario") no depende de
hardware BLE y no tiene motivo para esperar a Fase 0.

Crear `app/present-mdl.tsx`. Es una pantalla mínima, siguiendo el estilo visual de
`app/receive.tsx` (mismo patrón de `ScrollView`/`View`/`TouchableOpacity` y
`branding.primaryColor`) pero con un flujo de estados más simple: recibe la lista
de elementos solicitados (`requestedElements: string[]`, ya resuelta por quien la
navegue hasta aquí — la extracción real de un `DeviceRequest` CBOR es trabajo de
Fase 0, no de este task) y expone un callback de aprobación/rechazo.

```tsx
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { branding } from '../branding.config';

type Props = {
  requestedElements: string[];
  onApprove: () => void;
  onReject: () => void;
};

/**
 * Consent screen for an mDL presentation request (spec §S-3 / criterion (c):
 * "no se envía sin aprobación del usuario"). The holder sees exactly which
 * elements were requested before anything is signed or transmitted —
 * filterByRequest (presentMdoc.ts) only ever sees the approved list, never
 * the full stored credential.
 */
export default function PresentMdlConsent({ requestedElements, onApprove, onReject }: Props) {
  const { t } = useTranslation();
  const [approving, setApproving] = useState(false);

  const handleApprove = () => {
    setApproving(true);
    onApprove();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.label}>{t('presentMdl.label_requested')}</Text>
        {requestedElements.map((name) => (
          <View key={name} style={styles.elementRow}>
            <Text style={styles.elementName}>{name}</Text>
          </View>
        ))}
      </View>
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: branding.primaryColor }, approving && styles.btnDisabled]}
        disabled={approving}
        onPress={handleApprove}
      >
        <Text style={styles.btnText}>{t('presentMdl.approve_btn')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.cancelBtn} onPress={onReject}>
        <Text style={styles.cancelText}>{t('common.cancel')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { flexGrow: 1, padding: 24 },
  card: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 20, marginBottom: 16 },
  label: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  elementRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  elementName: { fontSize: 15, color: '#111827' },
  btn: { height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelBtn: { height: 44, justifyContent: 'center', alignItems: 'center' },
  cancelText: { color: '#6B7280', fontSize: 15 },
});
```

> **Añadir las claves de traducción** `presentMdl.label_requested` y
> `presentMdl.approve_btn` a los recursos de `src/i18n` (en, es, fr) siguiendo el
> mismo patrón que las claves `receive.*` ya existentes.

**Lo que este task NO conecta todavía (y no debe fingir hacerlo):** esta pantalla
no está enlazada a ningún flujo real de recepción de `DeviceRequest` por BLE — eso
exige el transporte de Fase 0, que es exactamente lo que este task declara fuera
de alcance. Queda como componente aislado, probado por separado, listo para
conectarse cuando `announceForPresentation`/`respondToRequest` (las interfaces que
el plan anterior daba por hechas) se implementen de verdad.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/agent/mdl/presentMdoc.ts \
        src/__tests__/presentMdoc.test.ts app/present-mdl.tsx
git commit -m "feat: add BLE presentation scaffolding and consent screen

NOT production-ready: buildDeviceAuthenticationBytes is a placeholder
concatenation, not real CBOR encoding — see the TODO(mdl) comment. Real BLE
device engagement is untested pending Fase 0 hardware validation.
filterByRequest does exact-name matching only — the age_over_NN proximity
semantics in spec §C.7.2 are explicitly out of scope for this task."
```

---

## Task 9: Verificación final

**Files:** ninguno nuevo.

- [ ] **Step 1: Suite completa de Jest**

Run: `npm test`
Expected: todos los tests de `src/__tests__/` en verde, incluidos los nuevos de
este plan y los preexistentes (sin regresiones).

- [ ] **Step 2: TypeScript sin errores**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos atribuibles a este plan.

- [ ] **Step 3: Confirmar que no se rompió el flujo OID4VCI existente**

Los tests existentes (`normalizeOffer.test.ts`, `selectCredentials.test.ts`, etc.)
deben seguir pasando sin modificación — este plan no debe haber tocado ningún
archivo de `oid4vci/`, `oid4vp/`, `trust.ts` ni `revocation.ts`.

```bash
npm test -- --listTests | grep -v mdl
```

Confirmar que la lista no incluye ningún test roto fuera de `src/__tests__/*mdl*`.

## Notas para quien retome este plan

**Corrección estructural aplicada tras revisión exhaustiva (léase primero):** la
versión original de este plan asumía que Credo-TS 0.6.3 no tenía soporte nativo
de mdoc y planeaba instalar `@owf/mdoc` + escribir un `MdocRecord` y un
`MdocContext` propios (Tasks 5-6 originales). **Ambas premisas eran falsas** —
verificado leyendo `node_modules/@credo-ts/core` directamente: `agent.mdoc`
(`MdocApi`) y `MdocRecord` ya existen, sobre `@animo-id/mdoc@0.5.2`, ya instalado.
La versión con el diseño propio **perdía el `keyId`** de la clave de dispositivo
al persistir el mdoc, rompiendo la regla de binding de §AD-2 del lado wallet sin
que ningún test lo detectara. Task 5 se eliminó; Task 6 usa la API nativa. Si
retomas este plan desde una copia anterior, no reutilices las versiones viejas de
esos dos tasks.

**Bloqueante real para un flujo de ciudadano completo (Task 7):** de dónde saca
`receive.tsx` el `access_token` OIDC de sesión del ciudadano para el flujo mdl. No
es una decisión de este plan — depende de cómo la app maneja login/sesión hoy, que
no se investigó en profundidad aquí porque el foco era el módulo `mdl/` en sí. Debe
resolverse antes de considerar Task 7 completo para un caso de uso real, aunque no
bloquea Fase 0 (que puede correr con un token de prueba fijo vía
`EXPO_PUBLIC_DEV_MDL_ACCESS_TOKEN`, con guard explícito contra su uso en release).

**Bloqueante real para BLE en producción (Task 8):** dos cosas, no una.
`buildDeviceAuthenticationBytes` usa una concatenación de placeholder, no CBOR
real — marcado con `TODO(mdl)` a propósito. Y las Interfaces originalmente
declaradas para Task 8 (`announceForPresentation`/`respondToRequest`, la
orquestación de sesión BLE completa) **no se implementaron** — lo que existe son
las piezas más pequeñas que sí son testeables sin hardware. Conectar todo eso
(transporte real + `MdocContext` sobre `@animo-id/mdoc` si hace falta + la
pantalla de consentimiento del Step 6, que sí está construida) es trabajo posterior
a Fase 0, no de este plan.

**Sobre `MdocContext`:** ya no es necesario para Tasks 1-7 (los elimina el uso de
`agent.mdoc`). Si el trabajo posterior a Fase 0 necesita invocar `@animo-id/mdoc`
directamente para construir un `DeviceResponse` o validar una cadena X.509 que
`agent.mdoc` no cubra, su interfaz real (`crypto.digest({digestAlgorithm, bytes})`,
`crypto.calculateEphemeralMacKeyJwk`, `cose.sign1.verify({jwk, sign1, options})`,
más `mac0`/`x509` **obligatorios**, no opcionales) es sustancialmente distinta de
lo que la versión original de este plan asumía — confirmarla contra
`node_modules/@animo-id/mdoc/dist/index.d.ts` en ese momento, no contra este texto.

**Contrato cruzado con `verifiably`:** este plan asume el contrato exacto
documentado en `docs/superpowers/plans/2026-08-18-mdl-issuance-endpoint.md` de ese
repo (rutas, forma del proof JWT, forma de las respuestas, y el `aud` derivado de
`publicBase(r)` del lado servidor — ya alineado, ver la nota al inicio de este
documento). Si ese plan cambia antes de ejecutarse, `requestMdl.ts` (Task 3) es el
único punto que necesita ajustarse.
