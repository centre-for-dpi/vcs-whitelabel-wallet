import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { branding } from '../../branding.config';
import { useAgentState } from '../../src/agent/context';

const Row = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
  </View>
);

export default function Settings() {
  const agentState = useAgentState();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Billetera</Text>
        <Row label="Nombre" value={branding.appName} />
        <Row label="Estado del agente" value={agentState.status} />
        <Row
          label="Mediador"
          value={
            branding.mediatorUrl.includes('VPS_IP')
              ? 'No configurado'
              : branding.mediatorUrl
          }
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Emisores configurados</Text>
        {branding.issuers.map((issuer) => (
          <View key={issuer.id}>
            <Row label={issuer.label} value={issuer.dpg.toUpperCase()} />
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Protocolos soportados</Text>
        <Row label="OID4VCI" value="✓ Activo (INJI, walt.id)" />
        <Row label="OID4VP" value="✓ Activo (INJI, walt.id)" />
        <Row label="DIDComm OOB" value="✓ Activo (CREDEBL)" />
      </View>

      <Text style={styles.footer}>
        cdpi-wallet • Powered by Credo 0.6.3
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 16, paddingBottom: 40 },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  rowLabel: { fontSize: 14, color: '#374151', flex: 1 },
  rowValue: { fontSize: 13, color: '#6B7280', flex: 1, textAlign: 'right' },
  footer: {
    textAlign: 'center',
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 8,
  },
});
