import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../infra/postgres/migration-runner';
import { IdentityConflictError, IdentityStateError } from '@/server/identity-errors';
import { IdentityService } from '@/server/identity-service';
import { PostgresIdentityRepository } from '@/server/postgres/identity-repository';
import { createPostgresPool } from '@/server/postgres/pool';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for identity integration tests');
}

const pool = createPostgresPool(databaseUrl);
const repository = new PostgresIdentityRepository(pool);
const service = new IdentityService(repository);

function uniqueHandle(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

beforeAll(async () => {
  await runMigrations(pool, resolve('infra/postgres/migrations'));
});

beforeEach(async () => {
  await pool.query('delete from principals');
  await pool.query("select setval('ai_card_public_id_sequence', 100001, false)");
});

afterAll(async () => {
  await pool.end();
});

describe('PostgreSQL identity repository', () => {
  it('creates a human Card with separate permanent and internal identifiers', async () => {
    const card = await service.createCard({
      principalType: 'human',
      displayName: '  苏白  ',
      handle: uniqueHandle('subai'),
    });

    expect(card.displayName).toBe('苏白');
    expect(card.cardId).toBe('AI_100001');
    expect(card.principalId).toMatch(/-7[0-9a-f]{3}-/);
    expect(card.cardId).not.toContain(card.principalId);
    expect(await service.getPublicCard(card.cardId)).toMatchObject({
      card_id: card.cardId,
      display_name: '苏白',
      principal_type: 'human',
    });
  });

  it('allocates one shared monotonic sequence to humans and AI under concurrency', async () => {
    const controller = await service.createCard({
      principalType: 'human',
      displayName: '控制者',
      handle: uniqueHandle('sequence_controller'),
    });
    const cards = await Promise.all([
      service.createCard({
        principalType: 'human',
        displayName: '第二个人类',
        handle: uniqueHandle('sequence_human'),
      }),
      service.createCard({
        principalType: 'ai',
        displayName: '第一个 AI',
        handle: uniqueHandle('sequence_ai_one'),
        controllerPrincipalId: controller.principalId,
      }),
      service.createCard({
        principalType: 'ai',
        displayName: '第二个 AI',
        handle: uniqueHandle('sequence_ai_two'),
        controllerPrincipalId: controller.principalId,
      }),
    ]);

    expect(controller.cardId).toBe('AI_100001');
    expect(new Set(cards.map((card) => card.cardId))).toEqual(new Set([
      'AI_100002',
      'AI_100003',
      'AI_100004',
    ]));
  });

  it('rejects caller-selected or mutated public Card IDs', async () => {
    const principal = await service.createCard({
      principalType: 'human',
      displayName: '权威编号测试',
      handle: uniqueHandle('issuer_only'),
    });

    await expect(pool.query(
      'update ai_cards set card_id = $1 where card_id = $2',
      ['AI_777777', principal.cardId],
    )).rejects.toThrow();

    const directPrincipalId = '018f4f5d-8f6a-7a13-8e2c-1f21f3489a99';
    await pool.query(
      'insert into principals (principal_id, principal_type) values ($1, $2)',
      [directPrincipalId, 'human'],
    );
    await expect(pool.query(
      `insert into ai_cards (card_id, principal_id, display_name)
       values ($1, $2, $3)`,
      ['AI_777777', directPrincipalId, '伪造编号'],
    )).rejects.toThrow();
  });

  it('resolves a migrated legacy ID as a read-only alias to the permanent Card', async () => {
    const card = await service.createCard({
      principalType: 'human',
      displayName: '旧链接兼容',
      handle: uniqueHandle('legacy_alias'),
    });
    const legacyId = 'aic_01J4Z7Y8K9M2N3P4Q5R6S7T8VW';
    await pool.query(
      'insert into ai_card_id_aliases (old_card_id, card_id) values ($1, $2)',
      [legacyId, card.cardId],
    );

    expect(await service.getPublicCard(legacyId)).toMatchObject({ card_id: card.cardId });
  });

  it('reserves current and historical handles case-insensitively', async () => {
    const originalHandle = uniqueHandle('agent');
    const first = await service.createCard({
      principalType: 'human',
      displayName: '第一位用户',
      handle: originalHandle.toUpperCase(),
    });

    const nextHandle = uniqueHandle('renamed');
    await service.changeHandle(first.cardId, nextHandle);

    await expect(service.createCard({
      principalType: 'human',
      displayName: '第二位用户',
      handle: originalHandle,
    })).rejects.toBeInstanceOf(IdentityConflictError);

    const privateCard = await service.getPrivateCard(first.principalId);
    expect(privateCard.handle_history).toEqual([
      expect.objectContaining({ handle: originalHandle.toLowerCase() }),
    ]);
  });

  it('requires a verified human controller for an AI Card', async () => {
    const human = await service.createCard({
      principalType: 'human',
      displayName: '控制者',
      handle: uniqueHandle('controller'),
    });
    const ai = await service.createCard({
      principalType: 'ai',
      displayName: '悠悠',
      handle: uniqueHandle('yoyoo'),
      controllerPrincipalId: human.principalId,
    });

    const privateCard = await service.getPrivateCard(ai.principalId);
    expect(privateCard.controllers).toEqual([
      expect.objectContaining({ card_id: human.cardId, display_name: '控制者' }),
    ]);

    await expect(service.createCard({
      principalType: 'ai',
      displayName: '无责任主体',
      handle: uniqueHandle('orphan'),
      controllerPrincipalId: ai.principalId,
    })).rejects.toBeInstanceOf(IdentityStateError);
  });

  it('lists only active AI Cards controlled by the current human', async () => {
    const controller = await service.createCard({
      principalType: 'human',
      displayName: '当前控制者',
      handle: uniqueHandle('current_controller'),
    });
    const otherController = await service.createCard({
      principalType: 'human',
      displayName: '其他控制者',
      handle: uniqueHandle('other_controller'),
    });
    const active = await service.createCard({
      principalType: 'ai',
      displayName: '可授权助理',
      handle: uniqueHandle('active_agent'),
      controllerPrincipalId: controller.principalId,
    });
    const suspended = await service.createCard({
      principalType: 'ai',
      displayName: '暂停助理',
      handle: uniqueHandle('suspended_agent'),
      controllerPrincipalId: controller.principalId,
    });
    await service.changeStatus(suspended.cardId, 'suspended');
    await service.createCard({
      principalType: 'ai',
      displayName: '外部助理',
      handle: uniqueHandle('foreign_agent'),
      controllerPrincipalId: otherController.principalId,
    });

    expect(await service.listControlledCards(controller.principalId)).toEqual([
      expect.objectContaining({
        principalId: active.principalId,
        cardId: active.cardId,
        displayName: '可授权助理',
      }),
    ]);

    await service.changeStatus(controller.cardId, 'suspended');
    expect(await service.listControlledCards(controller.principalId)).toEqual([]);
  });

  it('treats retired as a terminal Card state', async () => {
    const card = await service.createCard({
      principalType: 'human',
      displayName: '生命周期测试',
      handle: uniqueHandle('lifecycle'),
    });

    await service.changeStatus(card.cardId, 'retired');

    await expect(service.changeStatus(card.cardId, 'active')).rejects.toBeInstanceOf(
      IdentityStateError,
    );
  });

  it('persists stable and unlinkable pairwise subjects per platform', async () => {
    const card = await service.createCard({
      principalType: 'human',
      displayName: '平台标识测试',
      handle: uniqueHandle('pairwise'),
    });

    const yoyooFirst = await service.getOrCreatePlatformSubject(card.principalId, 'yoyoo');
    const yoyooSecond = await service.getOrCreatePlatformSubject(card.principalId, 'yoyoo');
    const secondPlatform = await service.getOrCreatePlatformSubject(card.principalId, 'test_platform');

    expect(yoyooFirst).toBe(yoyooSecond);
    expect(yoyooFirst).not.toBe(secondPlatform);
    expect(yoyooFirst).toMatch(/^sub_[A-Za-z0-9_-]{43}$/);
    expect(yoyooFirst).not.toContain(card.cardId);
  });
});
