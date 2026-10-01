# SSO 浏览器夹具实测记录（2026-10-01）

## 环境与边界

- 浏览器：Codex 内置浏览器；本机 Node.js 24.18.0；夹具端口 43891。
- 宿主：`http://127.0.0.1:43891/app-a/`、`/app-b/`，两者使用不同的本域会话 Cookie。
- 认证中心：`http://localhost:43891/idp/authorize`，使用独立的中心 Cookie。
- 夹具是**OIDC 形状的模拟服务**，仅验证 SDK 与浏览器的导航、Cookie 和会话流转；不验证 OIDC 签名、令牌端点或真实提供方兼容。

## 操作与观察

| 步骤 | 浏览器观察 | 服务端计数 |
| --- | --- | --- |
| 打开 App A | 无本域会话，自动跳转中心登录页 | 中心登录 0 次 |
| 在中心点击“以 demo 登录” | 返回 App A，显示 `authenticated: demo` | 中心登录 1 次，App 回调 1 次 |
| 点击 App B | 返回 App B，显示 `authenticated: demo`，未出现登录表单 | 中心登录仍为 1 次，App 回调增至 2 次 |
| App B 点击“本应用登出” | 页面显示 `unauthenticated` | 本域会话失效 |
| 刷新 App B | 自动恢复为 `authenticated: demo`，未出现登录表单 | 中心登录仍为 1 次，App 回调增至 3 次 |

最终夹具计数：`centerLogins=1`、`centerAuthorizations=5`、`appCallbacks=3`。`centerAuthorizations` 包含初次显示中心登录页和登录后的再次授权请求。浏览器错误与警告日志为空。

## 测试环境修正

初始端口 `4173` 的 `localhost` 已有其他本机服务占用，首次浏览器跳转落到该服务。随后改用独立端口 `43891` 并重新运行完整场景，上表只记录修正后的结果。首次失败不计入 SDK 能力验证。

## 指定版本与框架接入复测

用户将本轮兼容目标明确为 Vite 5.0.0 和 Vue 3.4.0，并要求暂缓 webpack。示例依赖固定为 Vue 3.4.0、Vite 5.0.0、`@vitejs/plugin-vue` 5.0.1；React 示例使用 React 19.3.0 + Vite 5.0.0。

两套示例的生产构建均通过。第一次在未配置 Vue Vite 插件时，Vue 构建虽成功，浏览器运行却报 `__VUE_PROD_DEVTOOLS__ is not defined`。加入官方插件后重新构建，Vue 页面正常运行。这个失败说明只检查构建结果不足以证明兼容性。[Vue 编译特性标志](https://vuejs.org/api/compile-time-flags.html)、[官方 Vue Vite 插件](https://github.com/vitejs/vite-plugin-vue/blob/main/packages/plugin-vue/README.md)

在端口 43893 的新夹具进程中，浏览器打开 Vue App A → 中心登录一次 → 返回 A 显示 `authenticated: demo` → 进入 React App B 显示相同状态，期间不再显示中心登录表单。服务端计数为 `centerLogins=1`、`centerAuthorizations=3`、`appCallbacks=2`。修复后新打开的 Vue、React 标签页均无浏览器错误或警告日志。

负例在独立端口 43894 复测：首次跳到中心后点击“取消登录”，浏览器返回 Vue App A 并显示 `error`，没有再次自动跳到中心。此时计数为 `centerLogins=0`、`centerAuthorizations=1`、`centerCancels=1`、`appCallbacks=0`。随后点击应用的“登录”按钮可重新进入中心，完成登录后页面显示 `authenticated: demo`。

最终执行 `npm test`：19 项通过；Vue、React 两个示例的 Vite 5.0.0 构建通过。`npm pack` 生成 16 个文件、约 5.8 kB 的原型包；从 tarball 离线安装到独立目录后，根入口与 `/oidc` 子路径均可导入。此记录不包括向 npm 发布。

精确钉住 Vite 5.0.0 的示例依赖审计报告 2 项历史漏洞（1 项 moderate、1 项 high，主要涉及开发服务器）；此处仅在本机使用 Vite 做生产构建，浏览器夹具由独立 Node 服务提供静态文件。兼容性测试结果不等于建议生产环境继续使用未修复的旧版开发服务器。

## 尚未验证

- 真实 OIDC 提供方的授权码、PKCE、令牌交换与回调安全校验。
- SAML/CAS/WS-Fed 的真实协议互操作；Negotiate 的受管浏览器和域环境。
- 全局单点登出、中心会话过期与跨浏览器兼容。

## CAS 简版夹具追加实测

同日将夹具扩展为 OIDC/CAS 双协议测试服务，在端口 43893 用 Codex 内置浏览器打开 Vue App A 的 `/app-a/?protocol=cas`。中心显示 CAS 登录表单；点击“以 demo 登录”后，App A 显示 `authenticated: demo`。点击 App B 后，React 页面直接显示同样状态，未再次出现中心登录表单。App B 点击登出后显示 `unauthenticated`；返回 App A 仍是已登录；再次进入 App B 后由中心会话自动恢复登录。

根目录 `npm test` 同时通过 19 项 SDK 单元测试、Vue/React 的 Vite 5.0.0 构建，以及 6 项 OIDC/CAS 简版后端交互测试。CAS 用例覆盖两宿主共用中心会话、后端调用 `/cas/serviceValidate`、回调重放、`service` 不匹配后票据失效、票据过期和非法回跳。简版 CAS 服务只用于交互契约验证，真实 CAS 服务及 SLO 尚未验证。

## SAML 简版夹具追加实测

在端口 43893 用 Codex 内置浏览器打开 Vue App A 的 `/app-a/?protocol=saml`，页面跳转到中心的 SAML 登录表单。点击“以 demo 登录”后，中心通过自动提交的 HTML 表单向宿主 ACS 发起 POST；App A 返回原页面并显示 `authenticated: demo`。点击 App B 后，React 页面直接显示相同状态，未再次出现登录表单。

根目录 `npm test` 通过 19 项 SDK 单元测试、两个 Vite 5.0.0 示例构建及 8 项 OIDC/CAS/SAML 简版后端交互测试。SAML 负例包含非法 AuthnRequest、RelayState 不匹配、响应过期和回调重放。夹具响应未签名，不能作为真实 SAML 提供方或后端验签能力的证明。
