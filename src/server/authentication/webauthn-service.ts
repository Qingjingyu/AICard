import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

import type { WebAuthnAdapter } from '@/server/authentication/authentication-service';

function asTransports(transports: string[]): AuthenticatorTransportFuture[] {
  return transports.filter((transport): transport is AuthenticatorTransportFuture =>
    ['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'].includes(transport),
  );
}

export class SimpleWebAuthnAdapter implements WebAuthnAdapter {
  generateRegistrationOptions(input: Parameters<WebAuthnAdapter['generateRegistrationOptions']>[0]) {
    return generateRegistrationOptions({
      rpName: input.rpName,
      rpID: input.rpId,
      userID: Buffer.from(input.userId, 'base64url'),
      userName: input.userName,
      userDisplayName: input.displayName,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      excludeCredentials: input.excludeCredentials.map((credential) => ({
        id: credential.id,
        transports: asTransports(credential.transports),
      })),
    });
  }

  async verifyRegistration(input: Parameters<WebAuthnAdapter['verifyRegistration']>[0]) {
    const result = await verifyRegistrationResponse({
      response: input.response as RegistrationResponseJSON,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.expectedOrigin,
      expectedRPID: input.expectedRpId,
      requireUserVerification: true,
    });
    if (!result.verified) return { verified: false } as const;

    return {
      verified: true,
      credential: {
        id: result.registrationInfo.credential.id,
        publicKey: result.registrationInfo.credential.publicKey,
        counter: result.registrationInfo.credential.counter,
        transports: result.registrationInfo.credential.transports ?? [],
        deviceType: result.registrationInfo.credentialDeviceType,
        backedUp: result.registrationInfo.credentialBackedUp,
      },
    } as const;
  }

  generateAuthenticationOptions(input: Parameters<WebAuthnAdapter['generateAuthenticationOptions']>[0]) {
    return generateAuthenticationOptions({
      rpID: input.rpId,
      userVerification: 'required',
    });
  }

  async verifyAuthentication(input: Parameters<WebAuthnAdapter['verifyAuthentication']>[0]) {
    const result = await verifyAuthenticationResponse({
      response: input.response as AuthenticationResponseJSON,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.expectedOrigin,
      expectedRPID: input.expectedRpId,
      requireUserVerification: true,
      credential: {
        id: input.credential.credentialId,
        publicKey: Uint8Array.from(input.credential.publicKey),
        counter: input.credential.counter,
        transports: asTransports(input.credential.transports),
      },
    });
    return {
      verified: result.verified,
      newCounter: result.authenticationInfo.newCounter,
    };
  }
}
