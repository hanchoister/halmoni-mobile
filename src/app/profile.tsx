import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { Screen } from '@/components/ui/screen';
import { shareCareKit } from '@/lib/care-kit';
import { calcAge } from '@/lib/format';
import { useParents } from '@/lib/parent';
import { palette, radius, spacing } from '@/lib/theme';

// Spelled out rather than shown raw: "no" meaning "full code" is exactly the
// kind of ambiguity that must not exist on an emergency screen.
const DNR_LABEL: Record<string, string> = {
  unknown: 'Not known',
  no: 'Full code — resuscitate',
  yes: 'DNR — do not resuscitate',
  see_document: 'See advance directive',
};

export default function ProfileScreen() {
  const { parents, currentParent, setCurrentParentId } = useParents();
  const [exporting, setExporting] = useState(false);

  async function onShareCareKit() {
    if (!currentParent) return;
    setExporting(true);
    try {
      await shareCareKit(currentParent);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not generate the Care Kit.';
      Alert.alert('Care Kit failed', msg);
    } finally {
      setExporting(false);
    }
  }

  if (!currentParent) {
    return (
      <Screen>
        <EmptyState emoji="🌿" title="No parent yet" message="Add a parent to get started." />
        <Button title="Add a parent" onPress={() => router.push('/parent/new')} />
      </Screen>
    );
  }

  const age = calcAge(currentParent.dob);

  return (
    <Screen>
      <Card>
        <View style={styles.headerRow}>
          <Avatar
            name={currentParent.nickname || currentParent.name}
            color="terracotta"
            size={64}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{currentParent.name}</Text>
            <Text style={styles.sub}>
              {currentParent.nickname && `"${currentParent.nickname}"`}
              {age != null && ` · ${age} years old`}
              {currentParent.blood_type && ` · ${currentParent.blood_type}`}
            </Text>
            {currentParent.conditions.length > 0 && (
              <View style={styles.pillRow}>
                {currentParent.conditions.map((c) => (
                  <Pill key={c} label={c} tone="cream" />
                ))}
              </View>
            )}
          </View>
        </View>
      </Card>

      {currentParent.preferences && (
        <Card tint="cream">
          <Text style={styles.sectionLabel}>WHAT TO KNOW</Text>
          <Text style={styles.body}>{currentParent.preferences}</Text>
        </Card>
      )}

      {currentParent.allergies.length > 0 && (
        <Card>
          <Text style={styles.sectionLabel}>ALLERGIES</Text>
          <View style={styles.pillRow}>
            {currentParent.allergies.map((a) => (
              <Pill key={a} label={`⚠ ${a}`} tone="terracotta" />
            ))}
          </View>
        </Card>
      )}

      {(currentParent.dnr_status || currentParent.healthcare_proxy) && (
        <Card>
          <Text style={styles.sectionLabel}>ADVANCE WISHES</Text>
          {currentParent.dnr_status && (
            <View style={styles.wishRow}>
              <Text style={styles.wishLabel}>Resuscitation</Text>
              <Text
                style={[
                  styles.wishValue,
                  currentParent.dnr_status === 'yes' && styles.wishValueAlert,
                ]}>
                {DNR_LABEL[currentParent.dnr_status] ?? currentParent.dnr_status}
              </Text>
            </View>
          )}
          {currentParent.healthcare_proxy?.name && (
            <View style={styles.wishRow}>
              <Text style={styles.wishLabel}>Healthcare proxy</Text>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Text style={styles.wishValue}>
                  {currentParent.healthcare_proxy.name}
                  {currentParent.healthcare_proxy.relation
                    ? ` · ${currentParent.healthcare_proxy.relation}`
                    : ''}
                </Text>
                {currentParent.healthcare_proxy.phone ? (
                  <Pressable
                    onPress={() =>
                      Linking.openURL(`tel:${currentParent.healthcare_proxy!.phone}`)
                    }>
                    <Text style={styles.phoneLink}>
                      📞 {currentParent.healthcare_proxy.phone}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          )}
        </Card>
      )}

      {currentParent.ice_contacts.length > 0 && (
        <Card>
          <Text style={styles.sectionLabel}>IN CASE OF EMERGENCY</Text>
          {currentParent.ice_contacts.map((c, i) => (
            <Pressable
              key={i}
              onPress={() => Linking.openURL(`tel:${c.phone}`)}
              style={styles.iceRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.iceName}>{c.name}</Text>
                <Text style={styles.iceSub}>{c.relation}</Text>
              </View>
              <Text style={styles.phoneLink}>📞 {c.phone}</Text>
            </Pressable>
          ))}
        </Card>
      )}

      <View style={styles.row}>
        {currentParent.primary_doctor && (
          <Card style={{ flex: 1 }}>
            <Text style={styles.sectionLabel}>PRIMARY DOCTOR</Text>
            <Text style={styles.detailValue}>{currentParent.primary_doctor.name}</Text>
            <Pressable onPress={() => Linking.openURL(`tel:${currentParent.primary_doctor!.phone}`)}>
              <Text style={styles.phoneLink}>📞 {currentParent.primary_doctor.phone}</Text>
            </Pressable>
          </Card>
        )}
        {currentParent.pharmacy && (
          <Card style={{ flex: 1 }}>
            <Text style={styles.sectionLabel}>PHARMACY</Text>
            <Text style={styles.detailValue}>{currentParent.pharmacy.name}</Text>
            <Pressable onPress={() => Linking.openURL(`tel:${currentParent.pharmacy!.phone}`)}>
              <Text style={styles.phoneLink}>📞 {currentParent.pharmacy.phone}</Text>
            </Pressable>
          </Card>
        )}
      </View>

      {currentParent.insurance && (
        <Card>
          <Text style={styles.sectionLabel}>INSURANCE</Text>
          <Text style={styles.detailValue}>{currentParent.insurance.provider}</Text>
          {currentParent.insurance.planName && (
            <Text style={styles.sub}>{currentParent.insurance.planName}</Text>
          )}
          <Text style={[styles.sub, { marginTop: spacing.sm }]}>
            Member ID: <Text style={styles.mono}>{currentParent.insurance.memberId}</Text>
          </Text>
          {currentParent.insurance.groupId && (
            <Text style={styles.sub}>
              Group ID: <Text style={styles.mono}>{currentParent.insurance.groupId}</Text>
            </Text>
          )}
        </Card>
      )}

      {parents.length > 1 && (
        <Card>
          <Text style={styles.sectionLabel}>SWITCH PARENT</Text>
          {parents.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => setCurrentParentId(p.id)}
              style={[
                styles.switchRow,
                p.id === currentParent.id && styles.switchRowActive,
              ]}>
              <Avatar name={p.nickname || p.name} color="sage" size={32} />
              <Text style={styles.detailValue}>{p.nickname || p.name}</Text>
            </Pressable>
          ))}
        </Card>
      )}

      <Button
        title="🩺 Share Care Kit (PDF)"
        onPress={onShareCareKit}
        busy={exporting}
      />
      <Button
        title="Edit details"
        onPress={() => router.push(`/parent/edit/${currentParent.id}`)}
        variant="secondary"
      />
      <Button title="+ Add another parent" onPress={() => router.push('/parent/new')} variant="secondary" />
      <Button title="Account & sign out" onPress={() => router.push('/account')} variant="secondary" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wishRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: 6,
  },
  wishLabel: { fontSize: 13, color: palette.ink500 },
  wishValue: { fontSize: 13, fontWeight: '700', color: palette.ink900, textAlign: 'right' },
  wishValueAlert: { color: palette.terracotta500 },
  headerRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  name: { fontSize: 24, fontWeight: '800', color: palette.ink900 },
  sub: { fontSize: 13, color: palette.ink500, marginTop: 4 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.ink500,
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  body: { fontSize: 13, color: palette.ink900, lineHeight: 19 },
  row: { flexDirection: 'row', gap: spacing.md },
  iceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.cream100,
    gap: spacing.md,
  },
  iceName: { fontSize: 14, fontWeight: '600', color: palette.ink900 },
  iceSub: { fontSize: 12, color: palette.ink500 },
  phoneLink: { fontSize: 13, color: palette.sage600, fontWeight: '600' },
  detailValue: { fontSize: 14, fontWeight: '600', color: palette.ink900 },
  mono: { fontFamily: 'Courier' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  switchRowActive: { backgroundColor: palette.sage50 },
});
