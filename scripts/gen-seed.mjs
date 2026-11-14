/**
 * gen-seed.mjs — write `supabase/seed.sql` from the account that is live in the local database.
 *
 *   npm run db:seed                    # the one non-test account in the database
 *   npm run db:seed -- you@example.com # or name it, when there is more than one
 *
 * WHY THIS EXISTS. `supabase db reset` drops and recreates the whole database, `auth.users`
 * included, and it has to be run every time a migration changes. Without a seed, every reset
 * silently deletes the account you have been testing with: you sign up again, get a NEW user id,
 * and any local IndexedDB rows or queued sync operations pointing at the old id are orphaned.
 *
 * `supabase/config.toml` already points at the file this writes:
 *     [db.seed]
 *     sql_paths = ["./seed.sql"]
 * so the output runs automatically at the end of every reset. Nothing else needs invoking.
 *
 * ── IT COPIES THE HASH, NOT A PASSWORD ──────────────────────────────────────────────────────────
 * `encrypted_password` is a bcrypt hash. It is one-way — it cannot be turned back into a password,
 * which is why GoTrue stores it rather than the password. Restoring the hash restores the login, so
 * the same password keeps working after a reset and never has to be written down anywhere. This
 * script therefore never asks for, prints, or needs to know the password.
 *
 * ── THE OUTPUT IS GITIGNORED, AND MUST STAY THAT WAY ────────────────────────────────────────────
 * A hash is not plaintext, but it is still a credential: in a repo it can be brute-forced offline,
 * at leisure, with no rate limit and no lockout. It is also a real email address. `seed.sql` is
 * excluded in `supabase/.gitignore`; `supabase/seed.sql.example` is the committed template. This
 * script refuses to write if the ignore rule has gone missing, because a credential committed once
 * is in the history forever.
 *
 * ── RUN IT AGAIN WHEN THE PASSWORD CHANGES ──────────────────────────────────────────────────────
 * Otherwise the next reset restores the OLD hash and the new password stops working — which is a
 * genuinely confusing thing to debug, since nothing about it says "stale seed".
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'supabase', 'seed.sql');

/** The local stack's fixed demo connection — identical on every machine, not a secret. */
const PSQL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Field separator: a unit separator, which cannot appear in an email, a hash or compact JSON. */
const SEP = '\x1f';

const die = (msg) => {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
};

function psql(sql) {
  try {
    return execFileSync('psql', [PSQL_URL, '-t', '-A', '-F', SEP, '-c', sql], {
      encoding: 'utf8',
      env: { ...process.env, PGPASSWORD: 'postgres' },
    }).trim();
  } catch (e) {
    if (e.code === 'ENOENT') die('psql is not on PATH. Install the Postgres client tools.');
    die(`Could not reach the local database. Is it running?\n  Try: npm run db:start\n\n  ${e.message}`);
  }
}

/* --- refuse to write a credential into a tracked file ----------------------------------------- */

try {
  execFileSync('git', ['check-ignore', '-q', 'supabase/seed.sql'], { cwd: ROOT, stdio: 'ignore' });
} catch {
  die(
    'REFUSING TO WRITE: supabase/seed.sql is not gitignored.\n' +
      '  This file holds a real email and a bcrypt password hash, and a credential committed once\n' +
      '  stays in the history forever. Add `seed.sql` to supabase/.gitignore and run this again.',
  );
}

/* --- find the account ------------------------------------------------------------------------- */

const wanted = process.argv[2];

// `@example.com` is what every test in this repo signs up with, so those are excluded by default —
// seeding a throwaway account from an e2e run back into every future reset would be worse than
// seeding nothing at all.
const filter = wanted
  ? `u.email = ${lit(wanted)}`
  : `u.email not like '%@example.com'`;

const rows = psql(`
  select u.id, u.email, u.encrypted_password,
         u.raw_app_meta_data::text, u.raw_user_meta_data::text,
         i.id, i.identity_data::text
    from auth.users u
    join auth.identities i on i.user_id = u.id and i.provider = 'email'
   where ${filter}
   order by u.created_at;
`);

if (!rows) {
  die(
    wanted
      ? `No account with an email identity for ${wanted}.`
      : 'No account to seed.\n' +
          '  Sign up in the app first, then run this again.\n' +
          '  (Test accounts ending @example.com are ignored on purpose.)',
  );
}

const lines = rows.split('\n');
if (lines.length > 1) {
  const found = lines.map((l) => `    ${l.split(SEP)[1]}`).join('\n');
  die(`More than one account here. Name the one to seed:\n\n${found}\n\n  npm run db:seed -- <email>`);
}

