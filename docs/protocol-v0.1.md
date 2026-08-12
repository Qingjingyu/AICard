# AI Card Protocol v0.1

## Status

本文是 AI Card v0.1 的实现合同，版本为 `0.1-draft.3`。它锁定身份标识、Card 投影、邀请认领、平台授权、错误结构和安全默认值。

v0.1 借鉴 WebAuthn、OAuth 2.0 Security Best Current Practice 和 OpenID Connect pairwise Subject 的安全原则，但在通过正式一致性测试前，不宣称是完整 OIDC/OAuth Provider。

## Normative Language

`MUST`、`MUST NOT`、`SHOULD` 和 `MAY` 表示协议约束。无法满足 `MUST` 的实现不得标记为 AI Card v0.1 兼容。

## Protocol Boundary

AI Card 负责：

- 证明一个 Principal 是谁。
- 管理 Card、Controller、凭据、AI 节点和平台授权。
- 向平台签发 pairwise Subject 和用户明确同意的最小 claims/scopes。
- 记录身份与授权相关审计事件。

AI Card 不负责：

- Yoyoo 内的群成员权限、消息权限、文件权限和业务角色。
- 存储消息、文件、任务或 Agent 私有记忆。
- 向平台提供 Card 根密钥或 AI 节点私钥。

## Canonical Identifiers

### Principal ID

- Internal field: `principal_id`
- Format: UUIDv7 canonical lowercase string, for example `018f4f5d-8f6a-7a13-8e2c-1f21f3489a10`.
- Visibility: system only; MUST NOT appear in public Card or platform claims.
- Semantics: immutable database identity for a human or AI Principal.

### AI Card ID

- External field: `card_id`
- Format: `aic_` plus 26 uppercase Crockford Base32 characters encoding 128 random bits.
- Regex: `^aic_[0-9A-HJKMNP-TV-Z]{26}$`
- Example: `aic_01J4Z7Y8K9M2N3P4Q5R6S7T8VW`.
- Semantics: globally unique, permanent, public, immutable and never reused.
- Generation MUST use a cryptographically secure random source and a database unique constraint.

The example above is illustrative and MUST NOT be accepted as a credential or fixture secret.

### Handle

- External field: `handle`
- Format: 3-32 lowercase ASCII characters from `a-z`, `0-9` and `_`; first character MUST be a letter.
- Regex: `^[a-z][a-z0-9_]{2,31}$`
- Display form: `@handle`.
- Semantics: globally unique, user-facing and mutable with cooldown; old values remain reserved as history aliases.
- The Chinese name is `display_name`, not `handle`. `display_name` accepts Unicode after NFKC normalization and rejection of control, line-break, bidi override and deceptive invisible characters.

### Platform Subject

- Claim: `sub`
- Format: `sub_` plus 43 unpadded Base64URL characters encoding 256 random bits.
- Scope: stable only for one `(client_id, principal_id)` pair.
- Storage: generated once, persisted with a unique constraint and never derived from public `card_id`.
- Privacy: two clients MUST receive different subjects for the same Principal unless the holder explicitly shares the public Card ID.

### Runtime Node ID

- Field: `node_id`
- Format: UUIDv7 canonical lowercase string.
- Scope: unique to one AI Card runtime node.
- A Card MAY have multiple nodes. Each node has its own public key, status and revocation state.

## Canonical URLs And Versions

The production issuer is not selected yet. Until it is locked, examples use `https://id.example.invalid`.

- Issuer: `https://<issuer-host>`
- API base: `https://<issuer-host>/api/v1`
- Public Card: `https://<issuer-host>/c/{card_id}`
- Browser authorization endpoint: `/authorize`
- Consent decision endpoint: `/api/v1/authorize`
- Token endpoint: `/api/v1/token`
- Revocation endpoint: `/api/v1/revoke`
- Protocol metadata: `/.well-known/ai-card-configuration`

`example.invalid` is intentionally non-routable. A deployment MUST configure one exact HTTPS issuer and MUST reject startup when issuer, RP ID or allowed origins are missing.

## Principal And Card Types

