// Editing a parent. This screen did not exist until 2026-09-01: parent/new was
// the only code path that ever wrote a `parents` row, so every medical detail
// was write-once on mobile. That was survivable while the web app could still
// edit them, and became a hole the moment Halmoni went mobile-only.
//
// Includes dnr_status and healthcare_proxy, which the mirror previously pulled
// from the server and threw away for want of a column to store them in.

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { ChipInput } from '@/components/ui/chip-input';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input } from '@/components/ui/field';
import { RepeatableRows } from '@/components/ui/repeatable-rows';
import { Screen } from '@/components/ui/screen';
import type { DnrStatus, IceContact } from '@/lib/parent';
import { useParents } from '@/lib/parent';
import { writeRow } from '@/lib/sync/write-path';
import { palette, radius, spacing } from '@/lib/theme';
import { validateDob } from '@/lib/validate-dob';

// Advance-care fields — resuscitation preference and healthcare proxy — are
// hidden for now. The first users are siblings coordinating a parent's
// day-to-day care, and asking them to record a DNR status is heavy and
// premature for that relationship.
//
// Revisit when expanding to professional caregivers and senior-care facilities,
// where these are routine intake fields rather than a difficult family
// conversation.
//
// Deliberately a flag rather than a deletion: the columns, the sync, the save
// path and the profile display all stay wired, so re-enabling is this one line.
// Values already set (e.g. from the web app) still show on the profile and are
// preserved on save.
const SHOW_ADVANCE_CARE_FIELDS = false;

const DNR_OPTIONS: { value: DnrStatus; label: string }[] = [
  { value: 'unknown', label: 'Not known' },
  { value: 'no', label: 'Full code' },
  { value: 'yes', label: 'DNR' },
  { value: 'see_document', label: 'See document' },
];

