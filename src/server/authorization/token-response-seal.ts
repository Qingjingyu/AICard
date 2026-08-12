import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const AAD = Buffer.from('aicard-token-response-v1', 'ascii');

export type SealedTokenResponse = {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
};

function deriveRecoveryKey(recoverySecret: string, idempotencyKey: string): Buffer {
  return createHash('sha256')
    .update('aicard-token-response-key-v1\0', 'ascii')
    .update(recoverySecret, 'utf8')
    .update('\0', 'ascii')
    .update(idempotencyKey, 'utf8')
    .digest();
}

export function sealTokenResponse<T>(
  response: T,
  recoverySecret: string,
  idempotencyKey: string,
): SealedTokenResponse {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, deriveRecoveryKey(recoverySecret, idempotencyKey), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(response), 'utf8'),
    cipher.final(),
  ]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

export function openTokenResponse<T>(
  sealed: SealedTokenResponse,
  recoverySecret: string,
  idempotencyKey: string,
): T {
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      deriveRecoveryKey(recoverySecret, idempotencyKey),
      sealed.iv,
    );
    decipher.setAAD(AAD);
    decipher.setAuthTag(sealed.tag);
    const plaintext = Buffer.concat([
      decipher.update(sealed.ciphertext),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8')) as T;
  } catch {
    throw new Error('Token response recovery failed');
  }
}
