import * as Sentry from '@sentry/react-native';

import { scrubBreadcrumb, scrubEvent } from '@/lib/reliability/sentry-scrub';

/**
 * Crash reporting, configured so a crash report cannot carry health data.
 *
 * The threat is specific. A React Native crash report will, by default, take
 * breadcrumbs with it: console output, navigation, and every HTTP request the
 * app made. In Halmoni those breadcrumbs contain a parent's name, their
 * medications and their diagnoses — PostgREST puts filter values straight into
 * the query string (`?name=eq.Elena`), so a URL alone is enough to leak. Once
 * an event reaches Sentry it is on someone else's servers and cannot be
 * recalled.
 *
 * So the rule this file enforces is: send the shape of the failure, never its
 * contents. Stack traces yes; values no.
 */

export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return; // No DSN configured: stay silent rather than half-initialise.

  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',

    // Never attach the user's IP, cookies or headers.
    sendDefaultPii: false,
    // A screenshot of a care screen is a picture of someone's medical record.
    attachScreenshot: false,
    // The view hierarchy carries rendered text, which is the same problem.
    attachViewHierarchy: false,
    // Stack traces are shape, not content — these are the useful part.
    attachStacktrace: true,

    // Performance tracing is off. Transaction names in this app are route
    // names carrying row ids, and the value does not justify the surface.
    tracesSampleRate: 0,

    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),

    beforeSend: (event) => scrubEvent(event),
  });

  reportTimezoneCapability();
}

/**
 * Say out loud, once per launch, if this runtime cannot resolve IANA zones.
 *
 * G2-27 gave every medication schedule the zone its wall-clock times are
 * written in, so an 08:00 dose entered in New York is 08:00 for a sibling in
 * California. All of that rests on `Intl.DateTimeFormat` accepting a
 * `timeZone`, and Hermes gets its zone data from the platform rather than from
 * JavaScript, so this is a property of the device and not of the code.
 *
 * The fallback is deliberately safe — an unresolvable zone reverts to the
 * reader's own clock rather than throwing. But that fallback IS the original
 * bug: doses quietly an hour or three out, on a medication reminder, with
 * nothing on fire. Node resolves zones perfectly, so the test suite and CI can
 * never catch it; only a real device can, and only if it tells someone.
 *
 * Hence a message rather than a silent degrade. It carries a zone name and a
 * boolean — no health data, nothing about a family — so it is safe under the
 * same rule as everything else in this file: the shape of the failure, never
 * its contents.
 */
function reportTimezoneCapability(): void {
  let resolves = false;
  let deviceZone = 'unknown';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York' }).format(new Date(0));
    resolves = true;
    deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown';
  } catch {
    resolves = false;
  }

  if (resolves) {
    // Useful context on any other crash, and not worth an event of its own.
    Sentry.setTag('tz.resolves', 'true');
    Sentry.setTag('tz.device', deviceZone);
    return;
  }

  Sentry.setTag('tz.resolves', 'false');
  Sentry.captureMessage(
    'Intl timezones unavailable: medication times fall back to this device\'s clock (G2-27)',
    'warning',
  );
}

/** Deliberate crash, for verifying what actually arrives (G1-07). */
export function sentryTestCrash(): void {
  Sentry.captureException(
    new Error('Halmoni scrubbing test — parent Elena Smith, id 30c30291-42eb-47cf-9fb6-1f0086d3cc71'),
  );
}
