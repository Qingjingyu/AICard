# AI Card Roadmap

## North Star

AI Card 成为面向 AI 时代的人类与 AI 的统一身份、鉴权和授权基础设施。身份可被多个平台使用，持卡人保有控制权、隐私权和撤销权；任何平台都不能获得根密钥或替代本地权限判断。

## Current Release

版本：v0.1

当前阶段：Phase 6B3 - 受控 AI 平台授权管理（已完成自动化自测；未独立安全审查或部署）

首个接入平台：Yoyoo

## Confirmed Decisions

- 产品名称统一为 AI Card，含义是“AI 时代的 ID Card”，不是 AI 专用卡。
- 人类和 AI 使用同一种基础身份模型。
- Yoyoo 是第一个使用 AI Card 的平台，不是身份所有者。
- AI Card ID 从第一天起全体系唯一。
- Card 采用公开正面、平台可见和私有背面三层可见性。
- 用户界面是正面和背面；不可展示秘密由系统保险库管理。
- AI Card 证明身份并管理授权，平台保留本地业务权限。
- AI 类型 Card 在 v0.1 必须绑定已验证的人类控制者。
- 昵称支持中文且可重复；`@handle` 唯一；业务最终引用不可变身份 ID。
- 默认向不同平台提供不可关联的 pairwise Subject ID。
- v0.1 中不实现支付、信用、DID、区块链和第三方开放市场。

## Phase Status

| Phase | Deliverable | Status |
|---|---|---|
| 0 | Product Spec、Development Plan、安全与协议基线 | Completed (Docs Verified) |
| 1 | 可运行工程、PostgreSQL、测试门禁和四态骨架 | Completed (Self-Tested) |
| 2 | Principal、AI Card、正反面和三层可见性 | Completed (Self-Tested) |
| 3 | 人类 Passkey 注册、登录和控制者认证 | Completed (Self-Tested) |
| 4 | AI 邀请、Card 认领和运行节点身份 | Completed (Self-Tested) |
| 5A | 预注册客户端、同意、授权码、PKCE、短期 Token 与 pairwise Subject | Completed (Self-Tested) |
| 5B | Refresh Token、授权管理与撤销 | Completed (Self-Tested) |
| 6A | Yoyoo 客户端契约、Owner 授权与稳定 Principal 映射 | Completed (Local Self-Tested) |
| 6B1 | 控制者选择 AI Card、Agent 授权与 Yoyoo 稳定身份映射 | Completed (Self-Tested) |
| 6B2 | AI Card 节点运行时认证、任务传输与兼容迁移 | Completed (Self-Tested) |
| 6B3 | 控制者查看和撤销受控 AI 的平台授权 | Completed (Self-Tested) |
| 7 | 安全加固、恢复演练和 v0.1 交接 | Pending |

Phase 3-6B3 的“Completed”表示实现、隔离 PostgreSQL、Chrome 虚拟认证器、协议测试 Agent，以及桌面/移动端自动化自测完成。Phase 6B2 另在本机使用全新人类与 Agent Card 完成 AI Card、Yoyoo 和真实外部 YOS 的冷启动端到端验收，覆盖入房、持久化回复和节点撤销；该验收仍由同一执行者完成，不等同于第三方独立审查。项目尚未经过独立安全验收、真实硬件 Passkey 人工验收或生产部署；账号恢复和生产级密钥管理未实现，公网部署保持关闭。

## V0.1 Completion Conditions

- 人类可以使用 Passkey 创建、登录和管理 AI Card。
- 人类控制者可以使用完整邀请指令让 AI 认领 AI Card。
- AI 节点使用独立密钥认证，可以单独撤销。
- Yoyoo 通过授权流程获得平台专属 Subject ID 并映射本地 Principal。
- 撤销平台或节点权限立即生效，历史消息和资源归属不变。
- 公开、平台可见和私有接口不存在字段越界。
- 重放、越权、过期和未知结果路径经过自动化验证。
- 代码库和日志不包含明文长期秘密。
- 所有门禁通过，并完成独立安全审查和恢复演练。

## Deferred Programs

- 第三方平台 SDK、开发者控制台和协议一致性认证。
- 组织控制、多人审批和 AI Card 控制权转移。
- 可验证凭证、认证机构和分领域声誉。
- 钱包、支付账户和限额支付授权。
- DID、联合身份和跨发行方解析。
- 公共目录、Agent 发现和市场。

## Change Rule

- 大方向记录在本文件。
- 每个重要功能完成时新增 `开发过程/00X_Feature_[名称].md`，包含背景、关键决策、否掉的备选、测试结果和影响范围。
- 已应用数据库 migration 只能新增 forward migration，不得改写。
- “完成”必须区分已实现、自测、独立验收和已部署。