const [uid, email, pw, appMeta, userMeta, identityId, identityData] = lines[0].split(SEP);

/* --- render ----------------------------------------------------------------------------------- */

/** A single-quoted SQL literal. Doubling the quote is the whole of the escaping Postgres needs. */
function lit(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

const sql = `\
-- GENERATED by scripts/gen-seed.mjs — re-run \`npm run db:seed\` to refresh.
-- Written ${new Date().toISOString()}
--
-- Recreates the developer account after \`supabase db reset\`, which drops the whole database,
-- \`auth.users\` included, every time a migration changes. \`[db.seed]\` in supabase/config.toml
-- points here, so this runs automatically at the end of every reset.
--
-- THE PASSWORD: \`encrypted_password\` below is a bcrypt HASH, not a password. It is one-way and
-- cannot be reversed — restoring it restores the login, so the same password keeps working and
-- never has to be written down. Re-run this script if the password changes, or the next reset puts
-- the old hash back and the new password stops working.
--
-- NEVER COMMIT THIS FILE. A hash is still a credential: in a repo it can be brute-forced offline
-- with no rate limit and no lockout, and this also carries a real email address. It is excluded in
-- supabase/.gitignore; supabase/seed.sql.example is the committed template.
--
-- LOCAL ONLY. \`supabase db push\` applies supabase/migrations/; seeds are not migrations, so this
-- never reaches a hosted project.

begin;

-- The account.
--
-- The id is FIXED, deliberately. \`workspaces.owner_id\` points at it, so pinning it means a reset
-- gives back the SAME account rather than a new one wearing the same email — local rows and queued
-- operations that reference it stay valid instead of becoming orphans.
--
-- \`confirmed_at\` is omitted on purpose: it is GENERATED ALWAYS from \`email_confirmed_at\` in this
-- version of GoTrue, and writing to it is an error rather than a no-op.
insert into auth.users (
  instance_id, id, aud, role,
  email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, last_sign_in_at,
  is_sso_user, is_anonymous,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, phone_change, phone_change_token
) values (
  '00000000-0000-0000-0000-000000000000',
  ${lit(uid)},
  'authenticated',
  'authenticated',
  ${lit(email)},
  ${lit(pw)},
  -- confirmed up front. \`enable_confirmations\` is false locally, but setting this means the seeded
  -- account still works unchanged the day it is switched on to test the confirmation flow.
  now(),
  ${lit(appMeta)},
  ${lit(userMeta)},
  now(), now(), now(),
  false, false,

  -- EMPTY STRINGS, NOT NULL. This looks like pointless noise and it is the whole difference between
  -- an account that logs in and one that does not.
  --
  -- These columns are nullable in the schema, so leaving them out is accepted without complaint and
  -- the row looks perfect in psql and in Studio. But GoTrue scans them into plain Go \`string\`s,
  -- which cannot hold NULL, so the scan fails on every read of the user — surfacing as
  --   {"code":500,"error_code":"unexpected_failure","msg":"Database error querying schema"}
  -- from /token, naming no column, no row, and no file.
  --
  -- A real signup writes '' in all eight, which is why an API-created account works and a
  -- hand-written one silently does not.
  '', '', '', '',
  '', '', '', ''
)
on conflict (id) do nothing;   -- idempotent: may meet a database that already has the row

-- The identity row. Easy to miss, and login fails without it.
--
-- GoTrue resolves a password login through \`auth.identities\`, not by scanning \`auth.users\`. An
-- account with a user row and no identity row exists, appears in Studio, and rejects the CORRECT
-- password with "Invalid login credentials" — which reads exactly like a typo and sends you looking
-- in the wrong place entirely.
--
-- For the email provider, \`provider_id\` is the user id as text.
insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at
) values (
  ${lit(identityId)},
  ${lit(uid)},
  ${lit(uid)},
  'email',
  ${lit(identityData)},
  now(), now(), now()
)
on conflict (id) do nothing;

commit;
`;

writeFileSync(OUT, sql);

// The email is echoed so you can see WHICH account was captured; the hash never is.
const masked = email.replace(/^(.{3}).*(@.*)$/, '$1***$2');
console.log(`\n  Wrote supabase/seed.sql for ${masked}`);
console.log(`  user id ${uid} (pinned — a reset returns the same account)`);
console.log(`  Password unchanged: the bcrypt hash was copied, not the password.`);
console.log(`  Gitignored. Re-run this after any password change.\n`);
