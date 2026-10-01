# 本地 Kerberos 互操作实验

运行 `npm run test:kerberos:local`。此测试是**手动、可选**的回归项，不加入默认 `npm test`：运行机器需要 Python 3、JDK（`java`/`javac`）、OpenSSL、带 SPNEGO/GSS-API 的 curl，以及 MIT Kerberos 的 `krb5kdc`、`kdb5_util`、`kadmin.local`、`kinit`、`kvno`。macOS Homebrew 安装 `krb5` 后脚本默认从 `/opt/homebrew/opt/krb5` 寻找；其他安装位置可设置 `KRB5_HOME`，或让程序进入 PATH。

可选的本地浏览器互操作：`SSO_KERBEROS_FIREFOX="/Applications/Firefox.app/Contents/MacOS/firefox" npm run test:kerberos:local`，此模式还需要 `geckodriver`。脚本为 Firefox 创建私有临时 profile，将 A/B 加入 `network.negotiate-auth.trusted-uris`，分别打开加载真实 SDK 构建产物的业务测试页；服务端同时确认 Kerberos 验票和 SDK 回到页面后的会话恢复。另用没有受信任站点的 profile 访问 A，断言挑战已到达但没有建立会话。Firefox 在无头模式下运行；测试进程、profile、票据和日志随实验结束清理。[Firefox 官方策略文档](https://firefox-admin-docs.mozilla.org/reference/policies/authentication/)说明 SPNEGO 允许列表对应此配置。

脚本在私有临时目录生成测试域 `SSO.TEST`、随机密钥、客户端票据与两个 `HTTP/<宿主名>` 服务主体。KDC 与 Java GSSAPI 测试服务仅监听 `127.0.0.1`；curl 通过 `--resolve` 将 `app-a.localhost`、`app-b.localhost` 指向本机。退出时终止服务并删除临时数据库、keytab、票据、证书私钥和 Cookie。测试过程不输出令牌或 Cookie。

断言包括：专用入口挑战而会话查询不挑战；curl 真正使用 Kerberos 票据完成 A/B HTTP Negotiate；服务端确认实际机制 OID 为 `1.2.840.113554.1.2.2`；A/B 独立会话和 A 本域退出；错误服务主体、畸形令牌及合成 NTLM 标记均不能建会话。回环反向代理夹具还验证：剥离服务端 `WWW-Authenticate` 后，匿名客户端只收到无挑战的 `401`；剥离客户端 `Authorization` 后，即使代理收到了 Kerberos 凭据，上游也不能创建会话。curl 的 `--negotiate` 可能主动发送认证头，因此响应头剥离场景使用匿名请求验证。

同一次实验还生成带 A/B 主机名 SAN 的临时自签名证书，启动两个 HTTPS GSSAPI 宿主。curl 在未指定此证书时必须拒绝连接；指定 `--cacert` 后完成两个站点的 Kerberos 登录，验证 `Secure` 会话 Cookie、独立会话与本域退出。登出接口只接受 `POST`，`GET` 返回 `405` 且不撤销会话。启用 Firefox 时，geckodriver 用 `acceptInsecureCerts` **仅在自动化浏览器会话中**接受这张临时证书，打开 HTTPS 测试页并验证真实 SDK 的双宿主登录及会话恢复；随后页面调用 SDK `logout()`，验证 A 本域会话失效、B 原会话保留、A 再次访问会通过域凭据重新认证。[WebDriver 证书能力说明](https://developer.mozilla.org/en-US/docs/Web/WebDriver/Reference/Capabilities/acceptInsecureCerts)明确此设置会接受浏览器原本不信任的证书；因此 Firefox 的这一项验证 HTTPS 交互，**不验证企业证书链信任**。

实验还在两个 HTTPS 测试服务上运行仓库的[匿名预检脚本](../../../scripts/negotiate-domain-preflight.mjs)。预检使用同一回环 IP 的不同端口作为两个来源，借临时证书完成 Node TLS 验证，检查无挑战会话查询、专用挑战和非法 `returnTo` 拒绝；输出必须同时标记 `kerberosVerified:false`。回环端口隔离能验证预检与服务端的接口合同，不能代替两个企业 FQDN、SPN 或浏览器策略验收。

**证据边界**：这是本机 HTTP/HTTPS + curl／可选 Firefox + Java GSSAPI 互操作，浏览器页面虽运行真实 SDK 构建产物，后端仍是专用测试服务；不验证企业受管浏览器策略、企业证书链、真实代理拓扑、连接亲和性、业务身份映射或真实企业域。无头 Firefox 在未信任站点时不建会话，不证明企业不受管浏览器的全部失败行为或交互提示。合成 NTLM 标记被拒绝也不等于已实测真实 NTLM 回退。默认的脚本化 HTTP 夹具和这里的真实 Kerberos 实验分别提供不同证据，均不能替代[真实域验收](../../../tasks/negotiate-integration/domain-validation.md)。
