# WS-Fed 独立参考环境（仅本机测试）

这套私有服务与 `services/protocol-fixture` 独立：使用 [Auth0 `wsfed` 8.0.0](https://github.com/auth0/node-wsfed) 签发 **SAML 1.1** 令牌，使用 [Auth0 `passport-wsfed-saml2` 4.6.4](https://github.com/auth0/passport-wsfed-saml2) 的 SAML 验证器在两个宿主 RP 校验固定可信证书、签名、受众、签发者、有效期和断言重放。每次启动以 OpenSSL 生成临时测试证书和私钥，进程结束即删除。SDK 不依赖这些库，也不解析 `wresult`。

## 复现

在仓库根目录运行：

```bash
npm install
npm run build:hosts
node --test tests/interop/wsfed-reference.test.mjs
SSO_WSFED_REFERENCE_PORT=43912 npm run start --workspace=@sso-test/wsfed-reference
```

最后一条命令用于浏览器手动检查：打开 `http://127.0.0.1:43912/app-a/?protocol=wsfed`，以 `demo/demo` 登录，再点击 App B。`127.0.0.1` 是宿主，`localhost` 是认证中心；测试 Cookie 与生产域拓扑无关。默认端口为随机空闲端口。环境需要 Node 22、OpenSSL 和 npm registry 或本机缓存。

固定测试配置：App A/B realm 分别为 `urn:reference:app-a` 和 `urn:reference:app-b`；回复地址分别为 `http://127.0.0.1:<port>/<app>/auth/wsfed/callback`；签发者为 `http://localhost:<port>/wsfed/issuer`。STS 严格匹配 realm 与 reply，RP 只信任启动时生成的证书。`wctx` 使用服务端一次性记录关联回跳，不依赖跨站 POST 时的宿主 Cookie。测试专用 `scenario` 参数会让 STS 故意签发错误受众、签发者或已过期令牌；不能在生产系统提供这种入口。

## 安全与适用范围

- 参考实现使用本地 HTTP、内存会话和测试账号；仅证明 SDK、浏览器和独立协议库之间的本机交互。生产 RP/STS 不应复制此服务。
- `passport-wsfed-saml2` 的时间验证实现无法作为唯一的有效期依据，因此 RP 还对**已验签的断言**读取 `NotBefore` 与 `NotOnOrAfter` 并验证，缺失或无效时间一律拒绝。RP 先消耗一次性 `wctx`，后用断言 ID 防重放。
- 2026-10-01 的 `npm audit --json` 在整个私有 monorepo 中报告 8 个包级告警（6 moderate、2 high），其中 WS-Fed 参考库及其旧版 XML 依赖占一部分，另有用户指定的 Vite 5.0.0 开发链。`passport-wsfed-saml2` 仓库已归档，`node-wsfed` 仓库公告将于 2026-11-02 归档。本服务只作为隔离的测试证据，不能作为推荐生产后端栈。
- 仍需实际统一认证中心与业务 RP 在 HTTPS、证书轮换、多实例共享待处理状态/重放存储、代理地址、真实浏览器策略和业务 API 权限上联调。全局登出、`wresultptr`、主动请求者和 IdP 发起登录未覆盖。
