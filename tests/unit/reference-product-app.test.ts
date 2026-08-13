import { describe, expect, it, vi } from 'vitest';

import { createReferenceProductHandler } from '../../reference-product/app';

const flow = {
  flowToken: `pf_${'a'.repeat(43)}`,
  state: 'b'.repeat(43),
  request: {
    responseType: 'code',
    clientId: 'test_client',
    redirectUri: 'http://localhost:4174/callback',
    scope: 'card.basic card.handle card.id',
    state: 'b'.repeat(43),
    codeChallenge: 'c'.repeat(43),
    codeChallengeMethod: 'S256',
    principalType: 'human',
  },
};

function dependencies() {
  return {
    productOrigin: 'http://localhost:4174',
    clientId: 'test_client',
    redirectUri: 'http://localhost:4174/callback',
    begin: vi.fn().mockResolvedValue(flow),
    authorizationUrl: vi.fn().mockReturnValue('http://localhost:3000/authorize?request=1'),
    complete: vi.fn().mockResolvedValue({
      member: {
        memberId: '0198a69a-8490-75f3-a398-e2a2615415f8',
        clientId: 'test_client',
        subject: `sub_${'d'.repeat(43)}`,
        cardId: 'AI_100001',
        principalType: 'human',
        displayName: '<苏白>',
        handle: 'subai_account',
      },
      sessionToken: `ps_${'e'.repeat(43)}`,
      expiresAt: '2026-08-13T12:00:00.000Z',
    }),
    resolveSession: vi.fn().mockResolvedValue(null),
  };
}

describe('reference product web app', () => {
  it('renders an explicit empty state and issues a CSRF cookie', async () => {
    const handler = createReferenceProductHandler(dependencies());
    const response = await handler(new Request('http://localhost:4174/'));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().join(';')).toContain('reference_product_csrf=');
    expect(html).toContain('连接你的 AI Card');
    expect(html).toContain('data-state="empty"');
    expect(html).toContain('name="csrf"');
  });

  it('rejects cross-origin connection requests before creating a flow', async () => {
    const input = dependencies();
    const handler = createReferenceProductHandler(input);
    const response = await handler(new Request('http://localhost:4174/connect', {
      method: 'POST',
      headers: {
        origin: 'https://attacker.example',
        cookie: 'reference_product_csrf=token',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'csrf=token',
    }));

    expect(response.status).toBe(403);
    expect(input.begin).not.toHaveBeenCalled();
  });

  it('starts authorization only after same-origin CSRF verification', async () => {
    const input = dependencies();
    const handler = createReferenceProductHandler(input);
    const response = await handler(new Request('http://localhost:4174/connect', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:4174',
        cookie: 'reference_product_csrf=token',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'csrf=token',
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost:3000/authorize?request=1');
    expect(response.headers.getSetCookie().join(';')).toContain('reference_product_flow=');
    expect(input.begin).toHaveBeenCalledWith({
      clientId: 'test_client',
      redirectUri: 'http://localhost:4174/callback',
    });
  });

  it('exchanges the callback and establishes an HttpOnly product session', async () => {
    const input = dependencies();
    const handler = createReferenceProductHandler(input);
    const response = await handler(new Request(
      `http://localhost:4174/callback?code=ac_${'f'.repeat(43)}&state=${flow.state}`,
      { headers: { cookie: `reference_product_flow=${flow.flowToken}` } },
    ));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/?connected=1');
    const cookies = response.headers.getSetCookie().join(';');
    expect(cookies).toContain('reference_product_session=');
    expect(cookies).toContain('HttpOnly');
    expect(input.complete).toHaveBeenCalledWith({
      flow: { flowToken: flow.flowToken },
      code: `ac_${'f'.repeat(43)}`,
      returnedState: flow.state,
    });
  });

  it('renders the connected card without allowing profile HTML injection', async () => {
    const input = dependencies();
    input.resolveSession.mockResolvedValue((await input.complete()).member);
    const handler = createReferenceProductHandler(input);
    const response = await handler(new Request('http://localhost:4174/', {
      headers: { cookie: `reference_product_session=ps_${'e'.repeat(43)}` },
    }));
    const html = await response.text();

    expect(html).toContain('data-state="success"');
    expect(html).toContain('AI_100001');
    expect(html).toContain('&lt;苏白&gt;');
    expect(html).not.toContain('<苏白>');
  });
});
