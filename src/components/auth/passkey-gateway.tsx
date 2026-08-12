'use client';

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Mode = 'create' | 'login';
type ViewState = 'idle' | 'loading' | 'error' | 'success';

type OptionsResponse<T> = { challengeId: string; options: T };

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? '请求没有完成');
  return body;
}

export function PasskeyGateway({ returnTo = '/me/card' }: { returnTo?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('create');
  const [viewState, setViewState] = useState<ViewState>('idle');
  const [message, setMessage] = useState('');

  async function submit(formData: FormData) {
    if (!window.PublicKeyCredential) {
      setViewState('error');
      setMessage('当前浏览器不支持 Passkey，请使用最新版系统浏览器。');
      return;
    }
    setViewState('loading');
    setMessage(mode === 'create' ? '正在创建安全凭据…' : '正在验证你的身份…');

    try {
      if (mode === 'create') {
        const options = await readJson<OptionsResponse<PublicKeyCredentialCreationOptionsJSON>>(
          await fetch('/api/v1/auth/passkey/register/options', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              displayName: String(formData.get('displayName') ?? ''),
              handle: String(formData.get('handle') ?? ''),
            }),
          }),
        );
        const credential = await startRegistration({ optionsJSON: options.options });
        await readJson(await fetch('/api/v1/auth/passkey/register/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ challengeId: options.challengeId, response: credential }),
        }));
      } else {
        const options = await readJson<OptionsResponse<PublicKeyCredentialRequestOptionsJSON>>(
          await fetch('/api/v1/auth/passkey/login/options', { method: 'POST' }),
        );
        const credential = await startAuthentication({ optionsJSON: options.options });
        await readJson(await fetch('/api/v1/auth/passkey/login/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ challengeId: options.challengeId, response: credential }),
        }));
      }
      setViewState('success');
      setMessage('身份已确认，正在打开 Card…');
      router.push(returnTo);
      router.refresh();
    } catch (error) {
      setViewState('error');
      setMessage(error instanceof Error ? error.message : 'Passkey 操作没有完成');
    }
  }

  return (
    <section className="auth-gateway" aria-labelledby="auth-title">
      <div className="auth-gateway__signal" aria-hidden="true"><span /></div>
      <p className="eyebrow">IDENTITY / PASSKEY</p>
      <h1 id="auth-title">你的 AI 时代身份</h1>
      <p className="description">创建一次，在 Yoyoo 与未来服务中证明你是谁。密钥只留在你的设备里。</p>

      <div className="auth-gateway__modes" aria-label="身份入口">
        <button type="button" aria-pressed={mode === 'create'} onClick={() => { setMode('create'); setViewState('idle'); }}>
          创建 Card
        </button>
        <button type="button" aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setViewState('idle'); }}>
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
        ) : null}
        <button className="auth-gateway__primary" type="submit" disabled={viewState === 'loading'}>
          {viewState === 'loading' ? '请在设备上确认' : mode === 'create' ? '使用 Passkey 创建' : '使用 Passkey 登录'}
        </button>
      </form>

      <p className={`auth-gateway__feedback auth-gateway__feedback--${viewState}`} aria-live="polite">
        {message || '支持 Touch ID、Face ID、Windows Hello 与安全密钥。'}
      </p>
    </section>
  );
}
