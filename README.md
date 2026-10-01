# SSO Browser SDK Monorepo

项目使用 Spec Guard 的本地[能力图](spec/CAPABILITY-MAP.md)约定，按模块维护 `spec/<module-id>.md` 与 `tasks/<module-id>/`。根目录 `tasks/plan.md`、`tasks/todo.md` 保留为初始化前的原型记录。

这个仓库统一维护前端 SDK、Vue/React 宿主示例、认证中心与宿主后端的测试夹具。**对业务方发布的仍是一个 npm 包**；测试服务和示例应用均为私有工作区，不进入 SDK 包。

| 目录 | 作用 | 发布 |
| --- | --- | --- |
| [`packages/browser-sdk`](packages/browser-sdk) | 无框架依赖的 SSO 核心及协议入口、单元测试 | 未来唯一发布包 |
| [`apps/compat`](apps/compat) | Vue 3.4.0 / React 示例，均固定 Vite 5.0.0 | 不发布 |
| [`services/protocol-fixture`](services/protocol-fixture) | 本机认证中心与两个宿主后端的简版交互夹具 | 不发布 |
| [`services/oidc-reference`](services/oidc-reference) | 基于真实 OIDC 提供方和客户端库的本机互操作服务 | 不发布 |
| [`services/cas-reference`](services/cas-reference) | 独立 Django CAS 提供方的本机互操作服务 | 不发布 |
| [`services/saml-reference`](services/saml-reference) | 独立 SAML IdP/SP 库的本机互操作服务 | 不发布 |
| [`services/wsfed-reference`](services/wsfed-reference) | 独立 WS-Fed STS/RP 库的本机互操作服务 | 不发布 |
| [`docs`](docs) | 五种方案的流程和后端要求 | 不发布 |
| [`tasks`](tasks) | 计划、验收与实测记录 | 不发布 |
| [`tests/compat`](tests/compat) | tarball 隔离安装、Vite 与宿主差异回归 | 不发布 |
| [`tests/integration`](tests/integration) | 启动后端夹具验证 SDK 与双宿主交互 | 不发布 |
| [`tests/interop`](tests/interop) | 验证真实协议实现与双宿主交互 | 不发布 |

## 本地验证

使用 Node.js 22.22.0、Python 3.10+、OpenSSL CLI 和具备 `java`/`javac` 的 JDK（CI 固定 Temurin 21）。仓库根目录的测试会启动独立 CAS 参考服务，因此首次运行需安装其 Python 依赖：

```bash
npm ci
python3 -m venv services/cas-reference/.venv
services/cas-reference/.venv/bin/python -m pip install -r services/cas-reference/requirements.lock
npm test
```

GitHub Actions 的 [CI 工作流](.github/workflows/ci.yml)在 `main` 推送和 Pull Request 上执行相同的回归，并审计 SDK 的生产依赖；全仓审计作为已知告警报告，不阻断当前候选。实验性的本地域 Kerberos/Firefox 验证需额外环境，见[测试说明](tests/README.md)。

根目录 `npm test` 运行 SDK 单元测试、构建 Vue/React 两个宿主示例、从 `npm pack` 产物隔离安装并验证类型与 Vite 开发/构建、验证 OIDC/CAS/SAML/WS-Fed 简版夹具，再运行四个协议的独立实现互操作测试。简版夹具可以用 `npm run start --workspace=@sso-test/protocol-fixture` 启动；WS-Fed 参考环境复现条件见 [`services/wsfed-reference`](services/wsfed-reference/README.md)。测试范围见 [回归测试说明](tests/README.md)；SDK 使用方式和后端接口契约见 [SDK README](packages/browser-sdk/README.md)。

目前 OIDC、CAS、SAML 已完成首版本机验证；WS-Fed 已完成独立 STS/RP 本机互操作和 Vue/React 浏览器流程，但暂保留为扩展实验能力，详见 [`tasks/wsfed-integration/verification.md`](tasks/wsfed-integration/verification.md)。Negotiate 已有本地真实 Kerberos 与 HTTPS/Firefox 证据，但仍待企业受管浏览器和域环境，详见[验证记录](tasks/negotiate-integration/verification.md)。打包 SDK 的宿主兼容证据见 [`tasks/host-compatibility/verification.md`](tasks/host-compatibility/verification.md)，业务接入要求见[首版接入指南](docs/SSO_首版接入指南.md)，[本地候选快照](release-candidate/README.md)记录了确切 tarball 与哈希，[变更记录](CHANGELOG.md)说明候选范围，发布条件见[首版发布检查表](docs/SSO_首版发布检查表.md)。生产认证中心与真实业务宿主仍需单独验收。参考实现使用开发专用的内存存储、临时签名材料和登录页，仅用于本机测试。Webpack 按当前要求暂缓。

## 许可证

本仓库按 [MIT 许可证](LICENSE)开放。SDK npm 包仍处于 `private: true` 的本地候选阶段；公开源码不代表已经发布正式包。
