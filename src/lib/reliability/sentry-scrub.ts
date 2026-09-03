/**
 * The scrubbing rules, kept free of any React Native import so they can be run
 * and asserted on directly. G1-07 asks for verification, and a rule you cannot
 * execute in a test is a rule you are trusting rather than checking.
 *
 * Rule: send the shape of a failure, never its contents.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- these mirror Sentry's own
   loose payload types; narrowing them here would just force casts at the call site. */
export type Breadcrumbish = {
  category?: string;
  message?: string;
  data?: Record<string, any>;
};

export type Eventish = {
  message?: string;
  request?: any;
  extra?: any;
  contexts?: Record<string, any>;
  user?: Record<string, any>;
  exception?: { values?: { value?: string }[] };
};

/** PostgREST puts filter values in the query string: `?name=eq.Elena`. */
export function stripQuery(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : `${url.slice(0, q)}?[filtered]`;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

/**
 * Free text is unscrubbable, so it is not sent.
 *
 * Redacting ids and emails is not enough: an Error message is arbitrary text,
 * and `new Error('Donepezil dose for Elena failed')` carries a medication and a
 * parent's name past every pattern you can write. A verification run caught
 * exactly that — "Elena" and "Donepezil" survived the first version of these
 * rules.
 *
 * So messages are replaced wholesale. What survives is the error class and the
 * stack trace, which are code rather than data, and which are the part that
 * actually tells you where a crash happened.
 */
export const MESSAGE_REMOVED = '[message removed — see stack trace]';

/** A row id plus a table name is a pointer to a person. */
export function redact(text: string): string {
  return text.replace(UUID_RE, '[id]').replace(EMAIL_RE, '[email]');
}

export function scrubBreadcrumb<T extends Breadcrumbish>(b: T): T | null {
  // Console output is the likeliest carrier of anything the app logged.
  if (b.category === 'console') return null;

  if (b.category === 'http' || b.category === 'fetch' || b.category === 'xhr') {
    const url = b.data?.url;
    if (typeof url === 'string') {
      b.data = { ...b.data, url: redact(stripQuery(url)) };
    }
    if (b.data) {
      delete (b.data as Record<string, unknown>).body;
      delete (b.data as Record<string, unknown>).response;
    }
  }
  // Breadcrumb messages are free text too — a navigation label can be a name.
  if (b.message) b.message = b.category === 'navigation' ? redact(b.message) : MESSAGE_REMOVED;
  return b;
}

export function scrubEvent<T extends Eventish>(e: T): T {
  delete e.request; // bodies, headers, cookies
  delete e.extra; // where component state gets attached
  if (e.contexts) delete e.contexts.state;
  // Identify the install, never the person: keep id, drop email/ip/username.
  if (e.user) {
    for (const k of Object.keys(e.user)) if (k !== 'id') delete e.user[k];
  }
  if (e.message) e.message = MESSAGE_REMOVED;
  e.exception?.values?.forEach((v) => {
    if (v.value) v.value = MESSAGE_REMOVED;
  });
  return e;
}
