# AI Card Development Plan

版本：v0.2（统一账号升级）

## Delivery Strategy

AI Card 作为独立身份中心开发，Yoyoo 是第一个平台客户端。v0.1 已建立 Card、Passkey、平台授权和 AI 节点基线；v0.2 将 AI Card 升级为唯一统一账号和发卡源，并移除 Yoyoo 的本地发卡权威。

每个阶段必须可运行、可测试、可暂停。未通过本阶段验收，不进入下一阶段。

## V0.2 Unified Account Upgrade

### Phase 8A: Authoritative Numbering And Password Account

#### Deliverables

- 新增 forward-only migration，把公开 Card ID 格式改为 `AI_100001` 起的永久顺序编号，并建立唯一数据库序列。
- 保留内部 UUIDv7 Principal ID；所有外键继续引用内部主键，不把顺序编号作为数据库关系主键。
- 新增人类密码凭据、统一注册和登录会话；密码采用随机盐和内存成本型 KDF。
- 统一注册要求预注册客户端和 `Idempotency-Key`，在一个事务内完成 Principal、Card、Handle、凭据和审计创建。
- AI 邀请创建继续复用同一发号器；客户端不能传入或保留下一个编号。
- 现有长 `aic_...` Card 增加迁移映射，不修改已有 migration 文件、不复用旧编号。

#### Verification

- 空库首张 Card 为 `AI_100001`；人类和 AI 混合并发创建无重复编号。
- 相同幂等键和相同请求返回同一 Card；内容冲突返回明确冲突，不新增身份。
- 错误密码、未知账号和已停用账号使用统一公开错误；登录限流和会话撤销生效。
- PostgreSQL schema 检查确认无明文密码、原始幂等键或可逆凭据。

### Phase 8B: First-Product Registration And Federation

#### Deliverables

- 扩展预注册平台客户端契约，支持从产品入口发起统一注册和已有账号登录。
- 注册成功后签发一次性授权结果，当前产品自动建立 pairwise Subject 映射和本地会话。
- 第二个测试产品完成同一 Card 复用验收，证明不会重复创建 Principal、Card 或凭据。
- Card 私有页直接展示当前登录人的 Card；移除“再次登录/注册/绑定 AI Card”的产品路径。
- 覆盖 loading、empty、error、success、重复提交和网络结果未知恢复状态。

#### Verification

- 在 Yoyoo 首次注册获得 Card 后，进入测试产品仍解析为同一 AI Card。
- 两个平台获得不同 pairwise Subject，但显式授权 `card.id` 后均指向同一个 Card。
- AI Card 服务不可用时产品注册失败且可重试，产品数据库没有新增本地替代身份。

### Phase 8C: Yoyoo Authority Migration

#### Deliverables

- 新增 Yoyoo forward-only migration，停止本地 `AI_` 发号 trigger 和 sequence。
- 将现有所有者稳定迁移到 AI Card 权威身份 `AI_100001`，保留 Yoyoo Principal ID 和全部历史资源外键。
- Yoyoo 登录页改为统一登录/注册入口；“我的 AI Card”直接展示当前统一身份。
- Agent 创建改为由 AI Card 自动发卡后绑定节点；旧 Gateway 凭据只保留兼容读取，不再成为身份创建主入口。
- 提供迁移前备份、映射对账、失败回滚和部署后只读验收脚本。

#### Verification

- 迁移前后房间、消息、文件、任务、成员和审计计数一致。
- 新建人类或 Agent 时 Yoyoo 不生成 Card ID；删除或隔离 AI Card 服务时创建请求明确失败。
- `AI_100001` 可登录并看到原工作空间；现有历史内容的作者与归属不变。
- 本地、集成、E2E、生产健康检查和公网真实登录全部通过后，才声明完成。

### Phase 8D: Controlled Product Onboarding And Production Readiness

#### Deliverables

- 旗下产品通过内部运维 CLI 登记精确 client、audience、callback 和 scope 合同，不开放第三方动态注册。
- 相同登记请求幂等；既有 client 的配置漂移默认拒绝，禁止静默增加 callback 或 scope。
- 生产 callback 强制 HTTPS，本地 HTTP 仅在显式开关下允许 `localhost`。
- 生产只读体检校验 issuer/WebAuthn 配置、migration ledger 和 Yoyoo client 精确合同，失败时以非零状态退出。
- 更新操作说明、开发记录和路线图，明确区分已实现、本地自测、独立审查和已部署。

#### Verification

