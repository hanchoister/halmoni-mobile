import { Platform, TextStyle } from 'react-native';

/**
 * Design tokens — "Dusk": A's spine (a saturated hero block, states said
 * outright, one filled action per screen) in C's voice (cream ground, serif
 * display, terracotta asks / sage confirms).
 *
 * `palette` keeps every key it has ever had, so the 37 files that import it
 * pick up the new look without being edited. New work should reach for the
 * semantic `color`, `typography` and `shadow` tokens below instead — a raw palette
 * key does not say what it is for, and `ink500` vs `ink700` is not a decision
 * anyone should be making per component.
 */
export const palette = {
  // Cream — the ground. Never pure white; white is reserved for cards, so
  // that a card reads as lifted without needing a border.
  cream50: '#faf7f1',
  cream100: '#f5f0e7',
  cream200: '#ede4d6',
  cream300: '#ddd1c0',
  // Sage — the anchor. sage700 is the hero block; sage500 confirms.
  sage50: '#eaefea',
  sage100: '#dce4dd',
  sage200: '#b9ccc1',
  sage300: '#94b1a3',
  sage400: '#7a9b8a',
  sage500: '#56766a',
  sage600: '#46604f',
  sage700: '#3a4f44',
  // Terracotta — asks for you. terracotta500 is the working accent and is
  // contrast-checked for body text and for white-on-fill; terracotta400 is
  // lighter and is for display type and decoration only.
  terracotta50: '#fbf3ef',
  terracotta100: '#f3e3d6',
  terracotta200: '#ecbfa9',
  terracotta300: '#e0a081',
  terracotta400: '#c2724f',
  terracotta500: '#a0563f',
  terracotta600: '#8a4a30',
  terracotta700: '#7e4736',
  // Ink — warm greys, not neutral ones. ink900 is near-black; the old #2a2a2a
  // sat too close to the background for anything to feel like a heading.
  ink300: '#a79c90',
  ink500: '#736a5f',
  ink700: '#5c5349',
  ink900: '#1e1c1a',
  butter100: '#fbf4df',
  butter200: '#f8e9a8',
  butter300: '#f0d670',
  white: '#ffffff',
} as const;

/**
 * Semantic tokens. Prefer these.
 *
 * Contrast, measured against `bg` (#faf7f1): textMuted 4.97:1, text 15.4:1,
 * accent 5.05:1, and white-on-accent 5.38:1 — all clear of WCAG AA for body
 * text. `accentDisplay` is 3.4:1 and is therefore only safe above ~24px;
 * `textFaint` is decorative. Re-check these if you change a value.
 */
export const color = {
  bg: palette.cream50,
  surface: palette.white,
  surfaceAlt: palette.cream100,
  hairline: 'rgba(30, 28, 26, 0.06)',

  hero: palette.sage700,
  onHero: '#f4efe6',
  onHeroDim: 'rgba(244, 239, 230, 0.62)',
  onHeroFaint: 'rgba(244, 239, 230, 0.5)',
  heroWell: 'rgba(244, 239, 230, 0.12)',
  onHeroAccent: '#e8a98c',

  text: palette.ink900,
  textMuted: palette.ink500,
  textFaint: palette.ink300,
  onFill: palette.white,

  accent: palette.terracotta500,
  accentDisplay: palette.terracotta400,
  accentSoft: palette.terracotta100,
  onAccentSoft: palette.terracotta700,

  confirm: palette.sage500,
  /** A pill sits ON a tinted card, so the two tints must differ or the pill
   *  disappears into it — confirmTint is the surface, confirmSoft the pill. */
  confirmTint: palette.sage50,
  confirmSoft: palette.sage100,
  onConfirmSoft: palette.sage700,

  warn: palette.butter300,
  warnSoft: palette.butter100,
} as const;

export type MemberColor = 'sage' | 'terracotta' | 'butter' | 'ink';

export const memberColorHex: Record<MemberColor, string> = {
  sage: palette.sage400,
  terracotta: palette.terracotta300,
  butter: palette.butter300,
  ink: palette.ink700,
};

export const memberColorSoft: Record<MemberColor, string> = {
  sage: palette.sage100,
  terracotta: palette.terracotta100,
  butter: palette.butter100,
  ink: palette.cream200,
};

export const memberColorOnSoft: Record<MemberColor, string> = {
  sage: palette.sage700,
  terracotta: palette.terracotta700,
  butter: '#6b5b18',
  ink: palette.ink900,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 18,
  xl: 22,
  hero: 28,
  pill: 999,
} as const;

/**
 * The faces loaded by `useFonts` in app/_layout.tsx. They were already being
 * loaded — and blocking the first render — but nothing referenced them, so
 * every glyph in the app was drawn in the system face. These names are the
 * link that was missing.
 *
 * On native a custom family carries its own weight: set `fontFamily` and
 * leave `fontWeight` alone, or Android synthesises a second, wrong bold.
 */
export const fontFamily = {
  serif: 'InstrumentSerif_400Regular',
  serifItalic: 'InstrumentSerif_400Regular_Italic',
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemi: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }) as string,
} as const;

/**
 * The type scale. Seven steps, and components pick one — sizes are no longer
 * chosen per component, which is why nothing used to line up.
 *
 * `display` is the serif: use it for anything that speaks to the reader
 * ("How's Mom today?", a finding, a screen title). Everything functional is
 * Inter.
 */
export const typography = {
  display: {
    fontFamily: fontFamily.serif,
    fontSize: 30,
    lineHeight: 34,
  },
  displaySm: {
    fontFamily: fontFamily.serif,
    fontSize: 21,
    lineHeight: 26,
  },
  title: {
    fontFamily: fontFamily.sansSemi,
    fontSize: 19,
    lineHeight: 24,
    letterSpacing: -0.4,
  },
  bodyStrong: {
    fontFamily: fontFamily.sansSemi,
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.15,
  },
  body: {
    fontFamily: fontFamily.sans,
    fontSize: 15,
    lineHeight: 21,
  },
  meta: {
    fontFamily: fontFamily.sans,
    fontSize: 13,
    lineHeight: 18,
  },
  label: {
    fontFamily: fontFamily.sansBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.3,
  },
} as const satisfies Record<string, TextStyle>;

/**
 * Cards lift off the cream instead of being outlined. The old 1px cream
 * hairline on a cream ground is the single detail that dated the interface
 * most; `card` replaces it with a two-layer shadow plus a hairline at 6%,
 * which reads as depth on both a bright screen and a dim one.
 */
export const shadow = {
  card: Platform.select({
    ios: {
      shadowColor: '#1e1c1a',
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 5 },
    },
    default: { elevation: 2 },
  }),
  hero: Platform.select({
    ios: {
      shadowColor: '#1e1c1a',
      shadowOpacity: 0.1,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
    },
    default: { elevation: 5 },
  }),
} as const;