```typescript
type PrincipalType = 'human' | 'ai';
type CardStatus = 'active' | 'suspended' | 'retired';
type NodeStatus = 'pending' | 'active' | 'revoked';
type InvitationStatus = 'unused' | 'claiming' | 'claimed' | 'expired' | 'revoked';
type GrantStatus = 'active' | 'expired' | 'revoked';
```

Rules:

- An AI Principal MUST have at least one verified human Controller in v0.1.
- `retired` is terminal. A retired `card_id` and handle history MUST NOT be reused.
- Suspended Cards MUST NOT authenticate nodes or issue new authorization artifacts.
- Revoking one node MUST NOT revoke other nodes or retire the Card.

## Visibility Projections

All responses MUST be produced by explicit allowlist projections. A database entity MUST NOT be serialized directly.

### Public Front

```json
{
  "card_id": "aic_01J4Z7Y8K9M2N3P4Q5R6S7T8VW",
  "handle": "yoyoo_assistant",
  "display_name": "悠悠",
  "principal_type": "ai",
  "avatar_url": "https://cdn.example.invalid/avatar.png",
  "bio": "数字员工",
  "status": "active"
}
```

Allowed fields: `card_id`, `handle`, `display_name`, `principal_type`, `avatar_url`, `bio`, `status`.

### Platform Visible

Returned only to an authorized client and always keyed by pairwise `sub`:

```json
{
  "sub": "sub_yJm8J0RkC5z2QnYtF9pS7uVx3aB6dE1gH4iK8mN2qWc",
  "display_name": "悠悠",
  "handle": "yoyoo_assistant",
  "principal_type": "ai",
  "agent_profile": {
    "capabilities": ["chat"],
    "presence": "online"
  }
}
```

Only claims covered by an active grant and requested scope MAY be returned. `card_id` is excluded by default.

### Private Back

Visible only to the Card holder or verified Controller:

- Controller relations and verification status.
- Passkey metadata, node metadata and last use time.
- Client grants, scopes, expiry and revocation controls.
- Handle history and security event summaries.

Private keys, raw invitation tokens, authorization codes, access tokens and refresh tokens MUST NOT be returned.

### System Vault

The vault contains only server-required sensitive material:

- Token and invitation keyed hashes.
- Encrypted recovery material, when recovery is implemented.
- Key identifiers and rotation metadata.

There is no generic vault read API. Services receive only the result of verification operations.

## Scope Registry

| Scope | Claims Or Capability | Default |
| --- | --- | --- |
| `card.basic` | `sub`, `display_name`, `principal_type`, avatar | Required |
| `card.handle` | `handle` | Optional |
| `card.id` | public global `card_id` | Sensitive, explicit consent |
| `agent.profile` | AI capability metadata | Optional, AI Card only |
| `agent.presence` | current presence | Optional, AI Card only |
| `offline_access` | permits refresh token issuance | Sensitive, explicit consent |

Unknown scopes MUST be rejected. A token MUST be checked for grant status, audience and scopes at every protected resource.

## Human Passkey Flow

### Library Baseline

- Server: `@simplewebauthn/server@13.3.2`, Node.js `>=20.0.0`.
- Browser: `@simplewebauthn/browser@13.3.0`.
- Versions were verified against the official npm registry on 2026-08-08. They are selected, not installed in Phase 0.

### Registration

1. Server creates a cryptographically random challenge and stores its hash, purpose, user binding and expiry.
2. Browser creates a credential for the configured RP ID and exact allowed origin.
3. Server verifies challenge, Origin, RP ID and `userVerified`.
4. In one transaction, server creates the Principal/Card relation and stores credential ID, public key, counter, transports and backup metadata.
5. Challenge is consumed regardless of verification outcome.

### Authentication

1. Server issues a purpose-bound challenge with a 5-minute maximum lifetime.
2. Browser requests the Passkey with `userVerification: required`.
3. Server verifies credential ownership, challenge, Origin, RP ID, signature and counter behavior.
4. Server rotates the authenticated session identifier and records a security audit event.

High-risk actions such as creating an AI invitation, adding a Passkey, revoking the last credential or changing Controller MUST require a Passkey verification performed within the previous 5 minutes.

## AI Enrollment Flow

### Invitation Artifact

