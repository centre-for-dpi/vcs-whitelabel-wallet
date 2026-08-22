import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { claimImageUri, claimShape } from '../utils/credential';

/**
 * Renders one claim's value according to its own shape, so a docType this
 * wallet has never seen still displays sensibly:
 *
 *   image  — JPEG/PNG byte strings (portrait) as the picture itself
 *   table  — an array of objects (driving_privileges) as header + rows
 *   list   — a single object as property/value pairs
 *   scalar — everything else as text
 *
 * Shared by both claim views so they cannot drift apart.
 */
export const ClaimBody: React.FC<{ value: unknown; label: string }> = ({ value, label }) => {
  const uri = claimImageUri(value);
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={styles.image}
        resizeMode="contain"
        accessibilityLabel={label}
      />
    );
  }

  const shape = claimShape(value);

  if (shape.kind === 'table') {
    return (
      // Horizontal scroll rather than wrapping: a driving-privileges table
      // with four date columns does not fit a phone, and squeezing it makes
      // every cell unreadable instead of just the far ones.
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
        <View>
          <View style={[styles.row, styles.headerRow]}>
            {shape.columns.map((c) => (
              <Text key={c} style={[styles.cell, styles.headerCell]} numberOfLines={2}>{c}</Text>
            ))}
          </View>
          {shape.rows.map((row, i) => (
            <View key={i} style={[styles.row, i % 2 === 1 && styles.rowAlt]}>
              {row.map((cell, j) => (
                <Text key={j} style={styles.cell} numberOfLines={3}>{cell}</Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }

  if (shape.kind === 'list') {
    return (
      <View style={styles.list}>
        {shape.rows.map((r) => (
          <View key={r.key} style={styles.listRow}>
            <Text style={styles.listKey}>{r.key}</Text>
            <Text style={styles.listValue}>{r.value}</Text>
          </View>
        ))}
      </View>
    );
  }

  return <Text style={styles.scalar}>{shape.text}</Text>;
};

const styles = StyleSheet.create({
  scalar: { fontSize: 15, color: '#111827', fontWeight: '500' },
  image: {
    width: 120,
    height: 150,
    borderRadius: 6,
    backgroundColor: '#F3F4F6',
    marginTop: 4,
  },

  tableScroll: { marginTop: 6 },
  row: { flexDirection: 'row' },
  headerRow: { borderBottomWidth: 1, borderBottomColor: '#D1D5DB' },
  rowAlt: { backgroundColor: '#F9FAFB' },
  cell: {
    minWidth: 96,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 13,
    color: '#111827',
  },
  headerCell: { fontWeight: '700', color: '#6B7280', fontSize: 11, textTransform: 'uppercase' },

  list: { marginTop: 4, gap: 2 },
  listRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  listKey: { fontSize: 13, color: '#6B7280', flexShrink: 0 },
  listValue: { fontSize: 14, color: '#111827', fontWeight: '500', flexShrink: 1, textAlign: 'right' },
});
