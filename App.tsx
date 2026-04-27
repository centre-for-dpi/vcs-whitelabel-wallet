import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { setupAgent } from './src/agent/setup';

type Status = 'loading' | 'ready' | 'error';

export default function App() {
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    setupAgent()
      .then(() => setStatus('ready'))
      .catch((e: Error) => {
        setStatus('error');
        setErrorMessage(e.message);
      });
  }, []);

  return (
    <View style={styles.container}>
      {status === 'loading' && (
        <>
          <ActivityIndicator size="large" color="#1A56DB" />
          <Text style={styles.label}>Initializing agent...</Text>
        </>
      )}
      {status === 'ready' && (
        <Text style={[styles.label, styles.success]}>
          Phase 0 complete — Agent ready
        </Text>
      )}
      {status === 'error' && (
        <Text style={[styles.label, styles.error]}>
          Agent init failed:{'\n'}{errorMessage}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  label: {
    marginTop: 16,
    fontSize: 16,
    textAlign: 'center',
    color: '#374151',
  },
  success: { color: '#16a34a', fontWeight: '600' },
  error: { color: '#dc2626' },
});
