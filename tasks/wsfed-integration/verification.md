# wsfed-integration 验证记录

日期：2026-10-01。模块范围为 **RP 发起的 WS-Federation Web Passive 登录**；SDK 只使用同源宿主入口和会话接口，不读取 `wresult`。本模块交付独立协议库的本机互操作证据，仍不声明生产支持。

## 简版交互夹具

新增 `services/protocol-fixture` 的 WS-Fed 路由与 `tests/integration/wsfed-fixture.test.mjs`。先运行新增测试，4/4 因无路由失败；实现后扩充至 6/6 通过。夹具验证 `wa=wsignin1.0`、固定 `wtrealm`/`wreply`、一次性随机 `wctx`、STS 登录后自动 POST、A/B 共用中心会话而分别创建本域会话，以及本域登出。负例包含跨应用回跳、错误 realm/reply/动作、错误或过期响应、重复回调、错误凭据、中心会话过期、取消和清除旧 `ssoError` 后手动重试。

夹具的 `wresult` 是一次性不透明测试标识，**不是签名令牌**；夹具不能用作生产 STS/RP，也不作为验签证据。

## 独立 WS-Fed 互操作

参考环境见 [`services/wsfed-reference/README.md`](../../services/wsfed-reference/README.md)：[Auth0 `wsfed` 8.0.0](https://github.com/auth0/node-wsfed) STS + [Auth0 `passport-wsfed-saml2` 4.6.4](https://github.com/auth0/passport-wsfed-saml2) 的 RP 验证器，Node 22.22.0、OpenSSL 4.0.2、`@xmldom/xmldom` 0.9.12。令牌类型为**签名 SAML 1.1**，测试证书和私钥在服务启动时生成并于退出时删除。A/B 分别使用固定 realm、精确回复地址、各自的本域会话，信任同一 STS 固定证书和签发者。

`node --test tests/interop/wsfed-reference.test.mjs` **7/7 通过**：

| 场景 | 实测结果 |
| --- | --- |
| A 首次登录、B 复用中心会话 | 一次中心登录；两份签名 SAML 1.1 令牌；两个独立本域会话 |
| 篡改签名、错误签名受众/签发者 | RP 拒绝，均无新会话；记录具体验证失败原因 |
| STS 请求的 realm/reply 被改 | STS 拒绝，不签发令牌 |
| 令牌过期、同一回调重放、已使用断言跨新 `wctx` 重放 | RP 拒绝；服务端一次性 `wctx` 与断言 ID 双重防重放 |
| 中心会话过期、用户取消与重试 | B 再次需要认证；取消后业务页得到错误状态，手动重试成功且旧错误参数清除 |
| 本域登出 | B 会话失效，A 保持有效；中心会话有效时 B 可重新登录 |

RP 在可信库验证签名之后，对**已验签的断言**再次严格检查 `NotBefore`/`NotOnOrAfter`；这是因为参考 RP 库自身的时间比较不能单独作为有效期保障。缺失或无效时间被拒绝。跨站 POST 不依赖宿主的 `SameSite=Lax` Cookie，而以服务端待处理 `wctx` 记录关联回跳。

## 真实浏览器与打包

Codex 内置浏览器在本机 `43912` 端口访问 Vite 5.0.0 构建的 Vue 3.4.0 App A 与 React 19.3.0 App B：A 初次显示中心登录页，点击测试账号后页面显示 `authenticated: demo`；B 不再出现登录页，直接显示相同状态；刷新仍登录。B 本域登出后显示 `unauthenticated`，手动登录可借中心会话恢复；A 的会话保持。重启参考服务模拟中心会话失效后，浏览器重新出现中心登录页；点击取消返回 A 的 `error` 状态，未进入自动跳转循环；点击“登录”后成功，URL 不再保留旧 `ssoError`。控制台未捕获 error/warn。浏览器的精确引擎版本未由工具提供。截图见 [浏览器已登录状态](browser-verified.png)。

- `npm test`：SDK 单测 20/20、Vite 5.0.0 双宿主构建、tarball 隔离消费者兼容 4/4、简版交互 20/20（WS-Fed 6）、独立互操作 20/20（WS-Fed 7）。
- `npm pack --workspace=sso-browser-sdk-prototype --dry-run --json`：16 个文件、6487 字节；包含 `dist/wsfed.js` 与类型声明，无测试服务、证书、私钥或运行时依赖。
- `npm audit --omit=dev --workspace=sso-browser-sdk-prototype --json`：0 项。整个私有 monorepo 的 `npm audit --json` 为 **8 个包级告警**（6 moderate、2 high），包含 WS-Fed 参考库的旧 XML 依赖与用户指定的 Vite 5.0.0 开发链。参考库已归档或公告将归档，仅用于本机验证，绝不推荐部署为生产后端。
- Spec Guard `verify-artifacts.sh`：3 通过、0 失败；历史状态文件提示 1 条，远端 tracker 映射未读取或验证。

## 支持结论与剩余条件

WS-Fed 从“只有前端入口单测”推进到**有独立签名令牌与真实浏览器证据的扩展实验能力**。首版正式支持声明仍限定 OIDC/CAS/SAML；WS-Fed 是否进入后续正式版本，需用实际统一认证中心和业务 RP 验收 HTTPS、证书/密钥轮换、代理地址、多实例共享待处理与重放存储、业务 API 鉴权及目标浏览器策略，并对测试参考库的安全告警作隔离处置。`wresultptr`、主动请求者、IdP 发起登录、全局退出不在当前范围。
