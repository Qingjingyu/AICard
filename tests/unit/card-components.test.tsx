import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CardBack } from '@/components/card/card-back';
import { CardFront } from '@/components/card/card-front';

const publicCard = {
  card_id: 'AI_100001',
  handle: 'yoyoo_assistant',
  display_name: '悠悠',
  principal_type: 'ai' as const,
  avatar_url: null,
  bio: '数字员工',
  status: 'active' as const,
};

describe('AI Card views', () => {
  it('renders the public identity without internal identifiers', () => {
    const html = renderToStaticMarkup(<CardFront card={publicCard} />);

    expect(html).toContain('悠悠');
    expect(html).toContain('@yoyoo_assistant');
    expect(html).toContain(publicCard.card_id);
    expect(html).not.toMatch(/principal[_-]?id/i);
  });

  it('renders private management metadata without secret material', () => {
    const html = renderToStaticMarkup(<CardBack card={{
      card: publicCard,
      controllers: [{
        card_id: 'AI_100002',
        display_name: '苏白',
        handle: 'subai_user',
        verified_at: '2026-08-08T00:00:00.000Z',
      }],
      handle_history: [{
        handle: 'yoyoo_old',
        retired_at: '2026-08-08T00:00:00.000Z',
      }],
      lifecycle: {
        status: 'active',
        created_at: '2026-08-08T00:00:00.000Z',
        updated_at: '2026-08-08T00:00:00.000Z',
      },
    }} />);

    expect(html).toContain('苏白');
    expect(html).toContain('@yoyoo_old');
    expect(html).not.toMatch(/token|secret|private[_-]?key/i);
  });
});
