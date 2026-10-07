# SAML 2.0 后端会话接入

首版本机验证范围：SP 发起 HTTP-Redirect AuthnRequest，IdP POST 响应至宿主 ACS。SDK 不处理 SAML XML、证书或 Assertion。

## 后端准备

双方交换 IdP/SP 元数据，登记 SP Entity ID、精确 ACS URL、IdP SSO 地址和可信签名证书，明确绑定方式和证书轮换。每个宿主有自己的 SP 标识及 ACS。

```text
页面 → /sso/saml/start → IdP（Redirect AuthnRequest）
宿主 ACS ← SAMLResponse + RelayState（跨站 POST）
验签/关联/防重放 → 本域 Cookie → 原页面 → /sso/session
```

宿主以固定信任的 IdP 证书验签，校验 issuer、audience、Destination、Recipient、时间与 InResponseTo，并检查断言重放。RelayState 对应服务端一次性待处理记录，不是可以直接信任的回跳 URL。

跨站 POST 不保证携带 `SameSite=Lax` 宿主 Cookie，因此不要仅用这个 Cookie 查找请求关联。多实例使用共享、可原子消费的关联/重放存储。

## 前端配置

从 `/saml` 导入 `samlAdapter`，用作 `createSSO` 的 adapter：

<<< ../../examples/shared/protocols.ts#saml

会话与登出配置见[共享客户端](../guide/quick-start#初始化一个客户端)。协议 ACS 不指向 Vue/React 页面，它必须由业务后端接收 POST。

## Demo 与接口

[SAML Demo](../demos/saml) 使用 `samlify` IdP 和独立的 `node-saml` SP，ACS 为 `/<app>/auth/saml/acs`。服务会生成临时测试证书，不需要把测试证书登记到生产 IdP。

## 失败定位

检查 Entity ID、ACS URL、IdP 证书和签名策略；代理下是否生成正确外部地址；时钟、请求 ID 和重放存储是否正确；不要为修复失败关闭签名、受众或关联校验。失败后端回到安全业务页或拒绝请求，不创建会话。

## 证据与边界

独立参考实现验证签名篡改、错误受众/接收方、时间、请求关联、重放和双宿主流程，见 [SAML 验证记录](https://github.com/haigeerlab/sso-browser-sdk/blob/main/tasks/saml-integration/verification.md)。生产 IdP、全局 SLO、IdP 发起登录及其他绑定方式未作支持承诺。

标准依据：[SAML Profiles](https://docs.oasis-open.org/security/saml/v2.0/saml-profiles-2.0-os.pdf)、[SAML Bindings](https://docs.oasis-open.org/security/saml/v2.0/saml-bindings-2.0-os.pdf)。
