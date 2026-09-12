import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';
import { HalmoniMark } from '@/components/halmoni-mark';
import { Checkbox } from '@/components/ui/checkbox';
import { ACCEPTANCE_LABEL, PRIVACY_URL, TERMS_URL } from '@/lib/terms';
import { recordTermsAcceptance } from '@/lib/terms-record';

export function LoginScreen() {
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Never starts ticked. A pre-ticked box is not an unambiguous act, which is
  // what both the clickwrap cases and Washington's consent definition want,
  // and ticking it for someone is the deceptive design the statute names.
  // Sign-in and sign-up are the same screen here, so a returning user sees it
  // too; the row it writes is per version, so re-accepting is not noise.
  const [accepted, setAccepted] = useState(false);
  const codeInputRef = useRef<TextInput | null>(null);

  async function sendCode() {
    const cleaned = email.trim();
    if (!cleaned) {
      setError('Enter your email to get a sign-in code.');
      return;
    }
    if (!accepted) {
      setError('Please agree to the Terms before continuing.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: cleaned,
      options: { shouldCreateUser: true },
    });
    if (error) {
      setError(error.message);
    } else {
      setStage('code');
      setNotice(`We sent a code to ${cleaned}. Check your inbox.`);
      setTimeout(() => codeInputRef.current?.focus(), 50);
    }
    setBusy(false);
  }

  async function verifyCode() {
    const token = code.trim();
    if (token.length < 6) {
      setError('Enter the code from your email.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      type: 'email',
    });
    if (error) {
      setError(error.message);
    } else if (data.user) {
      // Recorded after the code is verified, because that is the first moment
      // there is a user id to attach it to. Deliberately not awaited and never
      // fatal: a failure here must not stand between someone and their
      // mother's medication list, and the box is shown again next time.
      void recordTermsAcceptance(data.user.id);
    }
    setBusy(false);
  }

  function resetToEmail() {
    setStage('email');
    setCode('');
    setError(null);
    setNotice(null);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.container}>
          <HalmoniMark size={84} style={{ marginTop: 20 }} />
          <Text style={styles.title}>Halmoni</Text>
          <Text style={styles.subtitle}>
            {stage === 'email' ? 'Sign in to your account' : 'Enter the code we sent you'}
          </Text>

          {stage === 'email' && (
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor="#9AA5B1"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={sendCode}
              returnKeyType="send"
            />
          )}

          {stage === 'email' && (
            <View style={styles.terms}>
              <Checkbox checked={accepted} onChange={setAccepted} label={ACCEPTANCE_LABEL} />
              <View style={styles.termsLinks}>
                <Text style={styles.termsLink} onPress={() => Linking.openURL(TERMS_URL)}>
                  Terms
                </Text>
                <Text style={styles.termsDot}>·</Text>
                <Text style={styles.termsLink} onPress={() => Linking.openURL(PRIVACY_URL)}>
                  Privacy Policy
                </Text>
              </View>
            </View>
          )}

          {stage === 'code' && (
            <>
              <TextInput
                ref={codeInputRef}
                style={[styles.input, styles.codeInput]}
                placeholder="12345678"
                placeholderTextColor="#9AA5B1"
                autoCapitalize="none"
                autoComplete="one-time-code"
                autoCorrect={false}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                maxLength={8}
                value={code}
                onChangeText={setCode}
                onSubmitEditing={verifyCode}
                returnKeyType="go"
              />
              <Text style={styles.emailHint}>Code sent to {email.trim()}</Text>
            </>
          )}

          {error && <Text style={styles.error}>{error}</Text>}
          {notice && <Text style={styles.notice}>{notice}</Text>}

          <Pressable
            style={[styles.button, busy && styles.buttonDisabled]}
            disabled={busy}
            onPress={stage === 'email' ? sendCode : verifyCode}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {stage === 'email' ? 'Email me a code' : 'Verify and sign in'}
              </Text>
            )}
          </Pressable>

          {stage === 'code' && (
            <View style={styles.secondaryRow}>
              <Pressable disabled={busy} onPress={resetToEmail}>
                <Text style={styles.linkText}>Use a different email</Text>
              </Pressable>
              <Pressable disabled={busy} onPress={sendCode}>
                <Text style={styles.linkText}>Resend code</Text>
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 34, fontWeight: '800', color: '#111', textAlign: 'center' },
  subtitle: { fontSize: 16, color: '#555', textAlign: 'center', marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#D6E0EA',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111',
    backgroundColor: '#F7FAFC',
  },
  codeInput: {
    fontSize: 22,
    letterSpacing: 8,
    textAlign: 'center',
    fontWeight: '700',
  },
  emailHint: { color: '#6B7280', fontSize: 13, textAlign: 'center' },
  terms: { gap: 2 },
  termsLinks: { flexDirection: 'row', gap: 8, paddingLeft: 40 },
  termsLink: { color: '#208AEF', fontSize: 13, fontWeight: '600' },
  termsDot: { color: '#9AA5B1', fontSize: 13 },
  button: {
    backgroundColor: '#208AEF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  linkText: { color: '#208AEF', fontSize: 14, fontWeight: '600' },
  error: { color: '#B00020', fontSize: 14 },
  notice: { color: '#0B7A3B', fontSize: 14 },
});
