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
}

/** Deliberate crash, for verifying what actually arrives (G1-07). */
export function sentryTestCrash(): void {
  Sentry.captureException(
    new Error('Halmoni scrubbing test — parent Elena Smith, id 30c30291-42eb-47cf-9fb6-1f0086d3cc71'),
  );
}
