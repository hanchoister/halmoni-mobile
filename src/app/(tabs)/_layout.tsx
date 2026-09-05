import { router, Tabs } from 'expo-router';
import { Pressable } from 'react-native';

import { Icon, IconName } from '@/components/ui/icon';
import { color, fontFamily, palette, spacing } from '@/lib/theme';

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
      <Icon name="account" size={22} color={color.textMuted} />
    </Pressable>
  );
}

// Icons replace the emoji that used to live here. The old version passed the
// tint colour into a <Text> holding an emoji, and emoji ignore `color` — so the
// active tab was only ever signalled by its label. These take the tint, and
// fill when active.
function tabIcon(name: IconName) {
  function TabIcon({ color: tint, focused }: { color: string; focused: boolean }) {
    return <Icon name={name} size={23} color={tint} filled={focused} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: color.accent,
        tabBarInactiveTintColor: color.textFaint,
        tabBarStyle: {
          backgroundColor: color.bg,
          borderTopColor: color.hairline,
        },
        tabBarLabelStyle: {
          fontFamily: fontFamily.sansSemi,
          fontSize: 10,
        },
        headerStyle: { backgroundColor: color.bg },
        headerShadowVisible: false,
        headerTintColor: palette.ink900,
        headerTitleStyle: {
          fontFamily: fontFamily.sansBold,
          fontSize: 17,
        },
        headerRight: () => <AccountButton />,
      }}>
      <Tabs.Screen
        name="index"
        // The hero on Today is its own header — see app/(tabs)/index.tsx. It
        // carries the greeting and the account button itself.
        options={{ title: 'Today', tabBarIcon: tabIcon('today'), headerShown: false }}
      />
      <Tabs.Screen name="meds" options={{ title: 'Meds', tabBarIcon: tabIcon('meds') }} />
      <Tabs.Screen name="appointments" options={{ title: 'Visits', tabBarIcon: tabIcon('visits') }} />
      <Tabs.Screen name="family" options={{ title: 'Family', tabBarIcon: tabIcon('family') }} />
      <Tabs.Screen name="timeline" options={{ title: 'Timeline', tabBarIcon: tabIcon('timeline') }} />
    </Tabs>
  );
}
