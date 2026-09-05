import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { Screen } from '@/components/ui/screen';
import { Icon } from '@/components/ui/icon';
import { list } from '@/lib/db/repository';
import { useDataVersion } from '@/lib/db/signal';
import { useFamily } from '@/lib/family';
import { formatRelative } from '@/lib/format';
import { useMe } from '@/lib/me';
import { newId } from '@/lib/newid';
import { useParents } from '@/lib/parent';
import { supabase } from '@/lib/supabase';
import { writeRow } from '@/lib/sync/write-path';
import { color, fontFamily, palette, radius, spacing, typography } from '@/lib/theme';

type ThreadRow = {
  id: string;
  body: string;
  author_member_id: string | null;
  created_at: string;
  is_digest: boolean;
};

type InviteRow = { code: string; expires_at: string };

type HandoffRow = {
  id: string;
  from_member_id: string | null;
  to_member_id: string;
  summary: string;
  personal_message: string | null;
  sent_at: string;
  until: string;
};

type OnDutyRow = { member_id: string; until: string };

export default function FamilyScreen() {
  const { familyId } = useFamily();
  const { currentParent } = useParents();
  const { me, siblings, refresh: refreshMe } = useMe();
  const dataVersion = useDataVersion();
  const [thread, setThread] = useState<ThreadRow[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffRow[]>([]);
  const [onDuty, setOnDuty] = useState<OnDutyRow | null>(null);
  const [invite, setInvite] = useState<InviteRow | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!familyId || !currentParent) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [threadRows, handoffRows, dutyRows] = await Promise.all([
      list(
        'thread_messages',
        { parent_id: currentParent.id },
        { orderBy: 'created_at ASC', limit: 50 },
      ) as Promise<ThreadRow[]>,
      list(
        'handoffs',
        { parent_id: currentParent.id },
        { orderBy: 'sent_at DESC', limit: 5 },
      ) as Promise<HandoffRow[]>,
      list('on_duty', { parent_id: currentParent.id }, { limit: 1 }) as Promise<
        OnDutyRow[]
      >,
    ]);
    setThread(threadRows);
    setHandoffs(handoffRows);
    setOnDuty(dutyRows[0] ?? null);
    // family_invites is not part of the synced mirror, so read it directly.
    // Showing the family's existing code beats minting a fresh one every time
    // someone wants to read it out loud.
    const { data: inviteRows } = await supabase
      .from('family_invites')
      .select('code, expires_at')
      .eq('family_id', familyId)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);
    setInvite(inviteRows && inviteRows.length > 0 ? (inviteRows[0] as InviteRow) : null);
    await refreshMe();
    setLoading(false);
  }, [familyId, currentParent, refreshMe]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (dataVersion > 0) void load();
  }, [dataVersion, load]);

  async function send() {
    if (!me || !familyId || !currentParent || !message.trim()) return;
    const body = message.trim();
    setSending(true);
    try {
      const now = new Date().toISOString();
      await writeRow('thread_messages', {
        id: newId(),
        family_id: familyId,
        parent_id: currentParent.id,
        body,
        author_member_id: me.id,
        is_digest: false,
        created_at: now,
      });
      setMessage('');
    } catch (err) {
      Alert.alert('Could not send', err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  // Sharing must NOT mint a code. A family has one active invite at a time; if
  // every tap of Share generated a new one, the code on screen — and any code
  // already read out to a sibling — would silently stop being the current one.
  async function shareInvite(code: string) {
    const parentLabel = currentParent?.nickname?.trim() || currentParent?.name || 'our parent';
    const inviterName = me?.name?.trim();
    const opener = inviterName ? `${inviterName} set up Halmoni` : 'I set up Halmoni';
    const message =
      `${opener} to help our family coordinate ${parentLabel}'s care.\n\n` +
      `Join with code: ${code}\n\n` +
      `Get the app: https://halmoni.app`;
    try {
      // The code is on screen already, so a dismissed share sheet needs no alert.
      await Share.share({ message });
    } catch {
      // Sharing is a convenience, not the only route — the code is visible.
    }
  }

  async function createInvite() {
    if (!familyId) return;
    const { data, error } = await supabase.rpc('create_invite', { fid: familyId });
    if (error) {
      Alert.alert('Could not create invite', error.message);
      return;
    }
    const code = data as string;
    setInvite({
      code,
      expires_at: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
    });
    await Clipboard.setStringAsync(code);
    await shareInvite(code);
  }

  if (!currentParent) {
    return (
      <Screen>
        <EmptyState icon="leaf" title="No parent yet" message="Add a parent to set up your family." />
      </Screen>
    );
  }

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Card>
        <View style={styles.headerRow}>
          <Text style={styles.sectionLabel}>SIBLINGS</Text>
        </View>

        <View style={styles.inviteBox}>
          {invite ? (
            <>
              <Text style={styles.inviteLabel}>INVITE CODE</Text>
              <Text selectable style={styles.inviteCode}>
                {invite.code}
              </Text>
              <Text style={styles.inviteHint}>
                Read it out or tap Share. Expires {formatRelative(invite.expires_at)}.
              </Text>
              <View style={styles.inviteActions}>
                <Button
                  title="Copy"
                  variant="secondary"
                  style={styles.inviteBtn}
                  onPress={async () => {
                    await Clipboard.setStringAsync(invite.code);
                    Alert.alert('Copied', `Invite code ${invite.code} copied.`);
                  }}
                />
                <Button
                  title="Share"
                  variant="secondary"
                  style={styles.inviteBtn}
                  onPress={() => shareInvite(invite.code)}
                />
              </View>
              <Pressable onPress={createInvite} hitSlop={8}>
                <Text style={styles.inviteReplace}>
                  Replace with a new code
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.inviteHint}>
                Siblings join with a code. Anyone in the family can create one.
              </Text>
              <View style={{ height: spacing.sm }} />
              <Button title="Create invite code" variant="secondary" onPress={createInvite} />
            </>
          )}
        </View>

        {siblings.length === 0 ? (
          <Text style={styles.empty}>Just you so far.</Text>
        ) : (
          <View style={styles.siblingGrid}>
            {siblings.map((s) => {
              const isOnDuty = onDuty?.member_id === s.id;
              const isYou = s.id === me?.id;
              return (
                <View key={s.id} style={styles.siblingCard}>
                  <Avatar name={s.name} color={s.color} size={48} />
                  <Text style={styles.siblingName}>{s.name}</Text>
                  {s.relation && <Text style={styles.siblingSub}>{s.relation}</Text>}
                  <View style={styles.siblingPills}>
                    {isYou && <Pill label="you" tone="sage" />}
                    {isOnDuty && <Pill label="on duty" tone="terracotta" />}
                  </View>
                  {s.phone && !isYou && (
                    <Pressable onPress={() => Linking.openURL(`tel:${s.phone}`)}>
                      <View style={styles.phoneRow}>
                        <Icon name="phone" size={13} color={color.accent} strokeWidth={2} />
                        <Text style={styles.phoneLink}>{s.phone}</Text>
                      </View>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>FAMILY THREAD</Text>
        {thread.length === 0 ? (
          <Text style={styles.empty}>No messages yet. Say hi.</Text>
        ) : (
          thread.map((m) => {
            const author = siblings.find((s) => s.id === m.author_member_id);
            const isMine = author?.id === me?.id;
            return (
              <View
                key={m.id}
                style={[styles.messageRow, isMine && styles.messageRowMine]}>
                {!isMine && <Avatar name={author?.name} color={author?.color ?? 'sage'} size={28} />}
                <View
                  style={[
                    styles.bubble,
                    isMine ? styles.bubbleMine : styles.bubbleTheirs,
                  ]}>
                  {!isMine && <Text style={styles.bubbleAuthor}>{author?.name ?? 'Member'}</Text>}
                  <Text style={[styles.bubbleBody, isMine && { color: palette.white }]}>
                    {m.body}
                  </Text>
                  <Text style={[styles.bubbleTime, isMine && { color: '#dce6e0' }]}>
                    {formatRelative(m.created_at)}
                  </Text>
                </View>
              </View>
            );
          })
        )}
        <View style={styles.composeRow}>
          <TextInput
            style={styles.composeInput}
            placeholder="Write to your siblings…"
            placeholderTextColor={palette.ink300}
            value={message}
            onChangeText={setMessage}
            multiline
          />
          <Button
            title="Send"
            onPress={send}
            disabled={!message.trim()}
            busy={sending}
            variant="primary"
          />
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>RECENT HAND-OFFS</Text>
        {handoffs.length === 0 ? (
          <Text style={styles.empty}>No hand-offs yet.</Text>
        ) : (
          handoffs.map((h) => {
            const from = siblings.find((s) => s.id === h.from_member_id);
            const to = siblings.find((s) => s.id === h.to_member_id);
            return (
              <View key={h.id} style={styles.handoffRow}>
                <Text style={styles.handoffNames}>
                  {from?.name ?? 'Someone'} → {to?.name ?? 'Someone'}
                </Text>
                <Text style={styles.handoffWhen}>{formatRelative(h.sent_at)}</Text>
                {h.summary?.trim() ? (
                  <Text style={styles.handoffSummary}>{h.summary}</Text>
                ) : (
                  <Text style={styles.handoffNoSummary}>No summary added.</Text>
                )}
                {h.personal_message && (
                  <Text style={styles.handoffMessage}>&ldquo;{h.personal_message}&rdquo;</Text>
                )}
              </View>
            );
          })
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  handoffNoSummary: { ...typography.meta, color: palette.ink300, fontStyle: 'italic' },
  inviteBox: {
    backgroundColor: palette.cream100,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  inviteLabel: {
    fontSize: 10,
    fontFamily: fontFamily.sansBold,
    color: palette.ink500,
    letterSpacing: 1,
  },
  inviteCode: {
    fontSize: 30,
    fontFamily: fontFamily.sansBold,
    letterSpacing: 4,
    color: palette.ink900,
    marginVertical: 4,
  },
  inviteHint: { ...typography.meta, fontSize: 12, color: palette.ink500 },
  inviteReplace: {
    ...typography.meta, fontSize: 12,
    color: palette.ink500,
    textDecorationLine: 'underline',
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
  },
  inviteActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  inviteBtn: { flex: 1 },
  sectionLabel: { fontSize: 11, fontFamily: fontFamily.sansBold, color: palette.ink500, letterSpacing: 1 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  linkText: { ...typography.meta, color: palette.sage600 },
  empty: { ...typography.meta, color: palette.ink500, marginTop: spacing.sm },
  siblingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  siblingCard: {
    flexBasis: '47%',
    alignItems: 'center',
    padding: spacing.sm,
    gap: 4,
  },
  siblingName: { ...typography.bodyStrong, color: palette.ink900, marginTop: 4 },
  siblingSub: { fontFamily: fontFamily.sans, fontSize: 11, color: palette.ink500 },
  siblingPills: { flexDirection: 'row', gap: 4, marginTop: 2 },
  phoneLink: { ...typography.meta, fontSize: 12, color: palette.sage600, marginTop: 4 },
  messageRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'flex-end' },
  messageRowMine: { flexDirection: 'row-reverse' },
  bubble: { maxWidth: '78%', borderRadius: radius.md, padding: spacing.sm },
  bubbleMine: { backgroundColor: palette.sage500 },
  bubbleTheirs: { backgroundColor: palette.cream100 },
  bubbleAuthor: { fontSize: 11, fontFamily: fontFamily.sansBold, color: palette.ink500, marginBottom: 2 },
  bubbleBody: { ...typography.meta, color: palette.ink900, lineHeight: 18 },
  bubbleTime: { fontFamily: fontFamily.sans, fontSize: 10, color: palette.ink500, marginTop: 4 },
  composeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, alignItems: 'flex-end' },
  composeInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: palette.cream200,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.meta,
    color: palette.ink900,
    backgroundColor: palette.white,
  },
  handoffRow: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: palette.cream100 },
  handoffNames: { ...typography.bodyStrong, color: palette.ink900 },
  handoffWhen: { fontFamily: fontFamily.sans, fontSize: 11, color: palette.ink500, marginTop: 2 },
  handoffSummary: { ...typography.meta, color: palette.ink700, marginTop: 4 },
  handoffMessage: { ...typography.meta, fontSize: 12, color: palette.ink500, marginTop: 4, fontStyle: 'italic' },
});
