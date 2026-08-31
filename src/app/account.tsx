import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Alert, Modal, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/field';
import { Screen } from '@/components/ui/screen';
import { deleteAccount } from '@/lib/account/delete-account';
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  // If nobody else is left in the family, deleting the account takes the
  // whole family's records with it. Say so plainly before they confirm.
  const isLastMember = siblings.length <= 1;
  const canConfirm = confirmText.trim().toUpperCase() === 'DELETE' && !deleting;

  async function confirmDelete() {
    if (!canConfirm) return;
    setDeleting(true);
    try {
      await deleteAccount();
      // Auth state flips to signed-out and the root layout swaps to the
      // sign-in screen, so there is no navigation to do here.
    } catch (err) {
      setDeleting(false);
      Alert.alert(
        'Could not delete account',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

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

      <Card>
        <Text style={styles.sectionLabel}>DELETE ACCOUNT</Text>
        <Text style={styles.sub}>
          {isLastMember
            ? 'You are the only person in this family, so deleting your account also permanently deletes this family and every medication, dose and note in it.'
            : 'Your account is removed and you leave this family. The records your family has already logged stay with them.'}
        </Text>
        <Text style={[styles.sub, styles.permanent]}>This cannot be undone.</Text>
        <View style={{ height: spacing.sm }} />
        <Button
          title="Delete my account"
          onPress={() => {
            setConfirmText('');
            setDeleteOpen(true);
          }}
          variant="danger"
        />
      </Card>

      <Modal
        visible={deleteOpen}
        transparent
        animationType="fade"
        onRequestClose={() => !deleting && setDeleteOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Delete your account?</Text>
            <Text style={styles.sub}>
              {isLastMember
                ? 'This deletes your family and all of its health records for good.'
                : 'This deletes your account and removes you from the family.'}
            </Text>
            <View style={{ height: spacing.md }} />
            <Text style={styles.sub}>Type DELETE to confirm.</Text>
            <View style={{ height: 4 }} />
            <Input
              value={confirmText}
              onChangeText={setConfirmText}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!deleting}
              placeholder="DELETE"
            />
            <View style={{ height: spacing.md }} />
            <Button
              title="Permanently delete"
              onPress={confirmDelete}
              variant="danger"
              disabled={!canConfirm}
              busy={deleting}
            />
            <View style={{ height: spacing.sm }} />
            <Button
              title="Cancel"
              onPress={() => setDeleteOpen(false)}
              variant="ghost"
              disabled={deleting}
            />
          </View>
        </View>
      </Modal>
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
  permanent: { fontWeight: '700', color: palette.terracotta500 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: palette.white,
    borderRadius: 16,
    padding: spacing.lg,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: palette.ink900,
    marginBottom: spacing.xs,
  },
});
