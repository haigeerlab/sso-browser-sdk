# 方法、状态与适配器

## 公共方法

| 方法 | 返回值 | 说明与异常 |
| --- | --- | --- |
| `getState()` | `AuthState<User>` | 当前快照，不请求后端 |
| `getSession()` | `Promise<Session<User>>` | 查询会话；401 为未登录；网络/响应/映射错误拒绝并进入 error |
| `ensureAuthenticated({returnTo?})` | `Promise<Session<User>>` | 查询并在需要时导航一次；导航不等待认证结束；防循环或无 storage 时拒绝 |
| `login({returnTo?})` | `void` | 用户主动导航重试；外域回跳、适配器或导航错误同步抛出 |
| `logout()` | `Promise<void>` | POST 本域退出；未配置、响应非成功或重定向时拒绝 |
| `onAuthChange(listener)` | `() => void` | 订阅之后的变化；返回取消函数，不立即回放 |

`returnTo` 可以是当前来源的绝对地址或相对路径，SDK 转成 pathname + search + hash。无参数使用当前页面。后端仍需限制允许路径。

`ensureAuthenticated` 的并发去重针对同一个实例；重叠调用采用第一次调用的 `returnTo`。直接重复查询可能使较旧检查被取代。`logout` 成功后，先前开始的会话查询不能恢复旧登录状态。

## 状态类型

```ts
type Session<User> =
  | { status: 'authenticated'; user: User }
  | { status: 'unauthenticated' };

type AuthState<User> =
  | { status: 'unknown' }
  | { status: 'checking' }
  | Session<User>
  | { status: 'error'; error: unknown };
```

错误类型是 `unknown`，SDK 没有导出的错误码枚举。不要把内部英文消息当作稳定业务错误协议。未登录返回的是 `Session`，不是 `null`，也没有 `token` 属性。

## 协议入口

| 子路径 | 导出函数 | 配置类型 | 当前范围 |
| --- | --- | --- | --- |
| `/oidc` | `oidcAdapter` | `OIDCAdapterConfig` | 首版本机范围 |
| `/cas` | `casAdapter` | `CASAdapterConfig` | 首版本机范围 |
| `/saml` | `samlAdapter` | `SAMLAdapterConfig` | 首版本机范围 |
| `/wsfed` | `wsFedAdapter` | `WSFedAdapterConfig` | 扩展实验 |
| `/negotiate` | `negotiateAdapter` | `NegotiateAdapterConfig` | 扩展实验 |

这些适配器复用同源后端跳转逻辑，协议安全校验发生在后端。根入口不重新导出五个适配器。当前包是 ESM `import` 入口，不提供 CommonJS require 条件。

流程说明见[生命周期](../guide/lifecycle)，错误处理见[排错](../deployment/troubleshooting)。
