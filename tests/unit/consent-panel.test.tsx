import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ConsentPanel } from '@/components/consent/consent-panel';

const request = {
  responseType: 'code',
  clientId: 'yoyoo_dev',
  redirectUri: 'http://localhost:4173/auth/aicard/callback',
  scope: 'card.basic card.handle',
  state: 'state_1234567890',
  codeChallenge: 'challenge_12345678901234567890123456789012',
  codeChallengeMethod: 'S256',
  principalType: 'ai',
};

describe('platform consent identity selection', () => {
  it('shows controlled AI identities as explicit authorization subjects', () => {
    const html = renderToStaticMarkup(
      <ConsentPanel
        clientName="Yoyoo"
        request={request}
        scopes={['card.basic', 'card.handle', 'agent.runtime']}
        subjectOptions={[{
          principalId: '019c0000-0000-7000-8000-000000000001',
          cardId: 'aic_01J4Z7Y8K9M2N3P4Q5R6S7T8VW',
          displayName: '悠悠助理',
          handle: 'yoyoo_assistant',
        }]}
      />,
    );

    expect(html).toContain('选择要连接的 AI 身份');
    expect(html).toContain('悠悠助理');
    expect(html).toContain('@yoyoo_assistant');
    expect(html).toContain('作为 Agent 连接并领取平台任务');
    expect(html).not.toContain('019c0000-0000-7000-8000-000000000001');
  });

  it('shows an empty state and disables approval when no AI identity is controlled', () => {
    const html = renderToStaticMarkup(
      <ConsentPanel
        clientName="Yoyoo"
        request={request}
        scopes={['card.basic']}
        subjectOptions={[]}
      />,
    );

    expect(html).toContain('还没有可授权的 AI 身份');
    expect(html).toContain('先创建并认领一张 AI Card');
    expect(html).toMatch(/允许访问<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>允许访问<\/button>/);
  });
});
