# negotiate-integration 验证记录

日期：2026-10-01。范围：无框架 SDK 的 Negotiate 同源导航合同、本地 HTTP 交互夹具和受控本地 HTTP/HTTPS Kerberos 互操作。**已有真实本地 Kerberos 票据与服务端验票记录；尚无受管浏览器和企业宿主验收，Negotiate 仍为实验入口。**

## 基线与环境预检

- 修改前 `npm test`：SDK 单测 20/20、Vue 3.4.0 与 React 19.3.0 的 Vite 5.0.0 隔离安装兼容测试 4/4、简版交互 20/20、独立协议互操作 20/20，全部通过。
- 初始 PATH 中有 `kinit`、`klist`，但 `klist -s` 返回“Cache not found”；没有现成的企业域凭据。未发现 Docker、Podman 或 .NET。随后查到本机 Homebrew `krb5 1.21.3` 的 keg-only 安装含 `krb5kdc`、`kdb5_util`、`kadmin.local`、`kinit`、`kvno`，因此可以另建受控本地 Kerberos 域。仍没有两个企业 HTTPS 宿主、业务后端 Negotiate 模块或受管浏览器策略信息。
- 首次在默认命令沙箱运行新 HTTP 测试，服务监听被沙箱以 `EPERM` 拒绝；在获准的本机执行中复测，得到预期的路由缺失失败（`404`，测试期望 `401/400`）。完成独立夹具后复测，5/5 通过。沙箱 `EPERM` 不作为产品缺陷计入。

## 本地 HTTP 交互

新增 [独立 Negotiate 夹具](../../services/negotiate-fixture/README.md)与 `tests/integration/negotiate-fixture.test.mjs`。运行 `node --test tests/integration/negotiate-fixture.test.mjs`：**5/5 通过**。

| 场景 | 实测结果 |
| --- | --- |
| 会话查询与专用入口 | 未登录的 `GET /auth/session` 返回无 `WWW-Authenticate` 的 `401`；专用顶层登录入口返回 `401 WWW-Authenticate: Negotiate`，并禁用缓存。 |
| 非法回跳及伪造身份 | 外部、跨应用、路径规范化和编码反斜杠回跳被拒；随意提交 `Authorization` 或 `X-Remote-User` 不会得到会话。 |
| 多轮脚本与双应用 | 测试注入的验证器使一次继续挑战后完成；A/B 分别建立 Cookie 与本域会话，A 登出不影响 B。 |
| NTLM、过期与放弃 | 脚本报告 NTLM 时不建立会话；已过期会话被拒；放弃挑战后仍未登录。 |
| SDK 状态闭环 | `ensureAuthenticated` 只导航一次；未建立会话时报循环错误；用户主动 `login` 可重试，成功后清除旧错误和尝试标记；本域登出后会话失效。 |

夹具的验证器是测试注入的脚本，**没有解析、验签或验证任何 Kerberos/NTLM 令牌**。A/B 在同一回环来源的不同路径下模拟，因此这层也不能证明跨域 Cookie 隔离。测试 HTTP 与无 `Secure` 的 Cookie 只适用于本机夹具。浏览器/操作系统在真实域中的挑战轮次、SPN、代理连接、策略和提示行为尚无证据。

## 受控本地 Kerberos 互操作

发现本机 Homebrew MIT Kerberos 工具后，在私有临时目录创建 `SSO.TEST` 测试域、`testuser` 和两个独立的 `HTTP/app-a.localhost`、`HTTP/app-b.localhost` 服务主体。`kinit -k` 成功取得客户端 TGT，`kvno` 为两个服务主体分别取得服务票据（均返回 kvno 2）。测试域、密钥、票据和 Cookie 都是本轮临时生成，**没有加入仓库**。

