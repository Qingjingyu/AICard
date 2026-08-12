import { randomBytes } from 'node:crypto';

import { v7 as uuidv7 } from 'uuid';

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeCrockford128(bytes: Uint8Array): string {
  let value = BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
  let encoded = '';

  for (let index = 0; index < 26; index += 1) {
    encoded = CROCKFORD_BASE32[Number(value & 31n)] + encoded;
    value >>= 5n;
  }

  return encoded;
}

export function createPrincipalId(): string {
  return uuidv7();
}

export function createCardId(): string {
  return `aic_${encodeCrockford128(randomBytes(16))}`;
}

export function createPairwiseSubject(): string {
  return `sub_${randomBytes(32).toString('base64url')}`;
}
