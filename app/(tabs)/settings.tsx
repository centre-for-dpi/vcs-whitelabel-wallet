import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { branding } from '../../branding.config';
import { useAgentState } from '../../src/agent/context';
import { useUser } from '../../src/auth/UserContext';

const Row = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
  </View>
);

export default function Settings() {
  const agentState = useAgentState();
  const { user, clearUser } = useUser();

  const displayName = user?.name ?? user?.email ?? '';
  const initials = displayName
    ? displayName
        .split(' ')
        .slice(0, 2)
        .map((w) => w.charAt(0).toUpperCase())
        .join('')
    : '?';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {user && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sesión</Text>
          <View style={styles.userCard}>
            <View style={[styles.avatar, { backgroundColor: branding.primaryColor }]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.userInfo}>
              {user.name && <Text style={styles.userName}>{user.name}</Text>}
              {user.email && <Text style={styles.userEmail}>{user.email}</Text>}
            </View>
          </View>
          <TouchableOpacity style={styles.signOutBtn} onPress={clearUser}>
            <Text style={styles.signOutText}>Cerrar sesión</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Billetera</Text>
        <Row label="Nombre" value={branding.appName} />
        <Row label="Estado del agente" value={agentState.status} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Protocolos soportados</Text>
        <Row label="OID4VCI" value="✓ Activo" />
        <Row label="OID4VP" value="✓ Activo" />
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
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  userInfo: { flex: 1 },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 2,
  },
  userEmail: {
    fontSize: 13,
    color: '#6B7280',
  },
  signOutBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  signOutText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#DC2626',
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
