import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { Screen } from '@/components/ui/screen';
import { useFamily } from '@/lib/family';
import { formatRelative } from '@/lib/format';
import { useMe } from '@/lib/me';
import { useParents } from '@/lib/parent';
import { supabase } from '@/lib/supabase';
import { palette, radius, spacing } from '@/lib/theme';

type ThreadRow = {
  id: string;
  body: string;
  author_member_id: string | null;
  created_at: string;
  is_digest: boolean;
};

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
  const [thread, setThread] = useState<ThreadRow[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffRow[]>([]);
  const [onDuty, setOnDuty] = useState<OnDutyRow | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!familyId || !currentParent) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [threadRes, handoffsRes, onDutyRes] = await Promise.all([
      supabase
        .from('thread_messages')
        .select('*')
        .eq('parent_id', currentParent.id)
        .order('created_at', { ascending: true })
        .limit(50),
      supabase
        .from('handoffs')
        .select('*')
        .eq('parent_id', currentParent.id)
        .order('sent_at', { ascending: false })
        .limit(5),
      supabase.from('on_duty').select('*').eq('parent_id', currentParent.id).maybeSingle(),
    ]);
    setThread((threadRes.data as ThreadRow[] | null) ?? []);
    setHandoffs((handoffsRes.data as HandoffRow[] | null) ?? []);
    setOnDuty(onDutyRes.data as OnDutyRow | null);
    await refreshMe();
    setLoading(false);
  }, [familyId, currentParent, refreshMe]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function send() {
    if (!me || !familyId || !currentParent || !message.trim()) return;
    const body = message.trim();
    setSending(true);
    const { error } = await supabase.from('thread_messages').insert({
      family_id: familyId,
      parent_id: currentParent.id,
      body,
      author_member_id: me.id,
    });
    setSending(false);
    if (error) {
      Alert.alert('Could not send', error.message);
      return;
    }
    setMessage('');
    await load();
  }

  async function createInvite() {
    if (!familyId) return;
    const { data, error } = await supabase.rpc('create_invite', { fid: familyId });
    if (error) {
      Alert.alert('Could not create invite', error.message);
      return;
    }
    const code = data as string;
    await Clipboard.setStringAsync(code);
    const parentLabel = currentParent?.nickname?.trim() || currentParent?.name || 'our parent';
    const inviterName = me?.name?.trim();
    const opener = inviterName ? `${inviterName} set up Halmoni` : "I set up Halmoni";
    const message =
      `${opener} to help our family coordinate ${parentLabel}'s care.\n\n` +
      `Join with code: ${code}\n\n` +
      `Get the app: https://halmoni.uk`;
    try {
      const result = await Share.share({ message });
      if (result.action === Share.dismissedAction) {
        Alert.alert('Invite code copied', `Share this code: ${code}`);
      }
    } catch (e) {
      Alert.alert('Invite code copied', `Share this code: ${code}`);
    }
  }

  if (!currentParent) {
    return (
      <Screen>
        <EmptyState emoji="🌿" title="No parent yet" message="Add a parent to set up your family." />
      </Screen>
    );
  }

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Card>
        <View style={styles.headerRow}>
          <Text style={styles.sectionLabel}>SIBLINGS</Text>
          <Pressable onPress={createInvite}>
            <Text style={styles.linkText}>Invite</Text>
          </Pressable>
        </View>
        {siblings.length === 0 ? (
          <Text style={styles.empty}>Just you so far. Tap Invite to bring siblings in.</Text>
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
                      <Text style={styles.phoneLink}>📞 {s.phone}</Text>
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
                <Text style={styles.handoffSummary}>{h.summary}</Text>
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
  sectionLabel: { fontSize: 11, fontWeight: '700', color: palette.ink500, letterSpacing: 1 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  linkText: { fontSize: 13, color: palette.sage600, fontWeight: '600' },
  empty: { fontSize: 13, color: palette.ink500, marginTop: spacing.sm },
  siblingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  siblingCard: {
    flexBasis: '47%',
    alignItems: 'center',
    padding: spacing.sm,
    gap: 4,
  },
  siblingName: { fontSize: 14, fontWeight: '600', color: palette.ink900, marginTop: 4 },
  siblingSub: { fontSize: 11, color: palette.ink500 },
  siblingPills: { flexDirection: 'row', gap: 4, marginTop: 2 },
  phoneLink: { fontSize: 12, color: palette.sage600, marginTop: 4 },
  messageRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'flex-end' },
  messageRowMine: { flexDirection: 'row-reverse' },
  bubble: { maxWidth: '78%', borderRadius: radius.md, padding: spacing.sm },
  bubbleMine: { backgroundColor: palette.sage500 },
  bubbleTheirs: { backgroundColor: palette.cream100 },
  bubbleAuthor: { fontSize: 11, fontWeight: '700', color: palette.ink500, marginBottom: 2 },
  bubbleBody: { fontSize: 13, color: palette.ink900, lineHeight: 18 },
  bubbleTime: { fontSize: 10, color: palette.ink500, marginTop: 4 },
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
    fontSize: 14,
    color: palette.ink900,
    backgroundColor: palette.white,
  },
  handoffRow: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: palette.cream100 },
  handoffNames: { fontSize: 13, fontWeight: '700', color: palette.ink900 },
  handoffWhen: { fontSize: 11, color: palette.ink500, marginTop: 2 },
  handoffSummary: { fontSize: 13, color: palette.ink700, marginTop: 4 },
  handoffMessage: { fontSize: 12, color: palette.ink500, marginTop: 4, fontStyle: 'italic' },
});
