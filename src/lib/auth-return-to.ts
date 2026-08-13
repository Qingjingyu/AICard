const DEFAULT_AUTH_RETURN_TO = '/me/card';
const AUTHORIZATION_PATH = '/authorize';
const MAX_RETURN_TO_LENGTH = 4_096;
const AUTHORIZATION_PARAMETERS = new Set([
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
  'principal_type',
]);

type AuthorizationReturnInput = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  principalType?: string;
};

function parseSafeAuthorizationUrl(input: unknown): URL | null {
  if (
    typeof input !== 'string' ||
    input.length > MAX_RETURN_TO_LENGTH ||
    !input.startsWith(`${AUTHORIZATION_PATH}?`)
  ) return null;

  try {
    const base = new URL('https://aicard.invalid');
    const target = new URL(input, base);
    if (target.origin !== base.origin || target.pathname !== AUTHORIZATION_PATH || target.hash) return null;
    for (const key of target.searchParams.keys()) {
      if (!AUTHORIZATION_PARAMETERS.has(key) || target.searchParams.getAll(key).length !== 1) return null;
    }
    return target;
  } catch {
    return null;
  }
}

export function buildAuthorizationReturnTo(input: AuthorizationReturnInput): string {
  const query = new URLSearchParams({
    response_type: input.responseType,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: input.scope,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: input.codeChallengeMethod,
  });
  if (input.principalType) query.set('principal_type', input.principalType);
  return `${AUTHORIZATION_PATH}?${query.toString()}`;
}

export function normalizeAuthReturnTo(input: unknown): string {
  const target = parseSafeAuthorizationUrl(input);
  return target ? `${target.pathname}?${target.searchParams.toString()}` : DEFAULT_AUTH_RETURN_TO;
}

export function parseAuthorizationReturnTo(input: unknown): AuthorizationReturnInput | null {
  const target = parseSafeAuthorizationUrl(input);
  if (!target) return null;
  return {
    responseType: target.searchParams.get('response_type') ?? '',
    clientId: target.searchParams.get('client_id') ?? '',
    redirectUri: target.searchParams.get('redirect_uri') ?? '',
    scope: target.searchParams.get('scope') ?? '',
    state: target.searchParams.get('state') ?? '',
    codeChallenge: target.searchParams.get('code_challenge') ?? '',
    codeChallengeMethod: target.searchParams.get('code_challenge_method') ?? '',
    principalType: target.searchParams.get('principal_type') ?? undefined,
  };
}
