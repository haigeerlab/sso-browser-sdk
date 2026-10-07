# 接入前检查

这个 SDK 适用于**业务后端完成认证协议，再创建本域会话**的浏览器应用。认证中心可以是另一个域名，但前端登录入口必须是业务应用的同源路径。

```text
业务页面 → 本域后端登录入口 → 认证中心
        ← 后端校验回调并设置 HttpOnly Cookie
业务页面 → 本域会话查询 → 已认证用户
```

## 后端是否已经准备好

| 问题 | 必需条件 |
| --- | --- |
| 有统一认证中心吗？ | 提供 OIDC、CAS 或 SAML，对业务宿主完成客户端/服务/SP 登记 |
| 谁完成认证协议？ | 宿主后端换码、验票或验签，浏览器 SDK 不接收或保存协议凭据 |
| 会话如何查询？ | 同源 JSON 接口，已登录返回用户；未登录返回普通 401 或 `authenticated:false` |
| 登录入口在哪里？ | 同源路径，接受安全 `returnTo` 并发起协议；回调成功后导航回原页面 |
| 如何退出？ | POST 接口撤销本域会话并返回 2xx，按后端需要校验 CSRF |
| 业务 API 如何保护？ | 后端对每个请求验证会话和权限；不能信任前端的登录状态 |

具体请求与响应见[通用 HTTP 契约](../backend/contract)。接口不必叫 `/sso/*`，名称通过 SDK 配置。

## 选择协议

使用认证中心与业务后端已经提供的协议，不需要为了使用这个包切换协议。一个 SDK 实例选择一个适配器。

- [OIDC](../protocols/oidc)：后端完成授权码 + PKCE。
- [CAS](../protocols/cas)：后端验证 Service Ticket。
- [SAML](../protocols/saml)：后端 SP 在 ACS 验证响应。
- [WS-Fed](../protocols/wsfed)、[Negotiate](../protocols/negotiate)：实验入口，有额外环境与验收条件。

## 不能直接接入的情况

只有认证中心地址、没有宿主后端会话接口；要求浏览器直接换取/保存令牌；只提供 Bearer Token 而没有文档所述 Cookie 会话；要求全局单点登出。这些都需要额外实现或不同的接入方案。

`session.credentials` 可以配置 fetch 携带凭据的方式，但它本身不解决 CORS、跨站 Cookie 或跨域认证部署。首版接入按同源后端设计。

## 当前可用产物

包仍是 `sso-browser-sdk-prototype@0.0.0`，`private: true`。使用[本地 tarball 安装](./quick-start)，不要直接执行 registry 安装并期待下载已发布版本。

下一步：[安装与最小接入](./quick-start)。已有本机证据和未覆盖范围见[支持矩阵](../reference/support)。
