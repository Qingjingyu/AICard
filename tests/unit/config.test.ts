import { describe, expect, it } from 'vitest';

describe('server configuration', () => {
  it('accepts a complete development environment', async () => {
    const { parseServerConfig } = await import('@/server/config');

    const config = parseServerConfig({
      NODE_ENV: 'development',
      APP_ORIGIN: 'http://localhost:3000',
      DATABASE_URL: 'postgres://aicard:local@localhost:5432/aicard',
      LOG_LEVEL: 'info',
      WEBAUTHN_RP_NAME: 'AI Card',
      WEBAUTHN_RP_ID: 'localhost',
      WEBAUTHN_ORIGIN: 'http://localhost:3000',
    });

    expect(config).toEqual({
      nodeEnv: 'development',
      appOrigin: 'http://localhost:3000',
      databaseUrl: 'postgres://aicard:local@localhost:5432/aicard',
      logLevel: 'info',
      webauthn: {
        rpName: 'AI Card',
        rpId: 'localhost',
        origin: 'http://localhost:3000',
      },
    });
  });

  it('rejects a missing database URL with field-level context', async () => {
    const { parseServerConfig } = await import('@/server/config');

    expect(() =>
      parseServerConfig({
        NODE_ENV: 'test',
        APP_ORIGIN: 'http://localhost:3000',
        WEBAUTHN_RP_NAME: 'AI Card',
        WEBAUTHN_RP_ID: 'localhost',
        WEBAUTHN_ORIGIN: 'http://localhost:3000',
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it('requires HTTPS origins in production', async () => {
    const { parseServerConfig } = await import('@/server/config');

    expect(() =>
      parseServerConfig({
        NODE_ENV: 'production',
        APP_ORIGIN: 'http://aicard.example.com',
        DATABASE_URL: 'postgres://aicard:local@localhost:5432/aicard',
        WEBAUTHN_RP_NAME: 'AI Card',
        WEBAUTHN_RP_ID: 'aicard.example.com',
        WEBAUTHN_ORIGIN: 'http://aicard.example.com',
      }),
    ).toThrow(/APP_ORIGIN/);
  });

  it('rejects a WebAuthn origin that differs from the application origin', async () => {
    const { parseServerConfig } = await import('@/server/config');

    expect(() => parseServerConfig({
      NODE_ENV: 'development',
      APP_ORIGIN: 'http://localhost:3000',
      DATABASE_URL: 'postgres://aicard:local@localhost:5432/aicard',
      WEBAUTHN_RP_NAME: 'AI Card',
      WEBAUTHN_RP_ID: 'localhost',
      WEBAUTHN_ORIGIN: 'http://127.0.0.1:3000',
    })).toThrow(/WEBAUTHN_ORIGIN/);
  });
});
