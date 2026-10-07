# CAS 后端会话接入

首版本机验证范围：浏览器导航至宿主入口，后端使用 Service Ticket 验票并创建本域会话。SDK 不接收或验证 ticket。

## 后端准备

CAS 中心提供 login 与服务票据验证端点，并允许业务后端的精确 service URL。前后端不能各自拼不同的 service：签发与验票使用同一个值。本机参考环境把一次性 state 放在 service 查询参数中，用于宿主回调关联。

```text
页面 → /sso/cas/start → CAS /login?service=<已登记回调>
宿主 callback ← ticket
宿主 → /serviceValidate?ticket=...&service=<同一值>
认证成功 → 本域 Cookie → 原页面 → /sso/session
```

宿主只接受可信中心返回的成功验票结果，检查 XML 的协议结构和身份字段；错误 service、过期票据、重放或无法关联的回调均不能建立会话。消费一次性关联记录，回调后从页面地址移除 ticket。

## 前端配置

从 `/cas` 导入 `casAdapter`，将其赋给 `createSSO` 的 adapter：

<<< ../../examples/shared/protocols.ts#cas

会话与登出配置见[共享客户端](../guide/quick-start#初始化一个客户端)，不在前端配置 CAS 中心密钥或验票地址。

## Demo 与接口

[CAS Demo](../demos/cas) 使用 Django CAS 中心和 Node 宿主后端。回调为 `/<app>/auth/cas/callback`，验票代码见 [host.mjs](https://github.com/haigeerlab/sso-browser-sdk/blob/main/services/cas-reference/host.mjs)。

## 失败定位

核对 service 编码、路径、查询参数和反向代理外部地址；检查中心登记规则、票据有效期和一次性消费。中心错误密码通常停留登录页；取消回业务页不是所有 CAS 产品都统一提供的能力，需实际产品约定。

## 证据与边界

本机验证双宿主复用中心登录、错误 service、过期票据、重放、错误密码与本域退出，见 [CAS 验证记录](https://github.com/haigeerlab/sso-browser-sdk/blob/main/tasks/cas-integration/verification.md)。不包含代理票据、renew/gateway 或全局单点登出。独立实现为 Django CAS，不是 Apereo CAS 本体。

标准依据：[CAS 协议](https://apereo.github.io/cas/7.3.x/protocol/CAS-Protocol-Specification.html)。
