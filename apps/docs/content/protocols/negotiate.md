# HTTP Negotiate（实验）

已有受控本地真实 Kerberos、HTTP/HTTPS 与 Firefox SDK 互操作记录；企业域、受管浏览器、实际代理和业务后端仍未验收。

## 后端与环境前提

域/KDC、客户端可用凭据、两个不同 HTTPS FQDN 与对应 `HTTP/<FQDN>` SPN、服务端 GSSAPI/SSPI 验证模块、可信用户映射，以及允许集成认证的受管浏览器策略。

浏览器和系统完成协商，前端 JS 不读票据，也不自行设置 Authorization。服务端必须确认实际机制；`Negotiate` 前缀本身不能证明 Kerberos，可能回退到 NTLM。

## 分开两个入口

```http
GET /sso/session
→ 401，且没有 WWW-Authenticate

GET /sso/negotiate/start?returnTo=%2F
→ 401 WWW-Authenticate: Negotiate
→ 浏览器/系统协商
→ 服务端验证 Kerberos 后设置本域 Cookie 并回跳
```

普通会话查询不能发起挑战，避免后台 fetch 弹系统认证提示。挑战失败不建立会话；后端应提供能停止协商并解释失败的路径。

## 前端配置

从 `/negotiate` 导入 `negotiateAdapter`，用作客户端 adapter：

<<< ../../examples/shared/protocols.ts#negotiate

会话与登出配置见[共享客户端](../guide/quick-start#初始化一个客户端)。本域退出不删除系统域凭据，再次访问可能自动建立新会话。

## 验证层级

| 层级 | 能证明什么 |
| --- | --- |
| 适配器与脚本化 HTTP 夹具 | 导航、挑战接口约定、状态、防循环；不证明 Kerberos |
| 本地真实 Kerberos 实验 | 临时测试域的真实验票、双宿主、HTTP/HTTPS 和可选 Firefox |
| 企业域验收 | 实际 SPN、浏览器策略、证书链、代理、身份映射与负例，仍待完成 |

运行本地实验见[实验 Demo](../demos/experimental)。真实环境使用[域验收模板](https://github.com/haigeerlab/sso-browser-sdk/blob/main/tasks/negotiate-integration/domain-validation.md)和匿名预检；匿名预检通过仍为 `kerberosVerified:false`。

## 失败定位

依次检查 DNS/SPN、时钟与凭据、浏览器站点策略、系统认证提供者、服务运行身份和代理头/连接亲和性；记录服务端实际机制，不保存票据或 Cookie。NTLM 回退不计入首批 Kerberos 通过。

证据：[Negotiate 验证记录](https://github.com/haigeerlab/sso-browser-sdk/blob/main/tasks/negotiate-integration/verification.md)；协议资料：[HTTP Negotiate](https://www.rfc-editor.org/rfc/rfc4559)。
