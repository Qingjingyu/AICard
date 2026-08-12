# 008 Feature Yoyoo 首个平台接入

> 日期：2026-08-09  
> 状态：Phase 6A 已实现并完成自动化与本机双服务自测；未独立验收或部署

## 背景

Phase 5B 已经提供预注册平台授权、PKCE、短期 access token、refresh token
轮换和授权撤销。Phase 6A 增加第一个真实消费方 Yoyoo，但不把 Yoyoo 的
本地权限与资源所有权迁入 AI Card。

## 关键决策

- 在 AI Card 仓库冻结 `yoyoo_dev` 的客户端、audience、redirect URI、最小
  scopes、Token 与 UserInfo 响应契约。
- Yoyoo 只使用 pairwise Subject 建立本地映射；Card 展示字段不作为主键。
- Yoyoo 请求 `offline_access` 时，缺失 refresh token 或批准 scope 必须失败。
- 本阶段不实现 AI Agent 运行时会话，也不删除旧 Agent Gateway。
- 首次注册与登录完成后必须返回原授权请求；只接受规范化的内部
  `/authorize` 返回目标，拒绝外部、重复或畸形参数。

## 影响范围

- 新增 `src/lib/contracts/yoyoo-client.ts` 及契约测试。
- AI Card 既有数据库、授权服务和公开接口没有修改。
- 没有增加依赖，没有写入真实凭据。

## 验证结果

- Yoyoo 客户端契约：3/3 通过。
- AI Card `lint`、`typecheck`、生产 `build` 通过。
- AI Card 单元测试 56/56、集成测试 32/32 通过；改动前完整桌面/移动浏览器
  回归为 28/28。
- Yoyoo 同步通过 lint、隔离生产构建、79/79 单元与 UI 测试、63/63 集成测试
  和 24/24 桌面/移动浏览器回归。
- 本机使用 Chrome 虚拟 WebAuthn 认证器走通“Yoyoo 发起 -> AI Card 首次注册
  -> 授权同意 -> Yoyoo 回调绑定”，控制台 0 错误。临时测试 Card 与映射已
  清理，未声明真实硬件、独立安全或生产可用。

## 后续

- Phase 6B 完成 AI Agent 认领与持续运行时认证。
- Phase 7 完成独立安全验收、恢复演练和生产交接。
