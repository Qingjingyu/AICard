# AI Card

AI Card 是面向人类与 AI 的独立身份、鉴权和授权基础设施。Yoyoo 是第一个客户端，但不拥有 AI Card 身份。

当前状态：v0.2 Phase 8A、8B 与 8D 已实现并完成本地自动化自测。首次注册会由 AI Card 原子签发从 `AI_100001` 开始的永久编号；预注册产品可经公共 HTTP 授权接口建立自己的 pairwise Subject、成员映射和短期会话，旗下新产品可由内部运维流程幂等登记。独立参考产品已在桌面和移动端证明同一 Card 跨产品复用且不会生成本地替代身份；Yoyoo Phase 8C 也已通过隔离双数据库和两次独立浏览器会话的跨仓本地验收。生产身份权威切换、真实硬件 Passkey、账号恢复、第三方独立安全审查和生产部署仍未完成，不得用于公网或生产环境。

## Requirements

- Node.js `>=22.13.0`
- npm `>=11`
- Docker 28 或兼容版本

## Local Start

```bash
npm install
cp .env.example .env.local
docker compose --env-file .env.local up -d postgres
npm run db:migrate
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。Passkey 的 RP ID 是 `localhost`，不要改用 `127.0.0.1` 访问。

健康检查：

```bash
curl -i http://localhost:3000/api/health
```

- PostgreSQL 可用：HTTP `200`，`status: ok`，`database.status: up`。
- PostgreSQL 不可用或配置缺失：HTTP `503`，`status: degraded`，不回显内部连接错误。

独立参考产品用于验证公共接入协议，不直接调用 AI Card Repository：

```bash
AI_CARD_ORIGIN=http://localhost:3000 \
REFERENCE_PRODUCT_ORIGIN=http://localhost:4174 \
npm run dev:reference-product
```

打开 [http://localhost:4174](http://localhost:4174)，可以从产品入口创建或登录 AI Card、审批最小权限并返回产品。默认复用本地开发数据库里的隔离 `reference_product` schema；部署成独立服务时通过 `REFERENCE_PRODUCT_DATABASE_URL` 指向产品自己的 PostgreSQL，并只应用 `0012_reference_product_sessions.sql` 的产品 schema。生产必须使用 HTTPS 和独立 Cookie 域策略。

停止本地服务：

```bash
docker compose --env-file .env.local down
```

本地数据保存在 Docker volume 中。只有明确需要清空本地数据库时才执行 `docker compose --env-file .env.local down --volumes`，该操作不可恢复。

## Foundation States

Phase 1 使用查询参数保留四态验收入口：

- Success: `/?state=success`
- Empty: `/?state=empty`
- Loading: `/?state=loading`
- Error: `/?state=error`

这些是工程状态骨架，不是最终 AI Card 产品页面。

## Identity Core

Phase 2 提供以下内部能力：

- 人类与 AI 共用 Principal / AI Card 模型，内部 Principal ID 使用 UUIDv7。
- 永久公开 Card ID 由 PostgreSQL 唯一序列权威签发，格式为 `AI_` 加不少于六位数字，从 `AI_100001` 开始，不作为数据库关系主键。
- 内部 Principal ID 继续使用 UUIDv7；昵称和 Handle 均不参与真实身份归属判定。
- 迁移前的 `aic_...` 公开链接会通过别名表解析到新编号；新建 Card 只签发 `AI_...`。
- 中文昵称可以重复；`@handle` 全局唯一，修改后的历史 Handle 继续保留，不能被重新注册。
- AI Card 必须关联一个处于 active 状态的人类控制者。真正的控制者认证在 Phase 3 接入 Passkey 后生效。
- 平台 Subject 按 `(client, principal)` 随机生成并持久化，同一平台稳定、不同平台不可直接关联。
- 公开、平台和私有投影使用独立字段白名单；平台投影只返回 scope 覆盖的 claims。

公开读取入口：

- Card 页面：`GET /card/:cardId`
- Card JSON：`GET /api/v1/cards/:cardId`
- 私有背面：`GET /me/card` 与 `GET /api/v1/me/card`，必须持有有效会话；匿名请求返回 `401 AUTHENTICATION_REQUIRED`。

## Unified Human Account Authentication

- 首页支持中文昵称、唯一 `@handle` 和密码创建人类 Card；成功后立即进入当前 Card，不再要求另行注册或绑定。
- 登录接受 `AI_100001` 形式的永久编号或 `@handle`；未知账号、错误密码和已停用凭据返回同一公开错误。
- 密码最少 12 个字符，数据库只保存随机 16-byte salt 和 `scrypt` 64-byte 派生值，不保存明文或可逆凭据。
- 统一注册要求预注册客户端和 32-128 位 Base64URL 幂等键；重试只在资料和原密码同时一致时恢复同一身份。
- 注册和登录均受精确 Origin、限流、会话轮换和安全审计保护。
- Passkey 作为可选增强认证：密码注册用户可在私有 Card 背面添加首个 Passkey。
- Passkey 强制用户验证和 resident credential，不请求 attestation；支持 Touch ID、Face ID、Windows Hello 与外接安全密钥。
- Session 与 challenge 只持久化 SHA-256 哈希；Session Cookie 为 `HttpOnly`、`SameSite=Strict`，状态变更同时检查精确 Origin 和 CSRF 双提交 Token。
- challenge 五分钟过期且只能消费一次；登录会轮换 Session；敏感凭据操作要求五分钟内重新验证。
- 一个控制者可以持有多个 Passkey；当前仍保守地禁止撤销最后一个有效 Passkey，等密码重新验证界面完成后再调整。
- 本地入口必须使用 `http://localhost:3000`。生产配置必须使用 HTTPS，且 `WEBAUTHN_ORIGIN` 必须与 `APP_ORIGIN` 完全一致。