- `invitation_id`: UUIDv7 canonical lowercase string; it is an identifier, not a credential.
- Ticket entropy: 256 random bits, unpadded Base64URL encoded to 43 characters.
- Server storage: SHA-256 hash only; raw ticket is returned exactly once.
- Default lifetime: 15 minutes.
- Use: single successful claim; Controller can revoke before use.
- Binding: invitation ID, intended Card, Controller, allowed node count and expiry.

### Claim Request

```json
{
  "invitationId": "018f4f5d-8f6a-7a13-8e2c-1f21f3489a11",
  "ticket": "REDACTED_43_CHARACTER_BASE64URL_VALUE",
  "claimId": "018f4f5d-8f6a-7a13-8e2c-1f21f3489a10",
  "claimSecret": "REDACTED_43_CHARACTER_BASE64URL_VALUE",
  "machineName": "yoyoo-macbook",
  "publicKey": "base64url-SPKI-DER",
  "signature": "base64url-Ed25519-signature"
}
```

Rules:

- The Agent MUST generate its key pair locally; the private key MUST NOT be transmitted.
- `machine_name` MUST match `^[a-z0-9][a-z0-9_-]{0,62}$`. Other local display names MAY be normalized before submission.
- The server MUST validate an Ed25519 signature over `aicard-agent-claim-v1`, invitation ID, claim ID, machine name and public key joined by line feeds.
- Claim completion MUST atomically consume the invitation and activate exactly one node.
- The same `claim_id` MUST return the same final result. A different claim for a consumed invitation MUST fail.
- The Agent MUST create an independent 256-bit claim query secret. The server stores only its SHA-256 hash.
- Timeout with unknown outcome MUST be resolved using claim ID plus claim query secret, not blind re-registration.

### Node Authentication

Each authentication uses a 256-bit server challenge bound to `node_id` and a 2-minute expiry. The node signs `aicard-node-auth-v1`, node ID and the challenge joined by line feeds. The server verifies the public key, challenge hash, single use and node status.

## Platform Authorization Flow

### Client Registration

v0.1 client registration is operator-controlled. Each client has:

- Immutable `client_id`.
- Human-readable name and logo.
- Exact HTTPS redirect URI allowlist; localhost may use HTTP in development.
- Allowed scopes and token audience.
- Status and owner metadata.

Wildcard redirect URIs and open redirect intermediaries are forbidden.

### Authorization Request

Required parameters:

- `response_type=code`
- `client_id`
- `redirect_uri`
- `scope`
- `state`
- `code_challenge`
- `code_challenge_method=S256`

The consent page MUST show the client, Card, requested scopes, duration and whether offline access is requested. Silent scope expansion is forbidden.

### Authorization Code

- Prefix: `ac_`.
- Entropy: at least 256 random bits.
- Lifetime: 5 minutes.
- Storage: SHA-256 digest only; 256-bit random entropy makes offline recovery infeasible.
- Single use and bound to client, redirect URI, Principal, grant and PKCE challenge.
- A failed redemption MUST NOT make a valid code reusable after its state is ambiguous; the operation is idempotent by redemption request ID.

### Access Token

- Prefix: `at_`.
- Opaque, at least 256 random bits, SHA-256 digest stored server-side.
- Default lifetime: 10 minutes.
- Bound to grant, audience, client, pairwise Subject and scopes.

### Refresh Token

- Prefix: `rt_`.
- Opaque, at least 256 random bits, hash stored server-side.
- Maximum family lifetime: 30 days in v0.1.
- Rotated on every use. Reuse of a consumed token revokes the whole token family and emits a high-severity audit event.
- Issued only when `offline_access` was explicitly approved.

### Revocation

Revoking a grant MUST atomically revoke its token families, refresh tokens and access tokens. Protected resources MUST check the authoritative active grant and token revocation state so revocation takes effect immediately.

## Yoyoo Mapping Contract

Yoyoo stores a mapping from `(issuer, client_id, sub)` to its local Principal ID.

- It MUST NOT use `display_name`, `handle` or public `card_id` as a database foreign key.
- The same `sub` within the same issuer/client identifies the same AI Card Principal across sessions.
- A changed nickname or handle MUST NOT create another Yoyoo user.
- Revoking the grant blocks new AI Card-authenticated sessions but MUST NOT rewrite historical message/file ownership.
- Yoyoo retains all local authorization decisions after identity resolution.

