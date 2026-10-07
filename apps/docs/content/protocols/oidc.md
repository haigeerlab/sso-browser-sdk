# OIDC 后端会话接入

首版本机验证范围：授权码 + PKCE，由宿主后端使用 OIDC 客户端库处理。SDK 不保存 Access Token、ID Token、客户端密钥或授权码。

## 后端准备

认证中心提供 issuer、Discovery/JWKS、授权/令牌端点；为每个业务宿主登记独立 client ID、精确 redirect URI、响应类型与客户端认证方式。公开/机密客户端及密钥策略由后端和认证中心共同确定。

宿主保存一次性的 state、nonce、PKCE verifier 和回跳；回调校验 state，用匹配的 verifier/redirect URI 换码，校验身份令牌的签名、issuer、audience 与时效，再把可信身份映射为本域用户。协议处理应交给合适的后端库，不能只解码 JWT。

```text
页面 → /sso/oidc/start → issuer 的 authorization endpoint
后端 callback ← code + state
后端 → token endpoint → 校验身份 → 本域 Cookie → 原页面
页面 → /sso/session
```

## 前端配置

在[共享客户端](../guide/quick-start#初始化一个客户端)中使用 `/oidc` 导出的 `oidcAdapter`：

<<< ../../examples/shared/protocols.ts#oidc

此片段用作 `createSSO({ session, logout, adapter: oidc })` 的 `adapter`。`session` 与 `logout` 仍是业务后端路径。

自定义回跳参数：`oidcAdapter({ loginEndpoint: '/auth/oidc/login', returnToParam: 'next' })`。前后端参数名必须一致；现有查询参数会保留，回跳参数会写入/替换。

## Demo 与接口

[OIDC Demo](../demos/oidc) 使用独立 `oidc-provider` 与 `openid-client`，App A/B 回调分别是 `/<app>/auth/oidc/callback`。本机例子没有配置真实企业 issuer，也没有 production 的持久化中心会话。

## 失败定位

检查客户端登记的 redirect URI 是否与后端实际请求一致；代理下外部 HTTPS 地址是否正确；state/verifier 是否跨实例共享且一次性消费；回调设置的 Cookie 是否能被随后会话查询发送。取消登录不能创建业务会话，用户应能手动重试。

## 证据与边界

已有授权码 + PKCE、双宿主中心登录复用、中心会话过期与取消的本机互操作测试，见 [OIDC 验证记录](https://github.com/haigeerlab/sso-browser-sdk/blob/main/tasks/oidc-integration/verification.md)。生产 issuer、密钥轮换、共享存储和业务权限需单独验收。

标准依据：[OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html)、[PKCE](https://www.rfc-editor.org/rfc/rfc7636)。
