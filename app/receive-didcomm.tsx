import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { branding } from '../branding.config';

export default function ReceiveDIDComm() {
  const { url } = useLocalSearchParams<{ url?: string }>();

  console.warn('[didcomm] DIDComm OOB not supported in Credo-TS 0.6.x — url:', url?.slice(0, 120));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.center}>
        <Text style={styles.icon}>⚠️</Text>
        <Text style={styles.title}>Credencial DIDComm</Text>
        <Text style={styles.body}>
          Este QR contiene una invitación DIDComm (protocolo AIP 2.0). Esta versión de la wallet
          solo soporta credenciales OID4VCI (<Text style={styles.code}>openid-credential-offer://</Text>)
          y presentaciones OID4VP (<Text style={styles.code}>openid4vp://</Text>).
        </Text>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: branding.primaryColor }]}
          onPress={() => router.back()}
        >
          <Text style={styles.btnText}>Volver</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { flexGrow: 1, padding: 24 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 400 },
  icon: { fontSize: 56, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 12, textAlign: 'center' },
  body: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 22, marginBottom: 8 },
  code: { fontFamily: 'monospace', fontSize: 12, color: '#374151', backgroundColor: '#F3F4F6' },
  btn: { height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 24, width: '100%' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
