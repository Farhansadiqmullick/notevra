#!/usr/bin/env node
// Five local accounts across the three roles, so responsibilities can be checked by signing in as each.
// LOCAL ONLY — it writes plaintext dev passwords into public.dev_accounts and refuses a non-local API.
//   npm run db:seed:users        (requires: npm run db:start)
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const API = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321';
const PSQL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// the fixed demo key every local stack ships with — the same one supabase/tests/sync-scenarios.sh uses
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const PASSWORD = 'devpass123';
const PROJECT = 'Kernel Labs';

// fixed, not minted: a second run must find this project rather than create another one beside it
const WS = '5eed0000-0000-4000-8000-000000000001';
const NOTE = '5eed0000-0000-4000-8000-000000000002';
const BLOCKS = [
  ['5eed0000-0000-4000-8000-000000000003', 'Ship the scheduler'],
  ['5eed0000-0000-4000-8000-000000000004', 'Write the RFC'],
  ['5eed0000-0000-4000-8000-000000000005', 'Review the migration'],
];

// @example.com on purpose: scripts/gen-seed.mjs skips that domain, so these never become the seeded account
const ACCOUNTS = [
  { email: 'admin@example.com', name: 'Ada Admin', role: 'admin' },
  { email: 'member1@example.com', name: 'Mira Member', role: 'member' },
  { email: 'member2@example.com', name: 'Milo Member', role: 'member' },
  { email: 'guest@example.com', name: 'Gus Guest', role: 'guest' },
  // the control case: in no space at all, so "a stranger sees nothing" has something to compare against
  { email: 'outsider@example.com', name: 'Otto Outsider', role: null },
];

const die = (msg) => {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
};

// a hosted project would get plaintext passwords in a table and five real accounts; refuse outright
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(API)) {
  die(`REFUSING TO RUN against ${API}.\n  This seeder is local-only: it stores plaintext passwords.`);
}

function psql(sql) {
  try {
    return execFileSync('psql', [PSQL_URL, '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-c', sql], {
      encoding: 'utf8',
      env: { ...process.env, PGPASSWORD: 'postgres' },
    }).trim();
  } catch (e) {
    if (e.code === 'ENOENT') die('psql is not on PATH. Install the Postgres client tools.');
    die(`Could not reach the local database. Is it running?\n  Try: npm run db:start\n\n  ${e.message}`);
  }
}

const lit = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);

async function api(path, { method = 'POST', token, body, prefer } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      apikey: ANON,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { ok: res.ok, status: res.status, json };
}

// signup is idempotent by way of the fallback: an existing account just logs in
async function ensureAccount(email) {
  const cred = { email, password: PASSWORD };
  await api('/auth/v1/signup', { body: cred });
  const { ok, json } = await api('/auth/v1/token?grant_type=password', { body: cred });
  if (!ok) die(`Could not sign in as ${email}: ${JSON.stringify(json)}`);
  return { id: json.user.id, token: json.access_token };
}

console.log(`\n  Seeding five dev accounts against ${API}\n`);

const people = [];
for (const a of ACCOUNTS) {
  const { id, token } = await ensureAccount(a.email);
  // each account writes its OWN profile row — the only thing the profiles policy allows
  const { ok, json } = await api('/rest/v1/profiles', {
    token,
    prefer: 'resolution=merge-duplicates',
    body: { user_id: id, display_name: a.name, updated_at: new Date().toISOString() },
  });
  if (!ok) die(`Could not write ${a.email}'s profile: ${JSON.stringify(json)}`);
  people.push({ ...a, id, token });
  console.log(`  · ${a.email.padEnd(22)} ${a.name}`);
}

const admin = people.find((p) => p.role === 'admin');

