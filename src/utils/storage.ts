import * as SecureStore from 'expo-secure-store';

const KEY_WALLET_KEY = 'cdpi_wallet_key';
const KEY_PIN = 'cdpi_wallet_pin';
const KEY_SETUP_DONE = 'cdpi_wallet_setup';
const KEY_OIDC_USER = 'cdpi_oidc_user';

export type OidcUser = {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
};

export const isSetupDone = async (): Promise<boolean> => {
  const val = await SecureStore.getItemAsync(KEY_SETUP_DONE);
  return val === 'true';
};

export const savePin = async (pin: string): Promise<void> => {
  await SecureStore.setItemAsync(KEY_PIN, pin);
  await SecureStore.setItemAsync(KEY_SETUP_DONE, 'true');
};

export const verifyPin = async (pin: string): Promise<boolean> => {
  const stored = await SecureStore.getItemAsync(KEY_PIN);
  return stored === pin;
};

export const saveWalletKey = async (key: string): Promise<void> => {
  await SecureStore.setItemAsync(KEY_WALLET_KEY, key);
};

export const getWalletKey = async (): Promise<string | null> => {
  return SecureStore.getItemAsync(KEY_WALLET_KEY);
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
