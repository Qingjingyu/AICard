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
  if (
    typeof input !== 'string' ||
    input.length > MAX_RETURN_TO_LENGTH ||
    !input.startsWith(`${AUTHORIZATION_PATH}?`)
  ) {
    return DEFAULT_AUTH_RETURN_TO;
  }

  try {
    const base = new URL('https://aicard.invalid');
    const target = new URL(input, base);
    if (target.origin !== base.origin || target.pathname !== AUTHORIZATION_PATH || target.hash) {
      return DEFAULT_AUTH_RETURN_TO;
    }
    for (const key of target.searchParams.keys()) {
      if (!AUTHORIZATION_PARAMETERS.has(key) || target.searchParams.getAll(key).length !== 1) {
        return DEFAULT_AUTH_RETURN_TO;
      }
    }
    return `${target.pathname}?${target.searchParams.toString()}`;
  } catch {
    return DEFAULT_AUTH_RETURN_TO;
  }
}
