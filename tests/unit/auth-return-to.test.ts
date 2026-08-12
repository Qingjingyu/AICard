import { describe, expect, it } from 'vitest';

import {
  buildAuthorizationReturnTo,
  normalizeAuthReturnTo,
} from '../../src/lib/auth-return-to';

describe('authentication return target', () => {
  it('builds and restores the internal authorization request', () => {
    const target = buildAuthorizationReturnTo({
      responseType: 'code',
      clientId: 'yoyoo_dev',
      redirectUri: 'http://localhost:4173/auth/aicard/callback',
      scope: 'card.basic card.handle offline_access',
      state: 'state_1234567890',
      codeChallenge: 'challenge_1234567890',
      codeChallengeMethod: 'S256',
      principalType: 'ai',
    });

    expect(target).toBe(
      '/authorize?response_type=code&client_id=yoyoo_dev&redirect_uri=http%3A%2F%2Flocalhost%3A4173%2Fauth%2Faicard%2Fcallback&scope=card.basic+card.handle+offline_access&state=state_1234567890&code_challenge=challenge_1234567890&code_challenge_method=S256&principal_type=ai',
    );
    expect(normalizeAuthReturnTo(target)).toBe(target);
  });

  it.each([
    'https://attacker.example/authorize?client_id=yoyoo_dev',
    '//attacker.example/authorize?client_id=yoyoo_dev',
    '/me/card',
    '/authorize/other?client_id=yoyoo_dev',
    `/authorize?${'a'.repeat(4_100)}`,
    ['not', 'a', 'string'],
    undefined,
  ])('falls back for an unsafe return target: %j', (target) => {
    expect(normalizeAuthReturnTo(target)).toBe('/me/card');
  });
});
