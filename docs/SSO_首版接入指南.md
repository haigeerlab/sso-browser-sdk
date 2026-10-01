# SSO 浏览器 SDK 首版接入指南

本指南面向已有业务后端、且统一认证中心已由后端团队提供的浏览器项目。首版正式验证范围为 **OIDC 授权码 + PKCE、CAS、SAML 2.0** 的“宿主后端完成协议、创建本域会话”模式。一个业务项目选择一种协议入口；前端安装同一个 SDK 包。当前仓库的包仍是 `private` 原型，正式包名和 registry 待定，以下导入名用于本机验证。

## 前端最小接入

```ts
import { createSSO } from 'sso-browser-sdk-prototype';
import { oidcAdapter } from 'sso-browser-sdk-prototype/oidc';
// CAS 改用 /cas 的 casAdapter；SAML 改用 /saml 的 samlAdapter。

const sso = createSSO<{ id: string }>({
  session: { endpoint: '/sso/session' },
  logout: { endpoint: '/sso/logout' },
  adapter: oidcAdapter({ loginEndpoint: '/sso/oidc/start' }),
});

const unsubscribe = sso.onAuthChange((state) => {
  // unknown / checking / authenticated / unauthenticated / error
  renderAuthState(state);
});

// 在应用入口或受保护页面挂载后调用，并把错误显示给用户。
void sso.ensureAuthenticated().catch(showLoginError);
// 用户主动重试：sso.login()
// 本域登出：await sso.logout()
// 卸载时：unsubscribe()
```

核心包不依赖 Vue、React、Vite 或路由库；在 Vue `onMounted`/`onUnmounted`、React `useEffect` 等生命周期接线即可。SDK 导航前将回跳目标限制为当前页面同源；宿主后端还必须独立校验允许的回跳路径。业务 API 仍由后端验证会话，不能信任页面上的 `authenticated` 状态。

### 宿主差异的配置

| 差异 | SDK 配置 | 后端责任 |
| --- | --- | --- |
| 会话响应字段不同 | `session.map(payload)` 转为 `{ authenticated: true, user }` 或 `{ authenticated: false }` | 对未登录返回 `401` 或明确未登录值；故障返回非 2xx，不伪装访客 |
| 回跳参数不叫 `returnTo` | 适配器 `returnToParam: 'next'` | 登录入口读取 `next` 并校验同源及本应用路径 |
| 登出需要 CSRF 头 | `logout.headers` 提供头或返回头的函数 | 校验 CSRF、撤销本域会话并返回 2xx，不对 `fetch` 返回跨站跳转 |

`session.map` 只能处理响应格式，不应放宽身份验证。`getSession()` 把 `401` 当作未登录，把网络/后端故障当作 `error`；`ensureAuthenticated()` 只自动跳转一次，失败后由用户主动重试。

## 后端交付清单

| 参与方 | 通用必需项 |
| --- | --- |
| 统一认证中心 | 为每个业务宿主登记客户端/SP/服务地址；提供对应协议的登录端点、密钥或可信元数据、会话策略及测试账号；使用 HTTPS 并明确 Cookie、证书轮换和退出语义。 |
| 业务宿主后端 | 提供同源 `GET /sso/session`、`POST /sso/logout`、对应协议的 `GET /sso/{protocol}/start` 与服务端回调；安全处理协议结果后设置 `HttpOnly` 本域会话 Cookie；业务 API 单独鉴权。 |
| 前端 SDK | 查询会话、跳转同源入口、保存同源回跳页面、更新状态、处理一次自动登录和本域登出；不解析协议票据、断言或身份令牌。 |

### 通用 HTTP 与 Cookie 契约

- 会话查询已登录时返回 `200` JSON，默认格式为 `{"authenticated":true,"user":{...}}`；未登录时返回 `401` 或 `200 {"authenticated":false}`。响应应禁止缓存。
- 宿主登录入口验证回跳地址只落在本应用允许的路径，保存一次性请求关联；校验回调后设置本域 Cookie，再导航回原页面。跨域认证中心只能设置自己的域名 Cookie，不能由前端代写其他域 Cookie。
- 生产 Cookie 使用 `HttpOnly`、`Secure`，按实际站点拓扑选择 `SameSite`、`Domain`、`Path`；会话标识与敏感票据不放在 URL 或 JavaScript 可读存储。需要跨站 POST 的 SAML ACS 不能假定浏览器携带 `SameSite=Lax` 宿主 Cookie。
- 登出应使当前宿主会话立即失效并返回成功状态；全局单点登出及其他宿主会话失效不属于此 SDK 默认能力。后端应有 CSRF 防护，前端可通过 `logout.headers` 传必要令牌。
- 认证失败、取消、回调不匹配或中心会话过期时，后端不能创建宿主会话；可回到安全业务页带错误标记，或直接返回明确错误。前端应展示 `error` 并提供手动重试。

### 各协议额外要求

| 协议 | 认证中心提供 | 宿主后端必须验证 |
| --- | --- | --- |
| OIDC | Discovery/JWKS、授权与令牌端点、已登记 `client_id` 和精确回调地址 | 授权码 + PKCE、`state`、`nonce`、签名、签发者、受众、时效；服务端换码，回调一次性使用 |
| CAS | 登录与服务票据验证端点、已登记精确 `service` | 用签发时完全相同的 `service` 向中心验票；票据一次性、过期和错误服务均拒绝 |
| SAML 2.0 | IdP 元数据、可信验签证书、SSO 端点、SP 登记信息 | SP 发起 Redirect AuthnRequest；ACS 接受 POST Response；可信签名、签发者、受众、地址、时间、`InResponseTo`、重放；一次性 RelayState 关联 |
| WS-Fed（扩展实验） | Web Passive STS 端点、固定 realm/reply 登记、签名证书、明确的令牌类型和证书轮换策略 | `wa=wsignin1.0`、固定 `wtrealm`/`wreply` 与一次性 `wctx`；POST 回调验证可信签名、签发者、受众、有效期和断言重放；不依赖跨站 POST 时的宿主 Cookie |

协议示例、流程图和后端边界见[五方案调研](SSO_SDK_方案调研.md)。简版测试夹具不能作为生产后端复制；生产环境还需验证 HTTPS、反向代理、跨站 Cookie、多实例会话和密钥轮换。

## 已验证的宿主边界

Vue 3.4.0、React/React DOM 19.3.0、Vite 5.0.0、Node 22.22.0 下，两个隔离宿主从同一 SDK tarball 安装，根入口与 OIDC/CAS/SAML 子路径、TypeScript 类型、Vite 开发服务与生产构建均通过。Codex 内置浏览器完成代表登录/恢复/登出/失败重试流程，但精确浏览器版本尚未记录。证据与未覆盖项见[宿主兼容记录](../tasks/host-compatibility/verification.md)。Webpack、完整 SSR 与其他版本未做兼容承诺。

WS-Fed 已完成本机独立 STS/RP 库互操作与 Vue/React 浏览器流程，令牌类型锁定签名 SAML 1.1；它仍属于扩展实验入口，不在**首版**正式支持声明内。参考库的安全审计告警和生产后端需另行验收的项目见 [WS-Fed 验证记录](../tasks/wsfed-integration/verification.md)。Negotiate 已完成临时本地域的真实 Kerberos、HTTP/HTTPS 双宿主与 Firefox SDK 互操作，但仍等待企业真实域、受管浏览器和业务宿主验收，见 [Negotiate 验证记录](../tasks/negotiate-integration/verification.md)。