- 第一次登记创建一份 client 合同和一条安全审计，原样重试不重复写入。
- audience、callback 或 scope 任一漂移均显式冲突；非 HTTPS 生产 callback 被拒绝。
- 生产体检从真实 `aicard_schema_migrations` 和平台客户端表读取，不回显数据库密码。
- lint、typecheck、build、unit、integration 和 e2e 全部通过后，才将本阶段标记为本地自测完成。

### V0.2 Explicit Non-Goals

- 不自动合并两个已存在的不同 AI Card，不通过昵称、邮箱或自然语言猜测身份。
- 不引入短信登录、社交登录、钱包、支付、信用、DID 或第三方开放注册。
- 不删除 Yoyoo 历史 Principal，不改写已应用 migration，不把业务数据搬进 AI Card。
- 不在独立安全复验、备份和回滚演练前切换生产身份权威。

## Tech Stack

- Web 与 API：Next.js、TypeScript、Node.js runtime。
- 数据库：PostgreSQL。
- 运行时校验：Zod。
- 人类认证：成熟的 WebAuthn/Passkey 库；选型前核对当前 Next.js 和 Node.js 版本兼容性。
- AI 节点认证：Node.js `crypto` 公钥签名验证，首版使用 Ed25519。
- 平台授权：授权码、PKCE、短期 opaque access token、轮换 refresh token；v0.1 不宣称完整 OIDC 兼容。
- 单元与集成测试：Vitest。
- 端到端测试：Playwright。
- 样式：项目自有 CSS tokens，不在基础身份阶段引入额外 UI 框架。

依赖安装前必须在实施阶段记录依赖名称、锁定版本、选择理由和安全维护状态。本计划不执行依赖安装。

## Project Structure

```text
AICard/
  Product-Spec.md
  DEV-PLAN.md
  README.md
  package.json
  infra/postgres/migrations/
  src/app/
  src/components/card/
  src/components/consent/
  src/domain/identity/
  src/domain/authorization/
  src/server/authentication/
  src/server/authorization/
  src/server/postgres/
  src/lib/contracts/
  tests/unit/
  tests/integration/
  e2e/
  开发过程/
```

## Phase 0: Product And Security Baseline

### Deliverables

- 冻结 v0.1 产品边界、术语和非目标。
- 输出身份、控制者、凭据、平台授权、Card 可见性和审计威胁模型。
- 锁定 AI Card ID、`@handle`、平台 Subject ID 和公开 URL 格式。
- 决定 Passkey 库并记录版本与选择证据。

### Files

- `Product-Spec.md`
- `DEV-PLAN.md`
- `docs/security-threat-model.md`
- `docs/protocol-v0.1.md`
- `开发过程/000_Roadmap.md`
- `开发过程/001_Feature_身份与授权基线.md`

### Verification

- 规格逐项覆盖目标用户、MVP、非目标、核心流程和验收标准。
- 威胁模型至少覆盖身份冒用、邀请泄露、授权码重放、Token 盗用、节点失窃、跨平台关联和越权 scope。
- 协议示例不得包含真实凭据。

## Phase 1: Runnable Foundation

### Deliverables

- 初始化 Next.js、TypeScript、Vitest、Playwright 和 PostgreSQL migration runner。
- 建立环境变量校验、结构化错误、健康检查和本地启动说明。
- 建立 CI 等价的 lint、typecheck、build、unit、integration、e2e 命令。
- 提供 loading、empty、error、success 页面骨架。

### Files

- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `next.config.ts`
- `eslint.config.mjs`
- `vitest.config.mts`
- `playwright.config.ts`
- `.env.example`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/loading.tsx`
- `src/app/error.tsx`
- `src/app/api/health/route.ts`
- `src/server/config.ts`
- `README.md`

### Verification

```bash
npm run lint
npm run typecheck
npm run build
npm run test
npm run test:integration
npm run test:e2e
```

- 健康检查在数据库可用和不可用时返回可区分状态。
- 关键页面在 `1440x900` 和 `390x844` 无横向溢出。

## Phase 2: Identity Core And Card Views

### Deliverables

- 建立 Principal、AI Card、Handle、Controller 和公开字段可见性模型。
- 生成永久全局 Card ID、内部 Principal ID 和平台专属 Subject ID。
- 实现公开正面、平台视图和私有背面数据投影。
- 实现 Card 生命周期与 Handle 历史别名。
- 首个 forward-only migration 和 repository/service/API 测试。

### Files

- `infra/postgres/migrations/0002_identity_core.sql`
- `src/domain/identity/types.ts`
- `src/domain/identity/schemas.ts`
- `src/server/postgres/identity-repository.ts`
- `src/server/identity-service.ts`
- `src/app/api/v1/cards/[cardId]/route.ts`
- `src/app/api/v1/me/card/route.ts`
- `src/components/card/card-front.tsx`
- `src/components/card/card-back.tsx`
- `src/app/card/[cardId]/page.tsx`
- `tests/unit/identity-schemas.test.ts`
- `tests/integration/identity-repository.test.ts`
- `e2e/card-views.spec.ts`

### Verification

```bash
npm run test -- identity
npm run test:integration -- identity
npm run test:e2e -- card-views
```

- 中文昵称可创建和修改，控制字符与不可见欺骗字符被拒绝。
- `@handle` 唯一；Card ID 不可修改和复用。
- 公开接口快照不含私有字段或内部凭据。
- 两个平台对同一 Principal 生成不同且稳定的 Subject ID。

## Phase 3: Human Controller Authentication

### Deliverables

- 使用 Passkey 完成人类注册、登录、重新验证和退出。
- 一个控制者支持多个 Passkey，单个凭据可以撤销。
- 建立安全会话、CSRF 防护、速率限制、恢复边界和审计事件。
- Card 背面展示凭据元数据和撤销操作，不展示私钥。

### Files

- `infra/postgres/migrations/0003_human_credentials.sql`
- `src/server/authentication/webauthn-service.ts`
- `src/server/authentication/session-service.ts`
- `src/app/api/v1/auth/passkey/register/options/route.ts`
- `src/app/api/v1/auth/passkey/register/verify/route.ts`
- `src/app/api/v1/auth/passkey/login/options/route.ts`
- `src/app/api/v1/auth/passkey/login/verify/route.ts`
- `src/app/api/v1/me/credentials/[credentialId]/route.ts`
- `src/components/card/security-panel.tsx`
- `tests/integration/passkey-auth.test.ts`
- `e2e/human-card-auth.spec.ts`

### Verification

```bash
npm run test:integration -- passkey-auth
npm run test:e2e -- human-card-auth
```

- 注册 challenge、登录 challenge 和 assertion 均为一次性并按时过期。
- 错误 origin、RP ID、签名、计数器回退和重放被拒绝。
- 撤销一个 Passkey 不影响其他有效 Passkey。

## Phase 4: AI Card Enrollment And Node Identity

### Deliverables

- 已验证人类控制者创建 AI Card 邀请。
- 生成完整可复制接入指令和单次、限时邀请票据。
- Agent 本机生成 Ed25519 密钥并提交公钥完成幂等认领。
- 认领 ID 配合独立查询秘密恢复未知结果；票据和查询秘密仅保存哈希。
- 首次认领签名证明私钥持有，后续使用一次性 challenge 进行节点认证。
- 一个 AI Card 支持多个独立机器节点、在线状态和单独撤销。
- 提供协议测试客户端，不把测试私钥提交到仓库。

### Files

- `infra/postgres/migrations/0004_agent_enrollment.sql`
- `src/domain/identity/agent-enrollment.ts`
- `src/server/agent-enrollment-service.ts`
- `src/server/agent-enrollment-route.ts`
- `src/app/api/v1/agent-invitations/route.ts`
- `src/app/api/v1/agent-invitations/[invitationId]/route.ts`
- `src/app/api/v1/agent-enrollment/claim/route.ts`
- `src/app/api/v1/agent-enrollment/status/route.ts`
- `src/app/api/v1/agent-nodes/challenge/route.ts`
- `src/app/api/v1/agent-nodes/authenticate/route.ts`
- `src/components/card/agent-panel.tsx`
- `scripts/agent-enrollment-reference.mts`
- `tests/integration/agent-enrollment.test.ts`
- `e2e/agent-card-enrollment.spec.ts`

### Verification

```bash
npm run test:integration -- agent-enrollment
npm run test:e2e -- agent-card-enrollment
```

- 票据过期、撤销、重复使用、错误签名和无控制者请求被拒绝。
- 同一认领 ID 重试返回同一结果，不创建第二张 Card 或第二个节点。
- 响应未知时只能使用正确的认领 ID 与查询秘密恢复结果，错误查询秘密不泄露状态。
- 节点撤销后无法认证，Card 和其他节点保持有效。
- 页面和日志中找不到邀请票据、私钥或完整长期秘密。

## Phase 5: Platform Authorization

Phase 5 分成两个可独立验收的切片。先交付授权码基线，再增加长期授权与撤销，避免一次引入两个安全状态机。

### Phase 5A: Authorization Code + PKCE（当前）

#### Deliverables

- 预注册 `yoyoo_dev` 与 `test_client`，逐字匹配 redirect URI 和允许的 scopes。
- 实现授权请求校验、登录态同意页、批准与拒绝跳转。
- 实现 5 分钟一次性授权码、S256 PKCE 和 10 分钟 opaque access token。
- access token 绑定 audience 与 scopes；`userinfo` 返回 pairwise Subject 和最小 Card 投影。
- 授权码、access token 仅保存 SHA-256 哈希，并记录不含秘密的安全审计事件。

#### Not In Phase 5A

- Refresh token、`offline_access`、token family 重放检测。
- Card 背面的授权列表、授权撤销和动态客户端注册。
- OAuth 2.0 / OIDC 完整兼容性声明。

#### Files

- `infra/postgres/migrations/0005_platform_authorization.sql`
- `infra/postgres/migrations/0006_platform_token_subject_binding.sql`
- `src/domain/authorization/types.ts`
- `src/domain/authorization/scopes.ts`
- `src/server/authorization/authorization-service.ts`
- `src/server/postgres/platform-authorization-repository.ts`
- `src/app/api/v1/authorize/route.ts`
- `src/app/api/v1/token/route.ts`
- `src/app/api/v1/userinfo/route.ts`
- `src/app/authorize/page.tsx`
- `src/components/consent/consent-panel.tsx`
- `tests/unit/platform-authorization.test.ts`
- `tests/integration/platform-authorization.test.ts`
- `e2e/platform-consent.spec.ts`

#### Verification

```bash
npm run test -- platform-authorization
npm run test:integration -- platform-authorization
npm run test:e2e -- platform-consent
```

- 未注册客户端、非精确 redirect URI、未知 scope、非 S256 PKCE 被拒绝。
- 拒绝授权不会创建 grant、code 或 token，并安全带回原始 state。
- 授权码只能兑换一次；错误、过期或重放的 code 被拒绝。
- 数据库和响应日志中没有授权码或 access token 明文。
- Token 只对目标 audience 和已授权 scopes 有效。
- Yoyoo 与第二测试客户端获得不同 pairwise Subject ID。

### Phase 5B: Refresh, Grant Management and Revocation

### Deliverables

- 在 Phase 5A 基线上增加轮换 refresh token、token family 重放检测和撤销。
- 授权码兑换和 refresh 轮换增加请求绑定的加密幂等恢复，不落明文 token。
- Card 背面可以查看和撤销平台授权。
- 只为明确批准 `offline_access` 且客户端 allowlist 允许的请求签发 refresh token。

### Files

- `infra/postgres/migrations/0007_refresh_grants_and_revocation.sql`
- `src/server/authorization/token-response-seal.ts`
- `src/server/authorization/token-service.ts`
- `src/app/api/v1/revoke/route.ts`
- `src/components/card/platform-grants.tsx`
- `tests/unit/token-response-seal.test.ts`
- `tests/integration/platform-grant-lifecycle.test.ts`
- `e2e/platform-grants.spec.ts`

### Verification

```bash
npm run test:integration -- platform-authorization
npm run test:e2e -- platform-consent
```

- Refresh token 重放使该 token family 失效并产生审计事件。
- 撤销授权后 access token、refresh token 和后续刷新都被拒绝。
- 相同幂等键重试返回同一 token 响应，不新增 token；不同幂等键重放被拒绝。
- 非持卡人不能查看或撤销他人的 grant；撤销缺少近期 Passkey、Origin 或 CSRF 时失败。
- 授权列表具备 loading、empty、error、success 状态，桌面与移动端无溢出。

### Not In Phase 5B

- 真实 Yoyoo 本地 Principal 映射、房间、消息或权限迁移。
- 动态客户端注册、第三方开发者控制台和 OAuth 2.0/OIDC 完整兼容声明。

## Phase 6: Yoyoo Integration

### Phase 6A Status (2026-08-09)

- 已实现并完成自动化门禁：Yoyoo 客户端契约、S256 授权、加密临时回调状态、
  UserInfo 校验、pairwise Subject 到现有 Owner Principal 的稳定映射。
- 本机已使用 Chrome 虚拟 WebAuthn 认证器完成 Yoyoo 双服务授权实测；真实硬件
  Passkey、独立安全和生产验收仍待完成。
- 旧 Agent Gateway 保持兼容，没有删除或迁移 `yya_` 凭据。
- Phase 6B1 与 6B2 已完成自动化自测；真实 AI Card、Yoyoo 和外部 YOS
  三进程人工验收、独立安全验收与生产部署仍待完成。

### Phase 6B1: Controlled AI Identity Authorization

状态：2026-08-09 已实现并完成自动化自测；未独立验收或部署。

#### Deliverables

- 扩展授权请求支持可选 `principal_type=ai`，默认继续授权当前人类身份。
- 授权页展示当前人类控制的 active AI Card，并提供 loading、empty、error、
  success 状态。
- 服务端在签发授权码前原子验证控制者、目标 Principal 类型和状态。
- 授权码、Grant、Token、UserInfo 和 pairwise Subject 使用目标 AI Principal，
  不使用控制者 Principal。
- 不修改节点私钥、邀请票据或现有 Yoyoo Agent Gateway 凭据。

#### Verification

- 受控 AI Card 可授权；外部、已撤销、非 AI 或伪造目标被拒绝。
- 相同 AI Card 重复授权保持同一 pairwise Subject；人类授权回归不变。
- 授权选择和回调流程在桌面与移动视口无溢出、无控制台错误。
- 完整运行 lint、typecheck、build、unit、integration 和 e2e 门禁。

#### Not In Phase 6B1

- 节点密钥换取平台运行时会话、Yoyoo 作业领取与回复提交。
- 自动房间成员关系、旧凭据迁移、公开多租户和生产部署。

### Phase 6B2: Agent Runtime Session

状态：2026-08-09 已实现并完成自动化自测；未独立验收或部署。

#### Delivery Objective

让已认领节点使用现有 Ed25519 密钥换取两分钟有效、只面向 Yoyoo 的运行时会话，
同时继续由 AI Card 独占身份、控制关系、平台授权、节点和撤销权威。

#### Phase 1: Runtime Scope And Storage

- 将 `agent.runtime` 加入 scope allowlist 与预注册 `yoyoo_dev` 客户端。
- 新增 forward-only 运行时 Token 表，只保存 SHA-256 哈希，并绑定 grant、
  pairwise Subject、node、client 和 audience。
- 验证空库和当前 checksum 基线升级。

#### Phase 2: Node Exchange And Introspection

- 为节点认证增加可选 client-bound runtime exchange，规范载荷版本为
  `aicard-agent-runtime-v1`。
- 仅当 AI Card、节点、客户端、控制关系、Grant、Subject 和 `agent.runtime`
  全部 active 时签发两分钟 opaque token。
- 新增 rate-limited、no-store introspection route；默认拒绝并只返回 Subject、
  node、client、audience、scope 和过期时间。

#### Verification

- RED/GREEN unit tests：scope normalization 与规范签名载荷。
- PostgreSQL integration：只存哈希、错误 client、challenge 单次消费、过期、
  节点撤销和 Grant 撤销立即失效。
- Route contract：缺失、格式错误、过期与有效 Bearer Token。
- 交付前运行 lint、typecheck、unit、integration、build 和 e2e 全门禁。

#### Not In Phase 6B2

- 不迁移 `yya_`，不签发 runtime refresh token，不改房间成员，不做 streaming、
  并发租约、生产部署或私钥托管。

### Phase 6B3: Controlled AI Grant Management

状态：2026-08-10 已实现并完成自动化自测；未独立验收或部署。

#### Deliverables

- 私有 Card 背面按身份分组展示本人和当前有效控制 AI Card 的平台授权。
- 服务端使用当前会话 Principal 与实时控制关系决定 Grant 可见性和撤销权限；
  浏览器只提交 `grantId`。
- Grant、Token 和 pairwise Subject 仍归实际授权 Principal，控制者仅作为管理操作 actor。
- 撤销继续复用近期 Passkey、Origin、CSRF、限流和原子 Token 失效路径。
- loading、empty、error、success、revoked 状态在桌面和移动端可用。

#### Files

- `src/domain/authorization/types.ts`
- `src/server/postgres/platform-authorization-repository.ts`
- `src/server/authorization/authorization-service.ts`
- `src/app/api/v1/revoke/route.ts`
- `src/app/me/card/page.tsx`
- `src/components/card/platform-grants.tsx`
- `tests/integration/platform-authorization.test.ts`
- `e2e/platform-consent.spec.ts`

#### Verification

```bash
npm run test:integration -- platform-authorization
npm run test:e2e -- platform-consent
npm run lint
npm run typecheck
npm run build
```

- 控制者能看到并撤销受控 AI Grant；令牌和刷新立即失效。
- 无关用户、失效控制关系和伪造 `grantId` 被拒绝，且不泄露 Grant 是否存在。
- 审计事件 actor 为控制者，metadata 保留实际授权 subject；不记录 Token 或内部秘密。

#### Not In Phase 6B3

- 不新增数据库 migration、独立 AI 详情页、批量撤销、组织审批或控制权转移。

### Deliverables

- Yoyoo 通过 AI Card 授权流程建立本地 Principal 映射。
- Agent 接入页面改为创建或认领 AI Card，并复制完整接入指令。
- Yoyoo 不再把裸长期 Token 作为用户主要交付物。
- 撤销 AI Card 平台授权后，Yoyoo 新会话失败，既有消息和文件归属保持稳定。
- Yoyoo 继续拥有房间、消息、文件、任务和本地权限。

### Files

AICard：

- `src/lib/contracts/yoyoo-client.ts`
- `tests/integration/yoyoo-client-contract.test.ts`
- `e2e/yoyoo-authorization.spec.ts`

Yoyoo：

- `Product-Spec.md`
- `DEV-PLAN.md`
- `infra/postgres/migrations/005_aicard_identity_mapping.sql`
- `src/server/aicard-client.ts`
- `src/server/postgres/principal-repository.ts`
- `src/components/settings/agent-directory.tsx`
- `src/app/api/v1/workspaces/current/agents/route.ts`
- `tests/integration/aicard-mapping.test.ts`
- `e2e/agent-directory.spec.ts`
- `开发过程/018_Feature_AI_Card身份接入.md`

### Verification

```bash
# AICard
npm run lint
npm run typecheck
npm run build
npm run test
npm run test:integration
npm run test:e2e

