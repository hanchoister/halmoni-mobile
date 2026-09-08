// `expo-env.d.ts` carries this same reference, but the Expo CLI generates that
// file at dev-server start and its own template says to git-ignore it — so it
// does not exist on a fresh CI checkout. Without it nothing declares `*.css`,
// and TypeScript 6 rejects the side-effect `import '@/global.css'` in
// src/constants/theme.ts with TS2882 (TS 5.9 let unresolved side-effect
// imports through silently, which is why this only surfaced after the SDK 57
// upgrade). Checking the reference in here keeps CI and a local checkout
// typechecking the same code.
/// <reference types="expo/types" />
