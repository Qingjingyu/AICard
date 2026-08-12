import { randomUUID } from 'node:crypto';

import { ZodError } from 'zod';

import { cardIdSchema } from '@/domain/identity/schemas';
import { createErrorEnvelope } from '@/lib/contracts/errors';
import { IdentityNotFoundError } from '@/server/identity-errors';
import { getIdentityService } from '@/server/identity';

export const dynamic = 'force-dynamic';

type PublicCardReader = {
  getPublicCard(cardId: string): Promise<unknown>;
};

type CardRouteContext = {
  params: Promise<{ cardId: string }>;
};

function errorResponse(
  status: number,
  code: 'INVALID_REQUEST' | 'RESOURCE_NOT_FOUND' | 'INTERNAL_ERROR',
  message: string,
  requestId: string,
) {
  return Response.json(
    createErrorEnvelope({ code, message, requestId, retryable: status >= 500 }),
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

export function createPublicCardRoute(reader: PublicCardReader) {
  return async function publicCardRoute(
    _request: Request,
    context: CardRouteContext,
  ): Promise<Response> {
    const requestId = randomUUID();

    try {
      const { cardId: rawCardId } = await context.params;
      const cardId = cardIdSchema.parse(rawCardId);
      const card = await reader.getPublicCard(cardId);
      return Response.json(card, {
        status: 200,
        headers: { 'cache-control': 'no-store' },
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return errorResponse(400, 'INVALID_REQUEST', 'Card ID is invalid', requestId);
      }
      if (error instanceof IdentityNotFoundError) {
        return errorResponse(404, 'RESOURCE_NOT_FOUND', 'AI Card was not found', requestId);
      }
      return errorResponse(500, 'INTERNAL_ERROR', 'AI Card could not be loaded', requestId);
    }
  };
}

export const GET = createPublicCardRoute({
  getPublicCard(cardId: string) {
    return getIdentityService().getPublicCard(cardId);
  },
});
