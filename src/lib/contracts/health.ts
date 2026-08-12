export type DatabaseHealth =
  | { status: 'up'; latencyMs: number }
  | { status: 'down'; code: 'DATABASE_UNAVAILABLE' };

export type HealthBody = {
  service: 'ai-card';
  status: 'ok' | 'degraded';
  timestamp: string;
  uptimeSeconds: number;
  database: DatabaseHealth;
};

export type HealthReport = {
  httpStatus: 200 | 503;
  body: HealthBody;
};
