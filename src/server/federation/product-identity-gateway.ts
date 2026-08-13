import { z } from 'zod';

import type { RawAuthorizationRequest } from '@/server/authorization/authorization-service';
import type { PlatformAuthorizationService } from '@/server/authorization/authorization-service';

export type ProductAuthorizationToken = {
  accessToken: string;
  subject: string;
};

export type ProductAuthorizationExchange = {
  grantType: 'authorization_code';
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  idempotencyKey: string;
};

export interface ProductIdentityGateway {
  validateRequest(request: RawAuthorizationRequest): Promise<void>;
  exchangeAuthorizationCode(input: ProductAuthorizationExchange): Promise<ProductAuthorizationToken>;
  getUserInfo(accessToken: string): Promise<unknown>;
}

const validationSchema = z.object({ valid: z.literal(true) });
const tokenSchema = z.object({
  access_token: z.string().regex(/^at_[A-Za-z0-9_-]{43}$/),
  token_type: z.literal('Bearer'),
  sub: z.string().regex(/^sub_[A-Za-z0-9_-]{43}$/),
});

export class ProductIdentityGatewayError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProductIdentityGatewayError';
  }
}

async function parseResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok) throw new ProductIdentityGatewayError('AI Card request was rejected');
  try {
    return schema.parse(await response.json());
  } catch {
    throw new ProductIdentityGatewayError('AI Card response is invalid');
  }
}

export class HttpProductIdentityGateway implements ProductIdentityGateway {
  private readonly origin: string;

  constructor(
    origin: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.origin = origin.replace(/\/$/, '');
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(`${this.origin}${path}`, {
        ...init,
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new ProductIdentityGatewayError('AI Card service is unavailable', {
        cause: error,
      });
    }
  }

  async validateRequest(request: RawAuthorizationRequest): Promise<void> {
    const response = await this.request('/api/v1/federation/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        response_type: request.responseType,
        client_id: request.clientId,
        redirect_uri: request.redirectUri,
        scope: request.scope,
        state: request.state,
        code_challenge: request.codeChallenge,
        code_challenge_method: request.codeChallengeMethod,
        principal_type: request.principalType,
      }),
    });
    await parseResponse(response, validationSchema);
  }

  async exchangeAuthorizationCode(input: ProductAuthorizationExchange): Promise<ProductAuthorizationToken> {
    const response = await this.request('/api/v1/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': input.idempotencyKey,
      },
      body: new URLSearchParams({
        grant_type: input.grantType,
        client_id: input.clientId,
        redirect_uri: input.redirectUri,
        code: input.code,
        code_verifier: input.codeVerifier,
      }),
    });
    const token = await parseResponse(response, tokenSchema);
    return { accessToken: token.access_token, subject: token.sub };
  }

  async getUserInfo(accessToken: string): Promise<unknown> {
    const response = await this.request('/api/v1/userinfo', {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new ProductIdentityGatewayError('AI Card request was rejected');
    try {
      return await response.json();
    } catch {
      throw new ProductIdentityGatewayError('AI Card response is invalid');
    }
  }
}

export class InProcessProductIdentityGateway implements ProductIdentityGateway {
  constructor(private readonly authorization: PlatformAuthorizationService) {}

  async validateRequest(request: RawAuthorizationRequest): Promise<void> {
    await this.authorization.validateRequest(request);
  }

  async exchangeAuthorizationCode(input: ProductAuthorizationExchange): Promise<ProductAuthorizationToken> {
    const token = await this.authorization.exchangeAuthorizationCode(input);
    return { accessToken: token.accessToken, subject: token.subject };
  }

  getUserInfo(accessToken: string): Promise<unknown> {
    return this.authorization.getUserInfo(accessToken);
  }
}
