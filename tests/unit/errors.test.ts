import { describe, expect, it } from 'vitest';

describe('structured errors', () => {
  it('creates a stable public envelope without internal details', async () => {
    const { createErrorEnvelope } = await import('@/lib/contracts/errors');

    const envelope = createErrorEnvelope({
      code: 'INTERNAL_ERROR',
      message: '服务暂时不可用，请稍后重试。',
      requestId: 'req_test_123',
      retryable: true,
    });

    expect(envelope).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务暂时不可用，请稍后重试。',
        request_id: 'req_test_123',
        retryable: true,
      },
    });
    expect(JSON.stringify(envelope)).not.toContain('stack');
  });
});
