import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth';
import { useFamily } from '@/lib/family';
import { supabase } from '@/lib/supabase';
import { syncOnce } from '@/lib/sync/engine';

// Joining a family hands you an empty local mirror. Opening the app before the
// first pull lands shows blank screens that look exactly like a brand-new
// family, so we hold the (busy) onboarding screen until the data is actually
// there. Best-effort: a sync failure must never trap someone who has genuinely
// joined, so the gate opens regardless.
async function warmMirror(): Promise<void> {
  try {
    await syncOnce();
  } catch {
    // Non-fatal — the periodic sync will fill the mirror shortly.
  }
}

type Mode = 'choose' | 'create' | 'join';
const COLORS = ['sage', 'terracotta', 'butter', 'ink'] as const;
type Color = (typeof COLORS)[number];

const COLOR_HEX: Record<Color, string> = {
  sage: '#7a9b8a',
  terracotta: '#d28a66',
  butter: '#f0d670',
  ink: '#4a4a4a',
};

export function OnboardingScreen() {
  const { session } = useAuth();
  const { refresh } = useFamily();
  const userEmail = session?.user?.email ?? '';
  const defaultName =
    (session?.user?.user_metadata?.full_name as string | undefined) ??
    (session?.user?.user_metadata?.name as string | undefined) ??
    userEmail.split('@')[0] ??
    '';

  const [mode, setMode] = useState<Mode>('choose');
  const [familyName, setFamilyName] = useState('');
  const [memberName, setMemberName] = useState(defaultName);
  const [color, setColor] = useState<Color>('sage');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitCreate() {
    if (!familyName.trim() || !memberName.trim()) {
      setError('Family name and your name are both required.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('create_family', {
      family_name: familyName.trim(),
      member_name: memberName.trim(),
      member_color: color,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await refresh();
  }

  async function submitJoin() {
    if (!code.trim() || !memberName.trim()) {
      setError('Invite code and your name are both required.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('accept_invite', {
      code_in: code.trim().toUpperCase(),
      member_name: memberName.trim(),
      member_color: color,
    });
    if (rpcError) {
      setBusy(false);
      setError(rpcError.message);
      return;
    }
    // Pull the family's records in before handing over, so the first screen
    // they see is their family rather than an empty one.
    await warmMirror();
    setBusy(false);
    await refresh();
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled">
          <Text style={styles.emoji}>👵</Text>
          <Text style={styles.title}>Welcome to Halmoni</Text>
          <Text style={styles.subtitle}>
            {mode === 'choose'
              ? "Let's get you set up with a family."
              : mode === 'create'
                ? 'Start a new family'
                : 'Join an existing family'}
          </Text>

          {mode === 'choose' && (
            <View style={styles.cardStack}>
              <Pressable style={styles.choiceCard} onPress={() => setMode('create')}>
                <View style={[styles.choiceIcon, { backgroundColor: '#dce6e0' }]}>
                  <Text style={[styles.choiceIconText, { color: '#3a4f44' }]}>👨‍👩‍👧</Text>
                </View>
                <View style={styles.choiceText}>
                  <Text style={styles.choiceTitle}>Start a new family</Text>
                  <Text style={styles.choiceHint}>
                    You&apos;ll be able to invite siblings after.
                  </Text>
                </View>
              </Pressable>

              <Pressable style={styles.choiceCard} onPress={() => setMode('join')}>
                <View style={[styles.choiceIcon, { backgroundColor: '#f5dfd4' }]}>
                  <Text style={[styles.choiceIconText, { color: '#7e4736' }]}>🔗</Text>
                </View>
                <View style={styles.choiceText}>
                  <Text style={styles.choiceTitle}>Join with an invite code</Text>
                  <Text style={styles.choiceHint}>A sibling sent you a code.</Text>
                </View>
              </Pressable>

              <Text style={styles.footerLine}>
                Signed in as {userEmail}.{' '}
                <Text style={styles.footerLink} onPress={signOut}>
                  Sign out
                </Text>
              </Text>
            </View>
          )}

          {(mode === 'create' || mode === 'join') && (
            <View style={styles.form}>
              {mode === 'create' ? (
                <Field label="FAMILY NAME" hint="e.g. The Choi family — only your siblings see this.">
                  <TextInput
                    style={styles.input}
                    value={familyName}
                    onChangeText={setFamilyName}
                    placeholder="The Choi family"
                    placeholderTextColor="#a8a8a8"
                    autoFocus
                  />
                </Field>
              ) : (
                <Field label="INVITE CODE" hint="A sibling sent you 8 characters.">
                  <TextInput
                    style={[styles.input, styles.codeInput]}
                    value={code}
                    onChangeText={(v) => setCode(v.toUpperCase())}
                    placeholder="A1B2C3D4"
                    placeholderTextColor="#a8a8a8"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={12}
                    autoFocus
                  />
                </Field>
              )}

              <Field label="YOUR NAME" hint="How siblings will see you.">
                <TextInput
                  style={styles.input}
                  value={memberName}
                  onChangeText={setMemberName}
                  placeholder="Sarah"
                  placeholderTextColor="#a8a8a8"
                />
              </Field>

              <Field label="YOUR COLOR" hint="A subtle visual tag in shared lists.">
                <View style={styles.colorRow}>
                  {COLORS.map((c) => (
                    <Pressable
                      key={c}
                      onPress={() => setColor(c)}
                      style={[
                        styles.colorSwatch,
                        { backgroundColor: COLOR_HEX[c] },
                        color === c && styles.colorSwatchSelected,
                      ]}
                      accessibilityLabel={c}
                    />
                  ))}
                </View>
              </Field>

              {error && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <View style={styles.buttonRow}>
                <Pressable
                  style={styles.ghostButton}
                  disabled={busy}
                  onPress={() => {
                    setMode('choose');
                    setError(null);
                  }}>
                  <Text style={styles.ghostButtonText}>Back</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryButton, busy && styles.buttonDisabled]}
                  disabled={busy}
                  onPress={mode === 'create' ? submitCreate : submitJoin}>
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>
                      {mode === 'create' ? 'Create family' : 'Join family'}
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {hint && <Text style={styles.fieldHint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fefcf8' },
  flex: { flex: 1 },
  scroll: { padding: 24, paddingTop: 32, gap: 16 },
  emoji: { fontSize: 56, textAlign: 'center' },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#2a2a2a',
    textAlign: 'center',
    marginTop: 4,
  },
  subtitle: {
    fontSize: 15,
    color: '#6f6f6f',
    textAlign: 'center',
    marginBottom: 8,
  },
  cardStack: { gap: 10 },
  choiceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#f3ebde',
    padding: 16,
  },
  choiceIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceIconText: { fontSize: 22 },
  choiceText: { flex: 1 },
  choiceTitle: { fontSize: 16, fontWeight: '600', color: '#2a2a2a' },
  choiceHint: { fontSize: 12, color: '#6f6f6f', marginTop: 2 },
  footerLine: {
    fontSize: 11,
    color: '#a8a8a8',
    textAlign: 'center',
    marginTop: 8,
  },
  footerLink: { color: '#6f6f6f', textDecorationLine: 'underline' },
  form: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#f3ebde',
    padding: 18,
    gap: 14,
  },
  field: { gap: 4 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6f6f6f',
    letterSpacing: 1,
  },
  fieldHint: { fontSize: 11, color: '#a8a8a8' },
  input: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#f3ebde',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: '#2a2a2a',
  },
  codeInput: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 4,
    textTransform: 'uppercase',
  },
  colorRow: { flexDirection: 'row', gap: 12, marginTop: 6 },
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorSwatchSelected: {
    borderColor: '#2a2a2a',
    transform: [{ scale: 1.1 }],
  },
  errorBox: {
    backgroundColor: '#fbf3ef',
    borderWidth: 1,
    borderColor: '#f5dfd4',
    borderRadius: 12,
    padding: 10,
  },
  errorText: { color: '#7e4736', fontSize: 13 },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  ghostButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostButtonText: { color: '#6f6f6f', fontSize: 15, fontWeight: '600' },
  primaryButton: {
    flex: 1,
    backgroundColor: '#208AEF',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  buttonDisabled: { opacity: 0.6 },
});
