# 014 Feature 旗下产品受控登记与生产体检

> 日期：2026-08-13
> 状态：已实现并通过本地全量自动化门禁；独立安全审查和生产部署待完成

## 背景

Phase 8A-8C 已证明首次注册自动获得唯一 AI Card，Yoyoo 与独立参考产品可复用同一身份。但原有平台客户端仅由 migration 写死，新增旗下产品需要改 SQL，无法作为可重复、可审计的运维流程。同时，生产切换缺少一个只读、失败即停的配置与数据库体检入口。

## 关键决策

- 新增的是内部受控登记 CLI，不是公共动态客户端注册 API；不可信第三方不能自行获得客户端资格。
- client ID、audience、redirect URI 和 scopes 视为一份不可静默漂移的合同。原样重试幂等，任一字段变化显式冲突。
- 使用 PostgreSQL transaction advisory lock 串行化同一 client ID 的并发登记，客户端、redirect URI、scopes 和审计事件在同一事务内写入。
- 生产 callback 强制 HTTPS；本地 HTTP 仅容许 `localhost` 且必须显式开启。
- 生产体检只读取环境、`aicard_schema_migrations` 和平台客户端 ledger，不自动迁移、修复或改写生产。
- 体检先校验本地配置，配置不完整时不尝试连接数据库；错误输出对连接串进行脱敏。

## 否掉的备选

- 每个新产品新增 migration：可以工作，但会将运营配置与数据库 schema 演进混在一起，且缺少统一的幂等和防漂移规则。
- 开放类 OAuth Dynamic Client Registration 端点：更通用，但会立即带来开发者身份、审批、密钥、配额和滥用防护问题，不符合当前“仅旗下产品”边界。
- 遇到已有 client 时自动 merge callback/scopes：操作省事，但可能静默扩权，明确否决。
- 体检自动修复生产：无法在一个命令中保证备份和回滚边界，故保持只读。

## 影响范围

- 新增平台客户端登记 Service、PostgreSQL Repository 和内部 CLI。
- 新增生产只读 doctor，校验 issuer/WebAuthn、migration ledger 和 Yoyoo 生产 client 合同。
- 没有新增或移除依赖，没有新增 migration，没有修改公共 HTTP API，没有触碰生产数据或配置。

## 当前验证结果

- 平台客户端登记与 doctor ledger 集成测试：已在隔离 PostgreSQL 中通过，含创建、幂等重试、配置漂移、HTTPS 边界和审计断言。
- ESLint：通过。
- TypeScript 严格类型检查：通过。
- Next.js 生产构建：通过。
- 全量单元测试：28 个文件、85 项通过。
- 全量隔离 PostgreSQL 集成测试：12 个文件、60 项通过。
- Playwright 桌面与移动端回归：32 项通过。

## 未验证与下一步

- AI Card 正式 issuer 域名和 Yoyoo 生产 callback 尚未锁定，不能据此执行生产切换。
- 尚未完成独立安全审查、备份恢复演练、生产密钥管理和公网登录验收。
- 新增旗下产品还需实现本地成员/session 映射并通过跨产品协议验收；客户端登记成功不等于产品接入完成。
