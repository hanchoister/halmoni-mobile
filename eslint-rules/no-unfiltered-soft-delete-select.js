/**
 * Every synced table is soft-deleted: rows carry `deleted_at` and are never
 * removed. `repository.list()` filters them out, but a direct
 * `supabase.from(...).select(...)` does not, so deleted rows come back looking
 * live. Three of these shipped and only one was caught, by eye, in a PDF.
 *
 * This rule fails the build on a read of a soft-deleted table that does not
 * also filter `deleted_at`. Reads that genuinely want tombstones — the sync
 * pull is the only one — opt out with an eslint-disable comment saying why.
 */
'use strict';

// The 12 tables in src/lib/db/schema.ts. Every one has a deleted_at column.
const SOFT_DELETED = new Set([
  'families', 'family_members', 'parents', 'medications', 'med_doses',
  'appointments', 'visit_notes', 'symptoms', 'handoffs', 'on_duty',
  'thread_messages', 'notes',
]);

/** Walk up a fluent chain from `.from()`, collecting the calls made on it. */
function chainCalls(fromCall) {
  const calls = [];
  let node = fromCall;
  while (
    node.parent &&
    node.parent.type === 'MemberExpression' &&
    node.parent.object === node &&
    node.parent.parent &&
    node.parent.parent.type === 'CallExpression'
  ) {
    const call = node.parent.parent;
    calls.push({ name: node.parent.property.name, args: call.arguments });
    node = call;
  }
  return calls;
}

const isDeletedAtFilter = (c) =>
  c.name === 'is' &&
  c.args.length >= 1 &&
  c.args[0].type === 'Literal' &&
  c.args[0].value === 'deleted_at';

module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Require a deleted_at filter when selecting from a soft-deleted table' },
    schema: [],
    messages: {
      missing:
        "Reading '{{table}}' without .is('deleted_at', null) — soft-deleted rows will be returned as live. " +
        'Add the filter, use repository.list(), or disable this rule with a comment explaining why tombstones are wanted.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.property.name !== 'from') return;
        // Skip supabase.storage.from(bucket) — buckets are not tables.
        if (
          callee.object.type === 'MemberExpression' &&
          callee.object.property.name === 'storage'
        ) return;

        const arg = node.arguments[0];
        if (!arg || arg.type !== 'Literal' || !SOFT_DELETED.has(arg.value)) return;

        const calls = chainCalls(node);
        if (!calls.some((c) => c.name === 'select')) return;
        if (calls.some(isDeletedAtFilter)) return;

        context.report({ node, messageId: 'missing', data: { table: arg.value } });
      },
    };
  },
};
