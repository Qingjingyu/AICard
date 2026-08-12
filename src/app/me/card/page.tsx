import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CardBack } from '@/components/card/card-back';
import { AgentPanel } from '@/components/card/agent-panel';
import { SecurityPanel } from '@/components/card/security-panel';
import { PlatformGrants } from '@/components/card/platform-grants';
import { getPlatformAuthorizationService } from '@/server/authorization/authorization';
import { getAuthenticationService } from '@/server/authentication/authentication';
import { getAgentEnrollmentService } from '@/server/agent-enrollment';
import { SESSION_COOKIE } from '@/server/authentication/http-auth';
import { getIdentityService } from '@/server/identity';

export const dynamic = 'force-dynamic';

export default async function PrivateCardPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const authentication = getAuthenticationService();
  const session = token ? await authentication.resolveSession(token) : null;
  if (!session) redirect('/');

  const [card, credentials, agents, grants] = await Promise.all([
    getIdentityService().getPrivateCard(session.principalId),
    authentication.listCredentials(session.principalId),
    getAgentEnrollmentService().listManagedAgents(session.principalId),
    getPlatformAuthorizationService().listManageableGrants(session.principalId),
  ]);

  return (
    <main className="private-card-page">
      <header className="card-page__masthead">
        <Link className="card-page__brand" href="/">AI Card</Link>
        <p>PRIVATE / CONTROL SURFACE</p>
      </header>
      <div className="private-card-page__layout">
        <CardBack card={card} />
        <aside className="private-card-page__controls">
          <SecurityPanel credentials={credentials.map((credential) => ({
            credentialId: credential.credentialId,
            deviceType: credential.deviceType,
            backedUp: credential.backedUp,
            createdAt: credential.createdAt.toISOString(),
            lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
            revokedAt: credential.revokedAt?.toISOString() ?? null,
          }))} />
          <PlatformGrants grants={grants.map((grant) => ({
            grantId: grant.grantId,
            clientId: grant.clientId,
            clientDisplayName: grant.clientDisplayName,
            audience: grant.audience,
            scopes: grant.scopes,
            status: grant.status,
            createdAt: grant.createdAt.toISOString(),
            revokedAt: grant.revokedAt?.toISOString() ?? null,
            lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
            subject: grant.subject,
          }))} />
          <AgentPanel agents={agents.map((agent) => ({
            ...agent,
            expiresAt: agent.expiresAt.toISOString(),
            lastAuthenticatedAt: agent.lastAuthenticatedAt?.toISOString() ?? null,
          }))} />
        </aside>
      </div>
    </main>
  );
}