export default function EditParentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { parents } = useParents();
  const parent = parents.find((p) => p.id === id) ?? null;

  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [dob, setDob] = useState('');
  const [bloodType, setBloodType] = useState('');
  const [conditions, setConditions] = useState<string[]>([]);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [preferences, setPreferences] = useState('');
  const [dnr, setDnr] = useState<DnrStatus>('unknown');
  const [proxyName, setProxyName] = useState('');
  const [proxyPhone, setProxyPhone] = useState('');
  const [proxyRelation, setProxyRelation] = useState('');
  const [ice, setIce] = useState<IceContact[]>([]);
  const [pharmacyName, setPharmacyName] = useState('');
  const [pharmacyPhone, setPharmacyPhone] = useState('');
  const [pharmacyAddress, setPharmacyAddress] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [doctorPhone, setDoctorPhone] = useState('');
  const [insProvider, setInsProvider] = useState('');
  const [insMemberId, setInsMemberId] = useState('');
  const [insGroupId, setInsGroupId] = useState('');
  const [insPlanName, setInsPlanName] = useState('');
  const [insPhone, setInsPhone] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!parent) return;
    setName(parent.name ?? '');
    setNickname(parent.nickname ?? '');
    setDob(parent.dob ?? '');
    setBloodType(parent.blood_type ?? '');
    setConditions(parent.conditions ?? []);
    setAllergies(parent.allergies ?? []);
    setPreferences(parent.preferences ?? '');
    setDnr(parent.dnr_status ?? 'unknown');
    setProxyName(parent.healthcare_proxy?.name ?? '');
    setProxyPhone(parent.healthcare_proxy?.phone ?? '');
    setProxyRelation(parent.healthcare_proxy?.relation ?? '');
    setIce(parent.ice_contacts ?? []);
    setPharmacyName(parent.pharmacy?.name ?? '');
    setPharmacyPhone(parent.pharmacy?.phone ?? '');
    setPharmacyAddress(parent.pharmacy?.address ?? '');
    setDoctorName(parent.primary_doctor?.name ?? '');
    setDoctorPhone(parent.primary_doctor?.phone ?? '');
    setInsProvider(parent.insurance?.provider ?? '');
    setInsMemberId(parent.insurance?.memberId ?? '');
    setInsGroupId(parent.insurance?.groupId ?? '');
    setInsPlanName(parent.insurance?.planName ?? '');
    setInsPhone(parent.insurance?.phone ?? '');
  }, [parent]);

  if (!parent) {
    return (
      <Screen>
        <EmptyState emoji="🌿" title="Not found" message="That parent no longer exists." />
        <Button title="Back" onPress={() => router.back()} variant="secondary" />
      </Screen>
    );
  }

  async function save() {
    if (!parent || !name.trim()) return;
    const dobError = validateDob(dob);
    if (dobError) {
      Alert.alert('Check the date of birth', dobError);
      return;
    }
    setSaving(true);
    try {
      // A proxy is only meaningful with a name — storing a phone number with
      // nobody attached to it would be worse than storing nothing.
      const proxy = proxyName.trim()
        ? {
            name: proxyName.trim(),
            phone: proxyPhone.trim(),
            relation: proxyRelation.trim(),
          }
        : null;

      await writeRow('parents', {
        ...parent,
        name: name.trim(),
        nickname: nickname.trim() || name.trim(),
        dob: dob.trim() || null,
        blood_type: bloodType.trim() || null,
        conditions,
        allergies,
        preferences: preferences.trim() || null,
        // When the section is hidden these keys are omitted entirely, so the
        // spread above preserves whatever is already stored instead of
        // flattening a real value to the form's default.
        ...(SHOW_ADVANCE_CARE_FIELDS
          ? { dnr_status: dnr, healthcare_proxy: proxy }
          : {}),
        // Same rule throughout: a record with no name is noise, not data. Drop
        // half-filled rows rather than storing a phone number attached to
        // nobody — on an emergency screen that is worse than a blank.
        ice_contacts: ice.filter((c) => c.name.trim()).map((c) => ({
          name: c.name.trim(),
          relation: c.relation.trim(),
          phone: c.phone.trim(),
        })),
        pharmacy: pharmacyName.trim()
          ? {
              name: pharmacyName.trim(),
              phone: pharmacyPhone.trim(),
              ...(pharmacyAddress.trim() ? { address: pharmacyAddress.trim() } : {}),
            }
          : null,
        primary_doctor: doctorName.trim()
          ? { name: doctorName.trim(), phone: doctorPhone.trim() }
          : null,
        insurance: insProvider.trim()
          ? {
              provider: insProvider.trim(),
              memberId: insMemberId.trim(),
              ...(insGroupId.trim() ? { groupId: insGroupId.trim() } : {}),
              ...(insPlanName.trim() ? { planName: insPlanName.trim() } : {}),
              ...(insPhone.trim() ? { phone: insPhone.trim() } : {}),
            }
          : null,
      });
      router.back();
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.heading}>Edit details</Text>
      <Text style={styles.sub}>Everything here is shared with your family.</Text>

      <Field label="Full name" required>
        <Input value={name} onChangeText={setName} placeholder="Eleanor Park" />
      </Field>
      <Field label="Goes by">
        <Input value={nickname} onChangeText={setNickname} placeholder="Mom" />
      </Field>
      <Field label="Date of birth">
        <Input value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" />
      </Field>
      <Field label="Blood type">
        <Input value={bloodType} onChangeText={setBloodType} placeholder="O+" />
      </Field>
      <ChipInput
        label="Conditions"
        placeholder="Add a condition and press enter"
        chips={conditions}
        setChips={setConditions}
      />
      <ChipInput
        label="Allergies"
        placeholder="Add an allergy and press enter"
        chips={allergies}
        setChips={setAllergies}
      />
      <Field label="Preferences">
        <Input
          value={preferences}
          onChangeText={setPreferences}
          placeholder="Anything a stand-in should know."
          multiline
        />
      </Field>

      {SHOW_ADVANCE_CARE_FIELDS && (
        <>
      <Text style={styles.sectionLabel}>IN AN EMERGENCY</Text>
      <Text style={styles.sub}>
        Shown first on the emergency card. Leave as &ldquo;Not known&rdquo; rather than
        guessing — a wrong answer here is worse than no answer.
      </Text>

      <Field label="Resuscitation">
        <View style={styles.dnrRow}>
          {DNR_OPTIONS.map((o) => (
            <Pressable
              key={o.value}
              onPress={() => setDnr(o.value)}
              style={[styles.dnrPill, dnr === o.value && styles.dnrPillActive]}>
              <Text style={[styles.dnrText, dnr === o.value && styles.dnrTextActive]}>
                {o.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Field>

      <Field label="Healthcare proxy — name">
        <Input value={proxyName} onChangeText={setProxyName} placeholder="Who decides for her" />
      </Field>
      <Field label="Healthcare proxy — phone">
        <Input
          value={proxyPhone}
          onChangeText={setProxyPhone}
          placeholder="+44 …"
          keyboardType="phone-pad"
        />
      </Field>
      <Field label="Healthcare proxy — relation">
        <Input value={proxyRelation} onChangeText={setProxyRelation} placeholder="Daughter" />
      </Field>
        </>
      )}

      <RepeatableRows<IceContact>
        label="Emergency contacts"
        hint="Who to call first. Shown on the emergency card, in this order."
        rows={ice}
        setRows={setIce}
        blank={() => ({ name: '', relation: '', phone: '' })}
        addLabel="+ Add a contact"
        renderRow={(row, update) => (
          <>
            <Input
              value={row.name}
              onChangeText={(v) => update({ ...row, name: v })}
              placeholder="Name"
            />
            <Input
              value={row.relation}
              onChangeText={(v) => update({ ...row, relation: v })}
              placeholder="Relation (daughter, neighbour…)"
            />
            <Input
              value={row.phone}
              onChangeText={(v) => update({ ...row, phone: v })}
              placeholder="Phone"
              keyboardType="phone-pad"
            />
          </>
        )}
      />

      <Text style={styles.sectionLabel}>PHARMACY</Text>
      <Field label="Name">
        <Input value={pharmacyName} onChangeText={setPharmacyName} placeholder="Boots, High St" />
      </Field>
      <Field label="Phone">
        <Input
          value={pharmacyPhone}
          onChangeText={setPharmacyPhone}
          placeholder="Phone"
          keyboardType="phone-pad"
        />
      </Field>
      <Field label="Address">
        <Input value={pharmacyAddress} onChangeText={setPharmacyAddress} placeholder="Optional" />
      </Field>

      <Text style={styles.sectionLabel}>PRIMARY DOCTOR</Text>
      <Field label="Name">
        <Input value={doctorName} onChangeText={setDoctorName} placeholder="Dr Okafor" />
      </Field>
      <Field label="Phone">
        <Input
          value={doctorPhone}
          onChangeText={setDoctorPhone}
          placeholder="Phone"
          keyboardType="phone-pad"
        />
      </Field>

      <Text style={styles.sectionLabel}>INSURANCE</Text>
      <Field label="Provider">
        <Input value={insProvider} onChangeText={setInsProvider} placeholder="Provider name" />
      </Field>
      <Field label="Member ID">
        <Input value={insMemberId} onChangeText={setInsMemberId} placeholder="Member ID" />
      </Field>
      <Field label="Group ID">
        <Input value={insGroupId} onChangeText={setInsGroupId} placeholder="Optional" />
      </Field>
      <Field label="Plan name">
        <Input value={insPlanName} onChangeText={setInsPlanName} placeholder="Optional" />
      </Field>
      <Field label="Phone">
        <Input
          value={insPhone}
          onChangeText={setInsPhone}
          placeholder="Optional"
          keyboardType="phone-pad"
        />
      </Field>

      <Button title="Save" onPress={save} busy={saving} disabled={!name.trim()} />
      <Button title="Cancel" onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 24, fontWeight: '700', color: palette.ink900 },
  sub: { fontSize: 13, color: palette.ink500, marginBottom: spacing.sm },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.ink500,
    letterSpacing: 1,
    marginTop: spacing.md,
  },
  dnrRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dnrPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: palette.cream100,
  },
  dnrPillActive: { backgroundColor: palette.sage500 },
  dnrText: { fontSize: 13, color: palette.ink700 },
  dnrTextActive: { color: palette.white, fontWeight: '700' },
});
