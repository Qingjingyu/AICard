# AI Card Product Spec

版本：v0.2（统一账号）

## Goal

AI Card 是旗下所有产品面向人类与 AI 的唯一统一账号、身份、鉴权和授权基础设施。
人类或 AI 第一次在任意旗下产品注册时，由 AI Card 原子创建身份并自动签发永久公开编号；之后进入其他产品只复用同一身份，不重复注册、发卡或绑定。

Yoyoo 是第一个接入 AI Card 的平台，但不拥有 AI Card 身份。AI Card 必须保持独立产品边界、全体系唯一身份和可扩展协议边界。

## Target Users

- 需要在 Yoyoo 中协作的人类用户。
- 需要作为一等身份加入 Yoyoo 的 AI Agent。
- 负责某个 AI 身份的人类或组织控制者。
- 接入 AI Card 的平台开发者；v0.1 仅开放给 Yoyoo。

## Problem

当前 Agent 接入通常直接暴露一段长期 Token。用户不知道凭据代表谁、如何交给 Agent、具有什么权限，也无法形成跨平台稳定身份。

现有产品还容易把昵称、机器名、登录凭据和真实身份混为一体，导致改名、换设备、加入新平台或撤销连接时身份断裂。

AI Card 需要解决：

- 人与 AI 使用同一种身份基础模型。
- 昵称、可提及标识和真实身份主键明确分离。
- 身份、控制权、运行节点、平台授权和秘密凭据明确分层。
- 平台只获得用户明确授权的最小信息和权限。
- AI Card 可以跨平台复用，而不是每个平台重复注册一个新身份。

## Product Principles

- 一人或一个 AI 对应一个全体系身份，设备、运行时和平台成员关系不是新身份。
- AI Card 是唯一发卡源；Yoyoo 和其他业务产品不得自行生成、补发或重编号 AI Card ID。
- 产品内“注册”只是 AI Card 统一注册流程的入口，不产生产品私有账号。
- `Principal ID` 是内部不可变身份主键；所有消息、文件、任务和授权最终引用该主键或其平台映射。
- AI Card 正面用于被认识，背面用于管理，保险库用于保存不可展示的秘密。
- AI Card 证明“是谁”和“授予了什么”；平台决定“在本平台可以做什么”。
- 全体系唯一不等于默认跨平台可追踪；平台默认接收平台专属 Subject ID。
- AI 类型的 Card 在 v0.1 必须绑定一个已验证的人类控制者。
- 长期密钥不进入公开 Card、不通过聊天回显、不以明文持久化。
- 已签发身份和历史记录不能通过改名或换设备被重新解释。

## Identity Model

每张 AI Card 包含四层标识：

- `displayName`：对外昵称，支持中文，可以重复和修改。
- `handle`：用于搜索和 `@` 提及的唯一标识，可以按规则有限修改。
- `cardId`：全体系永久唯一、可公开分享的单调递增编号，格式为 `AI_` 加不少于六位数字，从 `AI_100001` 开始，不可修改或复用。事务回滚或并发失败可以留下空号，系统不为了补号重用已分配数值。
- `principalId`：系统内部不可变主键，不作为用户操作入口。

所有业务操作先解析为 `principalId` 或平台专属 Subject ID，再执行消息发送、文件归属、成员关系和授权判断。

## Visibility Model

### 公开正面

- 昵称、头像、身份类型。
- `@handle` 和 AI Card ID。
- 简介、公开认证和公开能力摘要。
- 可分享链接与二维码。

### 平台可见

- 当前平台需要且经持卡人同意的资料。
- 平台内角色、共同空间和协作所需能力。
- AI 的可用状态和经授权公开的运营者信息。

### 私有背面

- 身份控制者、设备和 AI 运行节点。
- 已授权平台、权限范围、有效期和撤销入口。
- 安全设置、恢复方式和审计记录。
- 钱包、认证和信用模块的未来入口，但 v0.1 不实现相关业务。

### 系统保险库

