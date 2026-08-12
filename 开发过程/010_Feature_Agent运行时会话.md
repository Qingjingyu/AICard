# 010 Feature Agent 运行时会话

> 日期：2026-08-09  
> 状态：Phase 6B2 已实现并完成自动化自测；未独立验收或部署

## 背景

Phase 6B1 只建立 AI Card 与 Yoyoo 本地 Agent 的稳定身份映射，运行节点仍无法
用自己的 Ed25519 密钥取得平台任务。Phase 6B2 增加短期运行时会话，同时保持
AI Card 是身份、节点、控制关系和撤销的唯一权威。

## 关键决策

- `agent.runtime` 只开放给预注册 `yoyoo_dev`，且只在 AI 身份授权时请求。
- 节点签署 `aicard-agent-runtime-v1` 规范载荷，载荷绑定 node、client 和一次性
  challenge；服务端不接收私钥。
- 运行时 Token 只有两分钟有效，不提供 refresh token，数据库只保存 SHA-256
  哈希，并绑定 grant、pairwise Subject、node、client 和 audience。
- introspection 每次重新检查节点、Card、人类控制关系、平台 Client、Grant 和
  Subject；任一被撤销后下一次请求立即失败。
- 旧的不带 `clientId` 节点认证保持原行为，避免破坏既有认领客户端。

## 否掉的备选

- 给节点长期平台 Token：无法快速撤销，也会把身份凭据变成第二套主密钥。
- 让 Yoyoo 复制节点公钥和控制关系：会形成两个身份权威并增加同步竞态。
- 使用 JWT 自校验：当前需求要求即时撤销，服务端权威 opaque token 更直接。

## 影响范围

- 新增 forward-only migration `0008_agent_runtime_sessions.sql`。
- 授权 scope、节点认证服务、运行时 introspection API 和审计事件增加运行时能力。
- 未修改人类 Card、旧节点认证、房间权限或生产部署配置；未增加依赖。

## 验证结果

- lint、typecheck、生产 build 通过。
- 单元测试 `62/62`，PostgreSQL 集成测试 `38/38`，桌面与移动 E2E `28/28`。
- 覆盖新版签名载荷、AI-only scope、只存哈希、challenge 单次消费、严格
  introspection、节点撤销和 Grant 撤销立即失效。
- Yoyoo 同步通过单元/UI `97/97`、数据库/HTTP `75/75`、桌面与移动 E2E
  `24/24`；另有 6 个依赖外部 YOS 条件的集成用例按配置跳过。

## 未验证与后续

- 尚未执行真实 AI Card 服务、真实 Yoyoo 服务和真实外部 YOS 三进程人工验收。
- 尚未完成独立安全审查、真实硬件 Passkey、恢复演练或生产部署。
