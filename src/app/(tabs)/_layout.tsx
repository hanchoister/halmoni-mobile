import { router, Tabs } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { palette, spacing } from '@/lib/theme';

// Account lived only behind the parent's Profile screen, two taps in, which read
// as the PARENT's details rather than yours — so sign-out, delete-account and
// the device reset were all effectively unfindable. App Store guideline 5.1.1(v)
// also expects deletion to be discoverable, not merely present.
function AccountButton() {
  return (
    <Pressable
      onPress={() => router.push('/account')}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Your account"
      style={{ paddingHorizontal: spacing.md }}>
      <Text style={{ fontSize: 20 }}>👤</Text>
    </Pressable>
  );
}

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
        headerRight: () => <AccountButton />,
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
