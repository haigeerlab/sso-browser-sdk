# saml-integration 验证记录

## 基线与简版交互（2026-10-01）

- 既有 `/saml` 入口是无框架的同源后端跳转适配器；SDK 核心负责会话查询、状态、防自动跳转循环和本域登出，不读取断言。基线：SDK 单元测试 20/20，SAML 简版交互 2/2 通过。
- 简版夹具新增随机中心会话及可设的 `SSO_SAML_CENTER_TTL_MS`；认证取消、错误凭据、中心会话到期、已知 ACS 失败后的业务页 `ssoError` 和待处理请求消耗均有测试。新增用例先红后绿；简版交互现为 5/5。
- 简版夹具仅比较固定 XML 字符串，响应不签名；以上只证明 Redirect/POST 导航和状态流转。

## 独立 SAML 实现互操作

私有参考环境：`samlify` 2.13.1 IdP、`@node-saml/node-saml` 5.1.0 SP、`@authenio/samlify-xsd-schema-validator` 1.0.5、`@xmldom/xmldom` 0.8.15，Node 22.22.0、OpenSSL 4.0.2、Java 18.0.1.1。IdP 每次启动生成临时自签名证书和私钥；固定 IdP 实体标识、证书、SP 实体标识与 ACS，通过各自元数据核对。`npm install` 必须运行 XSD 验证器的 Java 编译脚本；若使用 `--ignore-scripts`，补运行 `npm rebuild @authenio/xsd-schema-validator`。复现命令见 [`services/saml-reference/README.md`](../../services/saml-reference/README.md)。

`node --test tests/interop/saml-reference.test.mjs` 5/5 通过：

| 场景 | 实测结果 |
| --- | --- |
| A 首次登录、B 复用 IdP 中心会话 | 一次中心登录，两个经签名响应，各自建立本域会话 |
| 签名篡改 | SP 因签名失败拒绝，不建立会话 |
| 错误受众、错误 Destination/Recipient | 分别命中受众校验与宿主 ACS 地址校验，不建立会话 |
| 错误 `InResponseTo`、断言超过最大年龄 | 分别命中请求关联与时间校验，不建立会话 |
| 同一 ACS 表单重放、非法回跳 | 重放被一次性 RelayState 拒绝；跨站回跳被宿主拒绝 |
| B 本域登出后恢复 | A 保持已登录；B 借 IdP 中心会话恢复 |
| 旧 `ssoError` 后手动重试 | 宿主在新请求中清理旧错误参数，成功回跳 URL 干净 |

负例不仅断言 `ssoError`，还核对测试服务内部记录的拒绝原因。宿主先由 `node-saml` 验证 Response 与 Assertion 的可信签名、签发者、受众、有效期、`InResponseTo`，再显式检查库未替宿主校验的 `Destination`、`Recipient` 和精确请求 ID。ACS 无需原宿主 Cookie，使用服务端一次性 RelayState 记录处理跨站 POST。

## 浏览器实测

Codex 内置浏览器、Vite 5.0.0 构建的 Vue 3.4.0 App A / React App B：A 首次显示 `authenticated: demo@example.test`；打开 B 不再显示中心登录页，直接显示相同用户；B 登出后显示 `unauthenticated`，A 保持已登录，B 再访问恢复。另在新服务实例中取消登录，Vue 页显示 `error` 且没有自动跳转循环；点击“登录”可重试，成功后 URL 不再保留旧 `ssoError`。浏览器控制台无 error/warn。

## 最终回归、包边界与剩余风险

- `npm test` 最终通过：SDK 单元测试 20/20；Vue/React 的 Vite 5.0.0 构建；简版协议交互 14/14（SAML 5）；独立协议互操作 13/13（SAML 5）。
- `npm pack --workspace=sso-browser-sdk-prototype --dry-run --json`：SDK 包 16 个文件，约 6.1 kB；不含 SAML 服务、测试、证书、私钥或示例应用。
- `npm audit` 仍报告 2 项：锁定的 Vite 5.0.0 与其 esbuild 依赖各 1 项；本次新增 SAML 依赖不在告警名单。发布准备模块需结合 Vite 兼容约束评估。
- Spec Guard `verify-artifacts.sh`：3 通过、0 失败；历史状态文件提示仅说明未读取或验证远端 tracker 映射。模块清单已全部完成，下一模块为 `host-compatibility`。
- 参考环境只验证本机 HTTP、临时证书、内存会话和测试账号。生产 IdP、真实业务 SP、证书轮换、共享原子重放存储、HTTPS/Cookie/CSRF、全局登出及多实例部署尚未验收。SLO、IdP 发起登录、Artifact 和 ECP 不在首版。
