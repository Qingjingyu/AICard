# 002 Feature: 可运行工程基础

## Status

- 阶段：Phase 1
- 实现状态：已实现并自测
- 独立验收：未进行
- 部署状态：未部署；仅本机开发服务
- 当前访问地址：`http://127.0.0.1:3000`

## User Story

作为 AI Card 开发者，我需要一个可运行、可迁移、可测试、能安全失败的独立工程，这样后续身份、Passkey、AI 认领和平台授权都能建立在稳定门禁上，而不是继续堆在静态原型或 Yoyoo 仓库中。

## Delivered Scope

- Next.js 16 App Router、React、TypeScript 严格模式和自有 CSS tokens。
- Zod 环境变量校验，生产 `APP_ORIGIN` 强制 HTTPS。
- PostgreSQL 连接池、真实健康检查和 checksum migration runner。
- `/api/health` 对数据库在线与离线返回可区分状态，不回显内部错误。
- 统一结构化错误 envelope。
- CSP、COOP、Permissions Policy、Referrer Policy、nosniff 和防嵌入响应头。
- loading、empty、error、success 四态工程页面。
- Vitest 单元测试、真实 PostgreSQL 集成测试和 Playwright 双视口视觉测试。
- 本地 Docker Compose、迁移命令、README 和 CI 等价 `verify` 命令。

## Dependency Decisions

### Runtime

- `next@16.3.0`
- `react@19.2.8` / `react-dom@19.2.8`
- `zod@4.4.3`
- `pg@8.22.0`

### Development

- `typescript@6.0.3`
- `eslint@9.39.5` / `eslint-config-next@16.3.0`
- `vitest@4.1.10`
- `@playwright/test@1.62.1`
- `tsx@4.23.11`

最初按 registry 最新版尝试 TypeScript 7.0.2 与 ESLint 10.8.1。实际 lint 证明 Next 16.3 内置的 `typescript-eslint` 尚不支持 TypeScript 7，部分 ESLint 插件也只声明支持 ESLint 9，因此锁定当前兼容的 TypeScript 6.0.3 和 ESLint 9.39.5。安装树不再需要 peer override。

没有引入 UI 框架、ORM、认证库或日志框架。Phase 1 只建立基础设施。

## Design Decisions

### Forward-Only Migrations

每个 SQL migration 计算 SHA-256 并记录到 `aicard_schema_migrations`。runner 使用 PostgreSQL advisory lock、事务和 checksum 校验；已应用文件发生变化时直接失败，必须新增 forward migration。

### Real PostgreSQL Integration Tests

`npm run test:integration` 自动启动隔离的 `postgres:17-alpine`、执行真实 migration CLI、运行测试并清理容器。没有使用内存数据库冒充 PostgreSQL 行为。

### Safe Health Response

数据库正常时返回 HTTP 200、`status: ok`；数据库不可用时返回 HTTP 503、`status: degraded` 与稳定错误码。连接 URL、密码、主机和底层异常不进入响应。

### Four-State Skeleton, Not Final Product UI

当前页面只证明 loading、empty、error、success 四态、响应式布局与视觉回归门禁。Card 正反面和正式身份交互属于 Phase 2，不在本阶段伪造。

## Files Changed

- 工程配置：`package.json`、`package-lock.json`、`tsconfig.json`、`next.config.ts`、`eslint.config.mjs`、`vitest.config.mts`、`playwright.config.ts`。
- 本地环境：`.env.example`、`.gitignore`、`compose.yaml`、`README.md`。
- 页面/API：`src/app/`、`src/lib/contracts/`。
- 服务端：`src/server/config.ts`、`src/server/health.ts`、`src/server/postgres/pool.ts`。
- 数据库：`infra/postgres/migration-runner.ts`、`infra/postgres/migrate.ts`、`infra/postgres/migrations/0001_foundation.sql`。
- 测试：`tests/unit/`、`tests/integration/`、`e2e/`、`scripts/test-integration.mjs`。

## TDD Evidence

1. 配置、健康状态和 migration discovery：先运行 6 个测试，6 个均因模块不存在失败；实现后 6/6 通过。
2. 健康 route 和结构化错误：新增 3 个测试，3 个先失败；实现后全部通过。
3. PostgreSQL 集成：先因连接池模块不存在失败；实现后 3/3 通过。
4. migration CLI：本地演练先复现 top-level await/CJS 转换失败；将实际 CLI 加入集成门禁后稳定失败，再改为显式 `main()`，集成门禁转绿。
5. 页面 E2E：先因没有 App Router 目录失败；实现后建立桌面与移动视觉基线。
6. PostgreSQL 就绪竞态：完整门禁复现官方镜像初始化期间“临时实例已就绪、随后重启”的误判；先新增稳定就绪 tracker 测试并确认失败，再要求连续 3 次探针成功。修复后单测 10/10，通过 3 次连续全新 PostgreSQL 集成运行。

## Verification Results

### Full Gate

`npm run verify` 最终退出码为 0：

- ESLint：PASS。
- TypeScript：PASS。
- Next.js production build：PASS；`/`、`/_not-found`、`/api/health` 构建成功。
- Unit：6 个文件，10/10 PASS。
- PostgreSQL integration：1 个文件，3/3 PASS。
- Playwright：桌面 `1440x900` 与移动 `390x844`，12/12 PASS，包含基础安全响应头验证。

### Runtime Behavior

- PostgreSQL 在线：`/api/health` -> HTTP 200，`database.status: up`。
- PostgreSQL 停止：`/api/health` -> HTTP 503，`database.status: down`，错误码 `DATABASE_UNAVAILABLE`。
- PostgreSQL 重启：同一开发服务恢复 HTTP 200。
- `docker compose --env-file .env.local config --quiet`：PASS。
- `npm audit --registry=https://registry.npmjs.org --omit=dev --audit-level=high`：0 vulnerabilities。
- `package-lock.json` 只使用官方 npm registry；`npm ci` 可从锁文件重建依赖树。

### Visual Review

- 桌面与移动成功页截图已人工检查。
- 四态均无横向溢出。
- Playwright 等待 route fallback 卸载后才截图，避免把 loading 误当 success 基线。
- 移动端只允许最多 100 个字体抗锯齿像素差异，不使用百分比宽松阈值。

## Rejected Alternatives

- **ORM**：Phase 1 只有 migration ledger 和健康元数据，直接使用 `pg` 更小、更透明。
- **内存 PostgreSQL 替身**：无法证明真实 SQL、事务和 advisory lock 行为。
- **直接使用 TypeScript 7 / ESLint 10**：当前 Next 工具链存在明确兼容冲突。
- **提前实现 Card 页面**：会混淆工程四态与 Phase 2 产品功能。

## Impact Scope

所有改动只发生在 `/Users/subai/A/30_开发实验室/AICard`。没有修改 Yoyoo，没有接入生产数据库，没有部署公网服务，也没有创建真实身份或凭据。

本机创建了开发用 Docker volume `aicard_aicard-postgres-data`，用于保留本地 migration 数据。删除该 volume 会丢失本地数据，未自动清理。

## Remaining Risks

- 当前没有用户认证、Card 数据模型、授权或审计业务能力。
- `.env.example` 的数据库口令仅供本地开发，生产必须使用 Secret/KMS 管理。
- E2E 运行时存在 Node 颜色环境警告，不影响行为与截图，但后续 CI 可统一颜色变量。
- 本阶段是自测通过，不等于独立安全验收或可公网部署。

## Next Step

进入 Phase 2：实现 Principal、AI Card、Handle、Controller、三层可见性投影和 Card 正反面。先写数据库与领域行为测试，再实现页面。
