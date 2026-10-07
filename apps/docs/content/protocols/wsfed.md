# WS-Federation（实验）

已完成本机独立 STS/RP 与浏览器流程验证，仍是扩展实验能力，不属于首版正式支持范围。

## 后端准备与流程

STS 登记 RP 的 realm 和精确 reply 地址，提供 Web Passive 入口、签名证书与明确令牌类型。当前参考实现锁定签名 SAML 1.1，不代表其他令牌类型全部验证。

```text
页面 → /sso/wsfed/start
     → STS?wa=wsignin1.0&wtrealm=...&wreply=...&wctx=...
RP callback ← wa + wresult + wctx（POST）
验证签名/身份/关联/重放 → 本域 Cookie → 原页面
```

RP 固定可信 issuer、签名证书、realm/reply，保存一次性 wctx；验证已签名令牌的受众、签发者、时效和断言重放。wctx 用服务端记录关联，不能依赖跨站 POST 的宿主 Cookie。

## 前端配置

从 `/wsfed` 导入 `wsFedAdapter`（注意大小写），用作客户端 adapter：

<<< ../../examples/shared/protocols.ts#wsfed

会话与登出配置见[共享客户端](../guide/quick-start#初始化一个客户端)。

## Demo 与边界

运行方法见[实验协议 Demo](../demos/experimental)。参考库及旧 XML 依赖存在已知审计告警，只作为本机测试；不推荐直接部署参考 STS/RP 为生产服务。

失败时核对 realm/reply、可信证书、issuer、令牌类型、跨站 POST、wctx 和重放存储。生产还需验收 HTTPS、证书轮换、多实例和代理地址。`wresultptr`、主动请求者、IdP 发起登录和全局退出未覆盖。

证据：[WS-Fed 验证记录](https://github.com/haigeerlab/sso-browser-sdk/blob/main/tasks/wsfed-integration/verification.md)；标准资料：[WS-Federation 1.2](https://docs.oasis-open.org/wsfed/federation/v1.2/ws-federation.html)。
