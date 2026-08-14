import { describe, expect, it } from 'vitest';

import { AuthenticationStateError } from '@/server/authentication/errors';
import {
  assertTrustedProductMutationOrigin,
  createTrustedProductPreflight,
  withTrustedProductCors,
} from '@/server/authentication/trusted-product-cors';

const config = {
  appOrigin: 'https://id.yoyooai.com',
  trustedProductOrigins: ['https://app.yoyooai.com'],
};

describe('trusted product CORS', () => {
  it('accepts the AI Card origin and exact trusted product origins only', () => {
    expect(() => assertTrustedProductMutationOrigin(new Request('https://id.yoyooai.com/api', {
      method: 'POST',
      headers: { origin: config.appOrigin },
    }), config)).not.toThrow();
    expect(() => assertTrustedProductMutationOrigin(new Request('https://id.yoyooai.com/api', {
      method: 'POST',
      headers: { origin: config.trustedProductOrigins[0] },
    }), config)).not.toThrow();
    expect(() => assertTrustedProductMutationOrigin(new Request('https://id.yoyooai.com/api', {
      method: 'POST',
      headers: { origin: 'https://app.yoyooai.com.attacker.example' },
    }), config)).toThrow(AuthenticationStateError);
  });

  it('adds credentialed CORS headers only for an exact trusted product origin', () => {
    const trustedRequest = new Request('https://id.yoyooai.com/api', {
      headers: { origin: 'https://app.yoyooai.com' },
    });
    const response = withTrustedProductCors(
      trustedRequest,
      Response.json({ ok: true }),
      config,
    );

    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.yoyooai.com');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response.headers.get('vary')).toContain('Origin');

    const sameOrigin = withTrustedProductCors(
      new Request('https://id.yoyooai.com/api', { headers: { origin: config.appOrigin } }),
      Response.json({ ok: true }),
      config,
    );
    expect(sameOrigin.headers.has('access-control-allow-origin')).toBe(false);
  });

  it('returns a narrow preflight response and rejects unknown origins', () => {
    const response = createTrustedProductPreflight(new Request('https://id.yoyooai.com/api', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://app.yoyooai.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-csrf-token,idempotency-key',
      },
    }), config);

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.yoyooai.com');
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toBe(
      'content-type, idempotency-key, x-csrf-token',
    );

    expect(() => createTrustedProductPreflight(new Request('https://id.yoyooai.com/api', {
      method: 'OPTIONS',
      headers: { origin: 'https://attacker.example' },
    }), config)).toThrow(AuthenticationStateError);
  });
});
