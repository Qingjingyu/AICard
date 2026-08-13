'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Mode = 'create' | 'login';
type ViewState = 'idle' | 'loading' | 'error' | 'success';

function createIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? '请求没有完成');
  return body;
}

export function AccountGateway({
  returnTo = '/me/card',
  registrationClientId = 'aicard_web',
}: {
  returnTo?: string;
  registrationClientId?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('create');
  const [viewState, setViewState] = useState<ViewState>('idle');
  const [message, setMessage] = useState('');

  async function submit(formData: FormData) {
    setViewState('loading');
    setMessage(mode === 'create' ? '正在签发你的永久 AI Card…' : '正在验证账号…');
    try {
      const password = String(formData.get('password') ?? '');
      if (mode === 'create') {
        await readJson(await fetch('/api/v1/auth/password/register', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': createIdempotencyKey(),
          },
          body: JSON.stringify({
            clientId: registrationClientId,
            displayName: String(formData.get('displayName') ?? ''),
            handle: String(formData.get('handle') ?? ''),
            password,
          }),
        }));
      } else {
        await readJson(await fetch('/api/v1/auth/password/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            identifier: String(formData.get('identifier') ?? ''),
            password,
          }),
        }));
      }
      setViewState('success');
      setMessage('身份已确认，正在打开你的 AI Card…');
      router.push(returnTo);
      router.refresh();
    } catch (error) {
      setViewState('error');
      setMessage(error instanceof Error ? error.message : '账号操作没有完成');
    }
  }

  return (
    <section
      className="auth-gateway"
      aria-labelledby="auth-title"
      data-registration-client={registrationClientId}
    >
      <div className="auth-gateway__signal" aria-hidden="true"><span /></div>
      <p className="eyebrow">IDENTITY / ACCOUNT</p>
      <h1 id="auth-title">你的 AI 时代身份</h1>
      <p className="description">首次创建会自动签发永久 AI Card。之后在 Yoyoo 与其他服务中使用同一个身份。</p>

      <div className="auth-gateway__modes" aria-label="身份入口">
        <button type="button" aria-pressed={mode === 'create'} onClick={() => { setMode('create'); setViewState('idle'); setMessage(''); }}>
          创建 AI Card
        </button>
        <button type="button" aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setViewState('idle'); setMessage(''); }}>
          登录
        </button>
      </div>

      <form action={submit} className="auth-gateway__form">
        {mode === 'create' ? (
          <>
            <label>
              <span>昵称</span>
              <input name="displayName" autoComplete="name" maxLength={64} placeholder="例如：苏白" required />
            </label>
            <label>
              <span>@Handle</span>
              <input name="handle" autoCapitalize="none" autoComplete="username" pattern="[a-z][a-z0-9_]{2,31}" placeholder="例如：subai" required />
            </label>
          </>
        ) : (
          <label>
            <span>AI Card ID 或 @Handle</span>
            <input name="identifier" autoCapitalize="none" autoComplete="username" placeholder="AI_100001 或 @subai" required />
          </label>
        )}
        <label>
          <span>密码</span>
          <input name="password" type="password" minLength={12} maxLength={128} autoComplete={mode === 'create' ? 'new-password' : 'current-password'} required />
        </label>
        <button className="auth-gateway__primary" type="submit" disabled={viewState === 'loading'}>
          {viewState === 'loading' ? '请稍候' : mode === 'create' ? '创建 AI Card' : '登录'}
        </button>
      </form>

      <p className={`auth-gateway__feedback auth-gateway__feedback--${viewState}`} aria-live="polite">
        {message || (mode === 'create' ? '密码至少 12 个字符。创建后可在安全设置中添加 Passkey。' : '使用你的永久编号或唯一 @Handle 登录。')}
      </p>
    </section>
  );
}
