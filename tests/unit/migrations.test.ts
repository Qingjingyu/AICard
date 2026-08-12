import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('migration discovery', () => {
  it('sorts SQL files and assigns stable SHA-256 checksums', async () => {
    const { discoverMigrations } = await import('../../infra/postgres/migration-runner');
    const directory = await mkdtemp(join(tmpdir(), 'aicard-migrations-'));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, '0002_second.sql'), 'select 2;\n');
    await writeFile(join(directory, '0001_first.sql'), 'select 1;\n');
    await writeFile(join(directory, 'README.md'), 'ignored');

    const migrations = await discoverMigrations(directory);

    expect(migrations.map(({ name }) => name)).toEqual(['0001_first.sql', '0002_second.sql']);
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(migrations[0]?.checksum).not.toBe(migrations[1]?.checksum);
  });
});
