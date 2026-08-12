import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ConsentPanel } from '@/components/consent/consent-panel';
import { buildAuthorizationReturnTo } from '@/lib/auth-return-to';
import type { RawAuthorizationRequest } from '@/server/authorization/authorization-service';
import { getPlatformAuthorizationService } from '@/server/authorization/authorization';
import { getAuthenticationService } from '@/server/authentication/authentication';
import { SESSION_COOKIE } from '@/server/authentication/http-auth';
import { getIdentityService } from '@/server/identity';

export const dynamic = 'force-dynamic';

function value(input: string | string[] | undefined): string {
  return typeof input === 'string' ? input : '';
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const request: RawAuthorizationRequest = {
    responseType: value(query.response_type),
    clientId: value(query.client_id),
    redirectUri: value(query.redirect_uri),
    scope: value(query.scope),
    state: value(query.state),
    codeChallenge: value(query.code_challenge),
    codeChallengeMethod: value(query.code_challenge_method),
    principalType: value(query.principal_type),
  };
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = sessionToken
    ? await getAuthenticationService().resolveSession(sessionToken)
    : null;
  if (!session) {
    const returnTo = buildAuthorizationReturnTo(request);
    redirect(`/?${new URLSearchParams({ return_to: returnTo }).toString()}`);
  }

  const authorization = await getPlatformAuthorizationService().validateRequest(request);
  const subjectOptions = authorization.principalType === 'ai'
    ? await getIdentityService().listControlledCards(session.principalId)
    : undefined;
  return (
    <main className="authorization-page">
      <header className="card-page__masthead">
        <Link className="card-page__brand" href="/me/card">AI Card</Link>
        <p>CONSENT / MINIMUM ACCESS</p>
      </header>
      <ConsentPanel
        clientName={authorization.client.displayName}
        scopes={authorization.scopes}
        request={request}
        subjectOptions={subjectOptions?.map((card) => ({
          cardId: card.cardId,
          displayName: card.displayName,
          handle: card.handle,
        }))}
      />
      <footer className="foundation-footer"><p>PAIRWISE IDENTITY / EXPLICIT CONSENT</p></footer>
    </main>
  );
}
