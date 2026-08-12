'use client';

import { useState } from 'react';

import type { RawAuthorizationRequest } from '@/server/authorization/authorization-service';

type ConsentState = 'ready' | 'loading' | 'error' | 'success';

const scopeDescriptions: Record<string, string> = {
  'card.basic': '昵称、身份类型和头像',
  'card.handle': '@Handle',
  'card.id': '全局 AI Card ID',
  offline_access: '保持长期访问（可随时撤销）',
  'agent.runtime': '作为 Agent 连接并领取平台任务',
};

function readCookie(name: string): string | undefined {
  return document.cookie
    .split(';')
    .map((item) => item.trim().split('='))
    .find(([key]) => key === name)
    ?.[1];
}

export function ConsentPanel(input: {
  clientName: string;
  scopes: string[];
  request: RawAuthorizationRequest;
  subjectOptions?: Array<{
    principalId?: string;
    cardId: string;
    displayName: string;
    handle: string;
  }>;
}) {
  const [state, setState] = useState<ConsentState>('ready');
  const [message, setMessage] = useState('确认后只会向这个平台发送下列信息。');
  const [subjectCardId, setSubjectCardId] = useState(input.subjectOptions?.[0]?.cardId ?? '');
  const requiresAIIdentity = input.request.principalType === 'ai';

  async function decide(decision: 'approve' | 'deny') {
    setState('loading');
    setMessage(decision === 'approve' ? '正在创建一次性授权…' : '正在拒绝授权…');
    try {
      const csrf = readCookie('aicard_csrf');
      const response = await fetch('/api/v1/authorize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}),
        },
        body: JSON.stringify({
          decision,
          request: input.request,
          ...(requiresAIIdentity ? { subjectCardId } : {}),
        }),
      });
      const body = await response.json() as {
        redirect_url?: string;
        error?: { message?: string };
      };
      if (!response.ok || !body.redirect_url) {
        throw new Error(body.error?.message ?? '授权决定没有完成');
      }
      setState('success');
      setMessage(decision === 'approve' ? '已批准，正在返回平台…' : '已拒绝，正在返回平台…');
      window.location.assign(body.redirect_url);
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : '授权决定没有完成');
    }
  }

  return (
    <section className="consent-panel" aria-labelledby="consent-title">
      <div className="consent-panel__signal" aria-hidden="true"><span /></div>
      <p className="eyebrow">PLATFORM AUTHORIZATION</p>
      <h1 id="consent-title">允许 {input.clientName} 认识你？</h1>
      <p className="description">AI Card 只分享你在本次授权中明确允许的身份字段。</p>

      {requiresAIIdentity ? (
        <div className="consent-panel__subjects" aria-label="选择要连接的 AI 身份">
          <p>选择要连接的 AI 身份</p>
          {input.subjectOptions?.length ? (
            <div className="consent-panel__subject-list">
              {input.subjectOptions.map((option) => (
                <label key={option.cardId}>
                  <input
                    checked={subjectCardId === option.cardId}
                    name="subject-card"
                    onChange={() => setSubjectCardId(option.cardId)}
                    type="radio"
                    value={option.cardId}
                  />
                  <span><strong>{option.displayName}</strong><small>@{option.handle}</small></span>
                </label>
              ))}
            </div>
          ) : (
            <div className="consent-panel__subject-empty" role="status">
              <strong>还没有可授权的 AI 身份</strong>
              <span>先创建并认领一张 AI Card，再返回继续连接。</span>
            </div>
          )}
        </div>
      ) : null}

      <div className="consent-panel__access" aria-label="请求的信息">
        <p>将允许访问</p>
        <ul>
          {input.scopes.map((scope) => (
            <li key={scope}>
              <span aria-hidden="true" />
              <div><strong>{scopeDescriptions[scope]}</strong><small>{scope}</small></div>
            </li>
          ))}
        </ul>
      </div>

      <p className={`consent-panel__feedback consent-panel__feedback--${state}`} aria-live="polite">
        {message}
      </p>
      <div className="consent-panel__actions">
        <button type="button" onClick={() => decide('deny')} disabled={state === 'loading' || state === 'success'}>
          拒绝
        </button>
        <button
          type="button"
          onClick={() => decide('approve')}
          disabled={state === 'loading' || state === 'success' || (requiresAIIdentity && !subjectCardId)}
        >
          {state === 'loading' ? '处理中' : '允许访问'}
        </button>
      </div>
      <small className="consent-panel__notice">授权码将在 5 分钟后失效，且只能使用一次。</small>
    </section>
  );
}
