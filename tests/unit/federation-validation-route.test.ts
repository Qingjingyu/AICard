import { describe, expect, it, vi } from 'vitest';

import { createFederationValidationRoute } from '@/app/api/v1/federation/validate/route';

const body = {
  response_type: 'code',
  client_id: 'test_client',
  redirect_uri: 'http://localhost:4174/callback',
  scope: 'card.basic card.handle card.id',
  state: 'a'.repeat(43),
  code_challenge: 'b'.repeat(43),
  code_challenge_method: 'S256',
  principal_type: 'human',
};

describe('federation validation route', () => {
  it('validates public authorization metadata without exposing client internals', async () => {
    const validateRequest = vi.fn().mockResolvedValue({ client: { clientId: 'test_client' } });
    const POST = createFederationValidationRoute({ validateRequest });
    const response = await POST(new Request('http://localhost/api/v1/federation/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: true });
    expect(validateRequest).toHaveBeenCalledWith({
      responseType: 'code',
      clientId: 'test_client',
      redirectUri: 'http://localhost:4174/callback',
      scope: 'card.basic card.handle card.id',
      state: 'a'.repeat(43),
      codeChallenge: 'b'.repeat(43),
      codeChallengeMethod: 'S256',
      principalType: 'human',
    });
  });

  it('returns a generic rejection for malformed input', async () => {
    const validateRequest = vi.fn();
    const POST = createFederationValidationRoute({ validateRequest });
    const response = await POST(new Request('http://localhost/api/v1/federation/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    expect(validateRequest).not.toHaveBeenCalled();
  });
});