- 私钥、长期 Token 原文和支付敏感数据不得由正面或背面接口返回。
- v0.1 只持久化公钥、凭据标识、状态、哈希或加密后的必要材料。

## MVP Scope

### Card

- 创建一张人类 AI Card。
- 由人类控制者邀请并认领一张 AI 类型 AI Card。
- 支持中文昵称、唯一 `@handle`、永久 AI Card ID 和稳定分享链接。
- 提供公开正面、平台可见视图和私有背面管理视图。
- 支持 Card 的 `active`、`suspended`、`retired` 生命周期；ID 永不复用。

### Authentication And Control

- 人类控制者首版使用 AI Card ID 或唯一 `@handle` 加密码注册和登录。
- 密码只保存内存成本型哈希；登录、注册、找回和敏感操作必须使用限流、审计和会话撤销。
- Passkey 作为可选的增强登录和敏感操作验证方式保留，不作为首版注册门槛。
- AI 每个运行节点使用独立公钥凭据证明控制权。
- 一个 AI Card 支持多个运行节点，节点可以单独撤销。
- AI Card 与控制者关系可审计；v0.1 不支持无人负责的 AI Card。

### Platform Authorization

- Yoyoo 作为预注册的第一个平台客户端。
- 平台通过授权码与 PKCE 风格流程请求身份和权限。
- 授权页面显示平台、申请字段、权限范围和有效期。
- AI Card 向 Yoyoo 返回平台专属 Subject ID 和被同意的最小声明。
- 支持短期访问令牌、刷新令牌轮换、撤销和审计。
- 不宣称完整 OIDC/OAuth 规范兼容，除非后续通过对应一致性测试。

### Agent Enrollment

- 控制者输入中文昵称并生成一次性、限时邀请票据。
- 页面生成可直接发送给 Agent 的完整接入指令，而不是只显示裸 Token。
- 创建邀请时不占用永久编号；成功认领时才原子创建 AI Card、控制关系和运行节点。
- 已有 Agent 通过节点私钥证明复用原 Card；未使用、过期、拒绝或撤销的邀请不产生身份。
- 邀请票据只在创建成功响应中显示一次，服务端只保存 SHA-256 哈希。
- Agent 在本机生成密钥对，使用邀请票据和公钥完成认领。
- Agent 同时生成认领 ID 和认领查询秘密；服务端只保存查询秘密哈希。
- 网络结果未知时可以使用认领 ID 和查询秘密查询状态，不盲目重复注册。
- 首次认领必须使用节点私钥签署规范化认领载荷；只提交公钥不算连接成功。
- 认领成功后，节点通过一次性 challenge 和 Ed25519 签名证明持有私钥。
- 接入完成后只回报昵称、机器标识、认领状态和连接状态，不回显票据或秘密。

### Yoyoo Integration

- Yoyoo 的注册页调用 AI Card 统一注册能力，成功后自动创建当前产品会话和本地成员映射。
- 已有 AI Card 用户进入 Yoyoo 时直接登录或授权，不再创建 Yoyoo 身份后再绑定 Card。
- Yoyoo 将现有本地 Principal 映射到 AI Card 平台 Subject ID。
- Yoyoo 停止生成 `AI_` 编号；本地 Principal ID 只承担历史资源归属和产品权限外键。
- Yoyoo 的房间、消息、文件、任务和本地权限继续由 Yoyoo 保存。
- AI Card 不接收消息内容、文件内容或 Agent 私有思考。
- 撤销 Yoyoo 授权后，新请求必须被拒绝，既有审计和历史归属保持不变。

### States

所有核心页面必须覆盖 loading、empty、error、success 四态，并提供：

- 邀请未使用、认领中、已认领、已过期、已撤销。
- 节点在线、离线、已撤销。
- 授权有效、已过期、已撤销。
- 网络结果未知时的明确恢复入口。

## V2 / Later

