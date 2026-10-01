# SSO Browser SDK（原型）

一个无 Vue/React 运行时依赖的前端 SDK。当前实现的是**宿主后端建立本域会话**的接入模式：SDK 跳转到宿主登录入口，宿主后端与认证中心或域身份服务完成认证并设置本域 Cookie，SDK 返回后查询会话。五个子路径入口分别表示 OIDC、SAML、CAS、WS-Fed 和 Negotiate 的后端会话模式；它们复用同一段前端跳转逻辑。协议验签、验票、换码和 Kerberos 协商不在浏览器 SDK 中进行。

本包目前为 `private` 原型。OIDC、CAS、SAML 是首版本机验证范围；WS-Fed 已通过独立 STS/RP 库的本机互操作和 Vue/React 浏览器测试，但仍作为扩展实验入口，等待实际认证中心与业务 RP 联调及扩展版本发布评审。Negotiate 已有本地 HTTP 交互夹具、真实本地 Kerberos 及 HTTP/HTTPS Firefox SDK 互操作；企业真实域、受管浏览器及业务宿主认证模块仍待验证。任何本机结果都不等于生产就绪。

## 接入示例

```ts
import { createSSO } from 'sso-browser-sdk-prototype';
import { oidcAdapter } from 'sso-browser-sdk-prototype/oidc';

const sso = createSSO<{ id: string }>({
  session: { endpoint: '/sso/session' },
  logout: { endpoint: '/sso/logout' },
  adapter: oidcAdapter({ loginEndpoint: '/sso/oidc/start' }),
});

// 在应用入口或受保护页面调用。成功后返回本域会话；未登录时跳转一次。
await sso.ensureAuthenticated();

// 在页面状态管理中订阅：
const unsubscribe = sso.onAuthChange((state) => {
  // unknown / checking / authenticated / unauthenticated / error
});

// 用户主动登录可重试此前失败的流程。
sso.login({ returnTo: '/orders' });

// 本域登出。全局单点登出需要宿主后端另行协商和实现。
await sso.logout();
```

