import { describe, expect, it, vi } from 'vitest';

import type { RawAuthorizationRequest } from '@/server/authorization/authorization-service';
import { HttpProductIdentityGateway } from '@/server/federation/product-identity-gateway';

const request: RawAuthorizationRequest = {
  responseType: 'code',
  clientId: 'test_client',
  redirectUri: 'http://localhost:4174/callback',
  scope: 'card.basic card.handle card.id',
  state: 'a'.repeat(43),
  codeChallenge: 'b'.repeat(43),
  codeChallengeMethod: 'S256',
  principalType: 'human',
};

describe('HTTP product identity gateway', () => {
  it('uses only the public AI Card validation, token and userinfo endpoints', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ valid: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: `at_${'c'.repeat(43)}`,
        token_type: 'Bearer',
        expires_in: 600,
        scope: request.scope,
        sub: `sub_${'d'.repeat(43)}`,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sub: `sub_${'d'.repeat(43)}`,
        card_id: 'AI_100001',
        principal_type: 'human',
        display_name: '苏白',
        handle: 'subai_account',
      }), { status: 200 }));
    const gateway = new HttpProductIdentityGateway('https://card.example.com/', fetcher);

    await gateway.validateRequest(request);
    const token = await gateway.exchangeAuthorizationCode({
      grantType: 'authorization_code',
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      code: `ac_${'e'.repeat(43)}`,
      codeVerifier: 'f'.repeat(43),
      idempotencyKey: `idem_${'g'.repeat(43)}`,
    });
    const profile = await gateway.getUserInfo(token.accessToken);

    expect(profile).toMatchObject({ card_id: 'AI_100001' });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://card.example.com/api/v1/federation/validate',
      'https://card.example.com/api/v1/token',
      'https://card.example.com/api/v1/userinfo',
    ]);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ 'idempotency-key': `idem_${'g'.repeat(43)}` }),
    });
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({
      headers: expect.objectContaining({ authorization: `Bearer ${token.accessToken}` }),
    });
  });

  it('fails closed when AI Card is unavailable or returns malformed data', async () => {
    const unavailable = new HttpProductIdentityGateway(
      'https://card.example.com',
      vi.fn().mockRejectedValue(new TypeError('network down')),
    );
    const malformed = new HttpProductIdentityGateway(
      'https://card.example.com',
      vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
    );

    await expect(unavailable.validateRequest(request)).rejects.toThrow('AI Card service is unavailable');
    await expect(malformed.exchangeAuthorizationCode({
      grantType: 'authorization_code',
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      code: `ac_${'e'.repeat(43)}`,
      codeVerifier: 'f'.repeat(43),
      idempotencyKey: `idem_${'g'.repeat(43)}`,
    })).rejects.toThrow('AI Card response is invalid');
  });
});
