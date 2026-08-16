# Agent 接入生产发布

## 背景

Phase 8G 为 Yoyoo 提供 `agent.enroll` 授权、延迟 Agent 发卡、已有 Card 复用、
邀请撤销和权威机器名。本次发布到独立身份域 `id.yoyooai.com`。

## 发布决策

- 只新增 forward migration `0015`，不修改 `0001` 至 `0014`。
- 保留旧镜像和数据卷；异常时先回退 App，不自动恢复数据库。
- 生产写入前备份双库、Yoyoo Blob、Nginx 和两套环境配置并验证 SHA-256。

## 发布中发现并修复

`0015` 正确为 `yoyoo_prod` 增加了 `agent.enroll`，但生产客户端 JSON 清单仍是
旧 scope，幂等登记因此按设计拒绝配置漂移。线上旧 App 保持健康，没有切换。
随后以失败单元测试复现，统一清单、解析器和测试，提交 `7ad73f2` 后重新构建。
登记最终返回 `created: false`，证明现有客户端与新合同精确一致。

## 生产结果

- AI Card 镜像：`aicard:7ad73f2`。
- 发布目录：`/opt/aicard/releases/7ad73f2`。
- 迁移账本最新：`0015_deferred_agent_identity_and_enroll_scope.sql`。
- 回退镜像：`aicard:5b36530`。
- 验证备份：
  `/opt/yoyoo/backups/agent-onboarding-20260816T025532Z`。

## 验证

- 修复后 lint、typecheck、103/103 单元测试、62/62 PostgreSQL 集成测试和
  production build：通过。
- 生产 migration 重跑为 checksum no-op，`yoyoo_prod` 幂等登记通过。
- production doctor 全项通过。
- 内网与公网健康、精确来源 CORS、未知来源拒绝和关键错误日志扫描：通过。

## 未完成边界

尚未用真实生产 YOS 执行完整认领与重启复用流程，也未完成独立安全审查。
