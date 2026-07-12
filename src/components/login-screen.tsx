import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';

export function LoginScreen() {
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const codeInputRef = useRef<TextInput | null>(null);

  async function sendCode() {
    const cleaned = email.trim();
    if (!cleaned) {
      setError('Enter your email to get a sign-in code.');
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
      setNotice(`We sent a 6-digit code to ${cleaned}. Check your inbox.`);
      setTimeout(() => codeInputRef.current?.focus(), 50);
    }
    setBusy(false);
  }

  async function verifyCode() {
    const token = code.trim();
    if (token.length < 6) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      type: 'email',
    });
    if (error) {
      setError(error.message);
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
          <Text style={styles.emoji}>👵</Text>
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

          {stage === 'code' && (
            <>
              <TextInput
                ref={codeInputRef}
                style={[styles.input, styles.codeInput]}
                placeholder="123456"
                placeholderTextColor="#9AA5B1"
                autoCapitalize="none"
                autoComplete="one-time-code"
                autoCorrect={false}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                maxLength={6}
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
  emoji: { fontSize: 56, textAlign: 'center' },
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
