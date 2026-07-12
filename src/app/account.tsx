import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/lib/auth';
import { useFamily } from '@/lib/family';
import { useMe } from '@/lib/me';
import { supabase } from '@/lib/supabase';
import { palette, spacing } from '@/lib/theme';

export default function AccountScreen() {
  const { session } = useAuth();
  const { me, siblings } = useMe();
  const { familyId } = useFamily();
  const [busy, setBusy] = useState(false);

  async function createInvite() {
    if (!familyId) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('create_invite', { fid: familyId });
    setBusy(false);
    if (error) {
      Alert.alert('Could not create invite', error.message);
      return;
    }
    await Clipboard.setStringAsync(data as string);
    Alert.alert('Invite code copied', `Share this code: ${data}`);
  }

  async function signOut() {
    Alert.alert('Sign out?', 'You can sign back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          await supabase.auth.signOut();
          setBusy(false);
        },
      },
    ]);
  }

  return (
    <Screen>
      <Card>
        <Text style={styles.sectionLabel}>YOU</Text>
        {me ? (
          <View style={styles.meRow}>
            <Avatar name={me.name} color={me.color} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{me.name}</Text>
              {me.relation && <Text style={styles.sub}>{me.relation}</Text>}
              <Text style={styles.sub}>{session?.user?.email}</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.sub}>{session?.user?.email}</Text>
        )}
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>FAMILY</Text>
        <Text style={styles.sub}>
          {siblings.length === 1
            ? 'Just you so far.'
            : `${siblings.length} members in your family.`}
        </Text>
        <View style={{ height: spacing.sm }} />
        <Button title="Create invite code" onPress={createInvite} busy={busy} variant="secondary" />
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>SIGN OUT</Text>
        <Text style={styles.sub}>You&apos;ll be returned to the sign-in screen.</Text>
        <View style={{ height: spacing.sm }} />
        <Button title="Sign out" onPress={signOut} variant="danger" busy={busy} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.ink500,
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  meRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  name: { fontSize: 16, fontWeight: '700', color: palette.ink900 },
  sub: { fontSize: 13, color: palette.ink500, marginTop: 2 },
});
