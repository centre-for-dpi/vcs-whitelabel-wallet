import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

export default function CredentialsLayout() {
  const { t } = useTranslation();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: t('credentials.title') }} />
      <Stack.Screen name="[id]" options={{ title: t('credentials.detail_title') }} />
    </Stack>
  );
}
