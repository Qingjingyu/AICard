import { randomBytes } from 'node:crypto';

import { v7 as uuidv7 } from 'uuid';

export function createPrincipalId(): string {
  return uuidv7();
}

export function createPairwiseSubject(): string {
  return `sub_${randomBytes(32).toString('base64url')}`;
}