- 面向第三方平台的开发者控制台、SDK、动态客户端注册和协议一致性测试。
- 组织控制者、多管理员、审批流和 AI Card 控制权转移。
- 可验证认证、技能资质、履约声明和分领域声誉。
- 钱包、支付账户、限额授权和签名支付意图。
- DID、Verifiable Credentials、联合身份和跨发行方解析。
- 公共 AI Card 目录、可信发现和 Agent 市场。
- 更细粒度的字段级选择性披露和隐私证明。

## Not In V0.1

- 真实支付、转账、余额、结算或退款。
- 单一通用信用分或社会信用排名。
- 区块链、代币或去中心化账本。
- 无控制者的自主 AI 身份。
- 第三方开放注册、计费和生产级多租户运营后台。
- 在 AI Card 中保存 Yoyoo 消息、文件、任务或 Agent 私有记忆。
- 将一张 Card 的根密钥共享给任何平台。
- 允许业务产品在 AI Card 不可用时降级创建本地身份或临时 `AI_` 编号。
- 自动合并两个已经签发的不同 AI Card；冲突身份只能进入人工审计流程。

## User Stories

- 作为人类用户，我可以创建带中文昵称的 AI Card，并清楚区分昵称、`@handle` 和永久 Card ID。
- 作为首次使用任意旗下产品的人类，我完成一次注册就自动获得 AI Card，并立即进入当前产品。
- 作为已有 AI Card 的用户，我进入其他旗下产品时复用原身份，不再注册或绑定第二张 Card。
- 作为 AI 控制者，我可以生成完整邀请指令，让 Agent 自主完成 Card 认领。
- 作为 AI Agent，我可以使用自己的运行节点密钥证明身份，而不接收网页展示的长期主 Token。
- 作为持卡人，我可以查看 Yoyoo 请求了哪些资料和权限，并批准或拒绝。
- 作为持卡人，我可以撤销某个平台或某个运行节点，而不删除整张 Card。
- 作为 AI 控制者，我可以查看并撤销自己当前有效控制的 AI Card 平台授权，而不冒充该 AI 身份。
- 作为 Yoyoo，我可以稳定识别同一个人或 AI，同时只获得被授权的最小信息。
- 作为审计人员，我可以确认谁在何时创建、认领、授权、撤销或轮换了什么。

## Core Flows

### Human Card Creation

1. 用户在任意旗下产品的自有界面中填写中文昵称、可用 `@handle` 和密码，无需感知跳转到独立身份站点。
2. 浏览器只把凭据发送到 AI Card 明确允许的第一方产品接入接口；业务产品后端和数据库不得接收或记录密码。
3. AI Card 在一个事务内创建 Principal、分配下一个永久 `AI_` 编号、保存密码哈希并写审计。
4. AI Card 向当前产品返回一次性授权结果；产品建立本地成员映射和会话。
5. 用户立即看到自己的 Card；可随后添加 Passkey，不需要再次注册或绑定。

### Existing Card Sign-in To Another Product

1. 用户在另一个旗下产品选择登录。
2. 用户在该产品的第一方界面中使用 AI Card ID、`@handle` 或 Passkey 验证身份；凭据仍只由 AI Card 接收和验证。
3. 旗下可信产品可以在同一界面完成预登记最小权限授权，但必须保留 CSRF、PKCE、state、一次性授权码和审计。
4. 产品只获得稳定 pairwise Subject 与获准声明，并映射到本地成员。
5. AI Card、公开编号和控制关系保持不变。

### First-Party Embedded Entry

- AI Card 通过精确 origin 白名单为旗下产品开放携带凭据的浏览器请求，禁止 `*`、路径、查询参数和非受信来源。
- 生产白名单只接受 HTTPS；开发环境只额外接受 `localhost` 和 `127.0.0.1`。
- 登录或注册成功可以返回非秘密 CSRF token 与公开 Card 摘要，但 session token 只能保存在 AI Card host-only、HttpOnly Cookie 中。
- 业务产品必须使用预注册 client、redirect URI、scope、PKCE 和 state 完成一次性授权；内置界面不能绕过平台授权模型。

### AI Card Enrollment

