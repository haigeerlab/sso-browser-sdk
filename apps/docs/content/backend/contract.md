# 通用 HTTP 契约

下面是业务接口示例名称，可按现有后端配置。协议回调由后端接收，前端不注册协议回调处理器。

| 接口 | 方法 | 后端行为 |
| --- | --- | --- |
| `/sso/session` | GET | 查询当前业务会话，不重定向至登录页 |
| `/sso/{protocol}/start` | GET | 校验回跳，保存请求关联，启动认证 |
| `/sso/{protocol}/callback` | 按协议 | 校验认证结果，建立会话，回到安全业务页 |
| `/sso/logout` | POST | 验证 CSRF（若要求），撤销本域会话，返回 2xx |

## 查询会话

```http
GET /sso/session HTTP/1.1
Accept: application/json
Cookie: session=<浏览器发送的本域会话>
```

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{"authenticated":true,"user":{"id":"example-user"}}
```

未登录可以是无正文的 `401`，或 `200 {"authenticated":false}`。不能把数据库故障、认证服务故障或 403 权限错误统一包装成 401。SDK 会把非 401 的非成功响应当成错误。

字段不同可以用 `session.map(payload)` 映射，必须区分已登录和未登录；见[配置 API](../api/config)。会话接口不应重定向到认证中心，不应返回 HTML。Negotiate 的普通会话查询也不能发送 `WWW-Authenticate` 挑战。

## 登录与回调

```http
GET /sso/oidc/start?returnTo=%2Forders%3Ftab%3Dopen HTTP/1.1
```

OIDC/CAS/SAML/WS-Fed 的宿主后端保存一次性关联信息，再跳转到认证中心。认证通过后验证协议结果并创建随机本域会话：

```http
HTTP/1.1 302 Found
Set-Cookie: session=<随机标识>; Path=/; Secure; HttpOnly; SameSite=Lax
Location: /orders?tab=open
Cache-Control: no-store
```

Cookie 示例需要按部署拓扑调整。SAML/WS-Fed 的跨站 POST 回调不能假定携带 `SameSite=Lax` Cookie；以服务端一次性 RelayState/wctx 关联请求。

后端必须独立拒绝外部来源、`//host`、反斜杠/编码变体及不在本应用允许范围的回跳。SDK 的同源检查不能替代后端校验。URL fragment 不会发送给 HTTP 服务端，SDK 会把它编码进回跳参数，后端应妥善保留。

失败回调不创建会话；可回到安全业务页携带约定错误码，例如 `ssoError=oidc_login_canceled`。这是应用约定，不是协议统一标准，也不是 SDK 自动处理的字段。未知或无法关联的回调可以直接拒绝，不能未经校验使用请求中的回跳地址。

## 本域退出

```http
POST /sso/logout HTTP/1.1
Cookie: session=<浏览器发送的本域会话>
X-CSRF-Token: <由业务后端签发并校验的令牌>
```

```http
HTTP/1.1 204 No Content
Set-Cookie: session=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax
Cache-Control: no-store
```

撤销服务端会话，清除与创建时一致的 Cookie 域/路径；不要仅删除浏览器 Cookie。若采用 CSRF 令牌，用 `logout.headers` 携带后端规定的头。接口返回成功状态，不向 fetch 返回跨站重定向。

## 对照仓库参考服务

| 业务契约示例 | App A 实际 Demo 路径 | App B 实际 Demo 路径 |
| --- | --- | --- |
| 会话查询 | `/app-a/auth/session` | `/app-b/auth/session` |
| 登录入口 | `/app-a/auth/{protocol}/start` | `/app-b/auth/{protocol}/start` |
| 登出 | `/app-a/auth/logout` | `/app-b/auth/logout` |
| OIDC/CAS/WS-Fed 回调 | `/app-a/auth/{protocol}/callback` | `/app-b/auth/{protocol}/callback` |
| SAML ACS | `/app-a/auth/saml/acs` | `/app-b/auth/saml/acs` |

文档示例启动器使用上述真实路径，原生 TypeScript 示例与 Vue 示例都可以作为 App A。业务项目使用自己的路径；不要把通用配置原样连到不同路径的 Demo。

协议细节分别见 [OIDC](../protocols/oidc)、[CAS](../protocols/cas)、[SAML](../protocols/saml)。
