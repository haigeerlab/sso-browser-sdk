# Negotiate 本地 HTTP 夹具

此服务仅供 `tests/integration/negotiate-fixture.test.mjs` 在本机注入脚本化验证器，检查挑战头、多轮响应、失败反馈以及 App A/B 的独立会话。A/B 在同一回环来源的不同路径下模拟，**不能证明跨域 Cookie 隔离**。它**不解析、不验证 Kerberos 或 NTLM 令牌**，也不代表真实域单点登录或生产后端。服务只监听本机回环地址；HTTP 和无 `Secure` 的测试 Cookie 也仅适用于此夹具。

真实协议验收须按 [模块 Spec](../../spec/negotiate-integration.md) 在受管浏览器、Kerberos 域及真实服务端认证模块上完成，并由服务端确认协商机制为 Kerberos。
