import { beforeEach, describe, expect, it, vi } from 'vitest';

const simpleWebAuthn = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

vi.mock('@simplewebauthn/server', () => simpleWebAuthn);

import { SimpleWebAuthnAdapter } from '@/server/authentication/webauthn-service';

describe('SimpleWebAuthnAdapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires a discoverable, user-verified credential without attestation', async () => {
    simpleWebAuthn.generateRegistrationOptions.mockResolvedValue({ challenge: 'register' });
    const adapter = new SimpleWebAuthnAdapter();

    await adapter.generateRegistrationOptions({
      rpName: 'AI Card',
      rpId: 'localhost',
      userId: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      userName: 'su_bai',
      displayName: '苏白',
      excludeCredentials: [{ id: 'credential_1', transports: ['internal'] }],
    });

    expect(simpleWebAuthn.generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
      rpName: 'AI Card',
      rpID: 'localhost',
      userName: 'su_bai',
      userDisplayName: '苏白',
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      excludeCredentials: [{ id: 'credential_1', transports: ['internal'] }],
    }));
  });

  it('enforces origin, RP ID and user verification during verification', async () => {
    simpleWebAuthn.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: 'credential_1', publicKey: new Uint8Array([1, 2]), counter: 0, transports: ['internal'] },
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
      },
    });
    simpleWebAuthn.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 4 },
    });
    const adapter = new SimpleWebAuthnAdapter();
    const expectedChallenge = vi.fn().mockReturnValue(true);
    const credential = {
      credentialId: 'credential_1',
      principalId: 'prn_01J4Z7Y8K9M2N3P4Q5R6S7T8VW',
      publicKey: new Uint8Array([1, 2]),
      counter: 3,
      transports: ['internal'],
      deviceType: 'multiDevice' as const,
      backedUp: true,
      createdAt: new Date(),
      lastUsedAt: null,
      revokedAt: null,
    };

    const registration = await adapter.verifyRegistration({
      response: { id: 'credential_1' },
      expectedChallenge,
      expectedOrigin: 'http://localhost:3000',
      expectedRpId: 'localhost',
    });
    const authentication = await adapter.verifyAuthentication({
      response: { id: 'credential_1' },
      expectedChallenge,
      expectedOrigin: 'http://localhost:3000',
      expectedRpId: 'localhost',
      credential,
    });

    expect(registration).toMatchObject({ verified: true, credential: { id: 'credential_1' } });
    expect(authentication).toEqual({ verified: true, newCounter: 4 });
    expect(simpleWebAuthn.verifyRegistrationResponse).toHaveBeenCalledWith(expect.objectContaining({
      expectedOrigin: 'http://localhost:3000',
      expectedRPID: 'localhost',
      requireUserVerification: true,
    }));
    expect(simpleWebAuthn.verifyAuthenticationResponse).toHaveBeenCalledWith(expect.objectContaining({
      expectedOrigin: 'http://localhost:3000',
      expectedRPID: 'localhost',
      requireUserVerification: true,
      credential: {
        id: 'credential_1',
        publicKey: credential.publicKey,
        counter: 3,
        transports: ['internal'],
      },
    }));
  });
});
