# 011 Feature 受控 AI 平台授权管理

> 日期：2026-08-10  
> 状态：Phase 6B3 已实现并完成自动化自测；未独立安全审查或部署

## 背景

受控 AI 可以向 Yoyoo 签发 Grant，但原私有 Card 背面只查询当前登录人自己的
Grant。控制者能够撤销 AI 节点，却无法看到或单独撤销该 AI 的平台授权，身份生命周期
因此缺少“授权后管理”入口。

## 关键决策

- 控制者可管理本人和当前有效控制 AI Card 的 Grant；Grant、Token 与 pairwise
  Subject 仍归实际授权 Principal，控制者不会被伪装成 AI subject。
- 浏览器仍只提交 `grantId`。服务端根据当前会话 actor、Grant subject 和实时控制
  关系判断权限，不接受客户端提供目标 Principal ID。
- 查询和撤销均要求控制关系未撤销、控制者为 human 且其 Card active；关系失效后
  立即失去管理入口和撤销权限。
- 撤销继续使用同一事务失效 Grant、access token、refresh family 和 refresh token；
  审计 actor 为控制者，metadata 记录实际 subject。
- 私有 Card 背面按身份分组展示平台授权，复用现有近期 Passkey、精确 Origin、
  CSRF、限流和四态反馈。

## 否掉的备选

- 由浏览器提交 AI Principal ID：会暴露内部标识并扩大目标篡改面。
- 为每个 AI 新建详情页：首版增加导航和页面范围，但没有增加权限安全性。
- 控制关系失效后保留撤销权：会产生已经失去控制权的人继续操作 AI 身份的越权。

## 影响范围

- 未新增依赖或数据库 migration。
- 扩展 Grant 管理视图、授权 Repository/Service、现有撤销 API 和私有 Card 背面。
- 不修改公开 Card、平台授权签发、Agent 节点密钥或 Yoyoo 本地权限。

## 测试结果

- TDD RED：新集成场景首先因 `listManageableGrants` 不存在而失败；页面场景首先因
  找不到受控 AI 身份而失败。
- `lint`、typecheck、Next.js 生产 build 通过。
- 单元测试 `62/62`，隔离 PostgreSQL 集成测试 `40/40`，桌面与移动 Playwright
  `30/30`。
- 覆盖控制者查看和撤销、无关用户拒绝、控制关系失效立即拒绝、access/refresh
  Token 失效、actor/subject 审计分离、缺少安全证明拒绝和移动端无横向溢出。
- 人工检查桌面截图：身份、Handle、平台、scopes、状态和撤销入口无重叠，未向前端
  传递 Principal ID 或 Token。

## 未验证与后续

- 本阶段未完成第三方独立安全审查、真实硬件 Passkey、账号恢复或生产部署。
- 组织多人审批、控制权转移、批量撤销和独立 AI 授权详情页仍在 V2 范围。
