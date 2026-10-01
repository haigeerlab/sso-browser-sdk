# negotiate-integration 实施计划

依据：[Negotiate 模块 Spec](../../spec/negotiate-integration.md)。首批只把服务端确认使用 Kerberos 的真实域登录计为协议通过；NTLM 回退不计入。前端只导航宿主同源入口并消费本域会话。

## 基线与执行原则

- 已有 `packages/browser-sdk/src/negotiate.ts` 复用后端跳转适配器，`/negotiate` 已导出；现有测试只覆盖生成登录 URL。先查缺口，不为 Negotiate 重写 `createSSO` 或增加浏览器令牌处理。
- 本机预检发现 `kinit`、`klist`，未发现 Docker、Podman、.NET 命令；后续发现 Homebrew keg-only 的 MIT Kerberos 可搭建临时本地域。这不等于存在可用的企业域、HTTPS 宿主或受管浏览器。真实域验收须另核对域、两个宿主 FQDN/SPN、后端认证模块、浏览器策略和代理拓扑。
- 每个切片先留下失败用例或可观察的基线，再实现最小变更并复验。测试替身只证明 HTTP 交互，不替代 GSSAPI/Kerberos 验证。

## 切片 1：合同缺口与真实环境预检

- 对照 Spec 检查 `negotiateAdapter`、公共自动登录防循环、手动重试、本域登出和会话错误语义；记录已有覆盖与缺口。核对 `npm test` 基线。
- 只读核对可用的域/KDC、两个不同的 HTTPS 宿主 FQDN/SPN、服务端 Negotiate 模块、受管浏览器和策略、测试账号及反向代理位置。记录可执行的环境矩阵，不把 `kinit` 的存在当作域就绪。
- **验证**：在 `tasks/negotiate-integration/verification.md` 记录命令、版本、结果与缺失条件；若真实环境缺失，后续本地切片继续，真实域部分保持未完成。

## 切片 2：SDK 合同与专用挑战接口

- 如现有单测不足，先增加针对 `/negotiate` 的失败用例：同源入口和安全回跳、一次自动导航、回到应用仍无会话时停止重试、手动重试与本域退出。实现只补确有缺口的 SDK 行为。
- 为本地双宿主夹具增加专用 `GET /sso/negotiate/start` 与 `GET /sso/session`：前者呈现 `401 WWW-Authenticate: Negotiate` 挑战，后者未登录时返回**无挑战头**的普通未认证响应；回跳仅接受本站路径。
- **验证**：聚焦 SDK 单测与新增 HTTP 测试；非法回跳被拒绝，单独查询会话不触发挑战。不能以 `Authorization` 头存在作为认证通过条件。

## 切片 3：双宿主状态与失败闭环

- 夹具用明确标注为**测试替身**的服务端身份结果模拟认证完成，分别创建 App A、App B 本域会话；不解析或验证假 Kerberos 票据，也不允许客户端自填身份头换取会话。
- 覆盖挑战可多轮、协商失败/取消、安全失败回跳、过期后再次登录、会话恢复、本域退出及失败后的手动重试；各宿主 Cookie 和会话独立。验证自动登录最多一次，无 401 导航循环。
- **验证**：`node --test tests/integration/negotiate-fixture.test.mjs` 全部通过，保存 HTTP 状态/头、Cookie 边界和失败记录；文档显著标明“模拟交互，非 Kerberos 互操作”。

## 切片 4：真实 Kerberos 服务端与浏览器互操作

- 在可用的受控域或业务域中，用真实后端认证模块配置两个宿主的 HTTPS FQDN/SPN、浏览器信任策略和可信身份映射；确认实际协商机制可由服务端审计。由真实后端验证协商结果、创建各自本域会话。实现技术和部署配置以环境预检结果为准，不把测试夹具部署为认证服务。
- 在受管浏览器执行 A 首登、B 免输密码、刷新、过期重建和本域退出；再执行不受管浏览器/禁用策略、错误 SPN、无效凭据、NTLM 回退和代理路径等负例。分别记录客户端版本、策略、服务端机制、脱敏的挑战轮次、结果与限制。
- **验证**：只有服务端确认 Kerberos、双宿主均建立正确的独立会话且负例被拒绝，才将此层标为通过。若环境不可用，写明缺项并保持实验支持状态，不用模拟测试代替完成。

## 切片 5：回归、包内容与支持结论

- 根据真实测试结果补充宿主接入说明和验证记录，明确后端挑战入口、普通会话接口、Cookie、代理及退出语义；不扩大首版 OIDC/CAS/SAML 的正式支持声明。
- **验证**：`npm test`、`npm pack --workspace=sso-browser-sdk-prototype --dry-run --json`、SDK 类型/导出检查与 Spec Guard `verify-artifacts.sh`；确认发布包不包含夹具、域凭据、票据、证书或测试配置。未取得真实域证据时，对外只声明前端合同与本地 HTTP 交互通过。

## 依赖与停点

切片 2、3 依赖现有 SDK 核心，但不依赖真实域；切片 4 依赖切片 1 的环境信息和可用身份基础设施；切片 5 汇总实际完成的层级。缺少真实域不是放松 Kerberos 验收的理由。若后端只能提供 NTLM、要求浏览器 JS 处理票据，或代理无法满足认证要求，应停下记录差异并重新评审方案边界。

首个实现切片从 `tests/integration/negotiate-fixture.test.mjs` 的挑战入口与无挑战会话断言开始，预期先因路由不存在失败，再补最小夹具路由。实现前先完成切片 1 的基线与环境核对。
