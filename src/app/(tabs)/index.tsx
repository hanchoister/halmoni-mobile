import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeadsUp } from '@/components/heads-up';
import { Avatar } from '@/components/ui/avatar';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { list } from '@/lib/db/repository';
import { useDataVersion } from '@/lib/db/signal';
import { loadDismissedPairs } from '@/lib/detective-dismissals';
import { useFamily } from '@/lib/family';
import { calcAge, formatRelative, formatTime, isSameDay } from '@/lib/format';
import { useMe } from '@/lib/me';
import { newId } from '@/lib/newid';
import { useParents } from '@/lib/parent';
import { writeRow } from '@/lib/sync/write-path';
import { color, fontFamily, palette, radius, spacing, typography } from '@/lib/theme';

type DoseRow = {
  id: string;
  medication_id: string;
  scheduled_at: string;
  given_at: string | null;
  given_by_member_id: string | null;
  skipped: boolean;
};

type MedRow = {
  id: string;
  parent_id: string;
  name: string;
  dose: string | null;
  schedule: { time: string; withFood?: boolean }[];
  refill_by: string | null;
  started_at: string | null;
};

type SymptomRow = {
  id: string;
  description: string;
  observed_at: string;
  possible_med_links: string[] | null;
};

type HandoffRow = {
  id: string;
  from_member_id: string | null;
  to_member_id: string;
  summary: string;
  personal_message: string | null;
  accepted_at: string | null;
};

type AppointmentRow = {
  id: string;
  parent_id: string;
  provider_name: string;
  specialty: string | null;
  location: string | null;
  starts_at: string;
  status: string;
};

