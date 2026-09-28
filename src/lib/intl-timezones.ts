/**
 * Carry our own timezone database, so dose times never depend on the phone.
 *
 * G2-27 gave every medication schedule the IANA zone its wall-clock times are
 * written in, so an 08:00 dose entered in New York reads 08:00 to a sibling in
 * California — and, less visibly but more importantly, so every device derives
 * the same dose ids instead of minting a second parallel set of doses.
 *
 * All of that rested on `Intl.DateTimeFormat` accepting a `timeZone`. On React
 * Native that is not a property of our code: Hermes takes its zone data from
 * the platform (NSDateFormatter on iOS, android.icu on Android), so support
 * varies by OS version and by how the binary was built. Node resolves zones
 * perfectly, which is exactly why the test suite and CI could never tell us.
 *
 * The fallback in dose-plan.ts is safe — an unresolvable zone reverts to the
 * reader's own clock rather than throwing — but that fallback IS the original
 * bug: medication reminders quietly hours out, with nothing on fire. Detecting
 * it was the previous answer. Removing the dependency is the better one.
 *
 * So this module installs the FormatJS polyfill with the full IANA database
 * bundled. After it runs, zone resolution is a property of our bundle and
 * behaves identically on every device, every OS version, and in CI.
 *
 * `add-all-tz` rather than `add-golden-tz`, deliberately. Golden is about
 * 500KB smaller and covers the common zones, but it omits
 * `America/Indiana/Indianapolis` — and a medication app that gets Indiana
 * wrong is not a saving, it is a bug with a smaller bundle. The US alone has
 * zones that trip people up (Arizona does not observe DST; Indiana has county
 * splits), and this app ships in the US.
 *
 * `polyfill-force` rather than `polyfill`, also deliberately. The conditional
 * version only patches runtimes it believes are broken, which would leave us
 * with two behaviours in the field and the harder class of bug: one that
 * reproduces on some phones. Forcing it means every device agrees.
 *
 * MUST be imported before anything that touches Intl — it is the first import
 * in `src/app/_layout.tsx` for that reason. `initSentry()` reads Intl at module
 * scope to report zone capability, so ordering here is not academic.
 */

import { getCalendars } from 'expo-localization';

import '@formatjs/intl-datetimeformat/polyfill-force.js';
import '@formatjs/intl-datetimeformat/locale-data/en.js';
import '@formatjs/intl-datetimeformat/add-all-tz.js';

/**
 * Tell the polyfill which zone this device is in.
 *
 * It ships the world's zone data but has no idea which one it is standing in,
 * and its default is UTC — which would quietly put every reader an offset away
 * from the truth, the same shape of bug in a new costume.
 *
 * The device zone is read through `expo-localization`, which asks the operating
 * system directly, rather than through `Intl`. That is not fussiness about
 * style: `polyfill-force` has already replaced `Intl.DateTimeFormat` by the
 * time this line runs, so asking Intl would return the polyfill's UTC default
 * and we would confidently set the zone to the value we were trying to
 * discover. Reading the OS is the only source that is still independent.
 */
const setDefaultTimeZone = (
  Intl.DateTimeFormat as unknown as { __setDefaultTimeZone?: (tz: string) => void }
).__setDefaultTimeZone;

if (typeof setDefaultTimeZone === 'function') {
  try {
    const zone = getCalendars()[0]?.timeZone;
    if (zone) setDefaultTimeZone(zone);
  } catch {
    // Leave the polyfill's UTC default. dose-plan's zoneSupported() and the
    // diagnostics TIME card both still report what actually happened, so this
    // degrades to visible rather than silent.
  }
}
