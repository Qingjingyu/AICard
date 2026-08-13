# 015 Feature 独立生产发布基础

> 日期：2026-08-14
> 状态：已实现并通过本地生产容器演练；生产尚未变更

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

## 本地验证

- RED/GREEN：production doctor 曾错误接受 `yoyoo_dev`，现只接受显式生产 client ID。
- RED/GREEN：数据库曾拒绝两个客户端共享 audience，`0014` 后集成测试通过。
- AI Card 镜像真实构建成功，迁移运行时可用。
- 一次性 Compose 环境完成 PostgreSQL、14 条迁移、`yoyoo_prod` 登记、App 健康和只读 production doctor。
- ESLint、TypeScript 和 Next.js 生产构建通过。
- 单元测试 28 个文件、87 项通过；隔离 PostgreSQL 集成测试 12 个文件、61 项通过。
- Playwright 桌面与移动端回归 32/32 通过。
- 本记录不代表已部署。

## 影响范围与回滚

- 新增生产镜像、Compose、Nginx 模板、客户端合同和发布手册。
- 不改公共 HTTP API，不改已应用迁移，不触碰生产数据。
- 生产回滚先恢复 Yoyoo 旧 `.env` 与旧镜像，再停用 AI Card vhost；数据库卷只保留，不自动删除或还原。
