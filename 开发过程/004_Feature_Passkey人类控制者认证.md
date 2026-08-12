# 004 Feature：Passkey 人类控制者认证

## 背景

Phase 2 已建立 Principal 与 Card，但私密背面没有真实控制权。Phase 3 的目标是用设备持有的 Passkey 建立首个人类身份、可恢复登录和多凭据管理，同时不把长期秘密交给网页或数据库。

## 本阶段范围

- Passkey 创建人类 Card、可发现凭据登录、重新验证和退出。
- 多 Passkey、单凭据撤销、最后有效凭据保护。
- 一次性 challenge、哈希会话、CSRF、精确 Origin、数据库原子限流和安全审计事件。
- 首页身份入口、私密 Card 背面、凭据元数据与 loading/empty/error/success 状态。
- 官方 SimpleWebAuthn 适配器、单元/集成/桌面与移动端真实浏览器测试。

不包含账号恢复、邮箱或手机号登录、AI Agent 认领、平台授权、生产部署和真实硬件人工验收。

## 关键决策

1. 精确锁定 `@simplewebauthn/server@13.3.2` 与 `@simplewebauthn/browser@13.3.0`，使用官方库完成 WebAuthn 结构生成与密码学验证，不自写签名解析。
2. 注册强制 resident credential 与 user verification，attestation 设为 `none`；登录不传 allowCredentials，实现无用户名的可发现凭据选择。
3. challenge 五分钟过期、只能原子消费一次，并在验证前消费，失败与重放不能重复使用。
4. Session 和 challenge 在数据库只保存 SHA-256 哈希；Session 使用 256-bit 随机 Token、`HttpOnly`、`SameSite=Strict` Cookie。
5. 所有状态变更要求精确 Origin；登录后的敏感操作额外使用 CSRF Cookie/Header 双提交验证。
6. 追加 Passkey 必须绑定当前登录 Principal 且五分钟内完成过用户验证；仅拿到追加 challenge 不能把新凭据绑定给他人。
7. 没有恢复机制前禁止撤销最后一个有效 Passkey。相比制造一个不可靠的恢复后门，这个限制更明确且可审计。
8. migration 使用 forward-only `0003_human_credentials.sql`，没有改写已应用的 0001/0002 checksum。

## 否掉的备选

- **密码或邮箱验证码作为首要登录**：增加秘密存储、邮件基础设施和撞库面，不适合当前身份底座阶段。
- **自写 WebAuthn CBOR/签名验证**：安全风险和维护成本显著高于成熟库，没有产品收益。
- **把裸 Session Token 放进 localStorage**：扩大 XSS 后的凭据窃取面，因此使用 HttpOnly Cookie。
- **允许删除最后一个 Passkey**：当前没有经过验证的恢复通道，会直接造成永久失控。
- **以 `127.0.0.1` 同时支持本地登录**：WebAuthn RP ID 与 origin 语义会分裂；本地统一为 `localhost`。

## 状态与失败处理

- 首页和私密背面分别提供 loading、empty、error、success 状态；浏览器不支持 Passkey、用户取消和 API 失败都会显示可见反馈。
- 非同源状态变更与错误 CSRF 返回稳定 403；无会话返回 401；重复 Handle、过期 challenge、最后凭据撤销等冲突返回 409；限流返回 429 与 `Retry-After`。
- 公共错误不回显 PostgreSQL、签名、challenge、Session 或公钥材料。

## 验证结果

最终一次 `npm run verify` 结果：

- ESLint、TypeScript 严格类型检查与 Next.js production build 全部通过。
- Unit：14 个文件、40 项通过，包含 SimpleWebAuthn 安全选项与 HTTP 边界。
- Integration：4 个文件、16 项通过，覆盖一次性 challenge、会话轮换、多凭据、最后凭据保护、原子限流和审计 request ID。
- Chrome 虚拟认证器在桌面和 390px 移动端完成创建 Card、加入第二把 USB Passkey、撤销第一把、退出并以第二把无用户名登录。
- 全量 Playwright 22 项通过，既有工程四态和公开 Card 视觉基线未回归。
- 干净 `npm ci` 重新安装 536 个包，审计 537 个包，0 个已知漏洞。

## 影响范围与剩余风险

本阶段只修改独立 `/Users/subai/A/30_开发实验室/AICard`，没有修改 Yoyoo。新增数据库表、认证 API、首页和私密 Card 管理界面；公开 Card 协议与 Phase 2 字段边界不变。

剩余风险：尚无账号恢复、真实硬件人工验收、独立安全评审、反向代理可信客户端地址策略和生产监控。因此结论只能是“本地实现并自动化自测”，不是“可以公网发布”。
