import { describe, expect, it } from 'vitest';
import { buildInviteEmail, escapeHtml, inviteLink } from '../../supabase/functions/send-invite/email';
import { looksLikeEmail } from './useWorkspaceMembers';

const base = {
  appUrl: 'https://app.example.com/',
  to: 'new.person+x@example.com',
  inviterName: 'Ada Admin',
  workspaceName: 'Kernel Labs',
  role: 'member',
};

describe('invite email', () => {
  it('links to sign-up with the address filled in', () => {
    expect(inviteLink(base.appUrl, base.to)).toBe(
      'https://app.example.com/?invite=signup&email=new.person%2Bx%40example.com',
    );
  });

  it('names the inviter and the project', () => {
    const mail = buildInviteEmail(base);
    expect(mail.subject).toBe('Ada Admin invited you to Kernel Labs on Notevra');
    expect(mail.text).toContain('Kernel Labs');
    expect(mail.html).toContain(mail.link.replace(/&/g, '&amp;'));
  });

  it('escapes user-typed names in the HTML', () => {
    const mail = buildInviteEmail({ ...base, workspaceName: '<img src=x onerror=alert(1)>', inviterName: 'A "B" & C' });
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(mail.html).toContain('A &quot;B&quot; &amp; C');
  });

  it('keeps the subject to one line', () => {
    const mail = buildInviteEmail({ ...base, workspaceName: 'Line one\r\nBcc: someone@evil.test' });
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it('escapeHtml covers the five characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});

describe('looksLikeEmail', () => {
  it.each([
    ['ada@example.com', true],
    ['  ada@example.com  ', true],
    ['Ada Admin', false],
    ['ada@', false],
    ['ada@example', false],
    ['a b@example.com', false],
  ])('%s → %s', (input, expected) => {
    expect(looksLikeEmail(input)).toBe(expected);
  });
});
