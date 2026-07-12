export const palette = {
  cream50: '#fefcf8',
  cream100: '#faf6f0',
  cream200: '#f3ebde',
  cream300: '#e8dcc7',
  sage50: '#f3f6f4',
  sage100: '#dce6e0',
  sage200: '#b9ccc1',
  sage300: '#94b1a3',
  sage400: '#7a9b8a',
  sage500: '#5e7e6e',
  sage600: '#4a6557',
  sage700: '#3a4f44',
  terracotta50: '#fbf3ef',
  terracotta100: '#f5dfd4',
  terracotta200: '#ecbfa9',
  terracotta300: '#e0a081',
  terracotta400: '#d28a66',
  terracotta500: '#c97b63',
  terracotta600: '#a85f48',
  terracotta700: '#7e4736',
  ink300: '#a8a8a8',
  ink500: '#6f6f6f',
  ink700: '#4a4a4a',
  ink900: '#2a2a2a',
  butter100: '#fdf6dd',
  butter200: '#f8e9a8',
  butter300: '#f0d670',
  white: '#ffffff',
} as const;

export type MemberColor = 'sage' | 'terracotta' | 'butter' | 'ink';

export const memberColorHex: Record<MemberColor, string> = {
  sage: palette.sage400,
  terracotta: palette.terracotta400,
  butter: palette.butter300,
  ink: palette.ink700,
};

export const memberColorSoft: Record<MemberColor, string> = {
  sage: palette.sage100,
  terracotta: palette.terracotta100,
  butter: palette.butter100,
  ink: '#e5e5e5',
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
  md: 12,
  lg: 14,
  xl: 18,
  pill: 999,
} as const;

export const fontFamily = {
  serif: undefined as string | undefined,
  sans: undefined as string | undefined,
};
