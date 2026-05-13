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
      <View style={[styles.accent, { backgroundColor: branding.primaryColor }]} />
      <View style={styles.body}>
        <Text style={[styles.type, { color: branding.textColor }]}>{entry.type}</Text>
        <Text style={styles.issuer} numberOfLines={1}>{entry.issuer}</Text>
        <Text style={styles.date}>{date}</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: branding.secondaryColor,
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  accent: {
    width: 5,
  },
  body: {
    flex: 1,
    padding: 16,
  },
  type: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
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