1. 已登录的人类控制者填写 AI 昵称并创建邀请。
2. 系统创建永久 AI Card，并生成只显示一次的一次性票据和完整接入指令。
3. Agent 在本机生成 Ed25519 密钥对、认领 ID 和查询秘密。
4. Agent 使用节点私钥签署规范化载荷，提交公钥、机器名、认领 ID、查询秘密和票据。
5. 系统以事务方式消费票据并绑定运行节点；相同认领 ID 重试返回同一结果。
6. Agent 使用认领 ID 与查询秘密恢复结果，并通过节点 challenge 证明私钥持有权。

### Yoyoo Authorization

1. Yoyoo 发起带 PKCE、state、redirect URI 和 scopes 的授权请求。
2. AI Card 验证持卡人并展示同意页。
3. 持卡人同意后，系统生成一次性授权码。
4. Yoyoo 后端兑换短期令牌和平台专属 Subject ID。
5. Yoyoo 将 Subject ID 映射到本地 Principal，并执行本地权限判断。

#### Phase 6B1 受控 AI 身份授权

- Yoyoo 可以明确请求 `principal_type=ai`；未提供时保持现有人类身份授权行为。
- AI 授权页只展示当前已认证人类实际控制的 active AI Card；没有可选 Card 时
  显示明确空态，不静默退回人类身份。
- 同意请求携带的目标身份必须在服务端重新验证类型、状态和控制关系，不能依赖
  浏览器隐藏字段或展示列表。
- 授权码、Grant、Token 和 pairwise Subject 归属于被选择的 AI Principal，
  控制者只负责批准，不能成为返回给 Yoyoo 的 Subject。
- 原人类授权、不同客户端 Subject 隔离、撤销和历史审计行为保持不变。
- 本阶段不签发 Agent 运行时会话，不向 Yoyoo 或 Agent 暴露节点私钥、邀请票据
  或跨平台根凭据。

#### Phase 6B2 Agent 运行时会话

- 只有已被 `yoyoo_dev` 授权且包含 `agent.runtime` 权限的 AI Card，才可以为其
  active 运行节点签发 Yoyoo 运行时会话。
- 运行节点继续使用现有 Ed25519 私钥，对包含 `nodeId`、`clientId` 和一次性
  challenge 的 `aicard-agent-runtime-v1` 规范载荷签名；AI Card 不接收私钥。
- AI Card 返回两分钟有效的不透明 Bearer Token。服务端只持久化 Token 哈希，
  并将会话绑定到活动节点、AI Card、平台授权、pairwise Subject、client 和 audience。
- Yoyoo 对心跳、任务领取和结果回执逐次向 AI Card 校验运行时 Token，不复制
  节点公钥、控制关系或撤销状态。
- 节点、AI Card、平台客户端或平台授权任一失效后，新校验立即失败；失效节点
  不得提交已领取任务的结果，任务由现有租约过期机制回收。
- 运行时 Token 不提供 refresh token；过期后节点重新完成 challenge/signature。
- 旧节点认证保持兼容；只有显式提供 `clientId` 并签署新版载荷时才签发平台会话。

本阶段不迁移旧 Yoyoo `yya_` 凭据，不自动加入房间，不实现并发租约、流式回传、
生产部署或通用 OAuth/OIDC 一致性声明。

#### Phase 5A 授权基线

- v0.1 首个切片只接受预注册的 `yoyoo_dev` 与 `test_client`，redirect URI 必须逐字匹配白名单。
- 授权请求使用 `response_type=code`、`state`、S256 `code_challenge` 和最小 scopes；未知客户端、redirect URI、scope 或 PKCE 方法默认拒绝。
- 持卡人必须在 AI Card 登录后看到平台名称、所需字段和权限，并可以批准或拒绝。
- 批准后签发 5 分钟有效、只可使用一次且绑定 client、redirect URI、principal、scopes 和 PKCE challenge 的 opaque 授权码。
- 公共客户端使用 `code_verifier` 兑换 10 分钟有效的 opaque access token；数据库只保存授权码和 access token 的 SHA-256 哈希。
- `userinfo` 只返回 pairwise Subject ID 与已授权 scope 对应的 Card 投影；同一 Card 对两个客户端的 Subject ID 必须不同。
- Phase 5A 不签发 refresh token，不开放动态客户端注册，也不宣称 OAuth 2.0 或 OIDC 完整兼容。
- Refresh token 轮换、token family 重放检测、授权列表与撤销界面属于 Phase 5B，Phase 5A 不得提前标记整个 Phase 5 完成。

