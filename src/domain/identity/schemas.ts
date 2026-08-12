import { z } from 'zod';

const unsafeDisplayCharacters = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export const displayNameSchema = z.string()
  .transform((value) => value.normalize('NFKC').trim())
  .pipe(
    z.string()
      .min(1, 'display_name is required')
      .max(64, 'display_name must be at most 64 characters')
      .refine((value) => !unsafeDisplayCharacters.test(value), 'display_name contains unsafe characters'),
  );

export const handleSchema = z.string()
  .transform((value) => value.normalize('NFKC').trim().toLowerCase())
  .pipe(z.string().regex(/^[a-z][a-z0-9_]{2,31}$/, 'handle has an invalid format'));

export const cardIdSchema = z.string().regex(
  /^aic_[0-9A-HJKMNP-TV-Z]{26}$/,
  'card_id has an invalid format',
);

export const principalIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  'principal_id has an invalid format',
);

export const platformClientIdSchema = z.string().regex(
  /^[a-z][a-z0-9_-]{2,63}$/,
  'client_id has an invalid format',
);

const optionalHttpsUrlSchema = z.url()
  .refine((value) => new URL(value).protocol === 'https:', 'avatar_url must use HTTPS')
  .nullable()
  .optional();

export const createCardInputSchema = z.object({
  principalType: z.enum(['human', 'ai']),
  displayName: displayNameSchema,
  handle: handleSchema,
  avatarUrl: optionalHttpsUrlSchema,
  bio: z.string().trim().max(280).nullable().optional(),
  controllerPrincipalId: principalIdSchema.optional(),
}).superRefine((value, context) => {
  if (value.principalType === 'ai' && !value.controllerPrincipalId) {
    context.addIssue({
      code: 'custom',
      path: ['controllerPrincipalId'],
      message: 'AI Card requires a verified human controller',
    });
  }
});

export type CreateCardInput = z.infer<typeof createCardInputSchema>;
