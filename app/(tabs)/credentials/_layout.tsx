import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { branding } from '../../../branding.config';

function DetailHeader({ title }: { title: string }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
        <Text style={styles.backText}>‹</Text>
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <View style={styles.backBtn} />
    </View>
  );
}

export default function CredentialsLayout() {
  const { t } = useTranslation();
  const detailTitle = t('credentials.detail_title');
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="[id]"
        options={{
          headerShown: true,
          header: () => <DetailHeader title={detailTitle} />,
        }}
      />
    </Stack>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 56,
    backgroundColor: branding.headerBackgroundColor,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  backBtn: { width: 44, alignItems: 'center' },
  backText: { fontSize: 32, color: branding.textColor, lineHeight: 40 },
  title: { flex: 1, textAlign: 'left', fontSize: 17, fontWeight: '700', color: branding.textColor },
});
