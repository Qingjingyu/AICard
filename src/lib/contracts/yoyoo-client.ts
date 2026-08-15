import { z } from 'zod';

const accessTokenSchema = z.string().regex(/^at_[A-Za-z0-9_-]{43}$/);
const refreshTokenSchema = z.string().regex(/^rt_[A-Za-z0-9_-]{43}$/);
const subjectSchema = z.string().regex(/^sub_[A-Za-z0-9_-]{43}$/);

export const YOYOO_CLIENT_CONTRACT = {
  clientId: 'yoyoo_dev',
  audience: 'yoyoo',
  redirectUri: 'http://localhost:4173/auth/aicard/callback',
  scopes: ['card.basic', 'card.handle', 'offline_access', 'agent.enroll'],
} as const;

export const yoyooTokenResponseSchema = z
  .object({
    access_token: accessTokenSchema,
    token_type: z.literal('Bearer'),
    expires_in: z.number().int().positive(),
    scope: z.string().trim().min(1),
    sub: subjectSchema,
    refresh_token: refreshTokenSchema,
    refresh_expires_in: z.number().int().positive(),
  })
  .strict();

export const yoyooUserInfoSchema = z
  .object({
    sub: subjectSchema,
    display_name: z.string().trim().min(1).max(120),
    principal_type: z.enum(['human', 'ai']),
    avatar_url: z.url().nullable(),
    handle: z.string().trim().min(1).max(80),
    card_id: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export type YoyooTokenResponse = z.infer<typeof yoyooTokenResponseSchema>;
export type YoyooUserInfo = z.infer<typeof yoyooUserInfoSchema>;
