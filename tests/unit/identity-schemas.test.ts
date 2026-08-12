import { describe, expect, it } from 'vitest';

import {
  createCardInputSchema,
  handleSchema,
  platformClientIdSchema,
} from '@/domain/identity/schemas';

describe('AI Card identity schemas', () => {
  it('normalizes a Chinese display name and a case-insensitive handle', () => {
    const result = createCardInputSchema.parse({
      principalType: 'human',
      displayName: '  ＡＩ 苏白  ',
      handle: 'SuBai_AI',
    });

    expect(result.displayName).toBe('AI 苏白');
    expect(result.handle).toBe('subai_ai');
  });

  it.each(['苏\n白', '苏\u200B白', '苏\u202E白'])('rejects unsafe display name %j', (displayName) => {
    expect(() => createCardInputSchema.parse({
      principalType: 'human',
      displayName,
      handle: 'subai_user',
    })).toThrow();
  });

  it.each(['ab', '1agent', 'agent-name', 'agent name'])('rejects invalid handle %j', (handle) => {
    expect(() => handleSchema.parse(handle)).toThrow();
  });

  it('rejects an unsafe platform client ID', () => {
    expect(platformClientIdSchema.safeParse('../yoyoo')).toMatchObject({ success: false });
  });
});
