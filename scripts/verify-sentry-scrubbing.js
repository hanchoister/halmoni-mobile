// Verification for G1-07. Compile the scrub module, then assert that a
// worst-case event carrying a parent's name, a medication, an email, a UUID, an
// IP, a cookie and a PostgREST filter emerges with none of them.
//
//   npx tsc src/lib/reliability/sentry-scrub.ts --outDir /tmp/scrub \
//     --module commonjs --target es2020 --skipLibCheck && \
//     node scripts/verify-sentry-scrubbing.js /tmp/scrub/sentry-scrub.js
//
// The first run of this caught a real leak: ids and emails were scrubbed, but
// "Elena" and "Donepezil" survived inside the Error message. Free text is now
// dropped entirely.
// require() resolves a relative path against this file, not the working
// directory, so resolve it explicitly against cwd.
const path = require('path');
const target = path.resolve(process.cwd(), process.argv[2] || '.scrub-build/sentry-scrub.js');
const { scrubEvent, scrubBreadcrumb } = require(target);

// A realistic worst case: everything this app must never send.
const event = {
  type: 'error',
  message: 'Failed for Elena Smith (elena@example.com) id 30c30291-42eb-47cf-9fb6-1f0086d3cc71',
  request: { url: 'https://x.supabase.co/rest/v1/parents?name=eq.Elena', headers: { cookie: 'sb=abc' } },
  extra: { parent: { name: 'Elena Smith', conditions: ['Type 2 diabetes'] } },
  contexts: { state: { meds: ['Donepezil', 'Lisinopril'] }, device: { model: 'iPhone' } },
  user: { id: 'install-123', email: 'sofia@example.com', ip_address: '203.0.113.9' },
  exception: { values: [{ value: 'Donepezil dose for 30c30291-42eb-47cf-9fb6-1f0086d3cc71 failed' }] },
};
const crumbs = [
  { category: 'console', message: 'parent Elena Smith conditions Type 2 diabetes' },
  { category: 'fetch', data: { url: 'https://x.supabase.co/rest/v1/med_doses?given_by=eq.30c30291-42eb-47cf-9fb6-1f0086d3cc71', body: '{"name":"Elena"}', response: '{"dose":"5mg"}' } },
  { category: 'navigation', message: 'to /medication/30c30291-42eb-47cf-9fb6-1f0086d3cc71' },
];

const outEvent = scrubEvent(JSON.parse(JSON.stringify(event)));
const outCrumbs = crumbs.map((c) => scrubBreadcrumb(JSON.parse(JSON.stringify(c))));
const blob = JSON.stringify({ outEvent, outCrumbs });

const leaks = [];
for (const needle of ['Elena', 'elena@example.com', 'sofia@example.com', 'Donepezil', 'Lisinopril',
                      'Type 2 diabetes', '30c30291-42eb-47cf-9fb6-1f0086d3cc71', '203.0.113.9',
                      'sb=abc', 'name=eq', '5mg']) {
  if (blob.includes(needle)) leaks.push(needle);
}
console.log('--- WHAT WOULD BE SENT ---');
console.log(JSON.stringify({ outEvent, outCrumbs }, null, 1).slice(0, 900));
console.log('\n--- LEAK CHECK ---');
console.log(leaks.length === 0 ? 'PASS: none of the 11 sensitive values survived' : 'FAIL: ' + leaks.join(', '));
process.exit(leaks.length === 0 ? 0 : 1);
