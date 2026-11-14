// send-invite — invite an email address to a project. See design/email-invites-and-notifications.md.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildInviteEmail } from './email.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
// from a secret, never from the request: an Origin header would let a caller point the link anywhere
const APP_URL = Deno.env.get('APP_URL') ?? 'http://localhost:5173';
const MAIL_FROM = Deno.env.get('MAIL_FROM') ?? 'Notevra <no-reply@farhanmullick.trade>';
const IS_LOCAL = SUPABASE_URL.startsWith('http://kong:');
const MAILPIT_URL = Deno.env.get('MAILPIT_URL') ?? 'http://inbucket:8025';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const REFUSALS: Record<string, number> = {
  bad_role: 400,
  bad_email: 400,
  not_admin: 403,
  already_member: 409,
  already_invited: 409,
  rate_limited: 429,
};

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

interface InviteResult {
  result: string;
  send?: boolean;
  workspace_name?: string;
  inviter_name?: string;
}

async function deliver(to: string, role: string, r: InviteResult): Promise<void> {
  const mail = buildInviteEmail({
    appUrl: APP_URL,
    to,
    inviterName: r.inviter_name ?? '',
    workspaceName: r.workspace_name ?? '',
    role,
  });
  try {
    let res: Response;
    if (RESEND_API_KEY) {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: MAIL_FROM, to: [to], subject: mail.subject, html: mail.html, text: mail.text }),
      });
    } else if (IS_LOCAL) {
      const [, name = 'Notevra', email = 'no-reply@notevra.local'] = MAIL_FROM.match(/^(.*?)\s*<(.+)>$/) ?? [];
      res = await fetch(`${MAILPIT_URL}/api/v1/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ From: { Email: email, Name: name }, To: [{ Email: to }], Subject: mail.subject, HTML: mail.html, Text: mail.text }),
      });
    } else {
      console.error('send-invite: RESEND_API_KEY is not set, invite email not sent');
      return;
    }
    if (!res.ok) console.error('send-invite: mail provider refused', res.status, await res.text());
  } catch (e) {
    console.error('send-invite: mail delivery failed', e);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply(405, { result: 'method_not_allowed' });

  const authHeader = req.headers.get('Authorization') ?? '';
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: who, error: authError } = await asCaller.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  if (authError || !who.user) return reply(401, { result: 'not_signed_in' });

  let body: { workspaceId?: unknown; email?: unknown; role?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply(400, { result: 'bad_request' });
  }
  const ws = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = typeof body.role === 'string' ? body.role : 'member';
  if (!ws || !email) return reply(400, { result: 'bad_request' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc('invite_by_email', {
    inviter: who.user.id,
    ws,
    address: email,
    member_role: role,
  });
  if (error) {
    console.error('send-invite: invite_by_email failed', error.message);
    return reply(500, { result: 'failed' });
  }

  const r = data as InviteResult;
  // a registered address is invited in-app, with no email
  if (r.result === 'invited') return reply(200, { result: 'invited' });
  if (r.result !== 'ok') return reply(REFUSALS[r.result] ?? 400, { result: r.result });

  // reply before the mail provider answers, so a slow provider never holds up the dialog
  if (r.send) {
    const job = deliver(email, role, r);
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(job);
    else await job;
  }
  return reply(200, { result: 'sent' });
});
