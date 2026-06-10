import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEY_WALLET_KEY = 'cdpi_wallet_key';
const KEY_RECOVERY_PHRASE = 'cdpi_recovery_phrase';
const KEY_PIN_HASH = 'cdpi_pin_hash';
const KEY_PIN_SALT = 'cdpi_pin_salt';
const KEY_PIN_LEGACY = 'cdpi_wallet_pin'; // pre-v2 plaintext PIN — kept only for migration
const KEY_SETUP_DONE = 'cdpi_wallet_setup';
const KEY_OIDC_USER = 'cdpi_oidc_user';
const KEY_FAIL_COUNT = 'cdpi_fail_count';
const KEY_LOCKOUT_UNTIL = 'cdpi_lockout_until';
const KEY_BIOMETRICS_ENABLED    = 'cdpi_biometrics_enabled';
const KEY_OIDC_REFRESH_TOKEN    = 'cdpi_oidc_refresh_token';
const KEY_OIDC_TOKEN_EXPIRY     = 'cdpi_oidc_token_expiry';
const KEY_OIDC_ID_TOKEN         = 'cdpi_oidc_id_token';

export type OidcUser = {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
};

/**
 * Returns the best available full display name for a user.
 * Priority: given_name + family_name > given_name > name > email > undefined
 * Avoids using `name` as the primary source because many OIDC servers
 * populate it with a username or document ID instead of a human name.
 */
export function getUserDisplayName(user: OidcUser): string | undefined {
  if (user.given_name && user.family_name) return `${user.given_name} ${user.family_name}`;
  if (user.given_name) return user.given_name;
  if (user.name) return user.name;
  return user.email;
}

/** Returns the best available first name for greetings. */
export function getUserFirstName(user: OidcUser): string | undefined {
  if (user.given_name) return user.given_name;
  if (user.name) return user.name.split(' ')[0];
  return user.email?.split('@')[0];
}

// ── PIN key derivation ────────────────────────────────────────────────────────
//
// Two rounds of SHA-256 with a random salt — a major improvement over plaintext.
// True PBKDF2/Argon2 would require native bindings not available in expo-crypto.
// The random salt prevents rainbow-table attacks; the double-round adds minimal
// computational cost for the attacker with no UX impact.

async function derivePinHash(pin: string, salt: string): Promise<string> {
  const inner = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${pin}:${salt}`,
  );
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${inner}:${salt}:cdpi-pin-v2`,
  );
}

export const isSetupDone = async (): Promise<boolean> => {
  const val = await SecureStore.getItemAsync(KEY_SETUP_DONE);
  return val === 'true';
};

export const savePin = async (pin: string): Promise<void> => {
  const saltBytes = Crypto.getRandomBytes(16);
  const salt = Array.from(saltBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const hash = await derivePinHash(pin, salt);
  await SecureStore.setItemAsync(KEY_PIN_SALT, salt);
  await SecureStore.setItemAsync(KEY_PIN_HASH, hash);
  await SecureStore.deleteItemAsync(KEY_PIN_LEGACY).catch(() => {});
  await SecureStore.setItemAsync(KEY_SETUP_DONE, 'true');
};

export const verifyPin = async (pin: string): Promise<boolean> => {
  const salt = await SecureStore.getItemAsync(KEY_PIN_SALT);

  if (!salt) {
    // Legacy migration: plaintext PIN stored by pre-v2 setup.
    // If correct, silently re-saves with the new hashed format.
    const legacy = await SecureStore.getItemAsync(KEY_PIN_LEGACY);
    if (legacy !== null && legacy === pin) {
      await savePin(pin);
      return true;
    }
    return false;
  }

  const storedHash = await SecureStore.getItemAsync(KEY_PIN_HASH);
  if (!storedHash) return false;
  const hash = await derivePinHash(pin, salt);
  return hash === storedHash;
};

export const saveWalletKey = async (key: string): Promise<void> => {
  await SecureStore.setItemAsync(KEY_WALLET_KEY, key);
};

export const getWalletKey = async (): Promise<string | null> => {
  return SecureStore.getItemAsync(KEY_WALLET_KEY);
};

export const saveRecoveryPhrase = async (phrase: string): Promise<void> => {
  await SecureStore.setItemAsync(KEY_RECOVERY_PHRASE, phrase);
};

export const getRecoveryPhrase = async (): Promise<string | null> => {
  return SecureStore.getItemAsync(KEY_RECOVERY_PHRASE);
};

export const saveOidcUser = async (user: OidcUser): Promise<void> => {
  await SecureStore.setItemAsync(KEY_OIDC_USER, JSON.stringify(user));
};

export const getOidcUser = async (): Promise<OidcUser | null> => {
  const val = await SecureStore.getItemAsync(KEY_OIDC_USER);
  return val ? (JSON.parse(val) as OidcUser) : null;
};

export const clearOidcUser = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(KEY_OIDC_USER);
};

