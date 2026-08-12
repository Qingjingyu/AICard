'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export type PlatformGrantView = {
  grantId: string;
  clientId: string;
  clientDisplayName: string;
  audience: string;
  scopes: string[];
  status: 'active' | 'revoked';
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  subject: {
    principalType: 'human' | 'ai';
    cardId: string;
    displayName: string;
    handle: string;
  };
};

function csrfToken(): string {
  const value = document.cookie.split('; ').find((cookie) => cookie.startsWith('aicard_csrf='));
  return value ? decodeURIComponent(value.slice('aicard_csrf='.length)) : '';
}

const scopeNames: Record<string, string> = {
  'card.basic': '基础资料',
  'card.handle': '@Handle',
  'card.id': 'Card ID',
  offline_access: '长期访问',
  'agent.runtime': 'Agent 运行权限',
};

export function PlatformGrants({ grants }: { grants: PlatformGrantView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('授权可随时撤销；撤销后平台令牌将立即失效。');
  const [state, setState] = useState<'ready' | 'loading' | 'error' | 'success'>('ready');
  const grantGroups = grants.reduce<Array<{
    subject: PlatformGrantView['subject'];
    grants: PlatformGrantView[];
  }>>((groups, grant) => {
    const current = groups.at(-1);
    if (current?.subject.cardId === grant.subject.cardId) {
      current.grants.push(grant);
    } else {
      groups.push({ subject: grant.subject, grants: [grant] });
    }
    return groups;
  }, []);

  async function revoke(grantId: string) {
    setBusy(grantId);
    setState('loading');
    setMessage('正在撤销平台访问…');
    try {
      const response = await fetch('/api/v1/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({ grantId }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? '撤销没有完成');
      setState('success');
      setMessage('平台访问已撤销，关联令牌已失效。');
      router.refresh();
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : '撤销没有完成');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="security-panel grant-panel" aria-labelledby="grant-title">
      <header>
        <div>
          <p className="eyebrow">CONTROL / AUTHORIZATIONS</p>
          <h2 id="grant-title">平台授权</h2>
        </div>
        <span className="grant-panel__count">{grants.length.toString().padStart(2, '0')}</span>
      </header>

      {grantGroups.length ? (
        <div className="grant-panel__groups">
          {grantGroups.map((group) => (
            <section className="grant-panel__group" key={group.subject.cardId}>
              <header>
                <div>
                  <strong>{group.subject.displayName}</strong>
                  <span>@{group.subject.handle}</span>
                </div>
                <small>{group.subject.principalType === 'ai' ? 'AI 身份' : '我的身份'}</small>
              </header>
              <ul className="security-panel__list grant-panel__list">
                {group.grants.map((grant) => (
                  <li key={grant.grantId} data-revoked={grant.status === 'revoked'}>
                    <div>
                      <strong>{grant.clientDisplayName}</strong>
                      <span>{grant.scopes.map((scope) => scopeNames[scope] ?? scope).join(' · ')}</span>
                      <small>
                        {grant.lastUsedAt
                          ? `最近使用 ${new Date(grant.lastUsedAt).toLocaleString('zh-CN')}`
                          : `授权于 ${new Date(grant.createdAt).toLocaleDateString('zh-CN')}`}
                      </small>
                    </div>
                    {grant.status === 'active' ? (
                      <button type="button" disabled={busy !== null} onClick={() => revoke(grant.grantId)}>
                        {busy === grant.grantId ? '撤销中' : '撤销访问'}
                      </button>
                    ) : <span className="grant-panel__revoked">已撤销</span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="security-panel__empty">你和当前受控 AI 还没有平台授权。</p>
      )}

      <footer>
        <p className={`grant-panel__feedback grant-panel__feedback--${state}`} aria-live="polite">{message}</p>
      </footer>
    </section>
  );
}
