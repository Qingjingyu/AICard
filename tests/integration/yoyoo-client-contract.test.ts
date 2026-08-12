import { describe, expect, it } from 'vitest';

import {
  YOYOO_CLIENT_CONTRACT,
  yoyooTokenResponseSchema,
  yoyooUserInfoSchema,
} from '@/lib/contracts/yoyoo-client';

describe('Yoyoo platform client contract', () => {
  it('locks the registered client, callback, audience, and minimum scopes', () => {
    expect(YOYOO_CLIENT_CONTRACT).toEqual({
      clientId: 'yoyoo_dev',
      audience: 'yoyoo',
      redirectUri: 'http://localhost:4173/auth/aicard/callback',
      scopes: ['card.basic', 'card.handle', 'offline_access'],
    });
  });

  it('accepts the complete token response and rejects malformed credentials', () => {
    expect(yoyooTokenResponseSchema.parse({
      access_token: `at_${'a'.repeat(43)}`,
      token_type: 'Bearer',
      expires_in: 600,
      scope: 'card.basic card.handle offline_access',
      sub: `sub_${'b'.repeat(43)}`,
      refresh_token: `rt_${'c'.repeat(43)}`,
      refresh_expires_in: 2_592_000,
    })).toMatchObject({ token_type: 'Bearer', expires_in: 600 });

    expect(() => yoyooTokenResponseSchema.parse({
      access_token: 'visible-secret-without-prefix',
      token_type: 'Bearer',
      expires_in: 600,
      scope: 'card.basic',
      sub: `sub_${'b'.repeat(43)}`,
    })).toThrow();

    expect(() => yoyooTokenResponseSchema.parse({
      access_token: `at_${'a'.repeat(43)}`,
      token_type: 'Bearer',
      expires_in: 600,
      scope: 'card.basic card.handle offline_access',
      sub: `sub_${'b'.repeat(43)}`,
    })).toThrow();
  });

  it('keeps pairwise subject separate from display identity fields', () => {
    const userInfo = yoyooUserInfoSchema.parse({
      sub: `sub_${'d'.repeat(43)}`,
      display_name: '研究员小悠',
      principal_type: 'ai',
      avatar_url: null,
      handle: 'researcher_yoyo',
    });

    expect(userInfo).toEqual({
      sub: `sub_${'d'.repeat(43)}`,
      display_name: '研究员小悠',
      principal_type: 'ai',
      avatar_url: null,
      handle: 'researcher_yoyo',
    });
    expect(userInfo.sub).not.toContain(userInfo.handle);
  });
});
