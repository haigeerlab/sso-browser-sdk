# release-readiness 验证记录

日期：2026-10-01。本模块完成本机候选证据收口，**没有发布 npm 包，也不声明生产稳定版就绪**。

## 首版能力证据

| 范围 | 已验证内容 | 证据 |
| --- | --- | --- |
| SDK 核心 | 会话状态、`401` 与故障区分、同源回跳、防循环、手动重试、本域登出 | [sdk-core](../sdk-core/verification.md)、20 项单测 |
| OIDC 宿主模式 | `oidc-provider` 9.12.2 + `openid-client` 6.8.8；授权码 + PKCE、双宿主、过期、取消、重放 | [OIDC 记录](../oidc-integration/verification.md)、独立互操作 3 项 |
| CAS 宿主模式 | `django-cas-server` 3.1.0；双宿主、错误服务、票据过期/重放、失败 | [CAS 记录](../cas-integration/verification.md)、独立互操作 5 项 |
| SAML 宿主模式 | `samlify` 2.13.1 + `node-saml` 5.1.0；签名、受众/地址、时效、请求关联、重放 | [SAML 记录](../saml-integration/verification.md)、独立互操作 5 项 |
| 宿主兼容 | 同一 tarball 分别安装到 Vue 3.4.0、React 19.3.0、Vite 5.0.0；类型、开发与构建、浏览器代表路径 | [兼容记录](../host-compatibility/verification.md)、兼容测试 4 项 |

此处的简版后端交互 14 项用于验证跳转、会话和错误流转，不被当作协议安全实现。独立参考服务同样只证明本机互操作；生产认证中心和真实业务宿主没有验收证据。在本次首版候选收口时，WS-Fed、Negotiate 只有前端入口单测；两者后续已有独立本机证据，分别见 [WS-Fed](../wsfed-integration/verification.md) 和 [Negotiate](../negotiate-integration/verification.md) 模块记录，仍不改变首版正式支持范围。

## 本次复测

- `npm test` 退出码 0：SDK 单测 **20/20**，Vue/React 的 Vite 5.0.0 构建通过，tarball 隔离安装兼容测试 **4/4**，简版交互 **14/14**，独立协议互操作 **13/13**。
- `npm pack --workspace=sso-browser-sdk-prototype --dry-run --json`：`sso-browser-sdk-prototype@0.0.0`，16 个文件，约 6.3 kB；`README.md`、`package.json` 及 `dist/*.js`/`dist/*.d.ts`。无运行时 `dependencies`、无 bundled 依赖；没有示例宿主、参考服务、证书、私钥或测试文件。
- `npm audit --omit=dev --workspace=sso-browser-sdk-prototype --json`：0 项生产依赖告警。`npm audit --json`：2 个**包级**告警，Vite 为 high、esbuild 为 moderate；前者聚合多条安全公告，不能解读成总共只有两条漏洞。安装路径为私有 `apps/compat` → Vite 5.0.0 → esbuild 0.19.12，未进入 SDK tarball。说明与处置边界见[发布检查表](../../docs/SSO_首版发布检查表.md)。
- 已提供[业务前后端接入指南](../../docs/SSO_首版接入指南.md)，包含同源会话、协议回调、Cookie、CSRF、安全回跳和错误/登出语义；根 README 和 SDK README 已链接并标明实验入口。
- Spec Guard `verify-artifacts.sh`：3 通过、0 失败；另有历史状态文件提示，远端 tracker 映射没有被读取或验证。

## 发布结论与阻断项

当前只能称为**已完成本机验证的私有原型候选**。以下条件仍未满足：

1. 包为 `private: true`、`0.0.0`，正式包名、目标 registry、许可证、版本策略和发布权限未确定；没有对外发布动作授权。
2. 本模块收口时项目目录没有 Git 仓库或 CI。后续已建立本地基线提交 `173fabf`；远端、CI、发布标签与自动发布回归仍缺失。
3. 未接入真实业务宿主和实际统一认证中心，生产 HTTPS、Cookie、反向代理、业务 API、分布式会话及密钥轮换未验收。
4. Codex 内置浏览器完成代表流程，但接口未提供精确 Chromium 版本；没有可标识版本的目标浏览器记录。
5. 用户指定的 Vite 5.0.0 兼容测试通过，但其开发链审计告警仍在。不能把旧开发服务对外暴露，实际宿主构建工具的版本与风险处置需单独确认；这不改变 SDK 无 Vite 运行时依赖的事实。

上述条件具体检查顺序见[发布检查表](../../docs/SSO_首版发布检查表.md)。下一步需业务方提供目标包名/registry与首个真实宿主环境，才能继续将原型转换为可发布版本并完成生产前验收。

