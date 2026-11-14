// Pure email building, no Deno or npm imports, so vitest can test it from src/.

export interface InviteEmailInput {
  appUrl: string;
  to: string;
  inviterName: string;
  workspaceName: string;
  role: string;
}

export interface InviteEmail {
  subject: string;
  html: string;
  text: string;
  link: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Names are typed by users, so they're flattened to one plain line before going into a subject.
function oneLine(s: string, max = 80): string {
  const flat = s.replace(/[\r\n\t]+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function inviteLink(appUrl: string, to: string): string {
  const base = appUrl.replace(/\/+$/, '');
  return `${base}/?invite=signup&email=${encodeURIComponent(to)}`;
}

export function buildInviteEmail(o: InviteEmailInput): InviteEmail {
  const inviter = oneLine(o.inviterName) || 'Someone';
  const project = oneLine(o.workspaceName) || 'a project';
  const link = inviteLink(o.appUrl, o.to);
  const base = o.appUrl.replace(/\/+$/, '');
  const action = 'Create your account';
  const next = `Create a Notevra account with this email address (${o.to}), confirm it, and you will be asked to accept or decline.`;

  const subject = `${inviter} invited you to ${project} on Notevra`;
  const text = [
    `${inviter} invited you to join "${project}" on Notevra as a ${o.role}.`,
    '',
    next,
    '',
    `${action}: ${link}`,
    '',
    'Not expecting this? You can ignore this email. Nothing happens unless you accept, and the invitation expires in 14 days.',
  ].join('\n');

  const h = escapeHtml;
  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${h(subject)}</title>
</head>
<body style="margin:0; padding:0; background:#f4f5fa;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${h(inviter)} wants you in ${h(project)}.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5fa;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <tr><td align="center" style="padding-bottom:24px;">
          <img src="${h(base)}/icons/pwa-192.png" width="48" height="48" alt="Notevra" style="display:block; border:0; border-radius:12px;">
        </td></tr>
        <tr><td style="background:#ffffff; border:1px solid #dfe3ff; border-radius:16px; padding:40px 40px 36px; font-family:${font};">
          <h1 style="margin:0 0 12px; font-size:24px; line-height:1.3; font-weight:700; color:#161a29;">You're invited to ${h(project)}</h1>
          <p style="margin:0 0 12px; font-size:15px; line-height:1.6; color:#40465c;">
            <strong style="color:#161a29;">${h(inviter)}</strong> invited you to join <strong style="color:#161a29;">${h(project)}</strong> as a ${h(o.role)}.
          </p>
          <p style="margin:0 0 28px; font-size:15px; line-height:1.6; color:#40465c;">${h(next)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td align="center" bgcolor="#5b6cf0" style="border-radius:10px;">
              <a href="${h(link)}" target="_blank" style="display:inline-block; padding:13px 28px; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:10px; background:#5b6cf0;">${h(action)}</a>
            </td>
          </tr></table>
          <p style="margin:28px 0 6px; font-size:13px; line-height:1.6; color:#5a6076;">Button not working? Paste this link into your browser:</p>
          <p style="margin:0; font-size:12px; line-height:1.5; word-break:break-all;"><a href="${h(link)}" target="_blank" style="color:#4453d8;">${h(link)}</a></p>
          <hr style="border:0; border-top:1px solid #eef0ff; margin:28px 0 20px;">
          <p style="margin:0; font-size:13px; line-height:1.6; color:#8b90a4;">Not expecting this? You can ignore this email. Nothing happens unless you accept, and the invitation expires in 14 days.</p>
        </td></tr>
        <tr><td align="center" style="padding:24px 8px 0; font-family:${font}; font-size:12px; line-height:1.6; color:#8b90a4;">
          Notevra · notes that work offline and sync everywhere<br>
          <a href="${h(base)}" target="_blank" style="color:#8b90a4;">${h(base)}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html, text, link };
}
