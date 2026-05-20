import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import CryptoJS from 'crypto-js';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { KdfMethod, Store, StoreKeyMethod } from '@openwallet-foundation/askar-shared';
import RNFS from 'react-native-fs';
import type { WalletAgent } from '../agent/setup';

const BACKUP_VERSION = 1;
const WALLET_ID = 'cdpi-wallet-v1';

interface BackupPayload {
  walletKey: string;
  askarData: string; // base64-encoded Askar export SQLite
}

interface BackupFile {
  version: number;
  encrypted: string;
}

async function sha256Hex(input: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input);
}

// Derives the key used to encrypt the exported Askar SQLite file.
// Using 'raw' key derivation so the hex SHA-256 digest is used directly.
async function deriveAskarExportKey(phrase: string): Promise<string> {
  return sha256Hex(phrase + ':askar-export-cdpi-v1');
}

export async function generateRecoveryPhrase(): Promise<string> {
  const entropy = await Crypto.getRandomBytesAsync(16); // 128 bits → 12 words
  // Wrap in new Uint8Array so @scure/bip39's instanceof check passes on native
  return entropyToMnemonic(new Uint8Array(entropy), wordlist);
}

export async function exportBackup(agent: WalletAgent, phrase: string): Promise<void> {
  const timestamp = Date.now();
  const exportPath = `${RNFS.TemporaryDirectoryPath}/cdpi-export-${timestamp}.db`;
  const outputPath = `${RNFS.DocumentDirectoryPath}/cdpi-wallet-backup.cdpibak`;

  // Remove any leftover temp/output files
  if (await RNFS.exists(exportPath)) await RNFS.unlink(exportPath);
  if (await RNFS.exists(outputPath)) await RNFS.unlink(outputPath);

  // Export Askar wallet to temp SQLite file (encrypted with derived key).
  // Using argon2i:int so Askar accepts any string passphrase — raw requires
  // an exact 32-byte key in base58, which hex SHA-256 is not.
  const askarExportKey = await deriveAskarExportKey(phrase);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (agent as any).modules.askar.exportStore({
    exportToStore: {
      id: `cdpi-export-${timestamp}`,
      key: askarExportKey,
      keyDerivationMethod: 'argon2i:int' as const,
      database: { type: 'sqlite' as const, config: { path: exportPath } },
    },
  });

  // Read the exported file as base64
  const askarData = await RNFS.readFile(exportPath, 'base64');
  await RNFS.unlink(exportPath);

  // Get wallet key from SecureStore
  const { getWalletKey } = await import('./storage');
  const walletKey = await getWalletKey();
  if (!walletKey) throw new Error('Wallet key not found');

  // Encrypt the whole payload with the recovery phrase (AES-256 via crypto-js)
  const payload: BackupPayload = { walletKey, askarData };
  const encrypted = CryptoJS.AES.encrypt(JSON.stringify(payload), phrase).toString();

  const backupFile: BackupFile = { version: BACKUP_VERSION, encrypted };
  await RNFS.writeFile(outputPath, JSON.stringify(backupFile), 'utf8');

  // Share via native sheet
  await Sharing.shareAsync(outputPath, {
    mimeType: 'application/octet-stream',
    dialogTitle: 'Save wallet backup',
    UTI: 'public.data',
  });

  await RNFS.unlink(outputPath).catch(() => {});
}

export async function pickBackupFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  return result.assets[0].uri;
}

export async function decryptBackup(
  fileUri: string,
  phrase: string,
): Promise<BackupPayload> {
  // expo-document-picker returns a file:// URI; RNFS.readFile handles it
  const rawPath = fileUri.replace(/^file:\/\//, '');
  const content = await RNFS.readFile(rawPath, 'utf8');

  let backupFile: BackupFile;
  try {
    backupFile = JSON.parse(content) as BackupFile;
  } catch {
    throw new Error('invalid_file');
  }

  if (backupFile.version !== BACKUP_VERSION) throw new Error('invalid_file');

  const decrypted = CryptoJS.AES.decrypt(backupFile.encrypted, phrase);
  const payloadStr = decrypted.toString(CryptoJS.enc.Utf8);
  if (!payloadStr) throw new Error('invalid_phrase');

  try {
    return JSON.parse(payloadStr) as BackupPayload;
  } catch {
    throw new Error('invalid_phrase');
  }
}

export async function restoreAskarWallet(
  askarData: string,
  walletKey: string,
  phrase: string,
): Promise<void> {
  const tempPath = `${RNFS.TemporaryDirectoryPath}/cdpi-restore-src.db`;
  // Credo-TS ReactNativeFileSystem uses DocumentDirectoryPath + '/.afj' as dataPath
  const walletDir = `${RNFS.DocumentDirectoryPath}/.afj/wallet/${WALLET_ID}`;
  const walletPath = `${walletDir}/sqlite.db`;

  // Write backup DB bytes to temp location
  await RNFS.writeFile(tempPath, askarData, 'base64');

  // Remove existing wallet DB if present (edge case: restore over existing wallet)
  if (await RNFS.exists(walletPath)) await RNFS.unlink(walletPath);
  if (!(await RNFS.exists(walletDir))) await RNFS.mkdir(walletDir);

  // Open the backup store using the same derived key used during export
  const askarExportKey = await deriveAskarExportKey(phrase);
  const sourceStore = await Store.open({
    uri: `sqlite://${tempPath}`,
    keyMethod: new StoreKeyMethod(KdfMethod.Argon2IInt),
    passKey: askarExportKey,
  });

  // Copy to the wallet location with the original wallet key (Argon2IMod = default)
  await sourceStore.copyTo({
    recreate: false,
    uri: `sqlite://${walletPath}`,
    keyMethod: new StoreKeyMethod(KdfMethod.Argon2IMod),
    passKey: walletKey,
  });

  await sourceStore.close();
  await RNFS.unlink(tempPath);
}