## Agent Enrollment And Node Identity

- 私有 Card 背面的“AI 身份”支持中文昵称、唯一 `@handle` 和完整接入指令。
- 创建邀请时即创建永久 AI Card；15 分钟邀请票据只显示一次，数据库只保存 SHA-256 哈希。
- Agent 在本机生成 Ed25519 密钥、UUIDv7 认领 ID 和随机查询秘密；私钥不上传。
- 认领使用签名证明私钥持有；响应未知时使用认领 ID 与查询秘密恢复同一结果，不重复创建身份。
- 同一 AI Card 可以追加多个独立节点；待认领邀请和运行节点都可以单独撤销。
- 节点认证使用 2 分钟一次性 challenge；撤销后新的 challenge 和认证都会被拒绝。

仓库中的 `scripts/agent-enrollment-reference.mts` 是协议测试客户端。它从标准输入读取邀请 JSON，避免票据出现在命令行参数和进程列表；`--output` 指定的新文件以 `0600` 权限保存节点私钥、认领查询秘密和公钥。不要把该输出提交到仓库或发送给其他人。

## Platform Authorization

Phase 5B migration 默认预注册两个本地公共客户端：

| Client | Redirect URI | Audience |
| --- | --- | --- |
| `yoyoo_dev` | `http://localhost:4173/auth/aicard/callback` | `yoyoo` |
| `test_client` | `http://localhost:4174/callback` | `test-platform` |

客户端先生成 43-128 字符 PKCE verifier 及其 S256 challenge，再把用户导航到：

```text
GET /authorize?response_type=code
  &client_id=yoyoo_dev
  &redirect_uri=http%3A%2F%2Flocalhost%3A4173%2Fauth%2Faicard%2Fcallback
  &scope=card.basic%20card.handle
  &state=<16-256 character opaque state>
  &code_challenge=<base64url SHA-256 challenge>
  &code_challenge_method=S256
```

平台需要授权受控 AI 身份时额外传入 `principal_type=ai`。同意页只展示当前
人类控制、控制关系未撤销且双方 Card 均为 active 的 AI Card；浏览器提交公开
Card ID，服务端解析内部 Principal 并在签发授权码的事务中再次验证控制关系。
未选择、伪造、外部、非 AI 或失效 Card 一律拒绝。

