import { describe, expect, it } from 'vitest';

import { parsePlatformClientDocument } from '../../scripts/register-platform-client';

describe('platform client registration document', () => {
  it('parses one explicit product contract without adding permissions', () => {
    expect(parsePlatformClientDocument(JSON.stringify({
      clientId: 'yoyoo_mobile',
      displayName: 'Yoyoo Mobile',
      audience: 'yoyoo:mobile',
      redirectUris: ['https://mobile.yoyooai.com/auth/aicard/callback'],
      scopes: ['card.basic', 'card.handle', 'card.id', 'agent.enroll'],
    }))).toEqual({
      clientId: 'yoyoo_mobile',
      displayName: 'Yoyoo Mobile',
      audience: 'yoyoo:mobile',
      redirectUris: ['https://mobile.yoyooai.com/auth/aicard/callback'],
      scopes: ['card.basic', 'card.handle', 'card.id', 'agent.enroll'],
    });
  });

  it('rejects unknown fields and missing explicit scopes', () => {
    expect(() => parsePlatformClientDocument(JSON.stringify({
      clientId: 'unsafe_client',
      displayName: 'Unsafe',
      audience: 'unsafe',
      redirectUris: ['https://unsafe.yoyooai.com/callback'],
      dynamicScopes: true,
    }))).toThrow(/scopes|Unrecognized/i);
  });
});
