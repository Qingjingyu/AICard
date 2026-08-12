import { describe, expect, it } from 'vitest';

import {
  openTokenResponse,
  sealTokenResponse,
} from '@/server/authorization/token-response-seal';

describe('token response recovery seal', () => {
  const response = {
    accessToken: `at_${'a'.repeat(43)}`,
    refreshToken: `rt_${'b'.repeat(43)}`,
    tokenType: 'Bearer' as const,
    expiresIn: 600,
  };

  it('round-trips an opaque token response without storing its plaintext', () => {
    const sealed = sealTokenResponse(response, 'authorization-code-and-verifier', 'idem_1234567890123456789012');

    expect(openTokenResponse<typeof response>(
      sealed,
      'authorization-code-and-verifier',
      'idem_1234567890123456789012',
    )).toEqual(response);
    expect(JSON.stringify(sealed)).not.toContain(response.accessToken);
    expect(JSON.stringify(sealed)).not.toContain(response.refreshToken);
  });

  it('rejects recovery with a different credential or idempotency key', () => {
    const sealed = sealTokenResponse(response, 'authorization-code-and-verifier', 'idem_1234567890123456789012');

    expect(() => openTokenResponse(sealed, 'different-secret', 'idem_1234567890123456789012'))
      .toThrow('Token response recovery failed');
    expect(() => openTokenResponse(sealed, 'authorization-code-and-verifier', 'different-idempotency-key'))
      .toThrow('Token response recovery failed');
  });
});
