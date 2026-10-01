# OIDC 参考实现互操作记录（2026-10-01）

## 环境与配置

- Node.js 22.22.0；`oidc-provider` 9.12.2；`openid-client` 6.8.8；Codex 内置浏览器。
- Vue App A 与 React App B 运行在 `127.0.0.1` 的不同路径；认证中心运行在 `localhost`，使用与宿主隔离的浏览器 Cookie。HTTP 仅供本机测试；生产环境必须使用 HTTPS。
- 两个宿主后端各自发起 Authorization Code + PKCE（S256），验证 `state` 与 `nonce`，交换授权码后创建 HttpOnly 本域会话；前端 SDK 只调用宿主登录入口、会话接口和本域登出接口。
- 两个客户端被配置为可信第一方应用，预授权 `openid` scope，因此首次输入账号密码后切换宿主不出现授权同意页。此策略由认证中心控制，SDK 无法替代。
- 提供方使用开发专用内存存储、临时签名密钥和开发交互页；不作为生产认证中心模板。

## 自动化互操作

运行 `npm run test:interop`，结果 3 项通过。测试实际访问提供方发现文档、授权端点与令牌端点，通过 `openid-client` 完成令牌交换与 ID Token 检查：

| 场景 | 结果 |
| --- | --- |
| App A 首次登录 | 仅出现登录表单，回调后建立 App A 本域会话 |
| App B 首次进入 | 使用中心会话直接登录，无登录表单或同意页 |
| 回调 `state` 篡改 | 宿主返回 400，不创建会话 |
| 回调重放 | 首次有效，第二次返回 400 |
| App B 本域登出 | B 会话失效，A 会话继续有效 |
| App B 再次进入 | 使用中心会话直接恢复 B 会话 |
| 中心会话到期 | 将中心会话设为 2 秒并关闭默认时钟容差；到期后 App B 必须重新登录 |
| 用户取消登录 | 提供方返回 `access_denied`；宿主回到业务页，不创建本域会话 |

全局单点登出及刷新令牌不在本次证明范围。

## 浏览器复测

在端口 56775 的新进程打开 Vue App A，中心出现一次 Sign-in 表单；输入本地测试账号 `demo` 后，A 显示 `authenticated: demo`。点击 App B 后直接进入 React 页面，显示 `authenticated: demo`，没有再次出现登录或授权同意页。

随后在 B 点击登出，B 显示 `unauthenticated`；进入 A 仍显示 `authenticated: demo`；再进入 B 直接恢复 `authenticated: demo`，期间没有额外表单。

补测时重新构建 Vue/React 宿主，在 Codex 内置浏览器打开 Vue App A：首次取消登录后返回 A 并显示 `error`；点击“登录”再次进入认证中心，第二次取消仍返回 A 并显示 `error`，未发生自动重定向循环。

最初使用提供方默认配置时，App B 虽不要求重新输入账号密码，但首次访问会显示授权同意页。按提供方的 `loadExistingGrant` 扩展点，为这两个已登记的可信第一方客户端建立预授权 Grant 后，自动化测试和浏览器复测均确认无额外交互。生产认证中心需要明确同意策略，不能把“中心已登录”直接等同于“所有客户端无需用户操作”。[oidc-provider 官方配置说明](https://github.com/panva/node-oidc-provider/blob/main/docs/README.md)

## 后续验证

- 使用生产目标认证中心复测 OIDC 会话过期、回调错误展示、重新登录与中心登出。
- 接入真实 CAS、SAML、WS-Fed 提供方；Negotiate 需受管浏览器与域环境。
- 当前互操作服务仍是本项目自建的测试后端，不代表已有业务项目的接入验收。

## 全量回归与打包检查

`npm test` 通过：20 项 SDK 单元测试、8 项简版协议交互测试、3 项真实 OIDC 互操作测试，以及 Vue/React 两个 Vite 5.0.0 生产构建。先前的 `npm pack --workspace=sso-browser-sdk-prototype --dry-run --json` 显示 SDK 包 16 个文件、约 5.8 kB；测试服务、互操作测试与宿主示例均未进入 npm 包。本次没有重复运行打包预览。
