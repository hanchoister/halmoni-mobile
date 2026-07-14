import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { HeadsUp } from '@/components/heads-up';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { Screen } from '@/components/ui/screen';
import { useFamily } from '@/lib/family';
import { calcAge, formatRelative, formatTime, isSameDay } from '@/lib/format';
import { useMe } from '@/lib/me';
import { useParents } from '@/lib/parent';
import { supabase } from '@/lib/supabase';
import { palette, radius, spacing } from '@/lib/theme';

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
  member_id: string;
  until: string;
};

export default function TodayScreen() {
  const { familyId } = useFamily();
  const { currentParent } = useParents();
  const { me, siblings } = useMe();
  const [doses, setDoses] = useState<DoseRow[]>([]);
  const [meds, setMeds] = useState<MedRow[]>([]);
  const [nextAppt, setNextAppt] = useState<AppointmentRow | null>(null);
  const [onDuty, setOnDuty] = useState<OnDutyRow | null>(null);
  const [symptoms, setSymptoms] = useState<SymptomRow[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffRow[]>([]);
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

    const [medsRes, dosesRes, apptRes, onDutyRes, sympRes, handoffRes] = await Promise.all([
      supabase.from('medications').select('*').eq('parent_id', currentParent.id),
      supabase
        .from('med_doses')
        .select('*')
        .eq('family_id', familyId)
        .gte('scheduled_at', from.toISOString())
        .lte('scheduled_at', to.toISOString())
        .order('scheduled_at', { ascending: true }),
      supabase
        .from('appointments')
        .select('*')
        .eq('parent_id', currentParent.id)
        .eq('status', 'upcoming')
        .gte('starts_at', new Date().toISOString())
        .order('starts_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase.from('on_duty').select('*').eq('parent_id', currentParent.id).maybeSingle(),
      supabase
        .from('symptoms')
        .select('id,description,observed_at,possible_med_links')
        .eq('parent_id', currentParent.id)
        .gte('observed_at', since.toISOString())
        .order('observed_at', { ascending: false })
        .limit(30),
      supabase
        .from('handoffs')
        .select('*')
        .eq('parent_id', currentParent.id)
        .is('accepted_at', null)
        .order('sent_at', { ascending: false }),
    ]);

    const medsList = (medsRes.data as MedRow[] | null) ?? [];
    const medIds = new Set(medsList.map((m) => m.id));
    const allDoses = (dosesRes.data as DoseRow[] | null) ?? [];
    setMeds(medsList);
    setDoses(allDoses.filter((d) => medIds.has(d.medication_id)));
    setNextAppt(apptRes.data as AppointmentRow | null);
    setOnDuty(onDutyRes.data as OnDutyRow | null);
    setSymptoms((sympRes.data as SymptomRow[] | null) ?? []);
    setHandoffs((handoffRes.data as HandoffRow[] | null) ?? []);
    setLoading(false);
  }, [familyId, currentParent]);

  async function acceptHandoff(id: string) {
    const { error } = await supabase
      .from('handoffs')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    await load();
  }

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function markGiven(doseId: string) {
    if (!me) return;
    setDoses((prev) =>
      prev.map((d) =>
        d.id === doseId ? { ...d, given_at: new Date().toISOString(), given_by_member_id: me.id } : d,
      ),
    );
    await supabase
      .from('med_doses')
      .update({
        given_at: new Date().toISOString(),
        given_by_member_id: me.id,
        skipped: false,
      })
      .eq('id', doseId);
  }

  async function unmarkGiven(doseId: string) {
    setDoses((prev) =>
      prev.map((d) => (d.id === doseId ? { ...d, given_at: null, given_by_member_id: null } : d)),
    );
    await supabase
      .from('med_doses')
      .update({ given_at: null, given_by_member_id: null })
      .eq('id', doseId);
  }

  async function takeOverDuty() {
    if (!me || !familyId || !currentParent) return;
    const until = new Date();
    until.setHours(until.getHours() + 24);
    await supabase.from('on_duty').upsert(
      {
        parent_id: currentParent.id,
        family_id: familyId,
        member_id: me.id,
        until: until.toISOString(),
      },
      { onConflict: 'parent_id' },
    );
    await load();
  }

  if (!currentParent) {
    return (
      <Screen>
        <EmptyState
          emoji="🌿"
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

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Pressable onPress={() => router.push('/profile')}>
        <Card tint="sage" style={styles.parentCard}>
          <Avatar name={currentParent.nickname || currentParent.name} color="sage" size={48} />
          <View style={{ flex: 1 }}>
            <Text style={styles.parentName}>{currentParent.nickname || currentParent.name}</Text>
            {age != null && <Text style={styles.parentSub}>{age} years old</Text>}
            {currentParent.conditions.length > 0 && (
              <View style={styles.pillRow}>
                {currentParent.conditions.slice(0, 3).map((c) => (
                  <Pill key={c} label={c} tone="sage" />
                ))}
              </View>
            )}
          </View>
        </Card>
      </Pressable>

      <Card>
        <Text style={styles.sectionLabel}>ON DUTY</Text>
        {dutyMember ? (
          <View style={styles.dutyRow}>
            <Avatar name={dutyMember.name} color={dutyMember.color} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={styles.dutyName}>
                {meIsOnDuty ? 'You' : dutyMember.name}
                {meIsOnDuty && <Text style={styles.dutySub}>  (you)</Text>}
              </Text>
              <Text style={styles.dutySub}>Until {formatRelative(onDuty!.until)}</Text>
            </View>
            {meIsOnDuty && (
              <Button
                title="Hand off"
                variant="secondary"
                onPress={() => router.push('/handoff/new')}
              />
            )}
          </View>
        ) : (
          <View style={styles.dutyRow}>
            <Text style={styles.dutySub}>No one is on duty for {currentParent.nickname || currentParent.name}.</Text>
            <Button title="Take over" onPress={takeOverDuty} />
          </View>
        )}
      </Card>

      <HeadsUp
        meds={meds}
        symptoms={symptoms}
        handoffs={handoffs}
        siblings={siblings}
        meId={me?.id ?? null}
        onAcceptHandoff={acceptHandoff}
      />

      <Card>
        <Text style={styles.sectionLabel}>TODAY&apos;S MEDS</Text>
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
                    isGiven && { backgroundColor: palette.sage500, borderColor: palette.sage500 },
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
          </Pressable>
        ) : (
          <Text style={styles.empty}>No upcoming appointments.</Text>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  parentCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  parentName: { fontSize: 18, fontWeight: '700', color: palette.ink900 },
  parentSub: { fontSize: 13, color: palette.ink500, marginTop: 2 },
  pillRow: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: palette.ink500, letterSpacing: 1, marginBottom: spacing.sm },
  dutyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dutyName: { fontSize: 15, fontWeight: '600', color: palette.ink900 },
  dutySub: { fontSize: 12, color: palette.ink500, marginTop: 2 },
  empty: { fontSize: 13, color: palette.ink500 },
  doseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.cream100,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: palette.cream300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: { color: palette.white, fontSize: 16, fontWeight: '800' },
  doseTitle: { fontSize: 15, color: palette.ink900, fontWeight: '600' },
  doseGiven: { textDecorationLine: 'line-through', color: palette.ink500 },
  doseSub: { fontSize: 12, color: palette.ink500, marginTop: 2 },
  doseGiver: { fontSize: 11, color: palette.sage600, marginTop: 2 },
  apptRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  apptDate: {
    width: 50,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: palette.terracotta100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  apptDateDay: { fontSize: 20, fontWeight: '800', color: palette.terracotta700 },
  apptDateMonth: { fontSize: 10, color: palette.terracotta700, textTransform: 'uppercase' },
  apptProvider: { fontSize: 15, fontWeight: '600', color: palette.ink900 },
  apptSub: { fontSize: 12, color: palette.ink500, marginTop: 2 },
});
