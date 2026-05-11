import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { branding } from '../../branding.config';
import { detectQrType } from '../../src/utils/qr';

export default function Scan() {
  const { context } = useLocalSearchParams<{ context?: string }>();
  const isPresentMode = context === 'present';
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [manualUrl, setManualUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const cooldown = useRef(false);

  const navigate = (raw: string) => {
    const detected = detectQrType(raw.trim());
    switch (detected.kind) {
      case 'oid4vci':
        router.push({ pathname: '/receive', params: { url: detected.url } });
        break;
      case 'oid4vp':
        router.push({ pathname: '/present', params: { url: detected.url } });
        break;
      case 'didcomm_oob':
        setUrlError('Este QR usa el protocolo DIDComm, que no es compatible. Solicita al verificador un enlace OpenID4VP.');
        return false;
      default:
        return false;
    }
    return true;
  };

  const handleBarcodeScan = ({ data }: { data: string }) => {
    if (cooldown.current) return;
    cooldown.current = true;
    setScanned(true);
    const ok = navigate(data);
    if (!ok) setMode('manual');
    setTimeout(() => {
      setScanned(false);
      cooldown.current = false;
    }, 2000);
  };

  const handleManualSubmit = () => {
    const trimmed = manualUrl.trim();
    if (!trimmed) {
      setUrlError('Ingresa un enlace OpenID.');
      return;
    }
    const ok = navigate(trimmed);
    if (!ok) {
      setUrlError('Enlace no reconocido. Debe ser un enlace openid-credential-offer:// u openid4vp://');
    } else {
      setManualUrl('');
      setUrlError('');
    }
  };

  if (mode === 'manual') {
    return (
      <KeyboardAvoidingView
        style={styles.manualContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Text style={styles.manualTitle}>Pegar enlace OpenID</Text>
        <Text style={styles.manualSubtitle}>
          Copia el enlace de tu emisor y pégalo aquí.
        </Text>
        <TextInput
          style={[styles.urlInput, urlError ? styles.urlInputError : null]}
          value={manualUrl}
          onChangeText={(t) => { setManualUrl(t); setUrlError(''); }}
          placeholder="openid-credential-offer://..."
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          numberOfLines={3}
        />
        {urlError ? <Text style={styles.errorText}>{urlError}</Text> : null}
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: branding.primaryColor }]}
          onPress={handleManualSubmit}
        >
          <Text style={styles.submitBtnText}>Ir</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.switchBtn} onPress={() => { setMode('camera'); setUrlError(''); }}>
          <Text style={styles.switchBtnText}>Usar cámara</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    );
  }

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>Se necesita acceso a la cámara para escanear QR.</Text>
        <TouchableOpacity
          style={[styles.permBtn, { backgroundColor: branding.primaryColor }]}
          onPress={requestPermission}
        >
          <Text style={styles.permBtnText}>Permitir cámara</Text>
        </TouchableOpacity>
        {!isPresentMode && (
          <TouchableOpacity style={[styles.switchBtn, { marginTop: 12 }]} onPress={() => setMode('manual')}>
            <Text style={styles.switchBtnText}>Ingresar enlace manualmente</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarcodeScan}
      />

      <View style={styles.overlay}>
        <View style={styles.topMask} />
        <View style={styles.middle}>
          <View style={styles.sideMask} />
          <View style={[styles.visor, scanned && styles.visorScanned]} />
          <View style={styles.sideMask} />
        </View>
        <View style={styles.bottomMask} />
      </View>

      <View style={styles.hint}>
        <Text style={styles.hintText}>
          {scanned ? '✓ QR detectado' : isPresentMode ? 'Apunta al QR del verificador' : 'Apunta al código QR de tu emisor'}
        </Text>
      </View>

      {!isPresentMode && (
        <TouchableOpacity style={styles.manualToggle} onPress={() => setMode('manual')}>
          <Text style={styles.manualToggleText}>Ingresar enlace manualmente</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const VISOR = 260;
const MASK_COLOR = 'rgba(0,0,0,0.55)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  permText: {
    fontSize: 15,
    color: '#374151',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
  permBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  permBtnText: { color: '#fff', fontWeight: '600' },
  overlay: { ...StyleSheet.absoluteFillObject },
  topMask: { flex: 1, backgroundColor: MASK_COLOR },
  middle: { flexDirection: 'row', height: VISOR },
  sideMask: { flex: 1, backgroundColor: MASK_COLOR },
  bottomMask: { flex: 1, backgroundColor: MASK_COLOR },
  visor: {
    width: VISOR,
    height: VISOR,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 12,
  },
  visorScanned: { borderColor: '#22C55E' },
  hint: {
    position: 'absolute',
    bottom: 120,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hintText: {
    color: '#fff',
    fontSize: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  manualToggle: {
    position: 'absolute',
    bottom: 56,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  manualToggleText: {
    color: '#fff',
    fontSize: 14,
    textDecorationLine: 'underline',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  // Manual entry screen
  manualContainer: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 24,
    justifyContent: 'center',
  },
  manualTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  manualSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 24,
    lineHeight: 20,
  },
  urlInput: {
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: '#111827',
    minHeight: 90,
    textAlignVertical: 'top',
    marginBottom: 8,
  },
  urlInputError: { borderColor: '#DC2626' },
  errorText: { color: '#DC2626', fontSize: 13, marginBottom: 12 },
  submitBtn: {
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 4,
  },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  switchBtn: { height: 44, justifyContent: 'center', alignItems: 'center' },
  switchBtnText: { color: '#6B7280', fontSize: 15, textDecorationLine: 'underline' },
});
