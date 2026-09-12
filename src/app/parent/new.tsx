// Adding a parent. Two steps, and the first one is not skippable.
//
// Until 2026-09-10 this screen went straight to the medical form: Halmoni would
// store a person's diagnoses, medications, insurance and emergency contacts
// without anyone ever being asked whether that person agreed to it. The word
// "consent" did not appear anywhere in src/. G1-28.
//
// The permission step is a step of THIS screen rather than a route of its own on
// purpose: a route can be deep-linked past, a step cannot. Two more layers
// enforce the same rule underneath — guardParentConsent() in the write path, and
// a CHECK constraint, a trigger and an RLS policy on the server.

import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { ChipInput } from '@/components/ui/chip-input';
import { Field, Input } from '@/components/ui/field';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/lib/auth';
import { Checkbox } from '@/components/ui/checkbox';
import type { ConsentBasis } from '@/lib/consent';
import {
  buildConsent,
  CONSENT_BASES,
  CONSENT_BASIS_COPY,
  CONSENT_NOTICE_VERSION,
  NO_AUTHORITY_ACKNOWLEDGEMENT,
  NOTICE_ARCHIVE,
} from '@/lib/consent';
import { useFamily } from '@/lib/family';
import { useMe } from '@/lib/me';
import { newId } from '@/lib/newid';
import { shareParentNotice } from '@/lib/parent-notice';
import { writeRow } from '@/lib/sync/write-path';
import { color, palette, radius, spacing, typography } from '@/lib/theme';
import { validateDob } from '@/lib/validate-dob';

type Step = 'permission' | 'details';

