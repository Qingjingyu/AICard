# AI Card Unified Account Protocol v0.2

## Status And Boundary

本文是 v0.2 Phase 8A 与 8B 的已实现合同，覆盖 AI Card 权威发号、人类密码注册与登录、旧编号兼容、现有 AI 邀请复用统一发号器，以及预注册产品的统一身份接入。

Phase 8B 已由独立参考产品完成本地自动化复用验收，但不表示 Yoyoo 已经切换身份权威。Yoyoo forward-only 数据迁移、停止本地发号和生产切换仍属于 Phase 8C。

v0.1 的 Passkey、AI 节点、平台授权和 pairwise Subject 合同仍然有效；本文只定义 v0.2 更改的部分。

## Authoritative Identifiers

### Principal ID

- 内部不可变 UUIDv7，继续作为所有数据库关系和权限判断的真实身份主键。
- 不得因为 Card ID、昵称、Handle、平台或设备变化而重新生成。

### AI Card ID

- 字段：`card_id`
- 格式：`^AI_[1-9][0-9]{5,}$`
- 首个可签发值：`AI_100001`
- 语义：全体系永久公开编号，不可修改、回收或重用。编号单调递增但不承诺绝对无缺口；回滚事务已分配的数值不会补发给其他身份。
- 权威：只有 AI Card PostgreSQL 序列与 `ai_cards` insert trigger 可以签发。API、Repository、Yoyoo 或 Agent 不得指定下一个编号。

迁移前的 `aic_` 加 26 位 Crockford Base32 值不再签发。它们只保留在 `ai_card_id_aliases` 中用于解析历史公开链接，接口返回的 Card ID 始终是当前 `AI_...` 值。

## Unified Registration

`POST /api/v1/auth/password/register` MUST 包含：

- 精确匹配 `APP_ORIGIN` 的 `Origin`。
- `Idempotency-Key`：32-128 个 Base64URL 字符，由产品入口用密码学随机源产生。
- 已预注册且 active 的 `clientId`。
- `displayName`、`handle` 和 12-128 字符密码。

AI Card MUST 在一个事务内完成 Principal、Card ID、Handle、密码凭据、注册幂等记录、安全会话和审计事件。任何一步失败都不得留下部分身份。

相同客户端、幂等键、资料和原密码的重试 MUST 返回同一 Principal 和 Card，但轮换为新会话。资料改变 MUST 返回资源冲突；密码不匹配 MUST 返回通用认证失败，幂等键不能单独恢复会话。

### Success Response

```json
{
  "card": {
    "card_id": "AI_100001",
    "handle": "subai",
    "display_name": "苏白"
  },
  "replayed": false
}
```

响应不得包含 Principal ID、密码、salt、hash、会话原文或 CSRF 原文。会话仅通过 `HttpOnly`/`SameSite=Strict` Cookie 签发，CSRF Cookie 单独用于状态变更双提交校验。

## Password Login

`POST /api/v1/auth/password/login` 接受当前 `AI_...` Card ID 或 `@handle` 和密码。

- 未知账号、错误密码、非 active Card 和 disabled 密码凭据均返回同一公开错误 `Account or password is invalid`。
- 未知账号仍 MUST 执行等价 `scrypt` 校验，降低通过基础时序枚举账号的风险。
- 成功登录 MUST 撤销请求中的旧会话并签发新会话。
- 登录和注册 MUST 使用独立限流窗口并记录不含凭据原文的审计事件。

## Password Storage

- 算法标识：`scrypt-v1`
- Salt：每个账号 16 个密码学随机字节。
- 派生长度：64 bytes。
- 参数：`N=32768`, `r=8`, `p=1`。
- 服务端不得记录密码原文、请求体或可逆凭据。

Passkey 在 v0.2 中是可选的增强凭据。密码注册身份可在当前密码会话的近期验证窗口内添加首个 Passkey。

## Product Registration And Federation

产品 MUST 预注册 `client_id`、逐字匹配的 redirect URI 和 scope allowlist。产品入口生成随机 state、PKCE verifier/challenge 和不可预测 flow token，再把浏览器导航到 AI Card `/authorize`。

参考产品后端只允许调用以下公共接口：

- `POST /api/v1/federation/validate`：验证 client、redirect URI、PKCE 和 scopes；只返回 `{ "valid": true }`。
- `POST /api/v1/token`：使用一次性 code、verifier 和幂等键换取短期 access token。
- `GET /api/v1/userinfo`：使用 Bearer token 获取 pairwise Subject 和经批准 claims。

产品 MUST 使用 pairwise `sub` 作为当前产品内的稳定外部身份键。只有明确获得 `card.id` scope 时才能保存全局 `card_id`；不得保存 AI Card 内部 Principal ID。产品自己的 member ID、会话、角色、房间、消息和权限继续由产品数据库管理。

注册来源由 AI Card 服务端从已验证授权请求确定：直接访问 AI Card 官网使用 `aicard_web`，从产品入口进入则使用真实预注册 `client_id`。浏览器提交未经验证的客户端标识不能改变注册归属。

产品回调 MUST 同时验证 flow、state、code、client 和 redirect URI。flow/session 只保存 SHA-256 摘要；PKCE verifier 和幂等恢复响应使用 AES-256-GCM 加密保存。相同回调在网络结果未知后重试 MUST 恢复同一 member/session，不得重复创建身份。AI Card 不可用或响应无效时 MUST 失败关闭，不得生成产品私有 `AI_` 编号或替代账号。

## Compatibility And Non-Goals

- 旧 Card ID 只用于公开 Card 查询兼容，不是新建、登录或业务写入的主标识。
- Phase 8A/8B 不提供找回密码、修改密码、组织管理、动态客户端注册或生产密钥管理。
- 当 AI Card 不可用时，业务产品 MUST 明确失败且允许重试，MUST NOT 降级生成产品私有身份或临时 `AI_` 编号。