type OnDutyRow = {
  id: string;
  member_id: string;
  until: string;
  created_at: string;
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function TodayScreen() {
  const insets = useSafeAreaInsets();
  const { familyId } = useFamily();
  const { currentParent } = useParents();
  const { me, siblings } = useMe();
  const dataVersion = useDataVersion();
  const [doses, setDoses] = useState<DoseRow[]>([]);
  const [meds, setMeds] = useState<MedRow[]>([]);
  const [nextAppt, setNextAppt] = useState<AppointmentRow | null>(null);
  const [onDuty, setOnDuty] = useState<OnDutyRow | null>(null);
  const [symptoms, setSymptoms] = useState<SymptomRow[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffRow[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!familyId || !currentParent) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const today = new Date();
    const from = new Date(today);
    from.setHours(0, 0, 0, 0);
    const to = new Date(today);
    to.setHours(23, 59, 59, 999);

    const since = new Date();
    since.setDate(since.getDate() - 21);

    const nowIso = new Date().toISOString();

    const [
      medsList,
      todaysDoses,
      upcomingAppts,
      dutyRows,
      sympRows,
      allHandoffs,
      dismissedPairs,
    ] = await Promise.all([
      list('medications', { parent_id: currentParent.id }) as Promise<MedRow[]>,
      list(
        'med_doses',
        { family_id: familyId },
        {
          gte: { scheduled_at: from.toISOString() },
          lte: { scheduled_at: to.toISOString() },
          orderBy: 'scheduled_at ASC',
        },
      ) as Promise<DoseRow[]>,
      list(
        'appointments',
        { parent_id: currentParent.id, status: 'upcoming' },
        {
          gte: { starts_at: nowIso },
          orderBy: 'starts_at ASC',
          limit: 1,
        },
      ) as Promise<AppointmentRow[]>,
      list('on_duty', { parent_id: currentParent.id }, { limit: 1 }) as Promise<
        OnDutyRow[]
      >,
      list(
        'symptoms',
        { parent_id: currentParent.id },
        {
          gte: { observed_at: since.toISOString() },
          orderBy: 'observed_at DESC',
          limit: 30,
        },
      ) as Promise<SymptomRow[]>,
      list(
        'handoffs',
        { parent_id: currentParent.id },
        { isNull: ['accepted_at'], orderBy: 'sent_at DESC' },
      ) as Promise<HandoffRow[]>,
      loadDismissedPairs(familyId),
    ]);

    const medIds = new Set(medsList.map((m) => m.id));
    setMeds(medsList);
    setDoses(todaysDoses.filter((d) => medIds.has(d.medication_id)));
    setNextAppt(upcomingAppts[0] ?? null);
    setOnDuty(dutyRows[0] ?? null);
    setSymptoms(sympRows);
    setHandoffs(allHandoffs);
    setDismissed(dismissedPairs);
    setLoading(false);
  }, [familyId, currentParent]);

  async function acceptHandoff(id: string) {
    const row = handoffs.find((h) => h.id === id);
    if (!row) return;
    await writeRow('handoffs', {
      ...row,
      accepted_at: new Date().toISOString(),
    });
  }

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Refetch when the local mirror changes (realtime, sync pull, other screens).
  useEffect(() => {
    if (dataVersion > 0) void load();
  }, [dataVersion, load]);

  async function markGiven(doseId: string) {
    if (!me) return;
    const dose = doses.find((d) => d.id === doseId);
    if (!dose) return;
    const nowIso = new Date().toISOString();
    setDoses((prev) =>
      prev.map((d) =>
        d.id === doseId ? { ...d, given_at: nowIso, given_by_member_id: me.id } : d,
      ),
    );
    await writeRow('med_doses', {
      ...dose,
      given_at: nowIso,
      given_by_member_id: me.id,
      skipped: false,
    });
  }

  async function unmarkGiven(doseId: string) {
    const dose = doses.find((d) => d.id === doseId);
    if (!dose) return;
    setDoses((prev) =>
      prev.map((d) => (d.id === doseId ? { ...d, given_at: null, given_by_member_id: null } : d)),
    );
    await writeRow('med_doses', {
      ...dose,
      given_at: null,
      given_by_member_id: null,
    });
  }

  async function takeOverDuty() {
    if (!me || !familyId || !currentParent) return;
    const until = new Date();
    until.setHours(until.getHours() + 24);
    // on_duty is unique per parent_id — carry over the existing row's id if
    // present so we update in place, otherwise mint a new one.
    await writeRow('on_duty', {
      id: onDuty?.id ?? newId(),
      parent_id: currentParent.id,
      family_id: familyId,
      member_id: me.id,
      until: until.toISOString(),
      // writeRow stamps updated_at but not created_at, and the column is
      // NOT NULL. Preserve the original on takeover so the row keeps the
      // time duty first started, not the time it last changed hands.
      created_at: onDuty?.created_at ?? new Date().toISOString(),
    });
  }

  if (!currentParent) {
    return (
      <Screen>
        <EmptyState
          icon="family"
          title="No parent yet"
          message="Add the parent you're caring for to start tracking medications and appointments."
        />
        <Button title="Add a parent" onPress={() => router.push('/parent/new')} />
      </Screen>
    );
  }

  const dutyMember = onDuty ? siblings.find((s) => s.id === onDuty.member_id) : null;
  const meIsOnDuty = onDuty?.member_id === me?.id;
  const age = calcAge(currentParent.dob);
  const todayMeds = doses.map((d) => ({ dose: d, med: meds.find((m) => m.id === d.medication_id) }));

  const parentName = currentParent.nickname || currentParent.name;
  const dosesDue = todayMeds.length;
  const dosesGiven = todayMeds.filter(({ dose }) => !!dose.given_at).length;

  return (
    <Screen
      padded={false}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      {/* The hero. It is the one saturated surface in the app, and it exists to
          answer "how is Mom, and is anything on me?" before you scroll. */}
      <View style={[styles.hero, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.heroTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroGreeting}>
              {greeting()}
              {me?.name ? `, ${me.name.split(' ')[0]}` : ''}
            </Text>
            <Pressable onPress={() => router.push('/profile')}>
              <Text style={styles.heroDisplay}>
                How&rsquo;s <Text style={styles.heroDisplayAccent}>{parentName}</Text> today?
              </Text>
            </Pressable>
          </View>
          <Pressable
            onPress={() => router.push('/account')}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Your account"
            style={styles.heroAccount}>
            <Icon name="account" size={19} color={color.onHeroDim} />
          </Pressable>
        </View>

        <View style={styles.statRow}>
          <View>
            <Text style={styles.statValue}>
              {dosesGiven}
              <Text style={styles.statOf}>/{dosesDue}</Text>
            </Text>
            <Text style={styles.statLabel}>MEDS</Text>
          </View>
          <View style={styles.statDivider} />
          <View>
            <Text style={styles.statValue}>{age ?? '—'}</Text>
            <Text style={styles.statLabel}>YEARS OLD</Text>
          </View>
          {currentParent.conditions.length > 0 && (
            <>
              <View style={styles.statDivider} />
              <View style={{ flex: 1 }}>
                <Text style={styles.statValue}>{currentParent.conditions.length}</Text>
                <Text style={styles.statLabel} numberOfLines={1}>
                  CONDITIONS
                </Text>
              </View>
            </>
          )}
        </View>

        <View style={styles.dutyWell}>
          {dutyMember ? (
            <>
              <Avatar name={dutyMember.name} color={dutyMember.color} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={styles.dutyName}>
                  {meIsOnDuty ? 'You\u2019re on duty' : `${dutyMember.name} is on duty`}
                </Text>
                <Text style={styles.dutySub}>Ends {formatRelative(onDuty!.until)}</Text>
              </View>
              {meIsOnDuty && (
                <Pressable
                  onPress={() => router.push('/handoff/new')}
                  accessibilityRole="button"
                  style={styles.heroChip}>
                  <Text style={styles.heroChipText}>Hand off</Text>
                </Pressable>
              )}
            </>
          ) : (
            <>
              <View style={{ flex: 1 }}>
                <Text style={styles.dutyName}>No one is on duty</Text>
                <Text style={styles.dutySub}>for {parentName}</Text>
              </View>
              <Pressable onPress={takeOverDuty} accessibilityRole="button" style={styles.heroChip}>
                <Text style={styles.heroChipText}>Take over</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>

      <View style={styles.body}>

      <HeadsUp
        meds={meds}
        symptoms={symptoms}
        handoffs={handoffs}
        siblings={siblings}
        meId={me?.id ?? null}
        dismissedFindings={dismissed}
        onAcceptHandoff={acceptHandoff}
      />

      <Card>
        <View style={styles.cardHead}>
          <Text style={styles.sectionLabel}>TODAY&apos;S MEDS</Text>
          {dosesDue > 0 && (
            <Text style={styles.cardCount}>
              {dosesGiven} of {dosesDue}
            </Text>
          )}
        </View>
        {todayMeds.length === 0 ? (
          <Text style={styles.empty}>No doses scheduled today.</Text>
        ) : (
          todayMeds.map(({ dose, med }) => {
            const isGiven = !!dose.given_at;
            const giver = dose.given_by_member_id
              ? siblings.find((s) => s.id === dose.given_by_member_id)
              : null;
            return (
              <Pressable
                key={dose.id}
                onPress={() => (isGiven ? unmarkGiven(dose.id) : markGiven(dose.id))}
                style={styles.doseRow}>
                <View
                  style={[
                    styles.checkbox,
                    isGiven && { backgroundColor: color.confirm, borderColor: color.confirm },
                  ]}>
                  {isGiven && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.doseTitle, isGiven && styles.doseGiven]}>
                    {med?.name ?? 'Medication'}
                  </Text>
                  <Text style={styles.doseSub}>
                    {formatTime(dose.scheduled_at)}
                    {med?.dose ? ` · ${med.dose}` : ''}
                  </Text>
                  {giver && (
                    <Text style={styles.doseGiver}>
                      Given by {giver.name} {formatRelative(dose.given_at!)}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })
        )}
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>NEXT APPOINTMENT</Text>
        {nextAppt ? (
          <Pressable
            onPress={() => router.push(`/appointment/${nextAppt.id}`)}
            style={styles.apptRow}>
            <View style={styles.apptDate}>
              <Text style={styles.apptDateDay}>
                {new Date(nextAppt.starts_at).toLocaleDateString([], { day: 'numeric' })}
              </Text>
              <Text style={styles.apptDateMonth}>
                {new Date(nextAppt.starts_at).toLocaleDateString([], { month: 'short' })}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.apptProvider}>{nextAppt.provider_name}</Text>
              {nextAppt.specialty && <Text style={styles.apptSub}>{nextAppt.specialty}</Text>}
              <Text style={styles.apptSub}>
                {formatTime(nextAppt.starts_at)}
                {isSameDay(nextAppt.starts_at, new Date()) ? ' today' : ''}
              </Text>
            </View>
            <Icon name="chevronRight" size={17} color={color.textFaint} />
          </Pressable>
        ) : (
          <Text style={styles.empty}>No upcoming appointments.</Text>
        )}
      </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // ---- hero ----------------------------------------------------------------
  hero: {
    backgroundColor: color.hero,
    borderBottomLeftRadius: radius.hero,
    borderBottomRightRadius: radius.hero,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  heroAccount: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.heroWell,
    marginTop: 2,
  },
  heroGreeting: { ...typography.meta, color: color.onHeroDim },
  heroDisplay: { ...typography.display, color: color.onHero, marginTop: spacing.xs },
  heroDisplayAccent: { color: color.onHeroAccent },

  statRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg, marginTop: spacing.xl },
  statValue: { ...typography.display, fontSize: 24, lineHeight: 26, color: color.onHero },
  statOf: { fontFamily: fontFamily.sans, fontSize: 15, color: color.onHeroFaint },
  statLabel: { ...typography.label, fontSize: 9.5, color: color.onHeroFaint, marginTop: 5 },
  statDivider: { width: 1, height: 32, backgroundColor: 'rgba(244,239,230,0.16)' },

  dutyWell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: color.heroWell,
  },
  dutyName: { ...typography.bodyStrong, fontSize: 14, color: color.onHero },
  dutySub: { ...typography.meta, fontSize: 12, color: color.onHeroDim, marginTop: 1 },
  heroChip: {
    backgroundColor: color.onHero,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  heroChipText: { ...typography.bodyStrong, fontSize: 12, color: color.hero },

  // ---- body ----------------------------------------------------------------
  body: { padding: spacing.lg, gap: spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { ...typography.label, color: color.textMuted, marginBottom: spacing.sm },
  cardCount: { ...typography.bodyStrong, fontSize: 12, color: color.confirm, marginBottom: spacing.sm },
  empty: { ...typography.meta, color: color.textMuted },

  doseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  // Round, not square: a dose is a thing you tick off, and the circle reads as
  // a checklist rather than a form field.
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.8,
    borderColor: palette.cream300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: { color: palette.white, fontFamily: fontFamily.sans, fontSize: 14 },
  doseTitle: { ...typography.bodyStrong, fontSize: 14, color: color.text },
  doseGiven: { color: color.textFaint, textDecorationLine: 'line-through' },
  doseSub: { ...typography.meta, fontSize: 12, color: color.textMuted, marginTop: 1 },
  doseGiver: { ...typography.meta, fontSize: 11, color: color.textFaint, marginTop: 1 },

  apptRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  apptDate: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: color.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  apptDateDay: { ...typography.displaySm, fontSize: 17, lineHeight: 19, color: palette.terracotta700 },
  apptDateMonth: { ...typography.label, fontSize: 8.5, color: palette.terracotta600, marginTop: 1 },
  apptProvider: { ...typography.bodyStrong, fontSize: 14, color: color.text },
  apptSub: { ...typography.meta, fontSize: 12, color: color.textMuted, marginTop: 2 },
});
