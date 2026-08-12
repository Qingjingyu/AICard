# 003 Feature：身份核心与 Card 视图

## 背景

Phase 1 只证明项目可以运行。Phase 2 的目标是先建立稳定的身份骨架，使后续 Passkey、AI 认领和平台授权都引用同一组不可变标识和可见性规则，而不是继续使用昵称、Handle 或平台本地 ID 充当身份。

## 本阶段范围

- Principal、AI Card、Handle、Controller 和 Card 生命周期。
- UUIDv7 内部 Principal ID、永久公开 Card ID、平台专属 pairwise Subject。
- 公开正面、平台 claims 和私有背面三类独立投影。
- 公开 Card 页面、公开只读 JSON API，以及认证前固定拒绝的私有接口。
- PostgreSQL forward migration、repository/service、单元/集成/浏览器测试。

本阶段不实现 Passkey、会话、Card 创建页面、匿名写入 API、AI 邀请、节点密钥、平台 Token 或 Yoyoo 接入。

## 关键决策

1. Card ID 使用 `aic_` 加 128-bit 随机值，公开、永久、不可变；数据库内部关系使用 UUIDv7 Principal ID。
2. 昵称支持中文和重复，经过 NFKC 规范化并拒绝控制/不可见字符；`@handle` 只允许稳定的 ASCII 规则并永久保留历史值。
3. AI 和人类共用基础 Principal/Card 模型；AI 创建时必须引用 active 人类控制者。真正的“已验证控制者”必须等 Phase 3 Passkey 完成，当前 repository 能力没有对外写入口。
4. 平台 Subject 随机生成并按 `(client_id, principal_id)` 持久化，不从公开 Card ID 派生。
5. 可见性由三套显式投影实现，不通过“删掉几个字段”的方式复用同一响应。缺少 `card.basic` scope 时，平台投影不会返回昵称、类型和头像。
6. 私有 `/api/v1/me/card` 在认证完成前固定返回 401；不提供方便开发的临时匿名后门。
7. 使用 `uuid@14.0.1` 生成标准 UUIDv7。选择它是因为当前版本原生提供 v7、TypeScript 类型且无需自写时间位编码；版本精确锁定。

## 否掉的备选

- **直接使用 Card ID 作为所有数据库外键**：公开标识会扩散到内部和平台数据，不利于隐私隔离和未来迁移。
- **昵称或 Handle 作为身份**：两者都会变化，昵称还允许重复，不能保证消息、文件和授权归属稳定。
- **Card ID 派生平台 Subject**：不同平台可以关联同一持卡人，违背默认隐私隔离。
- **本阶段同时做 Passkey 和写 API**：会把身份模型、认证和授权三个风险域一次展开，无法形成可暂停、可验收的小阶段。
- **为了预览开放匿名创建接口**：缺少认证、速率限制和审计，会制造不能安全上线的临时行为。

## 错误与状态处理

- Card 页面包含 loading、success、empty/not-found 和 error 四态。
- 非法 Card ID 返回稳定的 `400 INVALID_REQUEST`；未知 Card 返回 `404 RESOURCE_NOT_FOUND`；内部错误返回不含数据库细节的 `500 INTERNAL_ERROR`。
- 所有 Card API 响应使用 `cache-control: no-store`。
- retired 是终态；Handle 历史值不能重新注册；并发状态变化使用条件更新拒绝静默覆盖。

## 验证结果

最终门禁结果在本阶段交付时重新执行并记录：

- ESLint：通过，0 error。
- TypeScript：`tsc --noEmit` 通过。
- Production build：Next.js 优化构建通过，Card 页面与两个 API 路由均进入构建产物。
- Unit：11 个测试文件、32 个测试全部通过。
- Integration：2 个测试文件、8 个测试全部通过，使用隔离 PostgreSQL 运行全部 migrations。
- Playwright：桌面和移动端共 18 个测试全部通过，其中 Card 功能与视觉测试 6 个。
- 依赖审计：执行干净 `npm ci`，审计 514 个包，0 个已知漏洞。

浏览器视觉基线覆盖 `1440x900` 和 `390x844`；公开 Card 不显示控制者、内部 Principal ID 或秘密字段。

## 影响范围与剩余风险

本阶段新增独立 AI Card 项目的身份域、数据库 schema、公开读取 API 和 Card 页面，不修改 Yoyoo。

剩余风险：尚无真实控制者认证、速率限制、审计事件和公网部署保护；公开 Card URL 在正式部署前仍需确定发行域名和边缘限流方案。因此当前结论是“本地实现并自测”，不是“可生产上线”。