持卡人批准后，平台 callback 收到 5 分钟有效的一次性 `ac_...` code 和原始 `state`。平台使用 `application/x-www-form-urlencoded` 调用 `POST /api/v1/token`，提交 `grant_type=authorization_code`、`client_id`、精确 `redirect_uri`、`code` 和 `code_verifier`，并携带至少 128-bit 随机性的 `Idempotency-Key` 请求头。成功响应包含 10 分钟有效的 `at_...` opaque access token；当 `yoyoo_dev` 被明确批准 `offline_access` 时，还包含 30 天 family lifetime 内的 `rt_...` refresh token。

Refresh 使用同一 token endpoint，提交 `grant_type=refresh_token`、`client_id` 和 `refresh_token`，每次必须使用新的 `Idempotency-Key`。同一请求和 key 可恢复相同响应；已消费 refresh token 被不同 key 重放时，整个 token family 会被撤销。随后以 `Authorization: Bearer at_...` 调用 `GET /api/v1/userinfo`，只会得到已批准 scope 覆盖的 Card 字段和该平台专属 `sub`。

- redirect URI 逐字匹配，不支持 wildcard。
- scopes 为 `card.basic`、`card.handle`、`card.id`、`offline_access` 和 `agent.runtime`；只有 `yoyoo_dev` 允许请求后两项，`agent.runtime` 只用于 AI 身份运行节点。
- 授权码、access token 和 refresh token 明文只出现在协议响应中，数据库只保存 SHA-256 摘要；幂等恢复响应使用 AES-256-GCM 密文保存。
- 持卡人可在私有 Card 背面按身份查看本人和当前受控 AI 的平台授权；撤销要求有效会话、精确 Origin、CSRF 证明和 5 分钟内 Passkey 验证，并立即使关联 access/refresh token 失效。浏览器只提交 Grant ID，服务端依据实时控制关系判断管理权限。
- 当前不支持第三方动态客户端注册或完整 OAuth/OIDC Provider。

### Controlled Product Registration

旗下新产品由受信任运维人员使用显式 JSON 合同登记，不开放公共动态注册端点。JSON 不得包含数据库密码、Token 或其他秘密：

```json
{
  "clientId": "product_name",
  "displayName": "Product Name",
  "audience": "product:name",
  "redirectUris": ["https://product.example.com/auth/aicard/callback"],
  "scopes": ["card.basic", "card.handle", "card.id"]
}
```

```bash
DATABASE_URL='postgresql://...' npm run platform:register -- ./product-client.json
```

- 生产 callback 必须使用 HTTPS；只有显式设置 `AICARD_ALLOW_INSECURE_LOCALHOST_CLIENT=true` 时才允许 `http://localhost` 本地开发回调。
- 完全相同的重试会返回已有客户端，不会重复创建。已有 `clientId` 的 audience、callback 或 scope 变化会显式冲突，不会静默扩权。
- 登记成功写入 `platform.client.registered` 安全审计事件。该工具是内部运维入口，不代替发布审批。

生产切换前的只读体检：

```bash
npm run production:doctor
```

体检从 `.env.production.local` 读取配置，验证 HTTPS issuer/WebAuthn 边界、PostgreSQL migration ledger，以及 Yoyoo 生产 client、callback 和 scopes。任一检查失败即以非零状态退出，不修改数据库或生产配置。

## First-Product Federation

