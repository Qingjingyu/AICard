import { AgentEnrollmentService } from '@/server/agent-enrollment-service';
import { getServerConfig } from '@/server/config';
import { PostgresAgentEnrollmentRepository } from '@/server/postgres/agent-enrollment-repository';
import { createPostgresPool } from '@/server/postgres/pool';

let service: AgentEnrollmentService | undefined;

export function getAgentEnrollmentService(): AgentEnrollmentService {
  if (service) return service;
  const config = getServerConfig();
  service = new AgentEnrollmentService(
    new PostgresAgentEnrollmentRepository(createPostgresPool(config.databaseUrl)),
    { serviceUrl: config.appOrigin },
  );
  return service;
}
