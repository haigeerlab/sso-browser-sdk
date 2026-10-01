# Negotiate 真实域验收操作记录模板

本文件用于拿到企业测试环境后执行 [模块 Spec](../../spec/negotiate-integration.md) 的剩余验收。当前已有受控本地域的 [HTTP/HTTPS curl／Firefox 与 GSSAPI 互操作](../../tests/interop/kerberos-lab/README.md)，但本地 HTTPS 使用临时自签名证书，浏览器自动化会话接受该证书；没有企业域、企业证书链或受管浏览器结果。填写和运行前不得把下面的示例域名当成可用环境。**匿名 HTTP 预检、本地 Kerberos 实验、企业域 curl SPNEGO 握手和受管浏览器测试是不同证据层级**；只有服务端确认实际机制为 Kerberos，才能计入对应环境的协议成功。

## 后端与环境交付信息

由业务后端及域管理员提供，记录配置值或内部文档位置，不在仓库保存账号密码、keytab、票据、Cookie、`Authorization` 内容或生产域秘密。

| 项目 | App A | App B |
| --- | --- | --- |
| HTTPS FQDN、会话接口、专用挑战入口、回跳参数名 | 待填 | 待填 |
| 登记的 `HTTP/<FQDN>` SPN、服务运行身份 | 待填 | 待填 |
| 实际验证身份和机制的后端模块/代理及版本 | 待填 | 待填 |
| 如何在服务端审计中确认 **Kerberos**、关联本次请求 | 待填 | 待填 |
| 受管浏览器版本、允许集成认证的站点策略 | 待填 | 待填 |
| 浏览器进程可用的 Kerberos 凭据与认证提供者；挑战后是否发起协商 | 待填 | 待填 |
| TLS、DNS、反向代理/负载均衡、连接亲和性 | 待填 | 待填 |
| 测试账号身份映射、会话有效期及登出语义 | 待填 | 待填 |

## 第一步：匿名接口预检

复制 [配置示例](domain-config.example.json)到本机私有路径并填入两个**不同的 HTTPS 来源**。从项目根运行：

```bash
node scripts/negotiate-domain-preflight.mjs /private/tmp/negotiate-domain-config.json
```

脚本只发送不带凭据的 GET，检查每个宿主的会话接口返回 `401` 或 `200 {"authenticated":false}` 且无挑战头、专用入口返回 `401 WWW-Authenticate: Negotiate`、首次挑战不创建会话，以及非法跨源回跳收到不带挑战和会话 Cookie 的 4xx。业务后端若使用自定义 `session.map` 响应结构，或用安全错误重定向拒绝非法回跳，脚本会保守地报告失败，需要人工核查映射结果或完整重定向链；不能把第一跳仍在本站视为已经安全。输出固定标记 `kerberosVerified:false`；**脚本通过不证明 Kerberos**。

## 第二步：已有域凭据的命令行握手

在有权限的域客户端按企业标准流程取得测试凭据；`klist -s` 应成功。先用 `curl --version` 确认 GSS-API/SPNEGO 支持。本机已发现这些功能，但目前 `klist -s` 没有可用凭据缓存。[curl 官方手册](https://curl.se/docs/manpage.html)规定 `--negotiate` 需配合 `-u :` 启用 HTTP SPNEGO；不要使用 `-v`、请求追踪或把令牌/会话 Cookie 输出到日志。

在受控终端为 App A 设置真实入口和会话 URL，使用私有临时 Cookie 文件：

```bash
(
  umask 077
  cookie_jar_a="$(mktemp)"
  trap 'rm -f "$cookie_jar_a"' EXIT
  app_a_start_url='https://app-a.example.test/sso/negotiate/start?returnTo=%2F'
  app_a_session_url='https://app-a.example.test/sso/session'
  curl --negotiate -u : --location --max-redirs 3 --silent --show-error --cookie '' --cookie-jar "$cookie_jar_a" --output /dev/null --write-out '%{http_code}\n' "$app_a_start_url"
  curl --silent --show-error --cookie "$cookie_jar_a" --output /dev/null --write-out '%{http_code}\n' "$app_a_session_url"
)
```

用另一份私有 Cookie 文件对 App B 重复，并在 A 登出后复查 B 会话。替换示例域名，保持 TLS 证书验证；不要使用 `-k` 或 `--location-trusted`。记录每一步最终 HTTP 状态、是否出现凭据提示、服务端认证日志对应的**实际机制**与匿名化用户标识。即使 curl 返回成功，也必须用服务端证据确认 Kerberos，而不能根据 `Authorization: Negotiate` 前缀推断；Negotiate 可能选择 Kerberos 或 NTLM。[Microsoft Negotiate/NTLM 说明](https://learn.microsoft.com/windows/win32/secauthn/microsoft-ntlm)

## 第三步：受管浏览器双宿主验收

在同一域身份、策略允许访问 A/B 的真实浏览器中，按顺序记录：A 首次进入及会话建立；B 首次进入是否免输密码；A/B 刷新；会话过期后的重建；A 本域登出后 B 是否仍保持；A 再次访问是否因系统凭据重新登录。每次由服务端关联请求并确认 Kerberos。记录浏览器和操作系统版本、策略名称和值、入口 FQDN、SPN、后端模块版本及代理路径。不要在证据中保存票据、挑战正文、会话 Cookie 或真实用户名。

若浏览器收到 `401 WWW-Authenticate: Negotiate` 却没有完成协商，先分别核对站点允许列表、浏览器进程可见的系统票据、GSSAPI/SSPI 提供者与服务 SPN，再看服务端是否收到 `Authorization` 及实际机制；不要仅凭一次 `401` 判断是 SDK 导航错误，也不要把命令行 curl 成功当作该浏览器成功。排查日志只保留状态、版本、策略和脱敏后的请求关联信息，不保留令牌正文。

| 正向场景 | 浏览器观察 | 服务端机制、身份映射与请求关联 | 结果 |
| --- | --- | --- | --- |
| App A 首次登录及刷新 | 待填 | 待填 | 待填 |
| App B 首次访问免输密码及刷新 | 待填 | 待填 | 待填 |
| 会话过期后重建 | 待填 | 待填 | 待填 |
| A 本域登出，B 保持会话 | 待填 | 待填 | 待填 |
| A 再次访问重新建会话 | 待填 | 待填 | 待填 |

## 第四步：失败矩阵

| 场景 | 预期 | 实测与证据 |
| --- | --- | --- |
| 浏览器不受管或目标未列入集成认证策略 | 不建立会话；失败或系统提示可解释，SDK 不无限自动跳转 | 待填 |
| SPN/DNS 错误或服务身份不匹配 | 不建立会话；后端记录验证失败 | 待填 |
| 错误/过期凭据与用户取消 | 不建立会话；可手动重试 | 待填 |
| 协商为 NTLM | 不计入首批通过；按后端策略拒绝或明确隔离 | 待填 |
| 代理剥离挑战头、改变连接亲和性 | 不把错误身份映射为会话；问题可定位 | 待填 |
| 非法跨源回跳或伪造身份头 | 不跳到外部站点，也不建立会话 | 待填 |

## 通过判定

两宿主的服务端均确认 Kerberos、浏览器路径通过、各自本域会话独立、失败矩阵没有认证绕过，并留下脱敏的版本/策略/日志关联证据后，才可勾选 [待办](todo.md)中的两项真实域验收。匿名预检与本地夹具通过时，这两项仍保持未完成。
