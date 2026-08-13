import { describe, expect, it } from 'vitest';

import {
  createPairwiseSubject,
  createPrincipalId,
} from '@/domain/identity/ids';
import { cardIdSchema } from '@/domain/identity/schemas';
import { publicCardLookupSchema } from '@/domain/identity/schemas';

describe('AI Card identifiers', () => {
  it('creates canonical UUIDv7 principal IDs', () => {
    expect(createPrincipalId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('accepts only authoritative public IDs allocated by the database', () => {
    expect(cardIdSchema.parse('AI_100001')).toBe('AI_100001');
    expect(cardIdSchema.parse('AI_999999')).toBe('AI_999999');
    expect(cardIdSchema.safeParse('AI_099999').success).toBe(false);
    expect(cardIdSchema.safeParse('ai_100001').success).toBe(false);
    expect(cardIdSchema.safeParse('aic_01J4Z7Y8K9M2N3P4Q5R6S7T8VW').success).toBe(false);
    expect(publicCardLookupSchema.parse('aic_01J4Z7Y8K9M2N3P4Q5R6S7T8VW'))
      .toBe('aic_01J4Z7Y8K9M2N3P4Q5R6S7T8VW');
  });

  it('creates unique pairwise subjects with 256 bits of encoded material', () => {
    const subjects = new Set(Array.from({ length: 100 }, () => createPairwiseSubject()));

    expect(subjects).toHaveLength(100);
    for (const subject of subjects) {
      expect(subject).toMatch(/^sub_[A-Za-z0-9_-]{43}$/);
    }
  });
});
