import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { branding } from '../../branding.config';
import { detectQrType } from '../../src/utils/qr';

export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const cooldown = useRef(false);

  const handleBarcodeScan = ({ data }: { data: string }) => {
    if (cooldown.current) return;
    cooldown.current = true;
    setScanned(true);

    const detected = detectQrType(data);

    setTimeout(() => {
      setScanned(false);
      cooldown.current = false;
    }, 2000);

    switch (detected.kind) {
      case 'oid4vci':
        router.push({ pathname: '/receive', params: { url: detected.url } });
        break;
      case 'oid4vp':
        router.push({ pathname: '/present', params: { url: detected.url } });
        break;
      case 'didcomm_oob':
        router.push({ pathname: '/receive', params: { url: detected.url, mode: 'didcomm' } });
        break;
      default:
        setTimeout(() => {
          setScanned(false);
          cooldown.current = false;
        }, 100);
    }
  };

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

      {/* Visor */}
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
          {scanned ? '✓ QR detectado' : 'Apunta al código QR de tu emisor'}
        </Text>
      </View>
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
    bottom: 80,
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
});
