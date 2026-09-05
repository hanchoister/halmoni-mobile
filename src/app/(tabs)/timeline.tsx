import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { Icon, IconName } from '@/components/ui/icon';
import { list } from '@/lib/db/repository';
import { useDataVersion } from '@/lib/db/signal';
import { formatRelative } from '@/lib/format';
import { useMe } from '@/lib/me';
import { useParents } from '@/lib/parent';
import { color, fontFamily, palette, radius, spacing, typography } from '@/lib/theme';

type TimelineItem = {
  id: string;
  kind: 'dose' | 'symptom' | 'note' | 'visit' | 'message' | 'handoff';
  when: string;
  title: string;
  body?: string;
  authorMemberId?: string | null;
  linkTo?: string;
};

type Filter = 'all' | 'doses' | 'symptoms' | 'notes' | 'visits' | 'handoffs';

export default function TimelineScreen() {
  const { currentParent } = useParents();
  const { siblings } = useMe();
  const dataVersion = useDataVersion();
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    if (!currentParent) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const since = new Date();
    since.setDate(since.getDate() - 21);
    const sinceIso = since.toISOString();

    const [doseRows, sympRows, noteRows, apptRows, msgRows, handoffRows, medRows] =
      await Promise.all([
        list(
          'med_doses',
          {},
          {
            gte: { given_at: sinceIso },
            notNull: ['given_at'],
            orderBy: 'given_at DESC',
            limit: 40,
          },
        ),
        list(
          'symptoms',
          { parent_id: currentParent.id },
          { gte: { observed_at: sinceIso }, orderBy: 'observed_at DESC' },
        ),
        list(
          'notes',
          { parent_id: currentParent.id },
          { gte: { created_at: sinceIso }, orderBy: 'created_at DESC' },
        ),
        list(
          'appointments',
          { parent_id: currentParent.id },
          { gte: { starts_at: sinceIso }, orderBy: 'starts_at DESC' },
        ),
        list(
          'thread_messages',
          { parent_id: currentParent.id },
          { gte: { created_at: sinceIso }, orderBy: 'created_at DESC', limit: 20 },
        ),
        list(
          'handoffs',
          { parent_id: currentParent.id },
          { gte: { sent_at: sinceIso }, orderBy: 'sent_at DESC' },
        ),
        list('medications', { parent_id: currentParent.id }),
      ]);

    const medIds = new Set(medRows.map((m) => m.id as string));
    const medName = (id: string) =>
      (medRows.find((m) => m.id === id)?.name as string | undefined) ?? 'Medication';

    const all: TimelineItem[] = [];
    for (const d of doseRows) {
      if (d.given_at && medIds.has(d.medication_id)) {
        all.push({
          id: `d-${d.id}`,
          kind: 'dose',
          when: d.given_at,
          title: `${medName(d.medication_id)} given`,
          authorMemberId: d.given_by_member_id,
        });
      }
    }
    for (const s of sympRows) {
      all.push({
        id: `s-${s.id}`,
        kind: 'symptom',
        when: s.observed_at,
        title: `Symptom: ${s.description}`,
        body: `Severity: ${s.severity}`,
        authorMemberId: s.observed_by_member_id,
      });
    }
    for (const n of noteRows) {
      all.push({
        id: `n-${n.id}`,
        kind: 'note',
        when: n.created_at,
        title: n.kind === 'mood' ? 'Mood note' : 'Note',
        body: n.body,
        authorMemberId: n.author_member_id,
      });
    }
    for (const a of apptRows) {
      all.push({
        id: `a-${a.id}`,
        kind: 'visit',
        when: a.starts_at,
        title: `${a.provider_name} (${a.specialty ?? 'visit'})`,
        body: a.summary ?? undefined,
        linkTo: `/appointment/${a.id}`,
      });
    }
    for (const m of msgRows) {
      all.push({
        id: `m-${m.id}`,
        kind: 'message',
        when: m.created_at,
        title: m.is_digest ? 'Weekly digest' : 'Family thread',
        body: m.body,
        authorMemberId: m.author_member_id,
      });
    }
    for (const h of handoffRows) {
      all.push({
        id: `h-${h.id}`,
        kind: 'handoff',
        when: h.sent_at,
        title: 'Hand off',
        body: h.summary?.trim() || undefined,
        authorMemberId: h.from_member_id,
      });
    }
    all.sort((a, b) => (b.when > a.when ? 1 : -1));
    setItems(all);
    setLoading(false);
  }, [currentParent]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (dataVersion > 0) void load();
  }, [dataVersion, load]);

  if (!currentParent) {
    return (
      <Screen>
        <EmptyState icon="leaf" title="No parent yet" message="Add a parent to see the timeline." />
      </Screen>
    );
  }

  const filtered = items.filter((i) => {
    if (filter === 'all') return true;
    if (filter === 'doses') return i.kind === 'dose';
    if (filter === 'symptoms') return i.kind === 'symptom';
    if (filter === 'notes') return i.kind === 'note' || i.kind === 'message';
    if (filter === 'visits') return i.kind === 'visit';
    if (filter === 'handoffs') return i.kind === 'handoff';
    return true;
  });

  const filterLabels: Record<Filter, string> = {
    all: 'Everything',
    doses: 'Doses',
    symptoms: 'Symptoms',
    notes: 'Notes',
    visits: 'Visits',
    handoffs: 'Hand-offs',
  };

  // Icon plus a tone: sage for things that went right (a dose given, a hand-off
  // accepted), terracotta for things that want attention (a symptom, a visit).
  function kindIcon(k: TimelineItem['kind']): { name: IconName; tone: string; well: string } {
    switch (k) {
      case 'dose':
        return { name: 'meds', tone: color.confirm, well: color.confirmSoft };
      case 'symptom':
        return { name: 'alert', tone: color.accent, well: color.accentSoft };
      case 'note':
        return { name: 'note', tone: color.textMuted, well: color.surfaceAlt };
      case 'visit':
        return { name: 'visits', tone: color.accent, well: color.accentSoft };
      case 'message':
        return { name: 'note', tone: color.confirm, well: color.confirmSoft };
      default:
        return { name: 'handoff', tone: color.confirm, well: color.confirmSoft };
    }
  }

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      padded={false}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={{ gap: 6, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
        {(Object.keys(filterLabels) as Filter[]).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.filterPill, filter === f && styles.filterPillActive]}>
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {filterLabels[f]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
        {filtered.length === 0 ? (
          <EmptyState icon="timeline" title="Nothing in this filter" message="Try a different filter or come back later." />
        ) : (
          filtered.map((item) => {
            const author = item.authorMemberId ? siblings.find((s) => s.id === item.authorMemberId) : null;
            return (
              <Pressable
                key={item.id}
                onPress={() => item.linkTo && router.push(item.linkTo as any)}>
                <Card>
                  <View style={styles.itemRow}>
                    {(() => {
                      const k = kindIcon(item.kind);
                      return (
                        <View style={[styles.kindWell, { backgroundColor: k.well }]}>
                          <Icon name={k.name} size={16} color={k.tone} strokeWidth={2} />
                        </View>
                      );
                    })()}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemTitle}>{item.title}</Text>
                      <Text style={styles.itemTime}>{formatRelative(item.when)}</Text>
                      {item.body && (
                        <Text style={styles.itemBody} numberOfLines={3}>
                          {item.body}
                        </Text>
                      )}
                      {author && (
                        <View style={styles.authorRow}>
                          <Avatar name={author.name} color={author.color} size={20} />
                          <Text style={styles.authorName}>{author.name}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </Card>
              </Pressable>
            );
          })
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterRow: { flexGrow: 0, backgroundColor: palette.cream50 },
  filterPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.cream200,
    backgroundColor: palette.white,
  },
  filterPillActive: { backgroundColor: palette.sage500, borderColor: palette.sage500 },
  filterText: { ...typography.bodyStrong, fontSize: 12, color: palette.ink700 },
  filterTextActive: { color: palette.white },
  itemRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  kindWell: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTitle: { ...typography.bodyStrong, color: palette.ink900 },
  itemTime: { fontFamily: fontFamily.sans, fontSize: 11, color: palette.ink500, marginTop: 2 },
  itemBody: { ...typography.meta, fontSize: 12, color: palette.ink700, marginTop: 6, lineHeight: 16 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  authorName: { fontFamily: fontFamily.sans, fontSize: 11, color: palette.ink500 },
});