## 2026-10-01 GitHub 公开仓库 CI 准备

- 用户确定 GitHub 公开开源托管；仓库地址、许可证与版权信息仍待确定，尚未创建远端或推送。
- 新增 `.github/workflows/ci.yml`：在 `main` 推送、Pull Request 和手动触发时使用 Ubuntu 24.04、Node 22.22.0、Python 3.10，安装 CAS 锁定依赖，运行 `npm test`、SDK 生产依赖审计及包清单检查；全仓审计报告已知测试依赖告警，但不阻断当前候选。
- 工作流 YAML 结构检查通过；本机按工作流命令复验 `npm test` 退出码 0（SDK 单测 20/20、打包宿主兼容 4/4、简版交互 29/29、独立互操作 20/20），SDK 生产依赖审计 0 项，`npm pack --dry-run --json` 仍为 16 个文件。
- 已检查 Git 跟踪文件名和常见私钥/令牌形态，未发现匹配。此扫描不能代替开源前对文档、测试账号、历史提交和最终 tarball 的人工审阅。
- 尚无 GitHub runner 执行记录，不能把本机复验表述为云端 CI 通过；本地域 Kerberos/Firefox 实验测试未纳入默认 CI。

## 2026-10-01 公开仓库内容预检

- 只读扫描本地 Git 的 4 个提交、447 个已跟踪文件快照：未发现私钥头、常见 GitHub/npm/AWS 令牌形态或用户目录绝对路径；历史文件名中也没有 `.env`、私钥或证书密钥文件。
- 检查当前文件中的 URL 主机名：除官方规范/依赖文档与公开服务外，均是 `localhost`、`example.test`、`invalid` 等测试用地址；没有发现企业内部域名。
- 这些是模式扫描，不能证明所有敏感数据都不存在。首次公开推送前仍需按实际远端、许可证与最终提交清单复核；目前尚未公开推送。

## 2026-10-01 MIT 开源源码候选

- 按用户继续指令采用 `haigeerlab/sso-browser-sdk` 公开 GitHub 仓库、MIT 许可证和 `2026 Haigeerlab Contributors` 版权行；仓库与 SDK 包都含 LICENSE，包元数据包含仓库地址，npm 包仍为 `private: true` 原型。
- `npm ci` 从锁文件干净安装成功；`npm test` 退出码 0：SDK 单测 20/20、宿主打包兼容 4/4、简版交互 29/29、独立协议互操作 20/20。SDK 生产依赖审计 0 项；全仓安装报告既有 8 个包级告警（2 high、6 moderate），归属见发布检查表。
- 从提交 `3f4b56e874be3226f3e1559ce06d236575072afe` 打包：17 文件，含 LICENSE，SHA-256 `c198fdda6c7e77841a10a18f25f750f741bccbd56a50e5c9373afbe23bf5f242`；独立临时目录重打包字节相同。确切 tarball 离线安装后，根入口和五个协议子入口均可导入，安装的 LICENSE 与源码一致。
- 此时尚未创建远端或运行 GitHub Actions，候选仍不是 npm 稳定版。

## 2026-10-01 CI JDK 前置条件补齐

- SAML 独立互操作依赖的 XSD 验证器在 `npm ci` 安装脚本中调用 `javac`；GitHub CI 已在 `npm ci` 前通过 `actions/setup-java@v6` 固定 Temurin 21，而不依赖 runner 镜像碰巧预装的 JDK。依据参考服务 README 与官方 setup-java 用法。
- 本机此前从锁文件运行 `npm ci` 和全量 `npm test` 通过；新增的是 runner 环境配置，尚无 GitHub Actions 实跑记录。

## 2026-10-01 公开仓库与首次 GitHub runner 回归

- 用户明确授权创建公开 `haigeerlab/sso-browser-sdk` 并推送本地 `main` 完整历史；GitHub 仓库已创建，远端 `main` 与本地提交 `18ae9466658f03b01773d4e429ff383244ca8cbb` 一致，GitHub 返回 `PUBLIC` 且识别 `MIT License`。
- [首次 CI 运行 36872579563](https://github.com/haigeerlab/sso-browser-sdk/actions/runs/36872579563) 在该提交上结论为 `success`，耗时约 1 分 16 秒：Node、Python、Temurin JDK 安装、`npm ci`、CAS Python 依赖、全量测试、SDK 生产依赖审计与包清单步骤均成功。
- 全仓 `npm audit` 在私有测试依赖中报告 8 项（2 high、6 moderate）；原先 `continue-on-error` 使该步骤虽不阻断 CI，仍在页面留下红色退出码注解。工作流已改为解析 JSON 并输出摘要；本机按工作流命令复验输出 8 项与受影响包名，云端复验由后续提交的 CI 负责。