#### Phase 5B 长期授权与撤销

- 只有预注册客户端允许且持卡人明确批准 `offline_access` 时，授权码兑换才签发 30 天 family lifetime 内的 opaque refresh token。
- refresh token 每次成功使用后立即消费并轮换，旧 token 不再是有效凭据；新 access token 继续保持 10 分钟有效并绑定原 grant、client、audience、pairwise Subject 和 scopes。
- 对已消费 refresh token 使用不同幂等键属于重放：系统必须在一个事务中撤销整个 family、关联 access token 和全部 refresh token，提交安全审计后返回失败。
- 授权码兑换和 refresh 轮换必须要求高熵 `Idempotency-Key`；相同请求和幂等键在响应丢失后返回同一结果，不创建第二组 token。
- 幂等恢复材料使用当前凭据与幂等键派生的内存密钥加密；数据库不得保存明文 code、access token、refresh token、PKCE verifier 或幂等键。
- Card 背面列出当前持卡人和其有效控制的 AI Card 平台授权；控制者只获得管理权，
  Grant、Token 和平台 Subject 仍归实际 AI Principal。撤销要求有效会话、五分钟内
  Passkey 验证、精确 Origin 和 CSRF。
- 撤销在一个事务中更新 grant、refresh family、refresh tokens 和 access tokens，并写入审计；随后 `userinfo`、刷新和新 token 签发立即失败。
- Phase 5B 不接入真实 Yoyoo 业务数据库，不实现动态客户端注册，也不宣称完整 OAuth 2.0/OIDC 兼容；真实平台映射属于 Phase 6。

### Revoke

1. 持卡人在背面选择平台授权或运行节点。
2. 系统要求再次验证并明确展示影响范围。
3. 撤销立即写入权威状态和审计事件。
4. 后续令牌、刷新或节点认证失败；历史消息和资源归属不改变。

## Functional Requirements

- AI Card ID 全体系唯一、不可修改、不可复用。
- AI Card ID 由 AI Card 数据库序列在事务内分配，格式为 `^AI_[1-9][0-9]{5,}$`，首个正式身份固定为 `AI_100001`。
- 人类和 AI 共用同一发号序列，任何产品和客户端都不能指定下一个编号。
- 统一注册接口必须要求预注册客户端、幂等键和明确的 Principal 类型；相同有效请求重试返回同一身份。
- 第一次在任意产品注册必须同时完成统一身份创建和当前产品授权；不得先创建产品私有账号再要求绑定。
- `@handle` 大小写不敏感唯一，并保留历史别名用于安全跳转和防止立即抢注。
- 昵称支持 Unicode，做规范化并拒绝控制字符、换行和欺骗性不可见字符。
- 公开接口不得返回私有字段、凭据材料或内部安全状态。
- 平台 Subject ID 对不同平台不可关联，除非持卡人主动公开全局 Card ID。
- 授权码一次性使用、短时有效并绑定客户端、redirect URI 和 PKCE。
- 访问令牌绑定受众和 scopes；刷新令牌轮换并支持重放检测。
- 邀请票据一次性、限时、可撤销；认领接口支持幂等查询。
- 邀请票据和认领查询秘密只以哈希持久化；明文只在各自持有方内存中短暂存在。
- 机器标识仅允许小写字母、数字、下划线和连字符，展示昵称仍支持中文。
- 节点连接状态来自成功的签名认领或节点 challenge，不由客户端自行声明。
- 一个 AI Card 可以绑定多个运行节点，每个节点独立认证、在线和撤销。
- 每个 AI Card 的创建、认领、控制权、授权、凭据和撤销变化必须产生审计事件。
- Yoyoo 只能根据平台授权信息建立本地身份映射，不能把 AI Card 当作 Yoyoo 本地权限的替代品。

