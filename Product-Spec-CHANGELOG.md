# AI Card Product Spec Changelog

## 2026-08-13 - Unified Account And Issuer Authority Locked

- AI Card 从“可由平台后续连接的独立身份”升级为旗下所有产品唯一的统一账号和发卡源。
- 人类或 AI 第一次在任意产品注册时自动获得永久顺序编号；编号从 `AI_100001` 开始，人类和 AI 共用同一序列。
- 业务产品的注册入口调用 AI Card；成功后一次完成统一身份、当前产品授权和本地成员映射，不再先建本地账号再绑定。
- 首版人类登录锁定为 AI Card ID 或 `@handle` 加密码；Passkey 保留为可选增强能力。
- Yoyoo 停止生成 `AI_` 编号，只保留本地 Principal 作为历史资源和权限外键。
- 注册使用预注册客户端、事务发号和幂等键；AI Card 不可用时明确失败，禁止本地降级发卡。

未选择“各产品继续自行发号、之后再合并”：该方案无法可靠判断两个账号是否属于同一人或 AI，会产生不可逆的重复身份、编号冲突和历史归属歧义。

未选择“继续以 Passkey 作为唯一注册入口”：它安全性高，但不符合第一版跨手机、跨产品低门槛登录目标；首版先提供密码入口，同时保留 Passkey 增强能力和后续升级路径。

## 2026-08-10 - Controlled AI Grant Management Locked

- 私有 Card 背面同时展示当前人类和其有效控制 AI Card 的平台授权，并按身份分组。
- 控制者只获得 Grant 管理权；Grant、Token 与 pairwise Subject 继续归实际 AI Principal。
- 撤销请求仍只提交 `grantId`，服务端依据登录人和实时控制关系判断权限，不信任浏览器提供目标身份。
- 控制关系失效后立即失去查看和撤销权；审计区分人类 actor 与 AI subject。
- 继续要求近期 Passkey、精确 Origin、CSRF 和限流；不增加数据库表或长期秘密。

未选择为每个 AI 新建详情页或让客户端提交 AI Principal ID：前者扩大首版导航与页面范围，后者增加目标篡改和越权风险。

## 2026-08-09 - Phase 5B Refresh And Revocation Contract Locked

- `offline_access` 改为显式同意且受客户端 allowlist 控制。
- Refresh token 使用 family 模型，每次使用后轮换；旧 token 重放撤销整个 family。
- 授权码兑换和 refresh 轮换要求幂等键，加密保存可恢复响应，不保存明文 token。
- Card 背面列出当前持卡人的平台授权；近期 Passkey、Origin 与 CSRF 保护撤销操作。
- 撤销事务同时覆盖 grant、access token、refresh family 和 refresh token。

未选择 JWT 或无状态 refresh token：它们会削弱即时撤销、重放检测和服务端权威审计，和 AI Card 的控制权模型不一致。

## 2026-08-09 - Phase 5A Platform Authorization Baseline Locked

- 平台客户端仅支持预注册；redirect URI 使用逐字白名单匹配。
- 首个切片实现登录同意、批准/拒绝、5 分钟一次性授权码、S256 PKCE、10 分钟 opaque access token 和 `userinfo`。
- Yoyoo 与测试客户端默认获得不可关联的 pairwise Subject ID。
- 授权码与 access token 只保存哈希，scope 投影使用显式 allowlist。
- Refresh token、授权撤销界面、动态客户端注册和完整协议兼容性声明延后到 Phase 5B。

未选择“一次完成 refresh token 与撤销”：该方案会同时引入授权码和 token family 两套安全状态机，不利于独立验证和回退。

## 2026-08-08 - Phase 4 Agent Enrollment Protocol Locked

- 创建邀请时即创建永久 AI Card，认领阶段只绑定运行节点。
- 邀请票据只显示一次，服务端只保存哈希。
- 增加认领 ID 与查询秘密，支持响应未知时安全恢复和幂等认领。
- 首次认领和后续节点认证均要求 Ed25519 私钥持有证明。
- 中文昵称与受限机器标识明确分层。
- 同一 AI Card 可以追加独立节点邀请；待认领邀请和已连接节点均可单独撤销。

未选择“Agent 认领成功后才创建 AI Card”：该方案会让网络超时、重复请求和身份去重耦合，增加产生重复身份的风险。
