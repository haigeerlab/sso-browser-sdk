# SSO Browser SDK

无框架运行时依赖的浏览器 SDK，通过**业务后端建立的本域 Cookie 会话**接入 SSO。提供会话查询、登录导航、刷新恢复、状态订阅、自动导航防循环、手动重试和本域退出。

协议换码、验票、验签和 Kerberos 协商由业务后端完成。认证中心支持标准协议，还需要宿主提供下面的接口，才能接入本包。

当前包为 `sso-browser-sdk-prototype@0.0.0`、`private: true`，尚未发布到 registry。OIDC/CAS/SAML 已完成本机参考环境验证；WS-Fed/Negotiate 是实验入口。生产认证中心与真实业务宿主需单独验收。

## 文档与完整示例

- [接入前检查](https://github.com/haigeerlab/sso-browser-sdk/blob/main/apps/docs/content/guide/prerequisites.md)
- [安装与最小接入](https://github.com/haigeerlab/sso-browser-sdk/blob/main/apps/docs/content/guide/quick-start.md)
- [原生 TypeScript](https://github.com/haigeerlab/sso-browser-sdk/blob/main/apps/docs/content/frameworks/typescript.md)、[Vue](https://github.com/haigeerlab/sso-browser-sdk/blob/main/apps/docs/content/frameworks/vue.md)、[React](https://github.com/haigeerlab/sso-browser-sdk/blob/main/apps/docs/content/frameworks/react.md)
- [后端 HTTP 契约](https://github.com/haigeerlab/sso-browser-sdk/blob/main/apps/docs/content/backend/contract.md)、[API](https://github.com/haigeerlab/sso-browser-sdk/blob/main/apps/docs/content/api/client.md)、[运行 Demo](https://github.com/haigeerlab/sso-browser-sdk/blob/main/apps/docs/content/demos/overview.md)

文档站源码在仓库 `apps/docs`。仓库根目录 `npm ci` 后执行 `npm run docs:dev`，访问终端输出地址。站点尚未线上部署；仓库链接须在本轮改动推送后才可在线读取，当前请使用本地站点。

## 安装当前包

从仓库源码构建，在仓库根目录运行（Node 22.22.0；首次仓库依赖安装还需 JDK）：

```bash
npm ci
npm run build --workspace=sso-browser-sdk-prototype
mkdir -p /private/tmp/sso-sdk-package
npm pack --workspace=sso-browser-sdk-prototype --pack-destination /private/tmp/sso-sdk-package
```

再到业务项目目录运行：

```bash
npm install /private/tmp/sso-sdk-package/sso-browser-sdk-prototype-0.0.0.tgz
```

临时路径可替换为自己系统的实际目录。包仅含 ESM、类型声明、README 和 LICENSE，无运行时依赖；不要直接导入源码目录。正式包发布前不提供 registry 安装承诺。

## 最小接入

以下用于浏览器受保护页面，替换三个接口路径并保证后端会话返回 `{ authenticated: true, user: { id: string } }`。一个应用使用一个共享实例。

```ts
import { createSSO } from 'sso-browser-sdk-prototype';
import { oidcAdapter } from 'sso-browser-sdk-prototype/oidc';

const sso = createSSO<{ id: string }>({
  session: { endpoint: '/sso/session' },
  logout: { endpoint: '/sso/logout' },
  adapter: oidcAdapter({ loginEndpoint: '/sso/oidc/start' }),
});

const unsubscribe = sso.onAuthChange((state) => {
  if (state.status === 'authenticated') console.log('已登录', state.user.id);
  if (state.status === 'error') console.error('会话或登录检查失败', state.error);
});

void sso.ensureAuthenticated().catch((error: unknown) => {
  console.error('检查失败，等待用户手动重试', error);
});
window.addEventListener('pagehide', unsubscribe, { once: true });

// 登录按钮：try { sso.login(); } catch (error) { /* 展示错误 */ }
// 退出按钮：void sso.logout().catch((error) => { /* 展示错误 */ });
```

`ensureAuthenticated()` 先查询，有会话时返回用户；未登录时发起整页导航并返回未登录结果，**不等待认证中心完成**。回跳后重新加载页面再查询会话。公共页面可只调用 `getSession()`。

失败后不要自动循环调用；用户主动 `login()` 可重试。`login()` 同步抛错，`logout()` 返回 Promise，按钮代码必须捕获。组件中初始化当前状态并取消订阅，完整按钮及反馈见仓库[示例源码](https://github.com/haigeerlab/sso-browser-sdk/tree/main/apps/docs/examples)。

## 后端最小接口

| 示例路径 | 契约 |
| --- | --- |
| `GET /sso/session` | 已登录返回 `200 {"authenticated":true,"user":{...}}`；未登录返回普通 401 或 `200 {"authenticated":false}`；故障不能伪装访客。返回 JSON，禁止缓存，不导航认证中心。 |
| `GET /sso/{protocol}/start?returnTo=...` | 校验本应用允许回跳；后端启动协议并处理回调，确认身份后设置本域 HttpOnly Cookie，导航回安全页面。 |
| `POST /sso/logout` | 按要求验证 CSRF，撤销本域会话，返回成功 2xx；不向 fetch 返回认证中心重定向。 |

后端负责协议回调、安全 Cookie、请求关联、防重放及每个业务 API 的权限。SDK 不主动解析 `ssoError`，由业务页与后端约定白名单反馈。本域退出不撤销认证中心、其他业务宿主或系统域凭据。

会话字段不同用 `session.map` 映射，回跳参数不同用 `returnToParam`，CSRF 头用 `logout.headers`。这些配置不代替后端认证校验。

## 协议入口

| 子路径 / 函数 | 后端责任 | 状态 |
| --- | --- | --- |
| `/oidc` · `oidcAdapter` | 授权码 + PKCE、state/nonce、可信令牌校验 | 首版本机验证 |
| `/cas` · `casAdapter` | 精确 service、真实验票、过期与重放拒绝 | 首版本机验证 |
| `/saml` · `samlAdapter` | SP 发起 Redirect/POST、ACS 验签/关联/防重放 | 首版本机验证 |
| `/wsfed` · `wsFedAdapter` | Web Passive、realm/reply/wctx、签名令牌验证 | 实验，本机 SAML 1.1 证据 |
| `/negotiate` · `negotiateAdapter` | 专用挑战入口、服务端确认 Kerberos、域与浏览器策略 | 实验，企业域待验收 |

替换适配器导入与 `loginEndpoint` 即可选择协议，session/logout 沿用后端契约。根入口不导出适配器。登录入口必须是同源路径，不能指向认证中心外域 URL。

## 已验证边界

Vue 3.4.0、React/React DOM 19.3.0、Vite 5.0.0 的打包隔离消费者已测试。SDK 不依赖这些框架。Webpack、全局单点登出、完整 SSR、跨源会话与全部浏览器版本未验证。详见[支持矩阵](https://github.com/haigeerlab/sso-browser-sdk/blob/main/apps/docs/content/reference/support.md)。

## 许可证

[MIT](LICENSE)。
