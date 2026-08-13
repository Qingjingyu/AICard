import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AccountGateway } from '@/components/auth/account-gateway';
import { normalizeAuthReturnTo, parseAuthorizationReturnTo } from '@/lib/auth-return-to';
import { getPlatformAuthorizationService } from '@/server/authorization/authorization';
import { getAuthenticationService } from '@/server/authentication/authentication';
import { SESSION_COOKIE } from '@/server/authentication/http-auth';

type FoundationState = 'success' | 'empty' | 'loading' | 'error';

type StateContent = {
  eyebrow: string;
  title: string;
  description: string;
};

const content: Record<FoundationState, StateContent> = {
  success: {
    eyebrow: 'FOUNDATION / READY',
    title: '工程基础已就绪',
    description: '身份与授权边界已经锁定，运行时、数据库和验证门禁现在处于可持续开发状态。',
  },
  empty: {
    eyebrow: 'CARD / EMPTY',
    title: '还没有 AI Card',
    description: 'Card 创建将在下一阶段开放。现在保留清晰的空状态，不制造尚未实现的操作入口。',
  },
  loading: {
    eyebrow: 'SYSTEM / CHECKING',
    title: '正在确认服务状态',
    description: '正在读取运行时与数据库状态。这个过程不会展示或记录任何身份凭据。',
  },
  error: {
    eyebrow: 'SYSTEM / DEGRADED',
    title: '身份服务暂不可用',
    description: '基础依赖未通过健康检查。没有请求会在未知状态下继续执行。',
  },
};

function normalizeState(value: string | string[] | undefined): FoundationState {
  const state = Array.isArray(value) ? value[0] : value;
  return state && state in content ? (state as FoundationState) : 'success';
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    state?: string | string[];
    return_to?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const requestedState = query.state;
  const returnTo = normalizeAuthReturnTo(query.return_to);
  const authorizationReturn = parseAuthorizationReturnTo(query.return_to);
  let registrationClientId = 'aicard_web';
  if (authorizationReturn) {
    const validated = await getPlatformAuthorizationService().validateRequest(authorizationReturn);
    registrationClientId = validated.client.clientId;
  }
  const state = normalizeState(requestedState);
  const current = content[state];

  if (!requestedState) {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (token && await getAuthenticationService().resolveSession(token)) redirect(returnTo);
  }

  return (
    <main className="foundation" data-state={state}>
      <header className="masthead">
        <div className="brand-mark" aria-hidden="true">
          AC
        </div>
        <div>
          <p className="brand-name">AI Card</p>
          <p className="brand-meta">Identity infrastructure / v0.1</p>
        </div>
      </header>

      {requestedState ? <section className="status-stage" aria-live={state === 'loading' ? 'polite' : 'off'}>
        <div className={`state-signal state-signal--${state}`} aria-hidden="true">
          <span />
        </div>
        <p className="eyebrow">{current.eyebrow}</p>
        <h1>{current.title}</h1>
        <p className="description">{current.description}</p>

        {state === 'success' ? (
          <dl className="system-facts">
            <div>
              <dt>Protocol</dt>
              <dd>0.1-draft.1</dd>
            </div>
            <div>
              <dt>Identity model</dt>
              <dd>Human + AI</dd>
            </div>
            <div>
              <dt>Exposure</dt>
              <dd>Protected only</dd>
            </div>
          </dl>
        ) : null}

        {state === 'error' ? (
          <Link className="text-action" href="/">
            重新检查
          </Link>
        ) : null}

        {state === 'empty' ? (
          <Link className="text-action" href="/">
            查看工程状态
          </Link>
        ) : null}
      </section> : <AccountGateway returnTo={returnTo} registrationClientId={registrationClientId} />}

      <footer className="foundation-footer">
        <p>AI CARD SYSTEM</p>
        <p>Identity / Control / Authorization</p>
      </footer>
    </main>
  );
}
