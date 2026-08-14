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
- `npm run typecheck`、`npm run lint` 与 `npm run build` 通过。
- 双服务浏览器注册登录闭环因本机 Docker 守护进程不可用尚未执行；生产部署未进行。

## 影响范围

只扩展第一方产品的密码登录、注册和授权 HTTP 边界；Passkey、Agent 认领、Token、数据库迁移和现有独立页面不变。