先用临时 Java GSSAPI 服务端和 curl 8.7.1 的 `--negotiate -u :` 实测，后收录为仓库内[可选实验](../../tests/interop/kerberos-lab/README.md)。运行 `npm run test:kerberos:local`：**通过**。每次运行创建并清理私有临时测试域，只绑定回环地址。服务端日志（脚本自动断言，不保留秘密）对 A/B 均确认 `accepted mechanism=1.2.840.113554.1.2.2 identity=testuser@SSO.TEST`，其中 OID 是 Kerberos 机制；不能仅凭 `Authorization: Negotiate` 前缀得出该结论。

| 场景 | 实测结果 |
| --- | --- |
| 匿名接口 | 登录专用入口 `401 WWW-Authenticate: Negotiate`；会话查询未认证且没有挑战头。 |
| App A/B 真实票据 | curl 对两个不同 `*.localhost` 主机名分别完成 HTTP SPNEGO，服务端 GSSAPI 验票后各返回 `302` 并创建独立本域会话。 |
| 会话边界与退出 | A Cookie 不能认证 B；A 退出后 A 会话失效，B 会话仍有效。 |
| 错误 SPN | 客户端请求 App A 的服务票据，但服务端只持有 App B 身份，返回 `401`，没有会话 Cookie。 |
| 畸形/合成令牌 | 畸形 Base64 与合成 NTLM 标记均返回 `401`，没有会话 Cookie；后者**不代表真实 NTLM 回退测试**。 |
| 本地反向代理剥离挑战头 | 匿名请求到代理后，客户端收到无 `WWW-Authenticate` 的 `401` 且无会话。`curl --negotiate` 可能主动发凭据，不能用它单独证明响应头剥离会阻止认证。 |
| 本地反向代理剥离认证头 | 代理确实收到客户端凭据，但不向上游转发；最终 `401`、无会话。只覆盖头剥离，不覆盖企业代理的连接复用或亲和性。 |

基础 HTTP 实验经 curl、回环 HTTP、Java GSSAPI 直接连接；下文另有本地 HTTPS 实验。两项真实域待办仍不勾选。本地测试把证据从“纯脚本化交互”推进到“真实 Kerberos 客户端与服务端互操作”，不构成完整 Negotiate 生产支持。

### Chrome 本地探针（未通过）

在同一临时域中，用本机 Google Chrome 154.0.8037.59 的独立临时 profile、`--headless=new` 和临时允许列表访问 App A 专用入口。服务端观察到浏览器到达入口并收到 Negotiate 挑战，但没有记录已验证的 Kerberos 身份，也没有建立会话；命令在 8 秒后超时。分别尝试精确宿主与通配允许列表，并用 macOS 自带 `kinit` 在私有缓存中重新取票，结果相同。没有读取或保存浏览器认证令牌。

