import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { branding } from '../../branding.config';
import type { CredentialEntry } from '../utils/credential';

type Props = {
  entry: CredentialEntry;
  onPress: () => void;
};

export const CredentialCard: React.FC<Props> = ({ entry, onPress }) => {
  const date = new Date(entry.issuanceDate).toLocaleDateString('es', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.badge, { backgroundColor: branding.primaryColor }]}>
        <Text style={styles.badgeText}>{entry.format.toUpperCase()}</Text>
      </View>
      <Text style={styles.type}>{entry.type}</Text>
      <Text style={styles.issuer} numberOfLines={1}>
        {entry.issuer}
      </Text>
      <Text style={styles.date}>{date}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 8,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  type: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  issuer: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 4,
  },
  date: {
    fontSize: 12,
    color: '#9CA3AF',
  },
});
