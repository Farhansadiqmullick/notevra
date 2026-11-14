// Confirm and reset emails link to `?token_hash=…&type=…` (supabase/templates), which works in any browser under PKCE.
import type { EmailOtpType, SupabaseClient } from '@supabase/supabase-js';

export interface EmailLink {
  tokenHash: string;
  type: EmailOtpType;
}

const TYPES: EmailOtpType[] = ['email', 'recovery'];

/** The token hash and type from an email link, or null when the URL is not one. */
export function readEmailLink(search: string): EmailLink | null {
  const params = new URLSearchParams(search);
  const tokenHash = params.get('token_hash');
  const type = params.get('type') as EmailOtpType | null;
  return tokenHash && type && TYPES.includes(type) ? { tokenHash, type } : null;
}

/** Redeem an email link on this page, if there is one; returns an error message or null. */
export async function consumeEmailLink(client: SupabaseClient): Promise<string | null> {
  const link = readEmailLink(window.location.search);
  if (!link) return null;
  // drop the hash from the address bar and history before redeeming it
  const url = new URL(window.location.href);
  url.searchParams.delete('token_hash');
  url.searchParams.delete('type');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  const { error } = await client.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
  return error?.message ?? null;
}
