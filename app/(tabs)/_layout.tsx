import { Tabs } from 'expo-router';
import React from 'react';
import { Alert, Image, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { branding } from '../../branding.config';

const Icon = ({ label, focused, size = 22 }: { label: string; focused: boolean; size?: number }) => (
  <View style={{ overflow: 'visible', alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ fontSize: size, opacity: focused ? 1 : 0.45 }}>{label}</Text>
  </View>
);

function NotificationBell() {
  const { t } = useTranslation();
  return (
    <TouchableOpacity
      onPress={() => Alert.alert(t('notifications.coming_soon_title'), t('notifications.coming_soon_body'))}
      hitSlop={10}
      style={{ paddingHorizontal: 16, paddingVertical: 8 }}
    >
      <Text style={{ fontSize: 20 }}>🔔</Text>
    </TouchableOpacity>
  );
}

export default function TabsLayout() {
  const { t } = useTranslation();

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
          tabBarLabel: t('tabs.credentials'),
          tabBarIcon: ({ focused }) => <Icon label="🪪      " focused={focused} />,
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
          headerRight: () => <NotificationBell />,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: t('tabs.scan'),
          tabBarLabel: t('tabs.scan'),
          tabBarIcon: ({ focused }) => <Icon label="📷" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t('tabs.history'),
          tabBarLabel: t('tabs.history'),
          tabBarIcon: ({ focused }) => <Icon label="📋" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          tabBarLabel: t('tabs.settings'),
          tabBarIcon: ({ focused }) => <Icon label="⚙️" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
