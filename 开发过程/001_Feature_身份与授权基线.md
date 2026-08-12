# 001 Feature: 身份与授权基线

## Status

- 阶段：Phase 0
- 交付状态：设计基线已完成并自检
- 代码状态：尚未初始化运行时工程
- 独立验收：未进行
- 部署状态：未部署

## Background

AI Card 将被人类、AI 和多个平台共同使用。若不先固定身份、控制权、可见性和授权边界，后续极易把昵称当主键、把公开 Card ID 当跨平台 Subject、把平台业务权限混入身份服务，最终无法安全扩展。

本阶段先把“谁是谁、谁控制谁、谁能看到什么、平台拿到什么、凭据如何撤销”锁定为实现合同，再进入工程初始化。

## Delivered Files

- `Product-Spec.md`：产品边界、MVP、非目标、核心流程和验收标准。
- `DEV-PLAN.md`：技术栈、Phase 0-7、每阶段文件与验证方式。
- `docs/security-threat-model.md`：信任边界、资产、攻击路径、12 类核心威胁和安全门禁。
- `docs/protocol-v0.1.md`：标识格式、可见性、状态机、Passkey、AI 认领、平台授权、错误和审计合同。
- `开发过程/000_Roadmap.md`：阶段状态与长期路线。

## Key Decisions

### One Identity Model For Humans And AI

人类和 AI 都是 Principal，都拥有 AI Card。类型差异只影响认证与控制方式，不产生两套彼此割裂的主键体系。

### Four Separate Identifiers

- `display_name`：支持中文、可重复、用于展示。
- `handle`：ASCII 全局唯一、可修改、用于被找到和提及。
- `card_id`：全局永久公开编号，不可修改或复用。
- `principal_id`：UUIDv7 内部主键，不进入公开或平台 claim。

平台获得的 `sub` 是针对 `(client_id, principal_id)` 随机生成并持久化的 pairwise Subject，默认不能跨平台关联。

### Front, Platform Projection, Back And Vault

Card 正面可公开；平台只获得 scope 覆盖的最小字段；私有背面只用于持卡人管理；保险库没有通用读取接口。数据库对象不得直接序列化为 API 响应。

### Human Control Is Required In V0.1

AI Card 必须绑定已验证的人类 Controller。无人负责的自治身份、组织多管理员和控制权转移延后，避免首版同时引入治理与争议处理系统。

### Passkey Library

选择：

- `@simplewebauthn/server@13.3.2`
- `@simplewebauthn/browser@13.3.0`

理由：官方文档覆盖 registration/authentication 的 challenge、Origin、RP ID、counter 和 TypeScript 数据结构；官方 npm registry 显示 server 要求 Node.js `>=20.0.0`，与计划的 Node 22 LTS 兼容。Phase 0 只锁定版本，未安装依赖。

### Protocol Security Defaults

- Passkey challenge：5 分钟，单次。
- AI node nonce：2 分钟，单次。
- Invitation：基线曾规划 30 分钟；Phase 4 实现收紧为 15 分钟、单次使用，服务端只存 SHA-256 哈希。
- Authorization code：5 分钟，单次，绑定 client、redirect URI、PKCE 与 grant。
- Access token：10 分钟，opaque，绑定 audience/scope。
- Refresh token：最长 30 天 family，每次轮换，检测 reuse 后撤销整族。

## Rejected Alternatives

### Reuse Yoyoo Local Principal As Global Identity

否决。它会让 Yoyoo 成为身份所有者，其他平台无法独立接入，也会把平台本地权限和身份鉴权耦合。

### Use Handle Or Nickname As Business Key

否决。两者都可能变更，昵称还允许重复。消息、文件、成员和授权必须最终引用内部 Principal 或平台 Subject。

### Expose Global Card ID To Every Platform By Default

否决。全局 ID 会天然形成跨平台追踪键。只有显式授权 `card.id` 后才允许平台获得它。

### Build Custom WebAuthn Cryptography

否决。认证签名、浏览器差异和 authenticator counter 处理不应自行实现，使用成熟库更可验证。

### Claim Full OIDC Compatibility In V0.1

否决。v0.1 使用授权码、PKCE 和 pairwise Subject 的安全原则，但未通过一致性测试，不对外宣称标准兼容。

## Threat Model Result

优先级最高的风险是邀请票据泄露后抢先认领（TM-001）。其余高风险集中在授权码/token 重放、节点私钥失窃、跨 Card 越权、Controller 接管、跨平台关联、scope 提权、撤销失效和秘密进入日志。

当前没有任何运行时安全控制。威胁模型中列出的控制全部是 Phase 1-7 的实现和测试门禁，不能作为“已上线能力”对外描述。

## Verification

2026-08-08 已执行文档级自检：

- AI Card ID 示例匹配固定 26 位 Crockford Base32 规则：PASS。
- Handle 示例匹配 ASCII 唯一标识规则：PASS。
- 威胁模型包含不少于 12 个稳定 Threat ID：PASS。
- 威胁模型 11 个必需章节齐全：PASS。
- 协议文档 11 个核心章节齐全：PASS。
- 全部 Phase 0 文档不存在未填写的工作占位标记：PASS。
- SimpleWebAuthn server/browser 版本与 server Node engine 已通过官方 npm registry 核对：PASS。

未执行构建、单元测试、集成测试或真实浏览器测试，因为运行时工程尚未初始化。

## Impact Scope

本阶段只新增或修改 `/Users/subai/A/30_开发实验室/AICard` 下的文档。没有安装依赖，没有创建数据库，没有修改 Yoyoo，也没有产生部署影响。

## Remaining Risks

- 正式 issuer 域名、RP ID 和 allowed origins 尚未选定，协议使用 `.invalid` 示例域名。
- 账户恢复、Controller 争议与生产 KMS 方案尚未确定。
- 所有安全控制仍待实现，Phase 1 只能在本地启动，不具备公网发布条件。

## Next Step

进入 Phase 1：初始化 Next.js、TypeScript、PostgreSQL、测试门禁、环境校验和四态页面骨架。Phase 1 不实现业务身份流程，只建立可运行、可测试、可安全失败的工程基础。
