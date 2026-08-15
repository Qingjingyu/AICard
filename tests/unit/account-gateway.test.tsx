import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { AccountGateway } from '@/components/auth/account-gateway';

describe('Account gateway', () => {
  it('defaults to the unified password registration experience', () => {
    const html = renderToStaticMarkup(<AccountGateway />);

    expect(html).toContain('创建 AI Card');
    expect(html).toContain('name="displayName"');
    expect(html).toContain('name="handle"');
    expect(html).toContain('name="password"');
    expect(html).toContain('type="password"');
    expect(html).toContain('minLength="8"');
    expect(html).toContain('密码至少 8 个字符');
    expect(html).not.toContain('Passkey 创建');
  });

  it('submits the server-validated registration source instead of a hard-coded product', () => {
    const direct = renderToStaticMarkup(<AccountGateway registrationClientId="aicard_web" />);
    const product = renderToStaticMarkup(<AccountGateway registrationClientId="test_client" />);

    expect(direct).toContain('data-registration-client="aicard_web"');
    expect(product).toContain('data-registration-client="test_client"');
    expect(product).not.toContain('data-registration-client="yoyoo_dev"');
  });
});
