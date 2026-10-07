# 回归测试边界

在仓库根目录运行 `npm test`，依次执行：

1. `packages/browser-sdk/test`：公共会话状态、跳转、登出和五个协议入口的单元测试。
2. `apps/compat`：Vue 3.4.0 与 React 示例的 Vite 5.0.0 构建。
3. `tests/compat`：同一个 `npm pack` tarball 安装到两个隔离消费者，验证根入口和 OIDC/CAS/SAML 子路径、类型、Vite 开发与构建；另用简版后端验证会话映射与自定义回跳参数。
4. `tests/integration`：启动 `services/protocol-fixture`，验证示例资源、双宿主登录、中心会话复用、本域会话、回调重放、非法回跳、取消登录及本域登出。
5. `tests/interop`：启动 `services/oidc-reference`、`services/cas-reference`、`services/saml-reference` 和 `services/wsfed-reference`。OIDC 验证授权码 + PKCE；CAS 验证真实验票；SAML 使用独立 IdP/SP 库验证 Redirect/POST；WS-Fed 使用独立 STS/RP 库验证 Web Passive POST、SAML 1.1 签名、受众、签发者、时效、重放与中心会话。

隔离消费者通过 npm registry 获取 Vue、React、Vite 和 TypeScript，首次运行需可访问 registry 或具备缓存。若要用从 tarball 构建的页面做浏览器联调，可设置 `SSO_PACKED_BUILD_DIR=/tmp/sso-packed-build npm run test:compat`，然后设置 `SSO_COMPAT_BUILD_ROOT=/tmp/sso-packed-build` 启动简版夹具；该目录只保存临时构建产物。

新协议的简版后端夹具放在 `services/`，对应的交互测试放在 `tests/integration/`；真实提供方的互操作测试放在 `tests/interop/`。两类测试文件名以 `.test.mjs` 结尾即可进入根目录回归。真实协议测试记录提供方版本、配置、浏览器和结果，不能以简版夹具代替。

当前有 OIDC、CAS、SAML 与 WS-Fed 形态的**简版交互夹具**。CAS 覆盖固定 `service`、一次性/过期票据；SAML 覆盖 Redirect/POST、RelayState 与失败反馈；WS-Fed 覆盖固定 realm/reply、一次性 `wctx`、POST 回调、中心会话、过期/重放和取消。简版夹具不验签。独立参考环境分别使用 OIDC `oidc-provider` 9.12.2 + `openid-client` 6.8.8、CAS `django-cas-server` 3.1.0、SAML `samlify` 2.13.1 + `@node-saml/node-saml` 5.1.0、WS-Fed `wsfed` 8.0.0 + `passport-wsfed-saml2` 4.6.4。本地 HTTP 与测试账号配置不代表生产认证中心。Negotiate 另有 HTTP 夹具、匿名预检与[可选真实本地 Kerberos 实验](interop/kerberos-lab/README.md)，企业域验收仍未完成。

开发者文档示例另用 `npm run docs:check` 验证链接、tarball 安装与 TS/Vue/React 类型和构建；`npm run docs:examples` 加载页面引用的源码与独立参考后端联调。详见[文档 Demo 总览](../apps/docs/content/demos/overview.md)。

首次运行 CAS 互操作前，按 [`services/cas-reference/README.md`](../services/cas-reference/README.md) 创建隔离 Python 环境。
首次运行 SAML 互操作前，按 [`services/saml-reference/README.md`](../services/saml-reference/README.md) 确认 OpenSSL、JDK 和 XSD 验证器安装步骤。
WS-Fed 参考环境及其测试依赖限制见 [`services/wsfed-reference/README.md`](../services/wsfed-reference/README.md)。
