import { beforeEach, describe, expect, it, vi } from 'vitest';

const revokeInvitation = vi.fn();
const authenticateAccessToken = vi.fn();

vi.mock('@/server/agent-enrollment', () => ({
  getAgentEnrollmentService: () => ({ revokeInvitation }),
}));
vi.mock('@/server/authorization/authorization', () => ({
  getPlatformAuthorizationService: () => ({ authenticateAccessToken }),
}));
vi.mock('@/server/config', () => ({
  getServerConfig: () => ({ appOrigin: 'https://id.example.com' }),
}));

describe('Agent invitation revocation route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows a human agent.enroll bearer to revoke its linked invitation', async () => {
    authenticateAccessToken.mockResolvedValue({
      identity: {
        principalId: '019f78ba-6ea8-7e85-bdaf-05b5fe7aa0a1',
        principalType: 'human',
      },
      clientId: 'yoyoo_dev',
      scopes: ['agent.enroll'],
    });
    revokeInvitation.mockResolvedValue(undefined);
    const { DELETE } = await import('@/app/api/v1/agent-invitations/[invitationId]/route');
    const invitationId = '019f8a48-e5b2-7ad2-a1f6-1681e4464163';

    const response = await DELETE(new Request(
      `https://id.example.com/api/v1/agent-invitations/${invitationId}`,
      { method: 'DELETE', headers: { authorization: `Bearer at_${'a'.repeat(43)}` } },
    ), { params: Promise.resolve({ invitationId }) });

    expect(response.status).toBe(200);
    expect(revokeInvitation).toHaveBeenCalledWith(
      '019f78ba-6ea8-7e85-bdaf-05b5fe7aa0a1',
      invitationId,
    );
    expect(await response.json()).toEqual({ revoked: true });
  });
});