# Yoyoo
npm run lint
npm run typecheck
npm run build
npm run test
npm run test:integration
npm run test:e2e
```

- 一个真实人类 Card 和一个协议测试 AI Card 完成 Yoyoo 授权与本地 Principal 映射。
- 中文昵称、`@handle`、AI Card ID 和本地 Principal ID 不混用。
- 撤销、过期、重复提交和网络结果未知路径均有可恢复 UI。
- Yoyoo 原有房间、消息、Agent Gateway 和历史数据通过回归测试。

## Phase 7: Hardening And Handoff

### Deliverables

- 完成安全审查、依赖审计、速率限制、日志脱敏和备份恢复演练。
- 验证 loading、empty、error、success、expired、revoked 和 unknown-result 状态。
- 更新 README、协议说明、运维说明和开发过程文档。
- 生成 v0.1 可回滚存档；不在本阶段自动公网发布。

### Files

- `README.md`
- `docs/protocol-v0.1.md`
- `docs/security-threat-model.md`
- `docs/operations.md`
- `docs/recovery.md`
- `开发过程/007_Feature_v0.1交接.md`
- `开发过程/000_Roadmap.md`

### Verification

```bash
npm audit --omit=dev
npm run lint
npm run typecheck
npm run build
npm run test
npm run test:integration
npm run test:e2e
```

- 独立安全审查确认没有高危未处理项后，才能讨论公网发布。
- 备份恢复演练能恢复 Card、控制权、授权和审计，不恢复已撤销凭据为有效状态。
- 交付报告明确区分已实现、自测、独立验收和已部署。

## Key Risks

- **身份与平台权限耦合**：AI Card 只签发身份和授权声明，平台保留本地授权判断。
- **全局 ID 导致追踪**：默认使用 pairwise Subject ID，公开 Card ID 由持卡人主动披露。
- **万能密钥泄露**：人类和 AI 使用多个独立凭据，不设计单个跨平台主 Token。
- **AI 无责任主体**：v0.1 强制已验证控制者，控制关系变化需要审计和再次验证。
- **协议伪兼容**：未通过一致性测试前只称“OIDC/OAuth 风格”，不对外宣称标准兼容。
- **Yoyoo 回归**：采用新增映射和兼容路径，不改写已应用 migration，不破坏现有 Principal ID。
- **范围膨胀**：支付、信用、DID、市场和第三方开放注册全部留在 v0.1 之外。

## Out Of Scope

- Product-Spec 中 `Not In V0.1` 的全部内容。
- 公网生产发布、真实资金流和生产组织迁移。
- 在未完成安全审查前向不受信任第三方发放平台客户端资格。
