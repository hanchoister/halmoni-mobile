import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { palette } from '@/lib/theme';

function tabIcon(emoji: string) {
  function Icon({ color }: { color: string }) {
    return <Text style={{ fontSize: 20, color }}>{emoji}</Text>;
  }
  return Icon;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.sage600,
        tabBarInactiveTintColor: palette.ink500,
        headerStyle: { backgroundColor: palette.cream50 },
        headerTintColor: palette.ink900,
        headerTitleStyle: { fontWeight: '700' },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: tabIcon('☀️') }} />
      <Tabs.Screen name="meds" options={{ title: 'Meds', tabBarIcon: tabIcon('💊') }} />
      <Tabs.Screen
        name="appointments"
        options={{ title: 'Visits', tabBarIcon: tabIcon('🩺') }}
      />
      <Tabs.Screen name="family" options={{ title: 'Family', tabBarIcon: tabIcon('👨‍👩‍👧') }} />
      <Tabs.Screen name="timeline" options={{ title: 'Timeline', tabBarIcon: tabIcon('🕓') }} />
    </Tabs>
  );
}