- 产品后端通过 `POST /api/v1/federation/validate`、`POST /api/v1/token` 和 `GET /api/v1/userinfo` 接入；不得导入 AI Card 内部 Service、Repository 或读取身份表。
- 产品生成随机 state、PKCE verifier 和一次性 flow token。数据库只保存 flow/session 摘要及 AES-256-GCM 加密的恢复材料，不保存 verifier、授权码或 access token 明文。
- 产品只保存本地 member ID、当前平台 pairwise Subject、经明确批准的 AI Card ID 和展示字段；不保存 AI Card Principal ID，不替代本地权限系统。
- `aicard_web` 只表示 AI Card 官网直接注册。从合法产品授权入口进入时，注册审计归属服务端验证后的真实 `client_id`，不能由浏览器任意指定。
- AI Card 网络失败、回调 state 不匹配或响应异常时，产品显示可重试错误且不创建本地替代身份；相同回调结果未知时返回同一成员和产品会话。

## Agent Runtime Session

已授权 `agent.runtime` 的 AI 节点先调用
`POST /api/v1/agent-nodes/challenge`，再使用本机 Ed25519 私钥签署：

```text
aicard-agent-runtime-v1
<nodeId>
yoyoo_dev
<challenge>
```

把 `nodeId`、`clientId`、challenge 和签名提交到
`POST /api/v1/agent-nodes/authenticate` 后，可取得两分钟有效的 `at_...`
运行时 Token。Yoyoo 使用 `POST /api/v1/agent-runtime/introspect` 逐次校验；
AI Card、节点、控制关系、Client 或 Grant 失效后，新请求立即返回未认证。
Token 明文不写入数据库，不提供 refresh token。

## Commands

| Command | Purpose |
| --- | --- |
| `npm run lint` | ESLint 与 Next.js 规则 |
| `npm run typecheck` | TypeScript 严格类型检查 |
| `npm run build` | Next.js 生产构建 |
| `npm test` | Vitest 单元测试 |
| `npm run test:integration` | 自动启动隔离 PostgreSQL、迁移、测试并清理 |
| `npm run test:e2e` | Playwright 桌面与移动端四态、密码账号、公开 Card、虚拟 Passkey、Agent 认领、平台授权与跨产品回归；默认使用专用端口 `4280/4281`，不复用既有服务 |
| `npm run platform:register -- <client.json>` | 受控登记旗下产品客户端，重试幂等、配置漂移默认拒绝 |
| `npm run production:doctor` | 只读检查生产身份权威配置、migration ledger 和 Yoyoo client 合同 |
| `npm run verify` | 顺序执行全部门禁 |

`test:integration` 默认使用本机已有或可拉取的 `postgres:17-alpine`。可通过 `AICARD_TEST_POSTGRES_IMAGE` 指定兼容镜像。

## Migration Rules

- migration 位于 `infra/postgres/migrations/`，文件名格式为 `NNNN_name.sql`。
- 已应用 migration 的 SHA-256 checksum 会写入 `aicard_schema_migrations`。
- 已应用 migration 不得修改；需要变更时新增 forward migration。
- checksum 不一致时 runner 直接失败，不会继续执行。

## Security Boundary

- 不在日志、页面、错误响应或仓库中保存真实票据、Token、私钥。
- AI Card 只证明身份并管理授权；平台继续负责本地业务权限。
- 公开 Card API 使用固定字段投影和 `no-store`；错误响应不回显数据库错误。
- 私有 Card 只接受有效的哈希会话；凭据接口不返回公钥、challenge、会话哈希或任何长期秘密。
- Agent 接入 API 只保存票据/查询秘密哈希和节点公钥；匿名接口受 schema、签名或秘密证明及速率限制保护。
- 平台授权只接受预注册客户端、精确 redirect URI、S256 PKCE 和 scope allowlist；授权码单次消费，token 绑定 client、audience、grant、pairwise Subject 和 scopes。
- 平台撤销、refresh family 重放检测和受保护资源的 active grant 检查已实现并自测。
- 当前没有账号找回、密码更换、多因子强制策略或独立安全审查；公网部署仍被明确禁止。
- 当前版本只允许本地或明确受保护环境部署。

详细设计见 [Product-Spec.md](./Product-Spec.md)、[统一账号协议 v0.2](./docs/protocol-v0.2.md)、[历史协议 v0.1](./docs/protocol-v0.1.md) 和[威胁模型](./docs/security-threat-model.md)。
