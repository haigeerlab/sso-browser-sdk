# 登录与会话生命周期

## 查询与自动登录是两件事

`getSession()` 只查询后端，不导航。适用于公共页面、主动刷新状态和退出后的检查。

`ensureAuthenticated()` 先查询：有会话时返回已登录结果并清理自动登录标记；未登录时设置标记并导航到登录入口，返回未登录结果。Promise **不等待整次认证跳转完成**。回调后重新加载的页面再次查询，才得到新会话。

## 状态

```text
unknown → checking → authenticated
                   → unauthenticated → 导航登录
                   → error
```

401 或 `200 {authenticated:false}` 是未登录。网络失败、非 401 的非成功响应、JSON/映射失败是错误，不能当作访客继续跳转。UI 应显示这些区别。

`onAuthChange` 只通知后续变化，不立即回放当前状态。订阅时用 `getState()` 初始化；组件卸载时取消订阅。

## 一次自动导航与重试

SDK 用 `sessionStorage` 和会话端点生成防循环标记。回到页面仍没有会话时，第二次自动导航被阻止，状态变为 `error`。用户可以主动 `login()` 再试一次；手动登录也设置标记，因此取消后不会自动再跳。

浏览器禁止访问 sessionStorage 时，自动登录会报错。不要通过清除标记循环重试；检查接口和 Cookie，然后提供手动登录按钮。不同客户端实例没有共享的并发 Promise，建议每个应用使用一个共享实例。

同一实例的并发 `ensureAuthenticated()` 共用一次检查和导航。直接并发 `getSession()` 时较旧请求可能抛出 `Session check superseded`，避免对同一客户端无意义地重复查询。

## 失败回调

后端可以回到安全页面并携带约定的错误码，例如 `?ssoError=saml_validation_failed`。SDK 不解析这个参数；[完整示例](../frameworks/typescript)由业务页用白名单文案展示，不直接渲染后端字符串。

`login()` 的路径/导航错误同步抛出，`logout()` 的失败 Promise 拒绝；这两种失败不会自动把状态设为 `error`。业务代码必须捕获并显示。

## 本域退出

`logout()` 向后端 POST，成功且未发生 fetch 重定向后设为未登录。失败时保留既有状态；后端重定向被拒绝，避免把认证中心 HTML 当作退出成功。

退出后不要在状态变为 `unauthenticated` 的订阅中自动执行 `ensureAuthenticated()`，否则中心或系统凭据仍有效时可能立即重新登录。示例只在受保护页面首次挂载时自动检查。

本域退出只撤销当前宿主会话，不撤销认证中心、其他宿主或域凭据。全局单点登出需后端另行实现。
