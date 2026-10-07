# Cookie、代理与路径

## 推荐部署拓扑

浏览器页面与业务认证接口同源，可以通过反向代理把 `/sso/*` 转发到业务后端；认证中心使用自己的来源。跨域协议导航可以发生，但会话 fetch 不需要跨域。

开发服务器也可以用代理访问后端。代理配置只是部署方案，必须保证中心登记的 callback/ACS/reply 与浏览器最终访问的外部 URL 一致，不能只代理会话接口而让回调落在不同来源。

## Cookie

生产使用 HTTPS 与 `Secure`、`HttpOnly`，按站点拓扑选择 `SameSite`、Domain、Path。A/B 不应无意共用会话 Cookie；会话标识不放在 JavaScript 存储。SDK fetch 默认 `credentials:'same-origin'`。

SAML/WS-Fed 跨站 POST 使用服务端一次性关联记录，不假定 Lax Cookie 被带到 ACS。设置 `SameSite=None` 也不能代替签名、请求关联和 CSRF 防护。

退出时后端撤销会话并清除匹配的 Cookie Path/Domain。若 Cookie 限定 `/app-a/`，会话接口必须在它的有效路径范围内。

## 路径和回跳

应用部署在 `/business/` 时，前端资源 base、路由和后端回跳允许范围需一致。SDK 的登录入口是来源根路径，不会自动附加应用 base。

例如会话接口为 `/business/auth/session`，登录入口为 `/business/auth/oidc/start`，回跳 `/business/orders`。适配器参数可配置为后端要求的名称。

不要把登录入口设置成 SPA 的普通页面或 hash 路由。SPA 路由守卫要保留浏览器整页导航；协议回调由后端处理后再回到业务路由。

## 多实例和代理

后端处理 TLS 终止后的外部地址，配置可信代理头；共享 pending state、nonce/PKCE、RelayState/wctx、重放和业务会话存储；一次性消费需要原子操作。参考环境内存 Map 只适用于单进程本机测试。

业务 API 对每个请求做权限检查。SDK 显示“已登录”只描述最近一次查询，并不会拦截所有请求、刷新 token 或代替权限控制。

## 文档站构建

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

静态产物位于 `apps/docs/.vitepress/dist`。部署在仓库子路径时构建：

```bash
DOCS_BASE=/sso-browser-sdk/ npm run docs:build
npm run docs:preview
```

此时访问预览服务器的 `/sso-browser-sdk/`。构建会检查死链，不通过 `ignoreDeadLinks` 隐藏错误。本轮只生成本地静态站，没有启用线上发布。
