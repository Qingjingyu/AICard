# 015 Feature 独立生产发布基础

> 日期：2026-08-14
> 状态：已部署并完成公网自验；首次真实持卡人注册待苏白完成

## 背景

AI Card 的身份、授权和 Yoyoo 联邦协议已经通过跨仓自测，但仓库缺少独立镜像、独立 PostgreSQL、正式产品客户端、Nginx 配置和可执行回滚说明。直接把它并入 Yoyoo 会重新混淆身份权威与产品边界。

## 关键决策

- AI Card 使用 `id.yoyooai.com`、宿主机回环端口 `4174` 和独立持久卷，不复用 Yoyoo 数据库。
- 正式客户端使用 `yoyoo_prod`；`yoyoo_dev` 永久保留给 localhost，避免回调串环境。
- 多个客户端允许共享同一个资源 audience；客户端回调、scope 和 pairwise Subject 仍各自隔离。
- `0014` 仅删除错误的 audience 全局唯一约束并增加查询索引；既有迁移不改写。
- 正式 Yoyoo 客户端必须包含人类登录 scope 和 `agent.runtime`，生产 doctor 缺任一项均失败。
- PostgreSQL 只加入 internal 网络，App 额外加入反代网络且只绑定 `127.0.0.1`。

## 否掉的备选

- 复用 `yoyoo_dev`：会让 localhost 和生产回调成为一份不可区分的客户端合同。
- 为生产客户端创建不同 audience：Yoyoo 人类和 Agent 最终访问的是同一资源服务，拆 audience 会制造无意义分叉。
- 手工修改生产数据库：不可复现且绕过 migration checksum 和审计，故使用 forward migration 与幂等登记 CLI。
- 与 Yoyoo 共用数据库：部署省事，但破坏独立身份权威和故障隔离。

## 验证

- RED/GREEN：production doctor 曾错误接受 `yoyoo_dev`，现只接受显式生产 client ID。
- RED/GREEN：数据库曾拒绝两个客户端共享 audience，`0014` 后集成测试通过。
- AI Card 镜像真实构建成功，迁移运行时可用。
- 一次性 Compose 环境完成 PostgreSQL、14 条迁移、`yoyoo_prod` 登记、App 健康和只读 production doctor。
- ESLint、TypeScript 和 Next.js 生产构建通过。
- 单元测试 28 个文件、87 项通过；隔离 PostgreSQL 集成测试 12 个文件、61 项通过。
- Playwright 桌面与移动端回归 32/32 通过。
- 生产镜像 `aicard:7382460` 已部署到独立 Compose 项目，App 仅绑定
  `127.0.0.1:4174`，PostgreSQL 使用独立卷
  `aicard-public_postgres_data`。
- 生产库应用 14 条 checksum migration，`yoyoo_prod` 已登记精确回调与
  `card.basic`、`card.handle`、`card.id`、`offline_access`、
  `agent.runtime` scope；production doctor 全项通过。
- `id.yoyooai.com` 的独立 Let's Encrypt 证书签发成功，公网健康接口返回
  `200`，Yoyoo 授权入口能带 S256 PKCE 跳转到统一注册/登录页。
- 错误账号返回 `401` 并显示可见错误；桌面与 `390x844` 手机页面无阻塞
  控制台错误或横向溢出。
- 生产库仍为 `ai_cards=0`，发号序列为 `100001 / is_called=false`；没有用
  测试账号占用苏白的首张 Card。

## 影响范围与回滚

- 生产已启用独立镜像、数据库、Nginx HTTPS 站点与正式客户端合同；Yoyoo
  下载货架及其现有站点未修改。
- 生产回滚先恢复 Yoyoo 旧 `.env` 与旧镜像，再停用 AI Card vhost；数据库卷只保留，不自动删除或还原。
- 首次真实注册、现有 Yoyoo Owner 映射与本地密码人工回归仍需苏白完成；
  独立安全审查和账号找回不包含在本次自验中。
