# createSSO 与配置

根入口导出 `createSSO<User>()`、`SSOConfig`、`Session`、`AuthState`、`SessionPayload`、`ProtocolAdapter`。协议适配器从对应子路径导入。

<<< ../../examples/shared/client.ts

## SSOConfig

| 配置 | 必需 / 默认 | 行为 |
| --- | --- | --- |
| `session.endpoint` | 必需 | 会话查询 URL，推荐同源路径 |
| `session.credentials` | `same-origin` | 会话查询与登出 fetch 的 credentials |
| `session.map` | 默认 `{authenticated,user}` | 将 JSON `unknown` 映射为 `SessionPayload<User>` |
| `adapter` | 必需 | 实现 `loginUrl({returnTo}): string`，推荐内置适配器 |
| `logout.endpoint` | 可选 | 调用 `logout()` 时必须有此配置 |
| `logout.headers` | 可选 | HeadersInit 或返回 HeadersInit 的同步函数，用于 CSRF 等头 |
| `fetch` | `globalThis.fetch` | 测试或宿主需要时注入 fetch |
| `navigate` | `location.assign` | 同步导航函数；不要仅修改 SPA 路由来代替协议跳转 |
| `currentUrl` | `location.href` | 获取当前绝对 URL，用于回跳限制 |
| `storage` | `sessionStorage` | getItem/setItem/removeItem，自动导航防循环 |

`session.map` 不代替认证，也不会处理 HTTP 401 正文，因为 401 直接被识别为未登录。默认映射只检查 authenticated 和 user 属性存在，不深度验证用户内容。

## 自定义响应映射

假设后端返回 `200 {"loggedIn":true,"profile":{"id":"u1"}}` 或 `200 {"loggedIn":false}`。映射必须处理两种情况；不能不看 loggedIn 就返回已认证。

<<< ../../examples/shared/custom-config.ts

`csrfToken` 由业务后端通过自己的受保护机制提供，示例函数接收现成令牌，不发明一个可以通过随机字符串绕过后端的 CSRF 值。后端不需要 CSRF 头时使用基本配置。

## 适配器配置

五个内置适配器都接受 `loginEndpoint: string` 和可选 `returnToParam: string`，默认参数名为 `returnTo`。登录入口必须是以 `/` 开头的同源路径，不能是完整外域 URL、`//` 路径或带 fragment 的入口。

```ts
import { oidcAdapter } from 'sso-browser-sdk-prototype/oidc';
const adapter = oidcAdapter({
  loginEndpoint: '/auth/login?tenant=example',
  returnToParam: 'next',
});
// adapter.loginUrl({ returnTo: '/orders' })
// → /auth/login?tenant=example&next=%2Forders
```

参数名不能为空，也不能含 `? & # =`。自定义 `ProtocolAdapter` 不会自动获得内置适配器对入口的校验，业务方必须保证其安全。
