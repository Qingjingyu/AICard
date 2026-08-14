# 016 Feature - 第一方产品内置身份入口

## 背景

Yoyoo 需要把 AI Card 呈现为内置统一身份，而不是要求用户跳到独立身份站点。身份发行和会话所有权仍归 AI Card，产品只负责展示表单和完成标准授权回调。

## 关键决策

- 仅允许 `TRUSTED_PRODUCT_ORIGINS` 中逐字匹配的 HTTPS Origin；开发环境只额外允许 localhost HTTP。
- 浏览器把密码直接提交给 AI Card，Yoyoo 服务端不接收、不记录、不保存密码。
- 登录或注册后返回公开 Card 投影和非秘密 CSRF Token；会话仍使用 AI Card 域下的 host-only Cookie。
- 授权继续使用原有 Authorization Code + S256 PKCE + state；未改数据库和 Token 模型。
- 登录、注册、授权三个端点共享凭据型 CORS 策略，未知来源在读取会话前被拒绝。

## 否掉的备选

- iframe 嵌入：第三方 Cookie 策略不稳定，交互和安全边界更难说明。
- 共享 `.yoyooai.com` Cookie：扩大 Cookie 作用域，任何同级子域问题都会放大会话风险。
- 把身份服务合进 Yoyoo：破坏 AI Card 可供多个产品复用的独立权威边界。

## 验证结果

- 精确来源解析与 CORS 单测通过。
- 登录、注册、授权的可信来源、未知来源、预检与 CSRF 返回单测通过。
- AI Card 全量测试 30 个文件、101 个测试通过。
- AI Card PostgreSQL 集成测试 12 个文件、61 个测试通过。
- 双服务生产构建浏览器验收通过：Yoyoo 同页创建 `AI_100001`、自动授权进入、第二浏览器再次登录、YOS Agent 认领与运行时传输均成功。
- 浏览器请求断言确认包含密码的注册与登录请求各发送一次，且目的地仅为精确 AI Card Origin。
- `npm run typecheck`、`npm run lint` 与 `npm run build` 通过。
- 2026-08-15 以 `aicard:11bb31f` 发布到 `id.yoyooai.com`；production doctor、双站健康、精确来源 CORS 204 和未知来源 403 均通过。
- 发布前备份位于 `/opt/yoyoo/backups/embedded-aicard-entry-20260814T152735Z`，数据库 dump、Blob/Nginx 归档和 SHA-256 均已校验；旧镜像保留用于应用级回滚。
- 生产未创建测试 Card；真实公网持卡人首次注册和独立安全审查仍未完成。

## 影响范围

只扩展第一方产品的密码登录、注册和授权 HTTP 边界；Passkey、Agent 认领、Token、数据库迁移和现有独立页面不变。
