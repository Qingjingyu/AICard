# 007 Feature - Refresh 轮换与授权撤销

## 背景

Phase 5A 只能签发 10 分钟 access token，且授权码兑换成功但响应丢失时无法恢复。Phase 5B 要在不保存明文长期凭据的前提下，提供长期授权、重试安全、重放检测和持卡人可见的撤销控制。

## 关键决策

- 只有客户端 allowlist 允许且持卡人明确批准 `offline_access` 时才签发 refresh token。
- Access token 保持 10 分钟；refresh family 最长 30 天，每次使用签发新 access/refresh token。
- 已消费 refresh token 用不同幂等键重放时，在一个数据库事务内撤销整个 family、其全部 refresh token 和关联 access token。
- 授权码兑换和 refresh 轮换都要求高熵 `Idempotency-Key`。同一凭据与 key 只恢复原响应，不再签发新 token。
- 恢复响应使用 AES-256-GCM 密封；密钥由客户端持有的原凭据和幂等键派生，数据库不保存这两者的明文。
- 平台授权列表只按当前 Principal 查询。撤销要求有效会话、精确 Origin、CSRF 证明和 5 分钟内 Passkey 验证。
- 数据库只通过 forward migration `0007_refresh_grants_and_revocation.sql` 扩展，不改写已应用 migration。

## 否掉的备选

- JWT refresh/access token：无法满足当前的即时撤销与服务端权威状态边界，还会新增签名密钥运维。
- 为幂等恢复保存 token 明文：会把数据库读权限升级为可直接冒用凭据的能力。
- 只撤销 refresh token，等 access token 自然过期：不符合产品对“立即撤销”的承诺。
- 先接真实 Yoyoo：会把协议缺陷带入第一个客户端，难以区分基础设施与集成问题。

## 实现与状态

- `/api/v1/token` 支持 `authorization_code` 和 `refresh_token` 两种 grant，并强制幂等键。
- 私有 Card 背面增加平台授权列表，具备加载、空、错误和成功状态。
- `/api/v1/revoke` 只能撤销当前持卡人的 grant，重复撤销幂等，并且只记录一次成功审计。
- 未新增或删除任何第三方依赖；加密、随机数和哈希均使用 Node.js `crypto`。

## 验证结果

- 单元测试：17 个文件、48 项通过。
- 集成测试：6 个文件、29 项通过，使用隔离 PostgreSQL 17 和完整 forward migration。
- E2E：桌面与移动端共 28 项通过，包含真实长期授权、Card 背面撤销、access/refresh 立即失效与窄屏无水平溢出。
- 生产构建、ESLint 和 TypeScript 严格类型检查通过。

## 影响范围与剩余风险

- 只修改 AICard；Yoyoo 仓库与其现有行为未改动。
- `yoyoo_dev` 获得 `offline_access` allowlist；`test_client` 仍不允许长期授权。
- 尚未完成真实 Yoyoo 接入、独立安全审查、生产 KMS/监控、账号恢复或公网部署。
- 当前结论是“已实现并自测”，不是“已独立验收”或“已生产发布”。
