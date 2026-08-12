import { describe, expect, it } from 'vitest';

import { createOpaqueToken } from '@/server/authentication/auth-security';
import {
  assertMutationOrigin,
  readCsrfToken,
  readSessionToken,
  requireCsrf,
} from '@/server/authentication/http-auth';
import { AuthenticationStateError } from '@/server/authentication/errors';

describe('authentication HTTP boundary', () => {
  it('accepts only the exact configured mutation origin', () => {
    expect(() => assertMutationOrigin(new Request('http://localhost/api', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
    }), 'http://localhost:3000')).not.toThrow();

    expect(() => assertMutationOrigin(new Request('http://localhost/api', {
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
    }), 'http://localhost:3000')).toThrow(AuthenticationStateError);
  });

  it('requires matching CSRF cookie and header and parses the session cookie', () => {
    const csrf = createOpaqueToken();
    const session = createOpaqueToken();
    const request = new Request('http://localhost/api', {
      method: 'POST',
      headers: {
        cookie: `aicard_session=${session}; aicard_csrf=${csrf}`,
        'x-csrf-token': csrf,
      },
    });

    expect(readSessionToken(request)).toBe(session);
    expect(readCsrfToken(request)).toBe(csrf);
    expect(() => requireCsrf(request)).not.toThrow();
    expect(() => requireCsrf(new Request('http://localhost/api', {
      headers: { cookie: `aicard_csrf=${csrf}`, 'x-csrf-token': createOpaqueToken() },
    }))).toThrow(AuthenticationStateError);
  });
});
