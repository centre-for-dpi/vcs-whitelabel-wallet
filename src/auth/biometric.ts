import * as LocalAuthentication from 'expo-local-authentication';

export type BiometricType = 'faceId' | 'fingerprint' | 'unknown';

export type BiometricSupport = {
  available: boolean;
  type: BiometricType;
};

/**
 * Checks whether the device has biometric hardware and an enrolled identity.
 * Returns the most capable type found (face > fingerprint > unknown).
 */
export async function checkBiometricSupport(): Promise<BiometricSupport> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();

  if (!hasHardware || !isEnrolled) {
    return { available: false, type: 'unknown' };
  }

  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  let type: BiometricType = 'unknown';

  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    type = 'faceId';
  } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    type = 'fingerprint';
  }

  return { available: true, type };
}

/**
 * Prompts the user with the system biometric dialog.
 * Returns true only when the hardware confirms authentication success.
 * Never throws — callers should handle false as "cancelled or failed".
 */
export async function authenticateWithBiometrics(promptMessage: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Cancel',
      disableDeviceFallback: true, // PIN fallback is handled by our own unlock screen
    });
    return result.success;
  } catch {
    return false;
  }
}
