import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { v7 as uuidv7 } from 'uuid';

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

async function requestJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json() as { error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message ?? `Request failed with ${response.status}`);
  return result as Record<string, unknown>;
}

const output = argument('output');
process.stdin.setEncoding('utf8');
let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;
const enrollmentInput = JSON.parse(stdin) as {
  serviceUrl?: string;
  invitationId?: string;
  ticket?: string;
  machineName?: string;
};
if (!enrollmentInput.serviceUrl || !enrollmentInput.invitationId
  || !enrollmentInput.ticket || !enrollmentInput.machineName) {
  throw new Error('stdin JSON requires serviceUrl, invitationId, ticket, and machineName');
}
const serviceUrl = enrollmentInput.serviceUrl.replace(/\/$/, '');
const invitationId = enrollmentInput.invitationId;
const ticket = enrollmentInput.ticket;
const machineName = enrollmentInput.machineName;
const claimId = uuidv7();
const claimSecret = randomBytes(32).toString('base64url');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeySpki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
const payload = [
  'aicard-agent-claim-v1', invitationId, claimId, machineName, publicKeySpki,
].join('\n');
const signature = sign(null, Buffer.from(payload), privateKey).toString('base64url');

const claimed = await requestJson(`${serviceUrl}/api/v1/agent-enrollment/claim`, {
  invitationId,
  ticket,
  claimId,
  claimSecret,
  machineName,
  publicKey: publicKeySpki,
  signature,
});
const nodeId = String(claimed.nodeId);
const challenge = await requestJson(`${serviceUrl}/api/v1/agent-nodes/challenge`, { nodeId });
const authenticationPayload = [
  'aicard-node-auth-v1', nodeId, String(challenge.challenge),
].join('\n');
const authenticationSignature = sign(
  null,
  Buffer.from(authenticationPayload),
  privateKey,
).toString('base64url');
const authenticated = await requestJson(`${serviceUrl}/api/v1/agent-nodes/authenticate`, {
  nodeId,
  challengeId: challenge.challengeId,
  challenge: challenge.challenge,
  signature: authenticationSignature,
});

await writeFile(output, JSON.stringify({
  version: 1,
  serviceUrl,
  cardId: claimed.cardId,
  nodeId,
  machineName,
  claimId,
  claimSecret,
  publicKeySpki,
  privateKeyPkcs8: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
}, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });

console.log(JSON.stringify({
  displayName: claimed.displayName,
  cardId: claimed.cardId,
  machineName: claimed.machineName,
  claimStatus: claimed.claimStatus,
  connectionStatus: authenticated.connectionStatus,
}, null, 2));