// one shared project, pushed through sync_push rather than inserted — the same path the browser takes
if (psql(`select 1 from public.workspaces where id = ${lit(WS)};`)) {
  console.log(`\n  ${PROJECT} already here — left as it is`);
} else {
  const push = await api('/rest/v1/rpc/sync_push', {
    token: admin.token,
    body: {
      device: 'seeder',
      ops: [
        { id: randomUUID(), entity: 'workspace', entityId: WS, type: 'CreateWorkspace', version: 1, payload: { name: PROJECT, kind: 'shared' } },
        { id: randomUUID(), entity: 'note', entityId: NOTE, type: 'CreateNote', version: 1, payload: { workspace_id: WS, title: 'Sync engine spec', type: 'planning' } },
        ...BLOCKS.map(([id, text], i) => ({
          id: randomUUID(), entity: 'block', entityId: id, type: 'CreateBlock', version: 1,
          // parent_block explicitly null: a payload that omits it lands as `undefined` on the client
          payload: { note_id: NOTE, type: 'task', text, position: i + 1, parent_block: null },
        })),
      ],
    },
  });
  if (!push.ok) die(`sync_push failed: ${JSON.stringify(push.json)}`);
  const bad = (push.json ?? []).filter((o) => o.status !== 'ack');
  if (bad.length) die(`sync_push did not ack everything: ${JSON.stringify(bad)}`);

  // sync_push writes id/owner_id/name/version only, so `kind` stays at its 'personal' default
  psql(`update public.workspaces set kind = 'shared' where id = ${lit(WS)};`);
  console.log(`\n  ${PROJECT} created by ${admin.email} — 1 page, ${BLOCKS.length} tasks`);
}

// added by the admin over HTTP, which also proves workspace_members_write actually permits it
for (const p of people.filter((p) => p.role && p.role !== 'admin')) {
  const { ok, json } = await api('/rest/v1/workspace_members', {
    token: admin.token,
    prefer: 'resolution=merge-duplicates',
    body: { workspace_id: WS, user_id: p.id, role: p.role, membership: 'active', invited_by: admin.id },
  });
  if (!ok) die(`Could not add ${p.email} as ${p.role}: ${JSON.stringify(json)}`);
  console.log(`  · ${p.email.padEnd(22)} joined as ${p.role}`);
}

// the outsider gets a PENDING invitation rather than membership, so the accept/decline prompt has
// something to draw the moment you sign in as him
const outsider = people.find((p) => !p.role);
if (outsider) {
  const { json } = await api('/rest/v1/rpc/share_workspace', {
    token: admin.token,
    body: { ws: WS, member_name: outsider.name, member_role: 'member' },
  });
  console.log(`  · ${outsider.email.padEnd(22)} invited (pending) — ${json}`);
}

// no grants and RLS on, so this is reachable through psql and Studio only, never through PostgREST
psql(`
  create table if not exists public.dev_accounts (
    email        text primary key,
    password     text not null,
    display_name text not null,
    role         text,
    user_id      uuid not null references auth.users (id) on delete cascade,
    workspace_id text,
    seeded_at    timestamptz not null default now()
  );
  alter table public.dev_accounts enable row level security;
  revoke all on public.dev_accounts from anon, authenticated;
`);

const rows = people
  .map((p) => `(${lit(p.email)}, ${lit(PASSWORD)}, ${lit(p.name)}, ${lit(p.role)}, ${lit(p.id)}, ${lit(p.role ? WS : null)})`)
  .join(',\n    ');

psql(`
  insert into public.dev_accounts (email, password, display_name, role, user_id, workspace_id)
  values
    ${rows}
  on conflict (email) do update set
    password = excluded.password, display_name = excluded.display_name, role = excluded.role,
    user_id = excluded.user_id, workspace_id = excluded.workspace_id, seeded_at = now();
`);

console.log(`\n  Credentials are in public.dev_accounts — every password is "${PASSWORD}".`);
console.log(`  Read them:  psql "${PSQL_URL}" -c 'table public.dev_accounts'`);
console.log(`  Or Studio:  http://127.0.0.1:54323\n`);
console.log(`  Sign in and out in the app to switch between them. A reset drops all of this —`);
console.log(`  run this again after every "npm run db:reset".\n`);
