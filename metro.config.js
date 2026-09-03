// Expo's default Metro config, plus `.wasm` as a resolvable asset.
//
// expo-sqlite's web worker imports `./wa-sqlite/wa-sqlite.wasm` directly. The
// file ships in the package, but Metro will not resolve an extension that is
// not in assetExts, so a web export fails with "Unable to resolve module
// ./wa-sqlite/wa-sqlite.wasm". Native builds are unaffected — they never touch
// the web worker — but this file is read by every build, so keep it additive.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

module.exports = config;
