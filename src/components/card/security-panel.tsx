'use client';

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export type CredentialView = {
  credentialId: string;
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

function csrfToken(): string {
  const value = document.cookie.split('; ').find((cookie) => cookie.startsWith('aicard_csrf='));
  return value ? decodeURIComponent(value.slice('aicard_csrf='.length)) : '';
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? '请求没有完成');
  return body;
}

export function SecurityPanel({ credentials }: { credentials: CredentialView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const active = credentials.filter((credential) => !credential.revokedAt);

  async function addCredential() {
    setBusy('add');
    setMessage('正在准备新的 Passkey…');
    try {
      const begun = await readJson<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>(
        await fetch('/api/v1/auth/passkey/register/options', {
          method: 'POST',
          headers: { 'x-csrf-token': csrfToken() },
        }),
      );
      const credential = await startRegistration({ optionsJSON: begun.options });
      await readJson(await fetch('/api/v1/auth/passkey/register/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({ challengeId: begun.challengeId, response: credential }),
      }));
      setMessage('新的 Passkey 已加入。');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '新增 Passkey 失败');
    } finally {
      setBusy(null);
    }
  }

  async function reverify() {
    setBusy('verify');
    setMessage('请验证当前 Passkey…');
    try {
      const begun = await readJson<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>(
        await fetch('/api/v1/auth/passkey/login/options', {
          method: 'POST',
          headers: { 'x-csrf-token': csrfToken() },
        }),
      );
      const credential = await startAuthentication({ optionsJSON: begun.options });
      await readJson(await fetch('/api/v1/auth/passkey/login/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeId: begun.challengeId, response: credential }),
      }));
      setMessage('身份已重新验证。');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '重新验证失败');
    } finally {
      setBusy(null);
    }
  }

  async function revoke(credentialId: string) {
    setBusy(credentialId);
    setMessage('正在撤销凭据…');
    try {
      await readJson(await fetch(`/api/v1/me/credentials/${encodeURIComponent(credentialId)}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken() },
      }));
      setMessage('Passkey 已撤销。');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '撤销失败');
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    setBusy('logout');
    try {
      await readJson(await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken() },
      }));
      router.push('/');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '退出失败');
      setBusy(null);
    }
  }

  return (
    <section className="security-panel" aria-labelledby="security-title">
      <header>
        <div>
          <p className="eyebrow">CONTROL / CREDENTIALS</p>
          <h2 id="security-title">身份控制</h2>
        </div>
        <button type="button" onClick={reverify} disabled={busy !== null}>重新验证</button>
      </header>

      {credentials.length > 0 ? <ul className="security-panel__list">
        {credentials.map((credential, index) => (
          <li key={credential.credentialId} data-revoked={Boolean(credential.revokedAt)}>
            <div>
              <strong>Passkey {String(index + 1).padStart(2, '0')}</strong>
              <span>{credential.deviceType === 'multiDevice' ? '同步凭据' : '本机凭据'} · {credential.backedUp ? '已备份' : '未备份'}</span>
            </div>
            <div className="security-panel__meta">
              <span>{new Date(credential.createdAt).toLocaleDateString('zh-CN')}</span>
              {!credential.revokedAt ? (
                <button
                  type="button"
                  onClick={() => revoke(credential.credentialId)}
                  disabled={busy !== null || active.length <= 1}
                  title={active.length <= 1 ? '最后一个有效 Passkey 不能撤销' : '撤销此 Passkey'}
                >撤销</button>
              ) : <span>已撤销</span>}
            </div>
          </li>
        ))}
      </ul> : <p className="security-panel__empty">没有可用凭据。为保护身份，当前会话不能继续执行敏感操作。</p>}

      <footer>
        <p aria-live="polite">{message || '私钥不会上传或显示。'}</p>
        <div>
          <button type="button" onClick={addCredential} disabled={busy !== null}>添加 Passkey</button>
          <button type="button" onClick={logout} disabled={busy !== null}>退出</button>
        </div>
      </footer>
    </section>
  );
}
