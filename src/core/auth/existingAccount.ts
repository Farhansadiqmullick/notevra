// Sign-up hit an email that already has an account (by password, Google, or both).
export const EXISTING_ACCOUNT = 'You already have an account with this email. Sign in, or continue with Google.';

interface SignUpUser {
  identities?: unknown[] | null;
}
interface SignUpError {
  message?: string;
  code?: string;
}

// With email confirmation on, Supabase hides a taken email: no error, just a user with no identities.
export function isExistingAccount(user: SignUpUser | null | undefined, error: SignUpError | null | undefined): boolean {
  if (error) {
    const msg = (error.message ?? '').toLowerCase();
    return error.code === 'user_already_exists' || msg.includes('already registered') || msg.includes('already been registered');
  }
  return !!user && Array.isArray(user.identities) && user.identities.length === 0;
}