// ── OIDC token persistence ────────────────────────────────────────────────────

export const saveOidcTokens = async (
  refreshToken: string | null | undefined,
  expiresIn: number | null | undefined,
  idToken?: string | null | undefined,
): Promise<void> => {
  if (refreshToken) await SecureStore.setItemAsync(KEY_OIDC_REFRESH_TOKEN, refreshToken);
  if (expiresIn) {
    const expiry = Date.now() + expiresIn * 1000;
    await SecureStore.setItemAsync(KEY_OIDC_TOKEN_EXPIRY, String(expiry));
  }
  // The id_token is what the issuer's self-service endpoint verifies (signature,
  // iss, exp) against the IdP JWKS. Persisted so the "Descubrir" → Obtener flow
  // can present the citizen's verified identity without a fresh login.
  if (idToken) await SecureStore.setItemAsync(KEY_OIDC_ID_TOKEN, idToken);
};

export const getOidcRefreshToken = async (): Promise<string | null> =>
  SecureStore.getItemAsync(KEY_OIDC_REFRESH_TOKEN);

export const getOidcIdToken = async (): Promise<string | null> =>
  SecureStore.getItemAsync(KEY_OIDC_ID_TOKEN);

export const isOidcTokenExpired = async (): Promise<boolean> => {
  const val = await SecureStore.getItemAsync(KEY_OIDC_TOKEN_EXPIRY);
  if (!val) return true;
  return parseInt(val, 10) <= Date.now();
};

export const clearOidcTokens = async (): Promise<void> => {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_OIDC_REFRESH_TOKEN),
    SecureStore.deleteItemAsync(KEY_OIDC_TOKEN_EXPIRY),
    SecureStore.deleteItemAsync(KEY_OIDC_ID_TOKEN),
  ]);
};

// ── Brute-force protection ────────────────────────────────────────────────────

/** Progressive lockout thresholds, checked in order (most restrictive first). */
export const LOCKOUT_THRESHOLDS: Array<{ failCount: number; durationMs: number }> = [
  { failCount: 10, durationMs: 30 * 60 * 1000 }, // 30 min
  { failCount: 8,  durationMs:  5 * 60 * 1000 }, //  5 min
  { failCount: 5,  durationMs:       30 * 1000 }, // 30 sec
];

/** Fail count at which the UI starts showing "N attempts remaining" warnings. */
export const LOCKOUT_WARNING_THRESHOLD = 5;

export const getFailCount = async (): Promise<number> => {
  const val = await SecureStore.getItemAsync(KEY_FAIL_COUNT);
  return val ? parseInt(val, 10) : 0;
};

/** Increments the fail counter and returns the new value. */
export const incrementFailCount = async (): Promise<number> => {
  const count = (await getFailCount()) + 1;
  await SecureStore.setItemAsync(KEY_FAIL_COUNT, String(count));
  return count;
};

export const resetFailCount = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(KEY_FAIL_COUNT);
  await SecureStore.deleteItemAsync(KEY_LOCKOUT_UNTIL);
};

/** Returns the epoch-ms timestamp until which the wallet is locked (0 = not locked). */
export const getLockoutUntil = async (): Promise<number> => {
  const val = await SecureStore.getItemAsync(KEY_LOCKOUT_UNTIL);
  return val ? parseInt(val, 10) : 0;
};

export const setLockout = async (durationMs: number): Promise<void> => {
  const until = Date.now() + durationMs;
  await SecureStore.setItemAsync(KEY_LOCKOUT_UNTIL, String(until));
};

// ── Biometric preference ──────────────────────────────────────────────────────

export const getBiometricsEnabled = async (): Promise<boolean> => {
  const val = await SecureStore.getItemAsync(KEY_BIOMETRICS_ENABLED);
  return val === 'true';
};

export const setBiometricsEnabled = async (enabled: boolean): Promise<void> => {
  await SecureStore.setItemAsync(KEY_BIOMETRICS_ENABLED, enabled ? 'true' : 'false');
};

/**
 * Returns the lockout duration for a given fail count, or 0 if no lockout applies.
 * Call this after incrementing the counter to decide whether to lock.
 */
export const lockoutDurationFor = (failCount: number): number => {
  for (const t of LOCKOUT_THRESHOLDS) {
    if (failCount >= t.failCount) return t.durationMs;
  }
  return 0;
};
