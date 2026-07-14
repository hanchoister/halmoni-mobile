import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/field';
import { Pill } from '@/components/ui/pill';
import { Screen } from '@/components/ui/screen';
import { formatDate, formatTime } from '@/lib/format';
import { useMe } from '@/lib/me';
import { useParents } from '@/lib/parent';
import { supabase } from '@/lib/supabase';
import { palette, radius, spacing } from '@/lib/theme';

type Tab = 'prep' | 'visit' | 'summary';
type Kind = 'voice' | 'diagnosis' | 'new-med' | 'stop-med' | 'follow-up' | 'instruction' | 'other';

type Appt = {
  id: string;
  parent_id: string;
  family_id: string;
  provider_name: string;
  specialty: string | null;
  starts_at: string;
  status: 'upcoming' | 'completed' | 'cancelled';
  prep_notes: string | null;
  summary: string | null;
};

type VisitNote = {
  id: string;
  kind: Kind;
  body: string;
  captured_at: string;
};

const KINDS: { id: Kind; label: string }[] = [
  { id: 'diagnosis', label: 'Diagnosis' },
  { id: 'new-med', label: 'New med' },
  { id: 'stop-med', label: 'Stop med' },
  { id: 'follow-up', label: 'Follow-up' },
  { id: 'instruction', label: 'Instruction' },
  { id: 'other', label: 'Note' },
];

function buildSummaryFromNotes(notes: VisitNote[]): string {
  const parts: string[] = [];
  const group = (k: Kind) => notes.filter((n) => n.kind === k);
  const diag = group('diagnosis');
  const newMeds = group('new-med');
  const stopMeds = group('stop-med');
  const followUps = group('follow-up');
  const instructions = group('instruction');
  const others = notes.filter((n) => n.kind === 'voice' || n.kind === 'other');
  if (diag.length) parts.push(`Diagnosis: ${diag.map((n) => n.body).join('; ')}.`);
  if (newMeds.length) parts.push(`New medication: ${newMeds.map((n) => n.body).join('; ')}.`);
  if (stopMeds.length) parts.push(`Stop: ${stopMeds.map((n) => n.body).join('; ')}.`);
  if (followUps.length) parts.push(`Follow-up: ${followUps.map((n) => n.body).join('; ')}.`);
  if (instructions.length) parts.push(`Instructions: ${instructions.map((n) => n.body).join('; ')}.`);
  if (others.length) parts.push(others.map((n) => n.body).join(' '));
  return parts.join(' ') || 'Visit completed. No structured notes captured.';
}

