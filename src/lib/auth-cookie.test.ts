import { shouldUseSecureCookies } from './auth-cookie';

describe('shouldUseSecureCookies', () => {
  it('does not honor X-Forwarded-Proto unless TRUST_PROXY is set', () => {
    const request = {
      headers: {
        get(name: string) {
          if (name === 'x-forwarded-proto') return 'https';
          if (name === 'host') return '192.168.1.8:3000';
          return null;
        },
      },
      url: 'http://192.168.1.8:3000/api/login',
    };
    expect(shouldUseSecureCookies(request, {})).toBe(false);
  });

  it('honors X-Forwarded-Proto when TRUST_PROXY is enabled', () => {
    const request = {
      headers: {
        get(name: string) {
          if (name === 'x-forwarded-proto') return 'https';
          if (name === 'host') return '127.0.0.1:3000';
          return null;
        },
      },
      url: 'http://127.0.0.1:3000/api/login',
    };
    expect(shouldUseSecureCookies(request, { TRUST_PROXY: 'true' })).toBe(true);
  });

  it('COOKIE_SECURE still wins', () => {
    const request = {
      headers: {
        get(name: string) {
          if (name === 'x-forwarded-proto') return 'https';
          return null;
        },
      },
      url: 'http://127.0.0.1:3000/api/login',
    };
    expect(
      shouldUseSecureCookies(request, {
        TRUST_PROXY: 'true',
        COOKIE_SECURE: 'false',
      })
    ).toBe(false);
  });
});
