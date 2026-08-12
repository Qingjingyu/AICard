import { z } from 'zod';

const logLevels = ['debug', 'info', 'warn', 'error'] as const;

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ORIGIN: z.url(),
    DATABASE_URL: z.string().refine((value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === 'postgres:' || protocol === 'postgresql:';
      } catch {
        return false;
      }
    }, 'Must be a PostgreSQL connection URL'),
    LOG_LEVEL: z.enum(logLevels).default('info'),
    WEBAUTHN_RP_NAME: z.string().trim().min(1).max(64),
    WEBAUTHN_RP_ID: z.string().trim().regex(
      /^(localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*)$/,
      'Must be a hostname without a scheme or port',
    ),
    WEBAUTHN_ORIGIN: z.url(),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === 'production' && !environment.APP_ORIGIN.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['APP_ORIGIN'],
        message: 'Must use HTTPS in production',
      });
    }
    if (environment.WEBAUTHN_ORIGIN !== environment.APP_ORIGIN) {
      context.addIssue({
        code: 'custom',
        path: ['WEBAUTHN_ORIGIN'],
        message: 'Must exactly match APP_ORIGIN',
      });
    }
    if (new URL(environment.WEBAUTHN_ORIGIN).hostname !== environment.WEBAUTHN_RP_ID) {
      context.addIssue({
        code: 'custom',
        path: ['WEBAUTHN_RP_ID'],
        message: 'Must match the WebAuthn origin hostname',
      });
    }
  });

export type ServerConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  appOrigin: string;
  databaseUrl: string;
  logLevel: (typeof logLevels)[number];
  webauthn: {
    rpName: string;
    rpId: string;
    origin: string;
  };
};

export class ConfigurationError extends Error {
  constructor(readonly fields: string[]) {
    super(`Invalid server environment: ${fields.join(', ')}`);
    this.name = 'ConfigurationError';
  }
}

export function parseServerConfig(environment: NodeJS.ProcessEnv): ServerConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.') || 'environment'))];
    throw new ConfigurationError(fields);
  }

  return {
    nodeEnv: result.data.NODE_ENV,
    appOrigin: result.data.APP_ORIGIN,
    databaseUrl: result.data.DATABASE_URL,
    logLevel: result.data.LOG_LEVEL,
    webauthn: {
      rpName: result.data.WEBAUTHN_RP_NAME,
      rpId: result.data.WEBAUTHN_RP_ID,
      origin: result.data.WEBAUTHN_ORIGIN,
    },
  };
}

let cachedConfig: ServerConfig | undefined;

export function getServerConfig(): ServerConfig {
  cachedConfig ??= parseServerConfig(process.env);
  return cachedConfig;
}