## Non-Functional Requirements

- PostgreSQL 使用 forward-only migration；已应用 migration 不得改写。
- 凭据比较使用安全哈希或公钥验证；秘密不得进入源码、日志、测试快照和前端状态持久化。
- 所有状态变更接口需要幂等、重放防护、速率限制和明确错误码。
- 密码使用独立随机盐和内存成本型 KDF；数据库、日志、审计和协议响应不得包含明文密码。
- AI Card 不可用时注册必须明确失败并可安全重试，业务产品不得降级为本地发卡。
- 安全事件记录 actor、subject、client、action、result、correlation ID 和时间，但不记录秘密。
- 默认拒绝未知平台、未知 redirect URI、未知 scope 和无控制者 AI Card。
- UI 支持桌面和移动端，具备键盘焦点、语义标签、文本溢出处理和四态。
- 核心鉴权路径需要单元、集成、端到端和安全回归测试。
- v0.1 只允许本地或明确受保护环境部署；公网部署前必须完成独立安全审查。

## Open Questions

- AI Card 正式 issuer 域名和恢复渠道仍需在生产部署前锁定；ID 前缀已锁定为大写 `AI_`。
- Yoyoo 首次授权由用户主动跳转还是从邀请 Agent 流程内联触发，需要在交互原型后确认。
- AI Card 正面视觉是否复用 Yoyoo 电影化设计系统，需要先做独立 Card 组件验证。

## Acceptance Criteria

- 人类可以在 Yoyoo 注册入口使用昵称、`@handle` 和密码完成统一注册，自动获得下一张 `AI_` Card，并立即进入 Yoyoo。
- 同一用户随后进入第二个测试产品时得到同一个 AI Card，不产生第二个 Principal 或 Card。
- 人类可以使用 AI Card ID 或 `@handle` 加密码重新登录；添加 Passkey 后也能回到同一身份。
- 人类和 AI 并发注册使用同一序列且无重复、跳回、覆盖或客户端指定编号。
- 昵称、`@handle`、AI Card ID 和内部 Principal ID 在数据与 UI 中明确分离。
- 人类控制者可以复制完整 Agent 接入指令；页面不把长期秘密作为主交付物。
- 一个真实或协议测试 Agent 可以生成密钥、认领 AI Card、连接和单独撤销节点。
- 相同认领 ID 重试不创建第二张 Card 或第二个节点；不同认领 ID 不能复用已消费票据。
- 响应丢失后，Agent 可以凭认领 ID 和查询秘密恢复同一认领结果，查询接口不会泄露票据或公钥以外的秘密。
- Yoyoo 可以完成授权码流程，获得稳定平台 Subject ID，并映射到本地 Principal。
- Yoyoo 数据库不再为新 Principal 生成 AI Card ID；AI Card 服务不可用时不会创建本地替代身份。
- 现有 Yoyoo 所有者迁移后继续使用 `AI_100001`，历史房间、消息、文件和权限外键不变。
- 第二个测试平台对同一 Card 得到不同 Subject ID，证明默认不可跨平台关联。
- 撤销 Yoyoo 授权后，旧访问令牌和刷新令牌都不能继续使用。
- 人类控制者可以查看并撤销自己有效控制的 AI Card Grant；其他控制者、已撤销控制关系
  和伪造目标均被拒绝，审计分别记录操作人和实际授权主体。
- 数据库和日志检查确认没有明文长期凭据。
- 重复提交、过期票据、错误 redirect URI、错误 PKCE、重放刷新令牌和越权 scope 均被拒绝。
- `lint`、类型检查、构建、单元、集成和端到端测试全部通过，并保留命令与结果证据。
