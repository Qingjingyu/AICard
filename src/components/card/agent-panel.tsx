'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export type ManagedAgentView = {
  invitationId: string;
  cardId: string | null;
  displayName: string;
  handle: string | null;
  invitationStatus: 'pending' | 'claimed' | 'expired' | 'revoked';
  expiresAt: string;
  nodeId: string | null;
  machineName: string | null;
  connectionStatus: 'connected' | 'offline' | 'revoked' | null;
  lastAuthenticatedAt: string | null;
};

type InvitationResponse = {
  invitationId: string;
  expiresAt: string;
  instructions: string;
  identity: { cardId: string | null; displayName: string; handle: string | null };
  error?: { message?: string };
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

const statusText = {
  pending: '等待认领',
  claimed: '已认领',
  expired: '已过期',
  revoked: '已撤销',
} as const;

export function AgentPanel({ agents }: { agents: ManagedAgentView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [instructions, setInstructions] = useState('');

  async function createInvitation(formData: FormData) {
    setBusy('create');
    setMessage('正在创建 AI Card 和一次性邀请…');
    setInstructions('');
    try {
      const result = await readJson<InvitationResponse>(await fetch('/api/v1/agent-invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({
          displayName: formData.get('displayName'),
        }),
      }));
      setInstructions(result.instructions);
      setMessage('邀请已创建。完整指令只在这里显示一次，请立即交给目标 Agent。');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建邀请失败');
    } finally {
      setBusy(null);
    }
  }

  async function createNodeInvitation(cardId: string) {
    setBusy(cardId);
    setMessage('正在为现有 AI Card 创建新的节点邀请…');
    setInstructions('');
    try {
      const result = await readJson<InvitationResponse>(await fetch('/api/v1/agent-invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({ cardId }),
      }));
      setInstructions(result.instructions);
      setMessage('新节点邀请已创建，完整指令只显示一次。');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建节点邀请失败');
    } finally {
      setBusy(null);
    }
  }

  async function copyInstructions() {
    try {
      await navigator.clipboard.writeText(instructions);
      setMessage('完整接入指令已复制。');
    } catch {
      setMessage('浏览器未允许复制，请手动选择指令文本。');
    }
  }

  async function revokeNode(nodeId: string) {
    setBusy(nodeId);
    setMessage('正在撤销运行节点…');
    try {
      await readJson(await fetch(`/api/v1/agent-nodes/${encodeURIComponent(nodeId)}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken() },
      }));
      setMessage('运行节点已撤销，后续认证将被拒绝。');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '撤销节点失败');
    } finally {
      setBusy(null);
    }
  }

  async function revokeInvitation(invitationId: string) {
    setBusy(invitationId);
    setMessage('正在撤销邀请…');
    try {
      await readJson(await fetch(`/api/v1/agent-invitations/${encodeURIComponent(invitationId)}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken() },
      }));
      setMessage('邀请已撤销，原指令中的票据不再有效。');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '撤销邀请失败');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="agent-panel" aria-labelledby="agent-panel-title">
      <header>
        <div>
          <p className="eyebrow">CONTROL / AI IDENTITIES</p>
          <h2 id="agent-panel-title">AI 身份</h2>
        </div>
        <span>{agents.length.toString().padStart(2, '0')}</span>
      </header>

      <form action={createInvitation} className="agent-panel__form">
        <label>
          <span>中文昵称</span>
          <input name="displayName" required maxLength={64} placeholder="例如：悠悠助理" />
        </label>
        <button type="submit" disabled={busy !== null}>创建邀请</button>
      </form>

      {instructions ? (
        <div className="agent-panel__instruction" aria-label="一次性完整接入指令">
          <div>
            <strong>仅显示一次</strong>
            <button type="button" onClick={copyInstructions}>复制完整指令</button>
          </div>
          <textarea readOnly value={instructions} rows={12} aria-label="完整接入指令" />
        </div>
      ) : null}

      {agents.length ? (
        <ul className="agent-panel__list">
          {agents.map((agent) => (
            <li key={agent.invitationId}>
              <div className="agent-panel__identity">
                <strong>{agent.displayName}</strong>
                <span>{agent.handle && agent.cardId ? `@${agent.handle} · ${agent.cardId}` : '认领成功后自动颁发 AI Card'}</span>
              </div>
              <div className="agent-panel__state">
                <span data-state={agent.connectionStatus ?? agent.invitationStatus}>
                  {agent.connectionStatus === 'connected' ? '已连接' : agent.connectionStatus === 'offline'
                    ? '离线' : agent.connectionStatus === 'revoked' ? '已撤销' : statusText[agent.invitationStatus]}
                </span>
                {agent.machineName ? <small>{agent.machineName}</small> : (
                  <small>有效至 {new Date(agent.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small>
                )}
              </div>
              <div className="agent-panel__actions">
                {agent.nodeId && agent.cardId && agent.connectionStatus !== 'revoked' ? (
                  <>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => createNodeInvitation(agent.cardId!)}
                    >添加节点</button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => revokeNode(agent.nodeId!)}
                    >撤销节点</button>
                  </>
                ) : null}
                {!agent.nodeId && agent.invitationStatus === 'pending' ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => revokeInvitation(agent.invitationId)}
                  >撤销邀请</button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="agent-panel__empty">还没有受你控制的 AI 身份。创建邀请后，把完整指令交给目标 Agent。</p>}

      <footer><p aria-live="polite">{message || '邀请票据不会再次显示，Agent 私钥永远留在其本机。'}</p></footer>
    </section>
  );
}
