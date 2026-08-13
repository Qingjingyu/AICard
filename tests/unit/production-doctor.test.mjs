import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { inspectProductionReadiness } from '../../scripts/production-doctor.mjs';

const validEnvironment = {
  NODE_ENV: 'production',
  APP_ORIGIN: 'https://id.yoyooai.com',
  DATABASE_URL: 'postgres://aicard:super-secret@postgres.internal:5432/aicard',
  WEBAUTHN_RP_NAME: 'AI Card',
  WEBAUTHN_RP_ID: 'id.yoyooai.com',
  WEBAUTHN_ORIGIN: 'https://id.yoyooai.com',
  AICARD_PRODUCTION_YOYOO_CLIENT_ID: 'yoyoo_prod',
  AICARD_PRODUCTION_YOYOO_REDIRECT_URI: 'https://app.yoyooai.com/auth/aicard/callback',
};

const validDatabase = {
  migrations: Array.from({ length: 14 }, (_, index) => `${String(index + 1).padStart(4, '0')}_migration.sql`),
  clients: [{
    clientId: 'yoyoo_prod',
    audience: 'yoyoo',
    status: 'active',
    redirectUris: ['https://app.yoyooai.com/auth/aicard/callback'],
    scopes: ['card.basic', 'card.handle', 'card.id', 'offline_access', 'agent.runtime'],
  }],
};

describe('AI Card production doctor', () => {
  it('accepts a complete HTTPS identity authority and exact Yoyoo client', () => {
    const report = inspectProductionReadiness(validEnvironment, validDatabase);

    expect(report.ok).toBe(true);
    expect(report.checks.every((check) => check.status === 'pass')).toBe(true);
  });

  it('reports every unsafe production boundary instead of stopping at the first one', () => {
    const report = inspectProductionReadiness({
      ...validEnvironment,
      NODE_ENV: 'development',
      APP_ORIGIN: 'http://localhost:3000',
      WEBAUTHN_RP_ID: 'localhost',
      WEBAUTHN_ORIGIN: 'http://localhost:3000',
      AICARD_PRODUCTION_YOYOO_REDIRECT_URI: 'http://localhost:4173/auth/aicard/callback',
    }, {
      migrations: validDatabase.migrations.slice(0, 12),
      clients: [{
        ...validDatabase.clients[0],
        redirectUris: ['http://localhost:4173/auth/aicard/callback'],
        scopes: ['card.basic', 'card.handle'],
      }],
    });

    expect(report.ok).toBe(false);
    expect(report.checks.filter((check) => check.status === 'fail').map((check) => check.id))
      .toEqual(expect.arrayContaining([
        'environment.production',
        'origin.public_https',
        'yoyoo.redirect_https',
        'database.migrations',
        'yoyoo.scopes',
      ]));
  });

  it('never includes database credentials in the serializable report', () => {
    const report = inspectProductionReadiness(validEnvironment, validDatabase);

    expect(JSON.stringify(report)).not.toContain('super-secret');
    expect(JSON.stringify(report)).not.toContain(validEnvironment.DATABASE_URL);
  });

  it('fails when only the local-development Yoyoo client is registered', () => {
    const report = inspectProductionReadiness(validEnvironment, {
      ...validDatabase,
      clients: [{
        ...validDatabase.clients[0],
        clientId: 'yoyoo_dev',
      }],
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === 'yoyoo.client')?.status).toBe('fail');
  });

  it('fails when the production client cannot issue Agent runtime sessions', () => {
    const report = inspectProductionReadiness(validEnvironment, {
      ...validDatabase,
      clients: [{
        ...validDatabase.clients[0],
        scopes: ['card.basic', 'card.handle', 'card.id', 'offline_access'],
      }],
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === 'yoyoo.scopes')?.status).toBe('fail');
  });

  it('runs from a repository path containing Chinese characters and fails closed', () => {
    const result = spawnSync(process.execPath, [resolve('scripts/production-doctor.mjs')], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({ ok: false });
    expect(report.checks.map((check) => check.id)).toEqual(expect.arrayContaining([
      'environment.production',
      'origin.public_https',
      'database.configured',
      'yoyoo.redirect_https',
    ]));
    expect(result.stdout).not.toContain('[redacted]SASL');
  });
});
