# 017 Feature - 延迟 Agent 发卡与平台接入

## 背景

过去创建 Agent 邀请时立即占用永久 Card 编号，且产品接入需要用户先到身份站
完成建卡。这既会为未使用邀请留下身份，也不能形成“一段话自动接入”的产品体验。

## 关键决策

- 通用 Agent 邀请只保存哈希票据和预期展示信息，成功认领时才在同一事务中
  创建 Card、控制关系、节点和运行授权。
- 新增 `agent.enroll`，允许预注册产品在当前已验证人类授权下创建或撤销受控
  Agent 邀请；它与 Agent 侧 `agent.runtime` 完全分离。
- 已有 Card 通过节点签名证明复用。产品为本次接入创建但未使用的身份邀请可由
  票据持有者显式拒绝，以保证同一 Agent 不产生第二张 Card。
- 运行时自省返回权威 Card ID、展示名、Handle 与机器名，产品不自行推导身份。

## 否掉的备选

- 邀请创建即发卡：会浪费编号并留下从未认领的身份。
- 由 Yoyoo 发号：形成第二身份权威，无法跨产品复用。
- 让已有 Agent 再注册一次：破坏永久身份语义和历史归因。
- 返回长期运行 Token：不利于轮换与撤销；保留短期 `agent.runtime` Token。

## 实现范围

- Forward migration `0015_deferred_agent_identity_and_enroll_scope.sql`。
- 延迟认领事务、`agent.enroll` 邀请创建/撤销、票据授权的拒绝接口。
- 运行时机器名投影和 Yoyoo 联邦验收脚本。
- 所有票据、查询秘密和 Token 继续只以哈希或加密形式持久化；Agent 私钥仅保存在
  本机 `0600` 凭据文件。

## 验证结果

- `npm run lint`、`npm run typecheck`、`npm run build` 通过。
- `npm test`：31 个文件、103 项通过。
- `npm run test:integration`：12 个文件、62 项通过。
- `npm run test:e2e`：桌面与移动端 32/32 通过。
- `npm run test:federation:yoyoo`：新 Agent 发卡、精确房间消息、已有 Card
  复用、未使用邀请拒绝及数据库唯一性闭环通过。

## 影响与未完成项

- 已实现并完成本地自测，尚未部署到 `id.yoyooai.com`。
- 生产发布必须保持已应用 migration 不变，仅向前应用 `0015`，并在备份和回滚
  准备后由用户明确批准。
- 真实生产 YOS 冒烟和第三方独立安全审查仍未完成。
