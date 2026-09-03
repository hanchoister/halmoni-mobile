import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette, radius, spacing } from '@/lib/theme';
import { HalmoniMark } from '@/components/halmoni-mark';

type Props = {
  /**
   * Omitted in release builds, which hides the demo entry point entirely.
   * A tester who wandered into demo mode would log doses, see them appear, and
   * reasonably conclude the app works — while nothing was saved or shared with
   * their family. For a care app that is a worse outcome than not offering a
   * demo at all.
   */
  onTryDemo?: () => void;
  onLogIn: () => void;
};

export function WelcomeScreen({ onTryDemo, onLogIn }: Props) {
  // With no demo on offer, signing in IS the primary action and should look it.
  const loginIsPrimary = !onTryDemo;
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.hero}>
          <HalmoniMark size={96} />
          <Text style={styles.title}>Halmoni</Text>
          <Text style={styles.tagline}>Share the load. Care for your parent — together.</Text>
        </View>

        <View style={styles.bulletList}>
          <Text style={styles.bullet}>
            <Text style={styles.bulletEmoji}>💊 </Text>
            <Text style={styles.bulletText}>
              Track meds, doses, and refills in one place your siblings can see.
            </Text>
          </Text>
          <Text style={styles.bullet}>
            <Text style={styles.bulletEmoji}>🩺 </Text>
            <Text style={styles.bulletText}>
              Capture doctor visits — diagnoses, new meds, follow-ups — so nothing gets lost.
            </Text>
          </Text>
          <Text style={styles.bullet}>
            <Text style={styles.bulletEmoji}>🔄 </Text>
            <Text style={styles.bulletText}>
              Hand off the mental load when you need a break.
            </Text>
          </Text>
          <Text style={styles.bullet}>
            <Text style={styles.bulletEmoji}>👀 </Text>
            <Text style={styles.bulletText}>
              Spot side effects and missed refills before they become emergencies.
            </Text>
          </Text>
        </View>

        <View style={styles.actions}>
          {onTryDemo ? (
            <Pressable
              onPress={onTryDemo}
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}>
              <Text style={styles.primaryBtnText}>See the live demo</Text>
              <Text style={styles.primaryBtnSub}>
                Explore with the sample Smith family — nothing you do is saved.
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={onLogIn}
            style={({ pressed }) => [
              loginIsPrimary ? styles.primaryBtn : styles.secondaryBtn,
              pressed && styles.pressed,
            ]}>
            <Text style={loginIsPrimary ? styles.primaryBtnText : styles.secondaryBtnText}>
              Log in / create account
            </Text>
            <Text style={loginIsPrimary ? styles.primaryBtnSub : styles.secondaryBtnSub}>
              Use Halmoni for your own family.
            </Text>
          </Pressable>
        </View>

        <Text style={styles.footer}>Built by Hana Choi · halmoni.app</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.cream50 },
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    justifyContent: 'space-between',
  },
  hero: { alignItems: 'center', marginTop: spacing.xxxl },
  title: {
    fontSize: 40,
    fontWeight: '800',
    color: palette.ink900,
    marginTop: spacing.md,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 16,
    color: palette.ink500,
    marginTop: spacing.sm,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: spacing.md,
  },
  bulletList: { gap: spacing.md, paddingHorizontal: spacing.sm },
  bullet: { fontSize: 15, lineHeight: 22 },
  bulletEmoji: { fontSize: 15 },
  bulletText: { color: palette.ink700 },
  actions: { gap: spacing.md },
  primaryBtn: {
    backgroundColor: palette.sage500,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  primaryBtnText: { color: palette.white, fontSize: 17, fontWeight: '700' },
  primaryBtnSub: {
    color: palette.sage100,
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  secondaryBtn: {
    backgroundColor: palette.white,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.cream300,
  },
  secondaryBtnText: { color: palette.ink900, fontSize: 17, fontWeight: '700' },
  secondaryBtnSub: {
    color: palette.ink500,
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  pressed: { opacity: 0.85 },
  footer: {
    fontSize: 11,
    color: palette.ink500,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
});
