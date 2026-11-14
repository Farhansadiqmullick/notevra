export type AuthMode = 'signin' | 'signup' | 'forgot' | 'reset';

export const AUTH_COPY: Record<AuthMode, { title: string; blurb: string; action: string }> = {
  signin: {
    title: 'Sign in',
    blurb: 'Your notes stay on this device either way — signing in is what lets them reach your other ones.',
    action: 'Sign in',
  },
  signup: {
    title: 'Create an account',
    blurb: 'Everything you have written so far stays exactly where it is. An account adds sync, it doesn’t move anything.',
    action: 'Create account',
  },
  forgot: {
    title: 'Reset your password',
    blurb: 'We’ll email you a link. It works once, and it expires.',
    action: 'Send the link',
  },
  reset: {
    title: 'Set a new password',
    blurb: 'Choose something you don’t use anywhere else.',
    action: 'Save password',
  },
};
