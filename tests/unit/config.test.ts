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
      trustedProductOrigins: [],
      databaseUrl: 'postgres://aicard:local@localhost:5432/aicard',
      logLevel: 'info',
      webauthn: {
        rpName: 'AI Card',
        rpId: 'localhost',
        origin: 'http://localhost:3000',
      },
    });
  });

  it('normalizes an exact trusted-product origin allowlist', async () => {
    const { parseServerConfig } = await import('@/server/config');

    const config = parseServerConfig({
      NODE_ENV: 'development',
      APP_ORIGIN: 'http://localhost:3000',
      TRUSTED_PRODUCT_ORIGINS: ' https://app.yoyooai.com, http://127.0.0.1:4173,https://app.yoyooai.com ',
      DATABASE_URL: 'postgres://aicard:local@localhost:5432/aicard',
      WEBAUTHN_RP_NAME: 'AI Card',
      WEBAUTHN_RP_ID: 'localhost',
      WEBAUTHN_ORIGIN: 'http://localhost:3000',
    });

    expect(config.trustedProductOrigins).toEqual([
      'https://app.yoyooai.com',
      'http://127.0.0.1:4173',
    ]);
  });

  it.each([
    '*',
    'https://app.yoyooai.com/login',
    'https://app.yoyooai.com?source=aicard',
    'https://user@app.yoyooai.com',
  ])('rejects a non-origin trusted product value: %s', async (value) => {
    const { parseServerConfig } = await import('@/server/config');

    expect(() => parseServerConfig({
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://id.yoyooai.com',
      TRUSTED_PRODUCT_ORIGINS: value,
      DATABASE_URL: 'postgres://aicard:local@localhost:5432/aicard',
      WEBAUTHN_RP_NAME: 'AI Card',
      WEBAUTHN_RP_ID: 'id.yoyooai.com',
      WEBAUTHN_ORIGIN: 'https://id.yoyooai.com',
    })).toThrow(/TRUSTED_PRODUCT_ORIGINS/);
  });

  it('rejects an insecure non-local trusted product in production', async () => {
    const { parseServerConfig } = await import('@/server/config');

    expect(() => parseServerConfig({
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://id.yoyooai.com',
      TRUSTED_PRODUCT_ORIGINS: 'http://app.yoyooai.com',
      DATABASE_URL: 'postgres://aicard:local@localhost:5432/aicard',
      WEBAUTHN_RP_NAME: 'AI Card',
      WEBAUTHN_RP_ID: 'id.yoyooai.com',
      WEBAUTHN_ORIGIN: 'https://id.yoyooai.com',
    })).toThrow(/TRUSTED_PRODUCT_ORIGINS/);
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
