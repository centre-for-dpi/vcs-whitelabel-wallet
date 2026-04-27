import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAgentState } from '../src/agent/context';
import { isSetupDone } from '../src/utils/storage';

export default function Entry() {
  const agentState = useAgentState();
  const [checked, setChecked] = React.useState(false);
  const [setupDone, setSetupDone] = React.useState(false);

  React.useEffect(() => {
    isSetupDone().then((done) => {
      setSetupDone(done);
      setChecked(true);
    });
  }, []);

  if (!checked || agentState.status === 'loading') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color="#1A56DB" />
      </View>
    );
  }

  if (!setupDone) return <Redirect href="/onboarding" />;
  if (agentState.status === 'uninitialized') return <Redirect href="/unlock" />;
  if (agentState.status === 'ready') return <Redirect href="/(tabs)/credentials" />;

  // error state — still go to unlock to let user retry
  return <Redirect href="/unlock" />;
}
