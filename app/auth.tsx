import * as WebBrowser from 'expo-web-browser';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

// Keycloak redirects here after login (cdpiwallet://auth).
// maybeCompleteAuthSession closes the browser and returns the auth code
// to the useAuthRequest hook in unlock.tsx.
WebBrowser.maybeCompleteAuthSession();

export default function AuthCallback() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
});
