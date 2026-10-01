# saml-integration：宿主后端 SAML 2.0 登录

## 目标

业务应用通过同一浏览器 SDK 的 `/saml` 入口，把登录导航交给已有宿主后端 Service Provider（SP）。宿主 SP 与统一认证中心 Identity Provider（IdP）完成 SAML 2.0 Web Browser SSO，ACS 验证响应后建立本域会话；第二宿主可借 IdP 中心会话完成自己的登录。首版仅覆盖 SP 发起、HTTP-Redirect 发送 AuthnRequest、HTTP-POST 返回 Response 的组合。

## 三方职责

| 参与方 | 必须提供或完成 |
| --- | --- |
| 认证中心 / IdP | 登记每个 SP 的实体标识与精确 ACS 地址，提供可信元数据和签名证书、SSO 端点、中心会话及经签名的 SAML 响应；证书轮换与会话策略由 IdP 管理。 |
| 宿主后端 / SP | 同源登录入口、ACS、会话查询与本域登出；生成请求 ID 和安全的 RelayState/回跳关联；验证 IdP 签名、响应状态、签发者、受众、接收方/目标地址、`InResponseTo`、时间条件及断言重放，再创建 HttpOnly 本域会话。业务 API 独立验证会话。 |
| 前端 SDK | 使用 `samlAdapter` 跳转到同源宿主登录入口并传同源回跳页面；ACS 返回业务页面后查询本域会话、更新状态、阻止自动跳转循环；调用宿主本域登出。SDK 不接收或解析 `SAMLResponse`，不管理 IdP 证书。 |

## 前端配置与交互

1. 业务方导入 `/saml` 的 `samlAdapter`，配置同源 `loginEndpoint`；默认回跳参数 `returnTo` 可通过 `returnToParam` 适配。`createSSO` 的会话和登出接口沿用公共契约。
2. `ensureAuthenticated` 查询宿主会话。明确未登录后，SDK 顶层导航到宿主 SP 登录入口。SP 验证回跳目标、保存请求关联，使用 HTTP-Redirect Binding 将 AuthnRequest 发往 IdP。
3. IdP 按自身 Cookie 判断是否要求交互；成功后使用 HTTP-POST Binding 将 `SAMLResponse` 与 `RelayState` 提交到该宿主 ACS。ACS 完成全部协议校验、建立本域 Cookie，再以普通导航返回原业务页面。SDK 重载后查询会话。
4. App B 由自己的 SP 重新发起请求并验证返回断言，借同一 IdP 会话免去再次输入凭据；A/B 本域会话相互独立。`logout()` 默认只注销当前宿主，不保证 IdP 或其他宿主退出。

流程与后端边界见 [五协议调研中的 SAML 图](../docs/SSO_SDK_方案调研.md)。浏览器 SSO 和 Redirect/POST 绑定依据 [OASIS SAML 2.0 Profiles](https://docs.oasis-open.org/security/saml/v2.0/saml-profiles-2.0-os.pdf) 与 [Bindings](https://docs.oasis-open.org/security/saml/v2.0/saml-bindings-2.0-os.pdf)。

## 失败与安全边界

- 宿主必须用可信元数据或受控配置固定 IdP 实体标识、SSO 地址与验签证书；不能从浏览器提交的 XML 自行选择证书或接受未验证断言。是否签名 Response、Assertion 或两者由双方元数据和策略约定，但被接受的身份声明必须完成可信签名验证。
- 错误签名、签发者、受众、ACS/Recipient/Destination、请求关联、时间条件、状态码或重复断言不得建立会话；宿主应安全地向业务页面返回可见失败，并让 SDK 停止自动重试。未知或恶意 ACS 请求可直接拒绝。
- 跨站 IdP→ACS 的 POST 可能不携带 `SameSite=Lax` Cookie。SP 的请求关联必须在这种条件下仍可安全完成，例如使用服务端待处理记录和不可猜测、一次性 RelayState；不能假设浏览器会在跨站 POST 中送回原会话 Cookie。
- SDK 与 SP 都要限制回跳目标。业务前端不保存 SAML 断言，ACS 处理完成后不把 `SAMLResponse` 放入页面 URL 或前端状态。
- IdP 发起的无请求响应、Artifact Binding、ECP、SAML 单点登出和跨 SP 全局登出不属于首版；若需支持，单独定义后端契约与测试。
- 当前简版夹具只做字符串比对且响应未签名，不能作为真实 SAML 安全校验或生产 SP 实现。

## 验收标准

- SDK 单元测试验证 `/saml` 子路径、同源登录入口、可配置回跳参数及公共防循环行为。
- 简版双宿主测试验证 Redirect 请求、POST 到 ACS、RelayState、中心会话复用、本域会话，以及非法回跳、过期、重放和取消/失败反馈；只作为交互链路证据。
- 在独立 SAML IdP/SP 实现上验证真实签名和元数据，覆盖双宿主登录、签名篡改、受众或接收方不符、过期、请求关联失败及重放；记录产品/库版本、证书和开发配置、命令与结果。不能以简版夹具代替真实互操作。
- 在真实浏览器验证首次登录、第二宿主复用、本域登出后恢复，以及失败后业务页可见状态。Vue/React 与 Vite 的完整版本兼容结论归 `host-compatibility`。
- 生产 IdP、真实业务 SP 和全局单点登出需在发布准备中单独验收，不由本机参考实现推断通过。

## 评审记录

- [x] 用户于 2026-10-01 回复“继续”，确认首版采用 SP 发起的 Redirect 请求 + POST 响应、后端 ACS 验签和本域会话模式，以及上述验收范围。
