import { describe, expect, it } from 'vitest';

import {
  createCardId,
  createPairwiseSubject,
  createPrincipalId,
} from '@/domain/identity/ids';

describe('AI Card identifiers', () => {
  it('creates canonical UUIDv7 principal IDs', () => {
    expect(createPrincipalId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('creates unique public Card IDs from the locked Crockford alphabet', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createCardId()));

    expect(ids).toHaveLength(100);
    for (const id of ids) {
      expect(id).toMatch(/^aic_[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });

  it('creates unique pairwise subjects with 256 bits of encoded material', () => {
    const subjects = new Set(Array.from({ length: 100 }, () => createPairwiseSubject()));

    expect(subjects).toHaveLength(100);
    for (const subject of subjects) {
      expect(subject).toMatch(/^sub_[A-Za-z0-9_-]{43}$/);
    }
  });
});