export default function AddParentScreen() {
  const { familyId } = useFamily();
  const { session } = useAuth();
  const { me } = useMe();

  const [step, setStep] = useState<Step>('permission');
  const [name, setName] = useState('');
  const [basis, setBasis] = useState<ConsentBasis | null>(null);
  const [sharingAgreed, setSharingAgreed] = useState(false);
  const [noAuthorityAck, setNoAuthorityAck] = useState(false);
  const [printing, setPrinting] = useState(false);

  // Changing the basis changes the words of both statements below it, so the
  // ticks that belonged to the old wording are cleared rather than carried
  // over to something the user never read.
  function chooseBasis(next: ConsentBasis) {
    setBasis(next);
    setSharingAgreed(false);
    setNoAuthorityAck(false);
  }

  const ready =
    !!name.trim() &&
    !!basis &&
    sharingAgreed &&
    (basis !== 'no_formal_authority' || noAuthorityAck);

  const [nickname, setNickname] = useState('');
  const [dob, setDob] = useState('');
  const [bloodType, setBloodType] = useState('');
  const [conditions, setConditions] = useState<string[]>([]);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [preferences, setPreferences] = useState('');
  const [saving, setSaving] = useState(false);

  async function printNotice() {
    if (!basis || !name.trim()) return;
    setPrinting(true);
    try {
      await shareParentNotice({
        parentName: name.trim(),
        basis,
        contactName: me?.name ?? null,
      });
    } catch (err) {
      Alert.alert('Could not make the notice', err instanceof Error ? err.message : String(err));
    } finally {
      setPrinting(false);
    }
  }

  async function save() {
    if (!familyId || !name.trim() || !basis || !ready) return;
    const userId = session?.user?.id;
    if (!userId) {
      Alert.alert(
        'Sign in first',
        'An attestation has to record who made it, and we could not tell who you are. Sign out and back in, then try again.',
      );
      return;
    }
    const dobError = validateDob(dob);
    if (dobError) {
      Alert.alert('Check the date of birth', dobError);
      return;
    }
    setSaving(true);
    try {
      await writeRow('parents', {
        id: newId(),
        family_id: familyId,
        name: name.trim(),
        nickname: nickname.trim() || name.trim(),
        dob: dob.trim() || null,
        blood_type: bloodType.trim() || null,
        conditions,
        allergies,
        preferences: preferences.trim() || null,
        ice_contacts: [],
        ...buildConsent(basis, sharingAgreed, userId),
        created_at: new Date().toISOString(),
      });
      router.back();
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (step === 'permission') {
    return (
      <Screen>
        <Text style={styles.heading}>Before you add them</Text>
        <Text style={styles.sub}>
          What goes in here is theirs — their medications, their diagnoses, their insurance.
          Halmoni keeps it for your family, so we need to know they are alright with that, or
          that you are the person entitled to decide for them.
        </Text>

        {/* The notice comes BEFORE the question, not after it. Until 09-11 this
            screen asked whether the parent had agreed, and only then offered to
            print the page describing what they would be agreeing to — which
            asks someone to attest to informed consent before the information
            exists. Same words as the printed sheet, from the same archive. */}
        <View style={styles.noticeBox}>
          <Text style={styles.noticeLabel}>WHAT THEY ARE BEING TOLD</Text>
          <Text style={styles.noticeHeading}>
            {NOTICE_ARCHIVE[CONSENT_NOTICE_VERSION].heading}
          </Text>
          {NOTICE_ARCHIVE[CONSENT_NOTICE_VERSION].paragraphs.map((p) => (
            <Text key={p.slice(0, 24)} style={styles.noticeBody}>
              {p}
            </Text>
          ))}
        </View>

        <Field label="Their full name" required>
          <Input value={name} onChangeText={setName} placeholder="Eleanor Park" autoFocus />
        </Field>

        <Text style={styles.question}>Which of these is true?</Text>
        <View style={styles.options}>
          {CONSENT_BASES.map((b) => {
            const selected = basis === b;
            return (
              <Pressable
                key={b}
                onPress={() => chooseBasis(b)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={CONSENT_BASIS_COPY[b].label}
                accessibilityHint={CONSENT_BASIS_COPY[b].attestation}
                style={[styles.option, selected && styles.optionSelected]}>
                <View style={[styles.dot, selected && styles.dotSelected]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionLabel}>{CONSENT_BASIS_COPY[b].label}</Text>
                  <Text style={styles.optionBody}>{CONSENT_BASIS_COPY[b].attestation}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Holding it and showing it to everyone else are two questions, and
            Washington wants the second answer separate from the first
            (RCW 19.373.030). It is also the one people are surprised by: the
            sibling who joins next month can read all of it. G1-32. */}
        {basis && (
          <View style={styles.second}>
            <Checkbox
              checked={sharingAgreed}
              onChange={setSharingAgreed}
              label="Everyone in the care circle will see it"
              description={CONSENT_BASIS_COPY[basis].sharing}
            />
            {basis === 'no_formal_authority' && (
              <Checkbox
                checked={noAuthorityAck}
                onChange={setNoAuthorityAck}
                label="I understand what this one means"
                description={NO_AUTHORITY_ACKNOWLEDGEMENT}
              />
            )}
          </View>
        )}

        <Text style={styles.fine}>
          We record which of these you chose and when, so that if anyone ever asks — them, an
          app store, a regulator — there is an answer. If none of them is true yet, have the
          conversation first. It is a two-minute conversation and it is theirs to have.
        </Text>

        <Button
          title="Print a notice for them"
          onPress={printNotice}
          variant="secondary"
          busy={printing}
          disabled={!basis || !name.trim()}
        />
        <Text style={styles.fine}>
          One page, large type: what Halmoni holds, who can see it, and how to have it deleted.
          Give it to them or read it aloud.
        </Text>

        <Button title="Continue" onPress={() => setStep('details')} disabled={!ready} />
        <Button title="Cancel" onPress={() => router.back()} variant="ghost" />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.heading}>About {name.trim()}</Text>
      <Text style={styles.sub}>Only the name was required. The rest can wait.</Text>

      <Field label="Nickname (what your family calls them)">
        <Input value={nickname} onChangeText={setNickname} placeholder="Mom" autoFocus />
      </Field>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field label="Date of birth">
            <Input value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Blood type">
            <Input value={bloodType} onChangeText={setBloodType} placeholder="O+" />
          </Field>
        </View>
      </View>

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

      <Field label="What to know about them">
        <Input
          value={preferences}
          onChangeText={setPreferences}
          placeholder="Personality, preferences, things to remember…"
          multiline
        />
      </Field>

      <Button title="Save parent" onPress={save} disabled={!name.trim()} busy={saving} />
      <Button title="Back" onPress={() => setStep('permission')} variant="secondary" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 22, fontWeight: '800', color: palette.ink900 },
  sub: { fontSize: 13, color: palette.ink500, marginTop: -spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md },
  question: { ...typography.bodyStrong, color: color.text, marginTop: spacing.xs },
  options: { gap: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: palette.cream200,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  optionSelected: { borderColor: color.confirm, backgroundColor: color.confirmTint },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: palette.cream300,
    marginTop: 2,
  },
  dotSelected: { borderColor: color.confirm, borderWidth: 6 },
  optionLabel: { ...typography.bodyStrong, color: color.text },
  optionBody: { ...typography.meta, color: color.textMuted, marginTop: 2 },
  fine: { ...typography.meta, color: color.textMuted },
  noticeBox: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: palette.cream200,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  noticeLabel: { ...typography.label, color: color.textMuted, textTransform: 'uppercase' },
  noticeHeading: { ...typography.bodyStrong, color: color.text },
  noticeBody: { ...typography.meta, color: color.textMuted },
  second: { gap: spacing.xs },
});
