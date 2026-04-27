import * as SecureStore from 'expo-secure-store';

const KEY_WALLET_KEY = 'cdpi_wallet_key';
const KEY_PIN = 'cdpi_wallet_pin';
const KEY_SETUP_DONE = 'cdpi_wallet_setup';

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