进一步用本机 Homebrew MIT Kerberos 的 `libgssapi_krb5.dylib` 路径作为 Chrome 的临时 `--gssapi-library-name` 参数，在真实 SDK 测试页上重试。页面模块、匿名会话查询及挑战均到达服务端；仍没有 Kerberos 验票成功记录。为此进程设置的私有 `KRB5_TRACE` 文件大小为 0；这只表明**未观察到该 MIT 库的跟踪输出**，不能证明 Chrome 实际使用了哪个 GSSAPI 提供者或具体为何没有发送可验证凭据。[Chromium 认证设计文档](https://www.chromium.org/developers/design-documents/http-authentication/)说明非 Windows 平台的 Negotiate 依赖 GSSAPI；但 [Chrome Enterprise 当前策略说明](https://chromeenterprise.google/policies/gss-api-library-name/)把 `GSSAPILibraryName` 的支持平台列为 Linux，不能把本地命令行尝试视作 macOS 生产配置方案。

这次失败不能确定是 Chrome 无头行为、系统凭据缓存与浏览器的集成，还是本地测试策略配置所致；它也不能充当“不受管浏览器安全失败”的正式验收。未把此探针加入默认或可选回归脚本，Chrome 通过状态保持**未验证**。下一轮应在受管的有界测试 profile 中核对实际策略、票据可见性和服务端机制日志；仅凭 curl 或 Firefox 的成功不能推断 Chrome 成功。

### Firefox 本地浏览器互操作

本机 Firefox 157.0 在独立临时 profile、无头模式下，分别打开 App A/B 加载 SDK 构建产物的测试页。页面用 `createSSO` 与 `negotiateAdapter` 查询本域会话，自动导航至专用挑战入口，成功回跳后再次查询会话。此 profile 通过 `network.negotiate-auth.trusted-uris` 明确允许两个本地域名；对每次访问，各宿主服务端均记录了新增的 `accepted mechanism=1.2.840.113554.1.2.2 identity=testuser@SSO.TEST`，以及页面在 SDK 得到 `authenticated` 状态后发送的测试观察标记。运行 `SSO_KERBEROS_FIREFOX="/Applications/Firefox.app/Contents/MacOS/firefox" npm run test:kerberos:local`：**通过**。

另建一个 `trusted-uris` 为空、没有既有 Cookie 的临时 Firefox profile，打开 App A 的 SDK 测试页。服务端观察到专用入口的挑战请求，但在有界观察期内没有新增 Kerberos 验票成功记录，也没有建立本域会话；脚本断言此边界。该观察不证明真实企业不受管浏览器的提示或失败页面行为。测试进程、profile、票据和日志在运行结束后清理。Firefox 的 SPNEGO 允许列表配置依据[官方管理员文档](https://firefox-admin-docs.mozilla.org/reference/policies/authentication/)。

**本地浏览器通过仅限真实 SDK 构建产物 + Firefox + 回环 HTTP/HTTPS + 临时 MIT Kerberos 域及测试后端**。它仍未包含 SDK 在真实业务项目的运行、企业受管策略、企业证书链、代理或业务身份映射；不能勾选两项企业环境验收。Chrome 的本地探针仍未通过，不能从 Firefox 结果推断 Chrome 支持。

### 本地 HTTPS 与浏览器验证

同一可选实验现在用 OpenSSL 生成一次性自签名证书，SAN 覆盖 `app-a.localhost` 和 `app-b.localhost`，由两个回环 Java HTTPS/GSSAPI 服务端分别提供测试页与认证入口。无测试证书时 curl 返回证书验证错误；显式 `--cacert` 后，A/B 都完成真实 Kerberos 验票。测试断言 Cookie 带 `Secure`，A Cookie 不能认证 B，A 登出后 A 会话失效而 B 保持。临时证书、私钥、keystore 与票据均在实验结束后删除。Java `HttpsServer` 的 TLS 配置依据[官方 API](https://docs.oracle.com/en/java/javase/26/docs/api/jdk.httpserver/com/sun/net/httpserver/HttpsConfigurator.html)。

启用 `SSO_KERBEROS_FIREFOX` 时，脚本还通过 geckodriver 让 Firefox 打开两个 HTTPS 测试页。每个宿主的服务端分别新增 Kerberos 机制 OID 验票记录与 SDK `authenticated` 观察标记。浏览器还在同一会话中调用 SDK `logout()`：A 服务端记录本域会话失效与 SDK `unauthenticated` 状态，B 页面重新查询后仍登录且没有新 Kerberos 验票，A 再访问则新增 Kerberos 验票并恢复登录。由于证书仅为一次性自签名测试证书，WebDriver 会话显式设置 `acceptInsecureCerts`；按[WebDriver 文档](https://developer.mozilla.org/en-US/docs/Web/WebDriver/Reference/Capabilities/acceptInsecureCerts)，这会接受浏览器原本不信任的证书。所以此浏览器结果只证明 HTTPS 下的导航、Kerberos 与 SDK 会话闭环，**不证明企业 CA 链或真实受管浏览器的证书策略**。

同一实验复用了仓库的 `scripts/negotiate-domain-preflight.mjs`，以 `https://127.0.0.1:<A/B 端口>` 作为两个不同 HTTPS 来源，并通过仅在子进程设置的 `NODE_EXTRA_CA_CERTS` 信任一次性测试证书。首次接入时，预检对 A/B 都报告 `unsafeReturnRejected:false`：非法 `returnTo` 得到 `401` 挑战，暴露了 Java 测试服务没有校验回跳的缺口。服务端改为先验证同源路径，再决定是否发挑战；复跑后两来源的匿名预检全部通过，且结果仍为 `kerberosVerified:false`。这验证了预检脚本与本地 HTTPS 服务的接口合同；同一 IP 的不同端口不等于两个企业 FQDN，也不验证 SPN、浏览器策略或企业证书链。

## 完整回归与包

- 修改后 `npm test`：SDK 单测 **20/20**、隔离安装兼容 **4/4**、交互测试 **29/29**（含 Negotiate HTTP 夹具 5 项、域预检工具 4 项）、独立互操作 **20/20**，全部通过。Vue 3.4.0、React 19.3.0 示例继续由 Vite 5.0.0 构建；隔离消费者还验证了 `/negotiate` 的 JS 与类型子路径导入。示例未连接真实 Negotiate 宿主。
- `npm pack --workspace=sso-browser-sdk-prototype --dry-run --json`：16 个文件，包含 `dist/negotiate.js` 与 `dist/negotiate.d.ts`；不包含测试夹具、域预检脚本、配置模板、私钥、票据或其他服务文件。包仍为 `private: true` 原型。
- Spec Guard `verify-artifacts.sh`：3 通过、0 失败；仅有历史状态文件警告，远端 tracker 映射未读取或验证。
- 加入可选真实 Kerberos 实验后重跑 `npm test`：SDK 单测 **20/20**、兼容测试 **4/4**、交互 **29/29**、独立互操作 **20/20**，全部通过；`npm run test:kerberos:local` 再次通过。打包 dry-run 仍只有 SDK 的 **16 个文件**；Spec Guard 再验 **3 通过、0 失败、1 条历史状态警告**。`phase-guard.sh` 仍报告 `BUILDING`，本模块剩余 2 项真实域验收。
- 加入 Firefox SDK 页面后，重新运行 curl-only 的 `npm run test:kerberos:local` 与带 `SSO_KERBEROS_FIREFOX` 的同一命令，**两者均通过**。后一运行实测 SDK 自动导航、A/B Kerberos 验票、SDK 会话恢复及未信任站点不建立会话。`npm pack --workspace=sso-browser-sdk-prototype --dry-run --json` 使用私有临时 npm 缓存复验为 **16 个文件**，不含测试 Java/Python 源码和临时凭据；默认用户缓存的写入曾被沙箱以 `EPERM` 拒绝，临时缓存复测成功，未改系统缓存权限。Spec Guard 结构检查仍为 **3 通过、0 失败、1 条历史状态警告**。此次未再次重跑默认 `npm test`；SDK 源码与其默认测试集没有改动。
- 加入本地代理头剥离负例后，curl-only 和带 Firefox 的 `npm run test:kerberos:local` 均再次通过；这两项是**本地代理故障模拟**，不能替代企业代理拓扑、连接亲和性与 HTTPS 负例验收。
- 加入本地 HTTPS 后，curl-only 和带 Firefox/geckodriver 的 `npm run test:kerberos:local` 均通过；加入未受信任证书拒绝断言后，带 Firefox 的完整实验再次通过。curl 实测证书拒绝/显式信任、A/B Kerberos 验票、`Secure` Cookie 和会话隔离；Firefox 实测两页 SDK 登录及恢复。Spec Guard 结构检查为 **3 通过、0 失败、1 条历史状态警告**；阶段仍为 `BUILDING`，两项企业环境验收未勾选。此次只改可选实验与文档，没有修改 SDK 源码或默认测试集。
- 把真实域匿名预检脚本接入本地 HTTPS 实验时，先得到预期失败：A/B 的 `unsafeReturn` 均为 `401`，总结果 `passed:false`。修复测试服务回跳校验后，curl-only 与带 Firefox/geckodriver 的完整实验均通过，匿名预检两来源均 `passed:true` 且 `kerberosVerified:false`。SDK 源码与默认测试集未改动。
- 核对本地实验的登出合同后，先用失败断言复现了测试服务接受 `GET /sso/logout` 的偏差。修正为仅接受 `POST` 后，带 Firefox/geckodriver 的完整实验通过：SDK 浏览器调用实际登出，A 退出不影响 B，A 再访问重新协商 Kerberos。curl 也验证 GET 不撤销会话。变更仅涉及可选实验与文档，SDK 源码未改动。

## 真实域验收准备

- 本机 `curl 8.7.1` 的特性包含 GSS-API、Kerberos、SPNEGO；现已用临时本地域凭据完成命令行握手，但没有企业域凭据或目标业务宿主，因此尚未运行企业域握手。
- 新增 [匿名 HTTP 合同预检工具](../../scripts/negotiate-domain-preflight.mjs)、[双宿主配置示例](domain-config.example.json)与[真实域验收模板](domain-validation.md)。工具只检查无凭据的会话、专用挑战和非法回跳，不发送域凭据；无论结果如何均标记 `kerberosVerified:false`。
- `node --test tests/integration/negotiate-preflight.test.mjs`：4/4 通过，包含本地 A/B 夹具、非 HTTPS 来源拒绝、不能把第一跳安全重定向误判为非法回跳已拒绝，以及 `authenticated:false` 会话形式。命令行入口的缺参数检查返回预期用法错误；**尚未对真实域执行此预检**。

## 未完成的真实域验收

需有可访问域/KDC、两个不同 HTTPS FQDN 与对应 SPN、真实服务端 Negotiate 验证模块、可信身份映射、受管浏览器策略、测试账号和明确代理拓扑。先由服务端确认 A/B 实际协商机制均为 **Kerberos**，再验证首次登录、第二宿主免输密码、刷新、会话过期、本域退出；另验证不受管浏览器、错误 SPN/凭据、NTLM 回退和代理故障的安全失败。每项记录浏览器/系统版本、策略、脱敏后的挑战轮次及服务端已验证身份。未获得这些证据前，不得声称 Negotiate 协议互操作或生产支持已通过。

## 2026-10-07 恢复企业环境验收检查点

- `developer-docs` 已完成验收，当前 `activeModule` 恢复为 `negotiate-integration`。用户明确要求在本会话继续；不再要求换会话。
- 已核对仓库配置和预检工具：可见的双宿主配置仍只有 `domain-config.example.json`，地址为 `*.example.test` 占位值，不能用作企业验收目标。`node --check scripts/negotiate-domain-preflight.mjs` 通过。
- 本机 Node 22.22.0、curl 8.7.1 可用；curl 支持 GSS-API/Kerberos/SPNEGO，kinit/klist 与 Java 工具存在。`klist -s` 返回非成功，未发现当前可用的默认凭据缓存；这不判断用户是否有其他域客户端或私有凭据缓存。
- 已请求实际 App A/B HTTPS 地址及接口、域/SPN、后端验证模块、受管浏览器策略与代理拓扑；不请求密码、keytab、票据或 Cookie。当前没有对占位地址发请求，没有运行企业握手，也没有重新计算本地实验结果为企业通过。
- 用户于 2026-10-07 明确回复“暂时没有，保留企业验收待办”。据此保留两项真实域验收未完成，不再将环境信息视为本轮待回复问题；文档站与 README 的交付不依赖补齐企业环境，本轮文档工作已完成。Negotiate 继续保持实验支持范围；该记录随文档收尾保存到本地分支 `codex/developer-docs`，未执行企业验收或发布。
- 下一步：收到实际配置后，先运行匿名 HTTP 合同预检；通过后在指定域客户端和受管浏览器逐项执行 `domain-validation.md`，由服务端机制证据确认 Kerberos。两项真实域待办继续保持未勾选。
