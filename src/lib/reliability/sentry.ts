import * as Sentry from '@sentry/react-native';

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

/** Anything that looks like a value rather than a shape. */
function stripQuery(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : `${url.slice(0, q)}?[filtered]`;
}

/** UUIDs identify rows, and a row id plus a table name is a pointer to a person. */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

function redact(text: string): string {
  return text.replace(UUID_RE, '[id]').replace(EMAIL_RE, '[email]');
}

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

    beforeBreadcrumb(breadcrumb) {
      // Console breadcrumbs are the single most likely carrier: anything the
      // app ever logged about a parent or a medication ends up here.
      if (breadcrumb.category === 'console') return null;

      if (
        breadcrumb.category === 'http' ||
        breadcrumb.category === 'fetch' ||
        breadcrumb.category === 'xhr'
      ) {
        const url = breadcrumb.data?.url;
        if (typeof url === 'string') {
          breadcrumb.data = { ...breadcrumb.data, url: redact(stripQuery(url)) };
        }
        // The body is never worth keeping — it is the record itself.
        if (breadcrumb.data) {
          delete (breadcrumb.data as Record<string, unknown>).body;
          delete (breadcrumb.data as Record<string, unknown>).response;
        }
      }

      if (breadcrumb.message) breadcrumb.message = redact(breadcrumb.message);
      return breadcrumb;
    },

    beforeSend(event) {
      // Request bodies, headers and cookies: drop wholesale.
      delete event.request;
      // `extra` and `contexts.state` are where component state gets attached,
      // and component state here is the care record.
      delete event.extra;
      if (event.contexts) delete (event.contexts as Record<string, unknown>).state;
      // Identify the install, never the person.
      if (event.user) event.user = { id: event.user.id };

      if (event.message) event.message = redact(event.message);
      event.exception?.values?.forEach((v) => {
        if (v.value) v.value = redact(v.value);
      });
      return event;
    },
  });
}

/** Deliberate crash, for verifying what actually arrives (G1-07). */
export function sentryTestCrash(): void {
  Sentry.captureException(
    new Error('Halmoni scrubbing test — parent Elena Smith, id 30c30291-42eb-47cf-9fb6-1f0086d3cc71'),
  );
}
