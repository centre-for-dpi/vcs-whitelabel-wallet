import { Tabs } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';
import { branding } from '../../branding.config';

const Icon = ({ label, focused }: { label: string; focused: boolean }) => (
  <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.45 }}>{label}</Text>
);

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: branding.primaryColor,
        tabBarStyle: { borderTopColor: '#E5E7EB' },
        headerStyle: { backgroundColor: '#fff' },
        headerTintColor: '#111827',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="credentials"
        options={{
          title: '',
          tabBarLabel: 'Credenciales',
          tabBarIcon: ({ focused }) => <Icon label="🪪" focused={focused} />,
          headerTitle: branding.appName,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Escanear',
          tabBarLabel: 'Escanear',
          tabBarIcon: ({ focused }) => <Icon label="📷" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Ajustes',
          tabBarLabel: 'Ajustes',
          tabBarIcon: ({ focused }) => <Icon label="⚙️" focused={focused} />,
        }}
      />
    </Tabs>
    
  );
}
