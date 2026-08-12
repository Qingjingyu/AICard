# 006 Feature - 平台授权码与 PKCE

## 背景

AI Card 需要让 Yoyoo 和未来平台在不取得全局根身份、不接触长期密钥的前提下确认“是谁”以及“被允许看到什么”。Phase 5A 先完成可独立验收的短期授权闭环，不把 Refresh Token 与撤销状态机混入首个切片。

## 关键决策

- 首版只接受 operator 预注册的 `yoyoo_dev` 与 `test_client`；redirect URI 逐字匹配，禁止 wildcard。
- 请求必须使用 S256 PKCE、不可预测 state 和 scope allowlist；`offline_access` 在 5A 明确拒绝。
- 持卡人在独立同意页看到平台名和逐项身份字段，可以批准或拒绝。
- 授权码使用 `ac_` 前缀、256-bit 随机主体、5 分钟有效且只消费一次；access token 使用 `at_` 前缀、256-bit 随机主体、10 分钟有效。
- 授权码和 access token 只保存 SHA-256 摘要；审计只记录 client、grant、scope、audience 和结果。
- token 绑定 active grant、client、audience、pairwise Subject 和 scopes；`userinfo` 通过显式投影返回最小字段。
- pairwise Subject 由 `(client, principal)` 唯一约束稳定保存，并用 forward migration 加强 access token 的三字段外键绑定。

## 否掉的备选

- 一次完成 Refresh Token 与撤销：会同时引入授权码和 token family 两套安全状态机，首轮难以独立验证和回退。
- 动态客户端注册：首版没有开发者审核与 redirect 管理面，开放后会放大钓鱼和 open redirect 风险。
- 直接向平台返回全局 Card ID：会破坏不同平台默认不可关联的隐私原则。
- 把 token 明文保存用于重试：会扩大数据库泄露后的凭据风险；响应丢失恢复需另行设计安全幂等协议。

## 实现范围

- Forward-only migrations `0005_platform_authorization.sql` 与 `0006_platform_token_subject_binding.sql`。
- 授权请求校验、批准/拒绝、授权码兑换、短期 access token 和 `userinfo` API。
- 登录态同意页及 loading、error、success 状态，支持桌面和移动端。
- 预注册 Yoyoo 开发客户端与第二测试客户端，用于验证 pairwise Subject 隔离。
- 未新增第三方依赖；随机数、SHA-256 与 PKCE 使用 Node.js 内置 `crypto`。

## 状态与失败路径

- 未注册客户端、非精确 redirect URI、未知/延后 scope、非 S256 PKCE 默认拒绝。
- 授权拒绝不会创建 grant、code 或 token，并原样带回 state。
- 错误 verifier、错误 redirect、过期或重放 code 不签发 token。
- 缺少 Origin/CSRF 的授权决定、无 Bearer token 的 userinfo 和无效 token 请求返回稳定错误结构。
- Card 非 active 时不签发新的授权材料，已有 token 的 userinfo 也失败。

## 剩余风险与未完成项

- code 兑换成功但响应丢失时，客户端目前不能安全恢复同一结果；下一安全切片需要带请求绑定的幂等恢复。
- Refresh Token、token family 重放检测、授权列表与撤销属于 Phase 5B。
- 尚未接入真实 Yoyoo 后端，当前 callback 由 Playwright 模拟。
- 尚未完成独立安全审查、真实外部客户端验收或生产部署。

## 验证结果

专项验证已通过：授权单元 3 项、全部集成 27 项、授权桌面/移动端 E2E 4 项。

完整 `npm run verify` 已从头通过：

- lint 与 TypeScript 严格类型检查通过。
- Next.js 生产构建通过，生成 `/authorize`、授权决定、token 与 userinfo 动态路由。
- 单元测试 16 个文件、46 项通过。
- 集成测试 6 个文件、27 项通过，使用隔离 PostgreSQL 17 和完整 forward migration。
- E2E 28 项通过，覆盖桌面与移动端授权批准、拒绝、token 兑换、userinfo、CSRF/认证拒绝及既有 Card/Passkey/Agent 回归。

## 影响范围

- 新增平台客户端、grant、授权码和 access token 数据，不改写既有 migration checksum。
- 新增 `/authorize`、`/api/v1/authorize`、`/api/v1/token` 与 `/api/v1/userinfo`；既有 Card、Passkey、AI 节点接口和 Yoyoo 仓库不变。
- 当前仍是本地/受保护环境自测版本，不可宣称 OAuth 2.0/OIDC 完整兼容或生产就绪。
