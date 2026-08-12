import {
  createCardInputSchema,
  handleSchema,
  platformClientIdSchema,
  principalIdSchema,
} from '@/domain/identity/schemas';
import type { CardStatus, IdentityRecord } from '@/domain/identity/types';
import { projectPrivateCard, projectPublicCard } from '@/domain/identity/projections';
import { IdentityNotFoundError, IdentityStateError } from '@/server/identity-errors';
import type { PostgresIdentityRepository } from '@/server/postgres/identity-repository';

const allowedTransitions: Record<CardStatus, CardStatus[]> = {
  active: ['suspended', 'retired'],
  suspended: ['active', 'retired'],
  retired: [],
};

export class IdentityService {
  constructor(private readonly repository: PostgresIdentityRepository) {}

  async createCard(input: unknown): Promise<IdentityRecord> {
    const parsed = createCardInputSchema.parse(input);
    return this.repository.createIdentity(parsed);
  }

  async getPublicCard(cardId: string) {
    const identity = await this.repository.findByCardId(cardId);
    if (!identity) throw new IdentityNotFoundError();
    return projectPublicCard(identity);
  }

  async getPrivateCard(principalId: string) {
    principalIdSchema.parse(principalId);
    const identity = await this.repository.findByPrincipalId(principalId);
    if (!identity) throw new IdentityNotFoundError();
    const [controllers, handleHistory] = await Promise.all([
      this.repository.listControllers(principalId),
      this.repository.listHandleHistory(identity.cardId),
    ]);
    return projectPrivateCard(identity, { controllers, handleHistory });
  }

  async listControlledCards(controllerPrincipalId: string): Promise<IdentityRecord[]> {
    principalIdSchema.parse(controllerPrincipalId);
    return this.repository.listControlledCards(controllerPrincipalId);
  }

  async changeHandle(cardId: string, nextHandle: string): Promise<IdentityRecord> {
    const handle = handleSchema.parse(nextHandle);
    return this.repository.changeHandle(cardId, handle);
  }

  async changeStatus(cardId: string, nextStatus: CardStatus): Promise<IdentityRecord> {
    const identity = await this.repository.findByCardId(cardId);
    if (!identity) throw new IdentityNotFoundError();
    if (!allowedTransitions[identity.status].includes(nextStatus)) {
      throw new IdentityStateError(`Card cannot transition from ${identity.status} to ${nextStatus}`);
    }
    return this.repository.transitionStatus(cardId, identity.status, nextStatus);
  }

  async getOrCreatePlatformSubject(principalId: string, clientId: string): Promise<string> {
    principalIdSchema.parse(principalId);
    const parsedClientId = platformClientIdSchema.parse(clientId);
    return this.repository.getOrCreatePlatformSubject(principalId, parsedClientId);
  }
}
