# cas-integration 验证记录

## 既有能力核对（2026-10-01）

| 范围 | 证据 | 结论 |
| --- | --- | --- |
| `/cas` 子路径和同源宿主登录入口 | `packages/browser-sdk/src/cas.ts`、`redirect.ts`；SDK 20 项单元测试 | 已有公共跳转与参数配置能力，无需新增 CAS 前端协议逻辑 |
| 双宿主中心会话复用、各自验票、本域会话 | `tests/integration/cas-fixture.test.mjs` | 简版夹具已覆盖，不证明真实 CAS 互操作 |
| 错误 `service`、票据单次使用、票据过期、非法回跳 | 同一文件的第二、三项测试 | 简版夹具已覆盖 |
| 中心会话过期、认证失败、缺票回调 | 尚无对应测试 | 需补测 |
| 独立 CAS 提供方、浏览器完整 CAS 流程 | 尚无证据 | 需补测 |

基线命令：`node --test tests/integration/cas-fixture.test.mjs` 3/3 通过；`npm test --workspace=sso-browser-sdk-prototype` 20/20 通过。

现有简版宿主把 CAS XML 与固定 `demo` 字符串直接比较，仅用于导航和会话交互测试，不能作为生产验票实现。

## 新增简版交互证据

- `tests/integration/cas-fixture.test.mjs` 从 3 项增至 6 项：中心会话到期后 B 重新要求登录；错误密码与缺票不建会话；取消登录回到业务页且不建会话。
- 中心 Cookie 改为随机会话标识，测试夹具按 `SSO_CAS_CENTER_TTL_MS` 判断有效期。过期票据、错误服务、缺票等已关联的失败回调返回原业务页并附 `ssoError=cas_validation_failed`；未知回调仍返回 400，不创建会话。
- 新用例先红后绿：中心会话到期前夹具错误返回 302；取消入口前返回 404；失败回调原先返回 400 而非业务页。修复后 CAS 简版用例 6/6 通过。

## 独立 CAS 提供方互操作

测试提供方：`django-cas-server` 3.1.0、Django 5.2.17、Python 3.10.7；测试宿主使用 `fast-xml-parser` 5.11.2 解析真实 CAS XML。直接和完整 Python 依赖版本分别记录在 `services/cas-reference/requirements.txt` 与 `requirements.lock`。每次启动创建临时 SQLite 数据库，只登记当前 App A/B 的带 `state` 回调 `service`；两宿主与认证中心使用不同站点地址。

`node --test tests/interop/cas-reference.test.mjs` 5/5 通过：

| 场景 | 结果 |
| --- | --- |
| A 首次登录、B 使用中心会话登录 | A 出现一次真实登录表单；B 无需再输入密码；各自建立本域会话 |
| B 本域登出后恢复 | A 会话仍有效；B 再次使用中心会话恢复 |
| 错误 `service` 验票 | 独立提供方返回认证失败，票据被消费；宿主不建会话 |
| 成功回调重放 | 首次建立会话；再次提交同一回调被宿主拒绝 |
| 过期 Service Ticket | 独立提供方拒绝；宿主返回业务页错误标记，不建会话 |
| 错误密码 | 提供方仍停留登录页，未签发票据，宿主保持未登录 |

独立实现的安装方式与服务登记依据见 [django-cas-server 文档](https://django-cas-server.readthedocs.io/en/latest/README.html)；`service`、票据一次性使用和验票语义依据 [Apereo CAS 3.0 规范](https://apereo.github.io/cas/7.3.x/protocol/CAS-Protocol-Specification.html)。本次实测的是独立 Django 实现，不是 Apereo CAS 服务器本体。

## 浏览器实测

- Codex 内置浏览器：Vue App A 首次在独立 Django CAS 登录后显示 `authenticated: demo`；打开 React App B 直接显示 `authenticated: demo`；B 本域登出显示 `unauthenticated`，A 仍已登录；返回 B 后无需表单即可恢复。
- 简版夹具中，取消 CAS 登录后 Vue A 显示 `error`；点击“登录”可主动重试，再次取消仍显示 `error`，无跳转循环。
- 把简版夹具票据有效期设为 0 后，浏览器从 CAS 登录页返回 `/app-a/?protocol=cas&ssoError=cas_validation_failed`，Vue 页面显示 `error`，无自动重定向循环。

## 范围与剩余风险

- 本机 HTTP、Django 开发服务、临时数据库、固定测试账号和开发密钥仅供互操作；没有验证生产 CAS 中心或真实业务宿主。
- 独立提供方错误密码测试停留认证中心；中心登录页取消回业务页由简版夹具验证，不宣称所有 CAS 产品有标准取消回调。中心会话过期用简版夹具验证，尚未用独立 Django 提供方复测。
- CAS `renew`、`gateway`、代理票据、前端票据回调、中心登出与全局单点登出不在本模块范围。简版夹具的固定 XML 比对不得移植到业务后端。

## 最终回归与产物检查

- `npm test` 通过：20 项 SDK 单元测试、11 项简版协议交互测试（其中 CAS 6 项）、8 项独立提供方互操作测试（CAS 5 项、OIDC 3 项）；Vue 3.4.0 与 React 示例的 Vite 5.0.0 构建通过。
- `npm pack --workspace=sso-browser-sdk-prototype --dry-run --json --cache /private/tmp/sso-npm-cache`：SDK 包 16 个文件，约 5.9 kB；未包含 Django 服务、Python 虚拟环境、简版夹具、宿主示例或测试文件。
- Spec Guard `verify-artifacts.sh`：3 通过、0 失败；提示存在历史状态文件，远端 tracker 映射未读取或验证。该警告不代表本地模块验收失败。
- `npm audit` 报告 2 项位于当前固定的 Vite 5.0.0 与其 esbuild 依赖；新加入的 `fast-xml-parser` 未出现在本次漏洞清单。Vite 版本升级受用户兼容目标约束，发布准备模块需评估开发服务暴露范围与版本策略。