将 `oidcAdapter` 换成 `/saml` 的 `samlAdapter` 或 `/cas` 的 `casAdapter`，并填入该协议在宿主后端的入口。`/wsfed` 的 `wsFedAdapter` 也可用同样方式接入，已完成本机签名 SAML 1.1 互操作；它仍是**扩展实验入口**，不属于首版正式支持声明。`/negotiate` 的 `negotiateAdapter` 使用同源专用挑战入口；本地测试已覆盖脚本化 HTTP 交互，以及 curl／Firefox 与 Java GSSAPI 的真实 Kerberos 互操作，企业受管浏览器和业务宿主仍待验证。业务方无需安装协议专用前端运行时。宿主入口的回跳参数默认叫 `returnTo`，可用 `returnToParam` 配置名称；SDK 只允许同源页面作为回跳目标。完整前后端分工见[首版接入指南](https://github.com/haigeerlab/sso-browser-sdk/blob/main/docs/SSO_首版接入指南.md)。

## 宿主后端必须提供的接口

| 接口 | 最小契约 |
| --- | --- |
| `GET /sso/session` | 已登录：`200 {"authenticated":true,"user":{...}}`；未登录：`401` 或 `200 {"authenticated":false}`。应禁止缓存。非 2xx 故障不能伪装成未登录。 |
| `GET /sso/{protocol}/start?returnTo=...` | 校验回跳仅在本应用允许的路径内。OIDC/CAS/SAML/WS-Fed 由后端发起相应协议；Negotiate 在同源专用入口发出 HTTP 挑战。后端确认身份后设置本域 `HttpOnly` 会话 Cookie，再返回目标页面。 |
| `POST /sso/logout` | 使本域会话失效，成功返回 2xx（建议 204），不得把跨站跳转作为 `fetch` 响应。需要 CSRF 令牌时，用 `logout.headers` 提供请求头。 |

Cookie 的 `Secure`、`SameSite`、域名、路径以及跨域部署方式由宿主后端按环境设置。所有业务 API 必须由后端独立验证会话，不能仅根据 SDK 的前端状态放行。

| 协议 | 后端额外责任 |
| --- | --- |
| OIDC | 保存并校验 `state`、`nonce`、PKCE；换取授权码；校验签名、签发者、受众和时效。 |
| SAML 2.0 | 生成 SP 发起的 Redirect AuthnRequest，在 ACS 接收 POST Response；以固定可信 IdP 证书校验签名、签发者、受众、`Destination`、`Recipient`、时效、`InResponseTo` 和重放。使用一次性服务端 RelayState 关联请求，不能依赖跨站 POST 携带 `SameSite=Lax` Cookie。 |
| CAS | 固定 `service`，向认证中心一次性验票，校验目标服务并防止重放。 |
| WS-Fed | 生成 `wa=wsignin1.0` 的 passive 请求，固定 realm/reply，保存一次性 `wctx`；POST 回调用可信证书验证令牌签名、签发者、受众、时效和重放后创建本域会话。跨站 POST 不能依赖 `SameSite=Lax` 宿主 Cookie。 |
| Negotiate | 配置域、服务主体和浏览器受信任策略，在专用入口处理 HTTP 协商并确认实际机制为 Kerberos 后建立本域会话；未登录的 `GET /sso/session` 不应发出 Negotiate 挑战。NTLM 回退不计入首批通过。真实域联调按[验收模板](https://github.com/haigeerlab/sso-browser-sdk/blob/main/tasks/negotiate-integration/domain-validation.md)记录。 |

仓库中的 [`docs/SSO_SDK_方案调研.md`](https://github.com/haigeerlab/sso-browser-sdk/blob/main/docs/SSO_SDK_方案调研.md) 记录了五种模式的完整流程图与后端边界。

## 当前验证范围

- 仓库根目录 `npm test`：公共状态、回跳约束、五个适配器入口和登出的单元测试；Vue/React 宿主构建；简版前后端交互回归与 Negotiate HTTP 夹具；独立 OIDC、CAS、SAML 与 WS-Fed 实现的互操作测试。Negotiate 夹具的脚本化验证器不是 GSSAPI/Kerberos。首次运行 CAS 测试前按 `services/cas-reference/README.md` 建立 Python 虚拟环境；SAML 测试需 OpenSSL、JDK 和安装时编译的 XSD 验证器，见 `services/saml-reference/README.md`。
- 仓库根目录执行 `npm run start --workspace=@sso-test/protocol-fixture`，在本机 `127.0.0.1` 与 `localhost` 两个站点模拟认证中心和宿主 A/B。默认打开 OIDC 示例；访问 `/app-a/?protocol=cas`、`/app-a/?protocol=saml` 或 `/app-a/?protocol=wsfed` 可验证简版流程。App A 为 Vue 3.4.0，App B 为 React 19.3.0，两者都用 Vite 5.0.0 构建。默认端口为 43893，可用 `SSO_FIXTURE_PORT` 覆盖。
- 简版夹具**不实现**真实 OIDC 令牌端点或协议安全验证；CAS XML 验票只处理固定测试响应，SAML/WS-Fed 简版响应未签名。独立参考服务中 WS-Fed 使用 `wsfed` 8.0.0 + `passport-wsfed-saml2` 4.6.4，并锁定签名 SAML 1.1。测试库已归档或计划归档，且私有测试依赖存在审计告警，详见 [`services/wsfed-reference/README.md`](https://github.com/haigeerlab/sso-browser-sdk/blob/main/services/wsfed-reference/README.md)。生产认证中心、真实业务 RP 与 Kerberos 域环境仍需另行验收。

`ensureAuthenticated` 使用 `sessionStorage` 记录一次自动跳转；回到应用仍未登录时会抛出登录循环错误。手动 `login()` 可以重试。网络或宿主故障抛错，并使状态为 `error`，不会被当成访客继续跳转。框架只需在入口或路由守卫调用公共 API。示例已在 Vue 3.4.0 + Vite 5.0.0、React 19.3.0 + Vite 5.0.0 下完成从打包 SDK 隔离安装后的类型、开发服务及构建验证；简版服务浏览器联调见仓库的 [`host-compatibility` 验证记录](https://github.com/haigeerlab/sso-browser-sdk/blob/main/tasks/host-compatibility/verification.md)。其他版本尚未形成兼容承诺。

## 许可证

[MIT](LICENSE)。
