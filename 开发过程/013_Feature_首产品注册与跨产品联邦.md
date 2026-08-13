# 013 Feature 首产品注册与跨产品联邦

> 日期：2026-08-13  
> 状态：Phase 8B 与 Yoyoo Phase 8C 已实现，完成双仓隔离数据库与真实浏览器自测；未独立安全审查或部署

## 背景

Phase 8A 已能统一注册和自动发卡，但业务产品还缺少完整闭环：从产品入口进入、在 AI Card 创建或登录、明确授权、返回产品、建立本地成员和会话。若产品直接调用 AI Card Repository，或在身份服务不可用时自建账号，就会重新形成多个身份权威。

## 关键决策

- 产品只通过公共 HTTP validation、token 和 userinfo 接口接入；运行时不依赖 AI Card 内部 Service 或 Repository。
- AI Card 负责全局身份与授权，产品负责本地 member、session 和业务权限。产品 schema 不建立到 AI Card 表的外键。
- 不同产品保存不同 pairwise Subject；只有用户明确批准 `card.id` 时才保存同一全局 Card ID。
- 产品 flow 使用随机 state、PKCE 和 flow token；摘要入库，verifier 与恢复响应使用 AES-256-GCM 加密。
- 重复回调和网络结果未知使用确定性幂等键恢复同一结果；失败路径不生成产品私有 Principal、Card 或替代身份。
- 官网注册来源固定为 `aicard_web`；产品入口来源必须由服务端验证授权请求后确定，不能相信浏览器任意传入的 client ID。
- 独立参考产品使用 Node 标准 HTTP 外壳，核心处理函数基于标准 `Request/Response`，便于后续迁入 Yoyoo 或其他框架。

## 否掉的备选

- 产品直接导入 `PlatformAuthorizationService`：开发更快，但会绕过公共协议并把两个系统锁在同一代码库。
- 产品 schema 外键引用 AI Card `platform_clients`：同库时方便，却无法安全拆库，也模糊身份与业务数据所有权。
- AI Card 不可用时先创建本地用户：会产生第二身份权威，后续无法可靠合并，明确否决。
- 直接把全局 Card ID 当产品唯一主键：容易造成跨产品追踪；产品仍以 pairwise Subject 建立本地映射。
- 为参考产品复制整套 Next.js：增加依赖和样式维护成本；当前仅需证明协议、状态和数据库边界。

## 影响范围

- 新增 `0011`-`0013` forward migration：测试客户端 `card.id`、参考产品 schema、官网注册客户端。
- 新增联邦服务、HTTP identity gateway、公开 validation 端点和参考产品。
- 首页注册来源按服务端验证结果传递；直接 AI Card 注册不再错误归属 Yoyoo。
- Playwright 同时启动 AI Card 与独立参考产品，覆盖桌面和移动回调闭环。
- E2E 使用独立 `4280/4281` 端口并禁止复用已有服务；参考产品的浏览器授权 Origin 与服务端内部访问 Origin 分离，避免本机地址族影响协议验收。
- 新增双仓验收脚本，但未新增或移除第三方依赖；未修改生产数据、生产配置或公网服务。

## 验证结果

- lint：通过。
- TypeScript 严格检查：通过。
- Next.js 生产构建：通过，包含新增 `/api/v1/federation/validate` 路由。
- 单元测试：28 个文件，85 项通过。
- 隔离 PostgreSQL 集成测试：12 个文件，60 项通过。
- Playwright：桌面与移动共 32 项通过；新增用例实走产品空态、账号创建、授权、回调、成功态和数据库对账。
- 跨仓库联邦验收：`npm run test:federation:yoyoo` 通过临时 HTTPS 反向代理、两个隔离数据库与真实 AI Card/Yoyoo 生产构建，验证从 Yoyoo 首次创建 `AI_100001`、授权回调、复用原 Owner Principal，以及新浏览器使用同一 Card 再次登录；同一脚本还创建并认领 YOS 的 `AI_100002`，由控制者授权到 Yoyoo，再以短期 `agent.runtime` 令牌发现明确房间 ID 并持久化消息。
- 跨仓数据库对账：Yoyoo 始终只有一个 human Principal、一个 AI Card 映射，不创建本地密码凭据；再次登录复用同一 Principal、pairwise Subject 和 Card ID，仅新建独立会话。测试结束自动清理服务、临时证书和数据库容器。
- Agent 对账：YOS 始终只有一张 AI Card、一个认领节点和一个 Yoyoo Agent Principal；重复授权复用同一 pairwise Subject，且 Yoyoo 不创建旧 `yya_` 凭据。端到端验收发现并修复了授权接口仍只接受旧 `aic_` 格式、导致新 `AI_100002` 无法提交的兼容问题。
- 数据库断言：同一 Card 在 `yoyoo_dev` 与 `test_client` 获得不同 Subject；产品 schema 仅有内部会话外键，无跨 AI Card schema 外键。
- 安全路径：错误 state、AI Card 不可用、畸形响应、重复回调、CSRF 和 HTML 注入均有自动化覆盖。

## 未验证与下一步

- 尚未完成独立安全审查、真实网络故障注入、生产 KMS/Secret 管理和公网限流。
- 参考产品 session 与 AI Card access token 同为十分钟；生产产品需要定义重新授权体验和撤销传播 SLO。
- Yoyoo Phase 8C 已通过跨仓本地验收。生产 issuer/client/callback、Owner 授权、备份、回滚演练和公网验收仍未完成。