## Idempotency And Concurrency

Mutating endpoints MUST accept `Idempotency-Key` with 128 bits or more of entropy.

- Keys are scoped to authenticated actor, endpoint and request body digest.
- Reusing a key with a different body returns `409 IDEMPOTENCY_CONFLICT`.
- Completed results remain queryable for at least 24 hours.
- Invitation consumption, code redemption, refresh rotation and revocation MUST use database transactions and uniqueness constraints.

Every response includes `request_id`; clients MAY send `X-Request-ID`, but the server validates format and creates its own trusted ID.

## Error Envelope

```json
{
  "error": {
    "code": "INVITATION_EXPIRED",
    "message": "The invitation is no longer valid.",
    "request_id": "req_01J4Z7Y8K9M2N3P4Q5R6S7T8VW",
    "retryable": false
  }
}
```

Stable v0.1 codes:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Schema or protocol validation failed |
| 400 | `UNSUPPORTED_SCOPE` | One or more scopes are not allowed |
| 401 | `AUTHENTICATION_REQUIRED` | No valid human session or node proof |
| 403 | `AUTHORIZATION_DENIED` | Actor or client lacks permission |
| 404 | `RESOURCE_NOT_FOUND` | Resource absent or intentionally concealed |
| 409 | `IDEMPOTENCY_CONFLICT` | Same key used for a different operation |
| 409 | `INVITATION_ALREADY_CLAIMED` | Invitation has a different completed claim |
| 410 | `INVITATION_EXPIRED` | Invitation expired or was revoked |
| 410 | `AUTHORIZATION_CODE_EXPIRED` | Code expired or was consumed |
| 429 | `RATE_LIMITED` | Caller exceeded a bounded budget |
| 503 | `TEMPORARILY_UNAVAILABLE` | Safe retry may be possible |

Error messages MUST NOT reveal whether an unrelated Card, credential, token or Controller exists.

## Audit Contract

Required event families:

- `principal.created`, `card.created`, `card.suspended`, `card.retired`
- `controller.bound`, `controller.reverified`
- `passkey.added`, `passkey.used`, `passkey.revoked`
- `invitation.created`, `invitation.claimed`, `invitation.revoked`, `invitation.expired`
- `node.activated`, `node.authenticated`, `node.revoked`
- `grant.created`, `grant.scope_changed`, `grant.revoked`
- `token.refresh_reuse_detected`

Events contain actor type/ID, target type/ID, timestamp, result, trusted request ID, coarse source metadata and changed field names. They MUST NOT contain raw secrets, token hashes, public-key private material or full sensitive request bodies.

## Security Defaults

| Artifact | Maximum Lifetime | Single Use | Stored Raw |
| --- | --- | --- | --- |
| Passkey challenge | 5 minutes | Yes | No |
| Node nonce | 2 minutes | Yes | No |
| Invitation token | 15 minutes | Yes | No |
| Authorization code | 5 minutes | Yes | No |
| Access token | 10 minutes | No | No |
| Refresh token | 30-day family | Rotated each use | No |

Implementations MAY choose shorter lifetimes. Longer lifetimes require a protocol revision and security review.

## Source Standards

- [Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/)
- [RFC 9700: Best Current Practice for OAuth 2.0 Security](https://datatracker.ietf.org/doc/html/rfc9700)
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [SimpleWebAuthn server documentation](https://simplewebauthn.dev/docs/packages/server)

## Compatibility Gate

An implementation may label itself `AI Card Protocol 0.1` only after automated tests prove:

- Identifier formats and non-reuse rules.
- Public/platform/private projections do not leak fields.
- Passkey challenge, Origin, RP ID and user verification enforcement.
- Invitation single-use behavior under concurrent claims.
- Node nonce replay rejection and independent revocation.
- Authorization code binding, PKCE, expiry and replay rejection.
- Token audience/scope enforcement, refresh rotation and reuse detection.
- Different clients receive different `sub` values for the same Principal.
- Revoked Card, node, grant and credential states remain revoked after backup restore.
