import { Tabs } from 'expo-router';
import React from 'react';
import { Image, Text, View } from 'react-native';
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
        headerStyle: { backgroundColor: branding.headerBackgroundColor },
        headerTintColor: branding.textColor,
        headerTitleStyle: { fontWeight: '700', color: branding.textColor },
      }}
    >
      <Tabs.Screen
        name="credentials"
        options={{
          title: '',
          tabBarLabel: 'Credenciales',
          tabBarIcon: ({ focused }) => <Icon label="🪪" focused={focused} />,
          headerTitle: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Image
              source={require('../../assets/header-logo.png')}
              style={{ height: 36, width: 36, tintColor: branding.headerLogoTintColor }}
              resizeMode="contain"
            />
            <Text style={{ fontSize: 17, fontWeight: '700', color: branding.textColor }}>
              {branding.appName}
            </Text>
          </View>
        ),
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
