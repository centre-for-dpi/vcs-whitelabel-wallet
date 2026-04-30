import { Stack } from 'expo-router';

export default function CredentialsLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Credenciales' }} />
      <Stack.Screen name="[id]" options={{ title: 'Detalles de la credencial' }} />
    </Stack>
  );
}