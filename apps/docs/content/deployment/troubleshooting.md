# 常见失败

先检查浏览器网络请求中的来源、路径、状态码、重定向和 Cookie 是否符合[后端契约](../backend/contract)。日志不要保存 ticket、SAMLResponse、Authorization 或会话 Cookie。

| 现象 | 检查与处理 |
| --- | --- |
| 会话请求 404 | 配置路径与业务后端或 Demo 不同；参考服务使用 `/app-a/auth/session` |
| 会话返回 HTML / JSON 解析失败 | 接口被代理到 SPA fallback 或登录页；后端会话接口必须返回 JSON/普通 401 |
| 未登录 401 | 正常；自动检查可导航登录。Negotiate 会话查询不应带挑战头 |
| 网络、500 或 403 | 属于错误，不能假装未登录。修复服务或权限反馈，不反复自动导航 |
| 登录返回后 loop detected | 已导航过仍没有会话；核对后端回调、Cookie、路径、浏览器策略和身份映射，提供手动重试 |
| 取消登录又反复跳转 | 不要在 catch/未登录状态订阅里再自动登录；使用共享实例及 SDK 防循环 |
| ssoError 没有显示 | SDK 不解析 URL 参数，按[示例反馈函数](../frameworks/typescript#错误反馈)处理白名单错误码 |
| 已退出又自动登录 | 中心或域凭据仍有效；退出后避免自动检查，使用用户主动登录；全局退出需后端实现 |
| 退出失败但页面仍显示登录 | SDK 保留旧状态是预期；捕获退出 Promise 错误并显示，不假装成功 |
| 退出收到 redirect | 后端必须返回 2xx，而不是向 fetch 返回认证中心导航 |
| Automatic login requires sessionStorage | 客户端存储不可用；检查策略，提供主动登录，避免假装支持自动跳转 |
| Session check superseded | 同一实例出现直接重叠查询；避免重复 getSession，自动检查使用去重方法 |
| React 开发期请求重复 | 核对 StrictMode、共享实例和 cleanup；不要每次 Effect 创建新客户端 |
| SAML/WS-Fed 跨站 POST 丢会话 | 不依赖 Lax Cookie 做请求关联；检查一次性 RelayState/wctx 和服务端状态 |

## 手动重试

`login()` 同步可能抛错，按钮 handler 需要 try/catch。`getSession()`、`ensureAuthenticated()`、`logout()` 返回 Promise，应捕获拒绝。自动登录失败不要由业务层循环重试，交给用户主动按钮。

后端的错误码及展示文案由业务方约定；不要直接将未验证的查询参数当作 HTML，或将内部异常/令牌显示给终端用户。

## 如何提交可复现问题

提供 SDK 产物版本/提交、浏览器与框架版本、所选协议、脱敏的接口路径/状态码、重定向顺序、是否复现于[本机 Demo](../demos/overview)及最小配置。不要发送密钥、票据、Cookie 或真实账号资料。
