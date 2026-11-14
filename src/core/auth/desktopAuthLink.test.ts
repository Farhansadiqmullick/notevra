import { describe, expect, it } from 'vitest';
import { parseAuthCallback } from './desktopAuthLink';

describe('parseAuthCallback', () => {
  it('reads the PKCE code from the query', () => {
    expect(parseAuthCallback('notevra://auth/callback?code=c1'))
      .toEqual({ kind: 'code', code: 'c1' });
  });

  it('reads an error from the query', () => {
    expect(parseAuthCallback('notevra://auth/callback?error=access_denied&error_description=Access+blocked'))
      .toEqual({ kind: 'error', message: 'Access blocked' });
  });

  it('reads an error from the fragment', () => {
    expect(parseAuthCallback('notevra://auth/callback#error=server_error'))
      .toEqual({ kind: 'error', message: 'server_error' });
  });

  it('ignores links that are not the auth callback', () => {
    expect(parseAuthCallback('notevra://open/page?code=c1')).toBeNull();
    expect(parseAuthCallback('https://example.com/?code=c1')).toBeNull();
  });

  it('ignores tokens, so a link cannot sign the app into another account', () => {
    expect(parseAuthCallback('notevra://auth/callback#access_token=a1&refresh_token=r1')).toBeNull();
  });
});