export default function VisitMode() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentParent } = useParents();
  const { me } = useMe();
  const [appt, setAppt] = useState<Appt | null>(null);
  const [notes, setNotes] = useState<VisitNote[]>([]);
  const [tab, setTab] = useState<Tab>('prep');
  const [prepDraft, setPrepDraft] = useState('');
  const [summaryDraft, setSummaryDraft] = useState('');
  const [noteKind, setNoteKind] = useState<Kind>('other');
  const [noteBody, setNoteBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [apptRes, notesRes] = await Promise.all([
      supabase.from('appointments').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('visit_notes')
        .select('*')
        .eq('appointment_id', id)
        .order('captured_at', { ascending: true }),
    ]);
    const a = apptRes.data as Appt | null;
    const loadedNotes = (notesRes.data as VisitNote[] | null) ?? [];
    setAppt(a);
    setNotes(loadedNotes);
    if (a) {
      setPrepDraft(a.prep_notes ?? '');
      setSummaryDraft(a.summary ?? buildSummaryFromNotes(loadedNotes));
      if (a.status === 'completed') setTab('summary');
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Screen>
        <Text style={styles.muted}>Loading…</Text>
      </Screen>
    );
  }

  if (!appt) {
    return (
      <Screen>
        <EmptyState emoji="🩺" title="Not found" message="This appointment may have been removed." />
      </Screen>
    );
  }

  async function savePrep() {
    if (!appt) return;
    setBusy(true);
    await supabase.from('appointments').update({ prep_notes: prepDraft }).eq('id', appt.id);
    setBusy(false);
  }

  async function addNote() {
    if (!appt || !noteBody.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('visit_notes').insert({
      appointment_id: appt.id,
      family_id: appt.family_id,
      kind: noteKind,
      body: noteBody.trim(),
      captured_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) {
      Alert.alert('Could not save', error.message);
      return;
    }
    setNoteBody('');
    setNoteKind('other');
    await load();
  }

  const autoSummary = buildSummaryFromNotes(notes);

  function buildShareText(): string {
    if (!appt) return '';
    const parentLabel =
      currentParent?.nickname?.trim() || currentParent?.name || 'our parent';
    const body = summaryDraft.trim() || autoSummary;
    const header = `${appt.provider_name} visit — ${parentLabel}\n${formatDate(appt.starts_at)}`;
    const footer = '—\nSent from Halmoni · coordinate care for aging parents · https://halmoni.uk';
    return `${header}\n\n${body}\n\n${footer}`;
  }

  async function saveSummary(): Promise<string | null> {
    if (!appt || !currentParent) return null;
    const text = summaryDraft.trim() || autoSummary;
    const { error } = await supabase
      .from('appointments')
      .update({ summary: text, status: 'completed' })
      .eq('id', appt.id);
    if (error) {
      Alert.alert('Could not save', error.message);
      return null;
    }
    return text;
  }

  async function finalize() {
    if (!appt) return;
    setBusy(true);
    const text = await saveSummary();
    if (text) {
      await supabase.from('thread_messages').insert({
        family_id: appt.family_id,
        parent_id: appt.parent_id,
        body: `Visit summary — ${appt.provider_name}: ${text}`,
        author_member_id: me?.id ?? null,
      });
    }
    setBusy(false);
    if (!text) return;
    router.replace(`/appointment/${appt.id}`);
  }

  async function shareExternally() {
    if (!appt) return;
    setBusy(true);
    const text = await saveSummary();
    setBusy(false);
    if (!text) return;
    try {
      await Share.share({ message: buildShareText() });
    } catch (e) {
      // user dismissed or share failed; summary is already saved
    }
    router.replace(`/appointment/${appt.id}`);
  }

  return (
    <Screen>
      <Card>
        <View style={styles.pillRow}>
          <Pill label="Visit Mode" tone="terracotta" />
          <Text style={styles.sub}>
            {formatDate(appt.starts_at)} · {formatTime(appt.starts_at)}
          </Text>
        </View>
        <Text style={styles.heading}>{appt.provider_name}</Text>
        {appt.specialty && <Text style={styles.sub}>{appt.specialty}</Text>}
      </Card>

      <View style={styles.tabRow}>
        {(['prep', 'visit', 'summary'] as Tab[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tabBtn, tab === t && styles.tabBtnActive]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'prep' ? 'Prep' : t === 'visit' ? 'In visit' : 'Summary'}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'prep' && (
        <Card>
          <Text style={styles.sectionLabel}>YOUR PREP NOTES</Text>
          <Input
            value={prepDraft}
            onChangeText={setPrepDraft}
            placeholder="What do you want to remember to ask?"
            multiline
          />
          <View style={{ height: spacing.sm }} />
          <Button title="Save prep" onPress={savePrep} variant="secondary" busy={busy} />
        </Card>
      )}

      {tab === 'visit' && (
        <>
          <Card>
            <Text style={styles.sectionLabel}>CAPTURE</Text>
            <View style={styles.kindRow}>
              {KINDS.map((k) => (
                <Pressable
                  key={k.id}
                  onPress={() => setNoteKind(k.id)}
                  style={[styles.kindPill, noteKind === k.id && styles.kindPillActive]}>
                  <Text style={[styles.kindText, noteKind === k.id && styles.kindTextActive]}>
                    {k.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Input
              value={noteBody}
              onChangeText={setNoteBody}
              placeholder="What did the doctor say?"
              multiline
            />
            <View style={{ height: spacing.sm }} />
            <Button
              title="Add to visit"
              onPress={addNote}
              disabled={!noteBody.trim()}
              busy={busy}
            />
          </Card>

          {notes.length > 0 && (
            <Card>
              <Text style={styles.sectionLabel}>CAPTURED</Text>
              {notes.map((vn) => (
                <View key={vn.id} style={styles.noteRow}>
                  <Text style={styles.noteKind}>
                    {vn.kind} · {formatTime(vn.captured_at)}
                  </Text>
                  <Text style={styles.body}>{vn.body}</Text>
                </View>
              ))}
            </Card>
          )}
        </>
      )}

      {tab === 'summary' && (
        <>
          <Card tint="sage">
            <Text style={styles.sectionLabel}>AUTO-BUILT SUMMARY</Text>
            <Text style={styles.body}>{autoSummary}</Text>
          </Card>

          <Card>
            <Text style={styles.sectionLabel}>EDIT BEFORE SHARING</Text>
            <Input
              value={summaryDraft}
              onChangeText={setSummaryDraft}
              multiline
            />
            <View style={{ height: spacing.sm }} />
            <Button title="Share with family" onPress={finalize} busy={busy} />
            <View style={{ height: spacing.sm }} />
            <Button
              title="Send via text"
              onPress={shareExternally}
              variant="secondary"
              busy={busy}
            />
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 6 },
  heading: { fontSize: 22, fontWeight: '800', color: palette.ink900 },
  sub: { fontSize: 12, color: palette.ink500, marginTop: 2 },
  tabRow: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: palette.cream200,
    borderRadius: radius.pill,
    padding: 4,
    alignSelf: 'flex-start',
  },
  tabBtn: { paddingHorizontal: spacing.lg, paddingVertical: 8, borderRadius: radius.pill },
  tabBtnActive: { backgroundColor: palette.white },
  tabText: { fontSize: 13, fontWeight: '600', color: palette.ink500 },
  tabTextActive: { color: palette.ink900 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.ink500,
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm },
  kindPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.cream200,
  },
  kindPillActive: { backgroundColor: palette.sage500 },
  kindText: { fontSize: 12, fontWeight: '600', color: palette.ink700 },
  kindTextActive: { color: palette.white },
  body: { fontSize: 13, color: palette.ink900, lineHeight: 19 },
  muted: { fontSize: 13, color: palette.ink500 },
  noteRow: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: palette.cream100 },
  noteKind: {
    fontSize: 11,
    color: palette.ink500,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
});
