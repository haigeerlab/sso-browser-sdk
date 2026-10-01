# SAML 2.0 本机互操作参考服务

此私有工作区使用 `samlify` 2.13.1 作为 IdP，使用独立的 `@node-saml/node-saml` 5.1.0 作为两个宿主 SP。浏览器 SDK 只导航至同源 SP 登录入口和查询本域会话，不处理 SAML XML。参考实现与生产认证中心、生产宿主后端分开验收。

## 环境与复现

- Node.js 22、可执行的 `openssl`、Java/JDK（XSD 验证器安装时运行 `javac`）。本次本机环境为 Node 22.22.0、OpenSSL 4.0.2、Java 18.0.1.1。
- 根目录执行 `npm install`，再运行 `npm run build:hosts` 和 `node --test tests/interop/saml-reference.test.mjs`。若安装时用了 `--ignore-scripts`，需补运行 `npm rebuild @authenio/xsd-schema-validator`，否则解析 AuthnRequest 时 XSD 校验器未编译，会返回 `ERR_INVALID_XML`。
- 浏览器实测：根目录执行 `SSO_SAML_REFERENCE_PORT=43977 npm run start --workspace=@sso-test/saml-reference`，访问 `http://127.0.0.1:43977/app-a/?protocol=saml`。App A 为 Vue，App B 为 React；IdP 在 `localhost`，宿主在 `127.0.0.1`。测试账号 `demo` / `demo`。

启动时用 OpenSSL 在系统临时目录生成一天有效的自签名 IdP 私钥和证书，进程退出时删除。IdP 元数据在 `/saml/metadata`，各 SP 元数据在 `/<app>/auth/saml/metadata`。私钥、固定测试账号、HTTP、内存会话与两个主机名只供本机互操作，不适用于生产。

## 交互与安全边界

两个 SP 各自登记实体标识和精确 ACS。`node-saml` 生成 HTTP-Redirect AuthnRequest；IdP 用 XSD 校验后解析，生成经可信证书签名的 HTTP-POST Response 与 Assertion。SP 在 ACS 使用固定 IdP 证书验证两层签名、签发者、受众、响应与断言时效及 `InResponseTo`，再显式校验 `Destination`、`Recipient` 和请求 ID 后创建本域 HttpOnly 会话。宿主通过服务端一次性 RelayState 查询待处理记录；跨站 POST 不依赖宿主的 `SameSite=Lax` Cookie。错误响应返回业务页 `ssoError`，不创建会话；再次发起时清理旧错误参数。

本机负例使用测试专属场景构造有效签名但错误的受众、ACS 地址或请求 ID；其他用例覆盖签名篡改、断言过期、回放、非法回跳与本域登出恢复。`node-saml` 默认缓存仅适合单进程测试；生产多实例 SP 必须使用共享的、可原子消费的请求关联和重放存储。生产系统还要落实证书轮换、HTTPS、Cookie/CSRF 策略、会话吊销、审计及真实 IdP 元数据管理。

实现依据：[OASIS SAML Profiles](https://docs.oasis-open.org/security/saml/v2.0/saml-profiles-2.0-os.pdf)、[OASIS Bindings](https://docs.oasis-open.org/security/saml/v2.0/saml-bindings-2.0-os.pdf)、[samlify](https://github.com/tngan/samlify) 与 [Node-SAML](https://github.com/node-saml/node-saml)。
