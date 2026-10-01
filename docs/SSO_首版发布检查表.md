# SSO 浏览器 SDK 首版发布检查表

状态：**本机发布候选证据已收集，稳定版尚未就绪。** 本表区分“本机通过”和“生产接入通过”；实际发布必须另行核对目标 registry、版本和精确 tarball。

## 可复测检查

| 检查 | 命令或证据 | 当前状态 |
| --- | --- | --- |
| 单元、兼容、简版交互、独立互操作 | 仓库根目录 `npm test` | 本机通过，见[验证记录](../tasks/release-readiness/verification.md) |
| 实际包隔离安装 | `npm run test:compat`，Vue/React 分别从同一 `npm pack` tarball 安装 | 通过 |
| 包文件与运行时依赖 | `npm pack --workspace=sso-browser-sdk-prototype --dry-run --json` | 17 个文件、含 MIT LICENSE、无运行时依赖；测试服务/密钥不入包 |
| 后端接口与协议责任 | [接入指南](SSO_首版接入指南.md) | 文档已列出；待真实业务后端核对 |
| 依赖审计 | `npm audit --json` 与 `npm audit --omit=dev --workspace=sso-browser-sdk-prototype --json` | 全仓 8 个包级告警（2 high、6 moderate）；SDK 工作区生产依赖告警 0 项 |
| 文档与能力图 | Spec Guard `verify-artifacts.sh` | 3 通过、0 失败；历史状态文件提示不代表远端验证 |

## 发布门槛与当前缺口

| 门槛 | 当前事实 | 进入稳定发布前要完成 |
| --- | --- | --- |
| 正式发布目标 | SDK 仍名为 `sso-browser-sdk-prototype@0.0.0` 且 `private: true` | 确定 npm 公共/私有 registry、正式包名、命名权、版本号与发布权限；审阅最终 tarball |
| 开源许可证与元数据 | 已选 MIT；根仓库与 SDK 包均含 LICENSE，GitHub 已识别 MIT；包声明 `license` 与仓库地址，`engines` 与支持政策尚未声明 | 确定正式发布前的包名、运行环境和支持政策 |
| 版本可追溯与自动回归 | [公开 GitHub 仓库](https://github.com/haigeerlab/sso-browser-sdk) 的 `main` 已推送完整历史；首次 [CI 运行](https://github.com/haigeerlab/sso-browser-sdk/actions/runs/36872579563) 在 `18ae946` 成功，尚无发布标签 | 正式包发布时从已通过 CI 的提交打标签，并记录包与提交的对应关系 |
| 真实业务接入 | 只有本机参考 IdP/SP 与示例宿主 | 至少一个真实业务宿主接入实际认证中心，验收 HTTPS、Cookie、代理、多实例、异常与业务 API 鉴权 |
| 浏览器版本矩阵 | 已用 Codex 内置浏览器实测，但其精确 Chromium 版本未暴露 | 在可识别版本的目标浏览器复测首版代表流程并记录版本 |
| 开发链安全 | Vite 5.0.0 与 esbuild 0.19.12 被当前审计标记 | 保留 Vite 5.0.0 **兼容测试**；实际宿主开发环境评估受支持且已修复的工具版本，不对外暴露旧开发服务；记录最终依赖审计与风险决定 |

## 依赖告警归属

2026-10-01 首版候选复测的 `npm audit --json` 报告 **8 个包级告警（2 high、6 moderate）**：Vite、esbuild 位于私有 `apps/compat` 的开发链；`@xmldom/xmldom`、`passport-wsfed-saml2`、`saml`、`wsfed`、`xml-crypto`、`xml-encryption` 位于私有 WS-Fed 参考服务依赖链。早期发布准备记录中的 2 项是加入 WS-Fed 参考服务之前的快照。`packages/browser-sdk` 没有运行时依赖，候选 tarball 不包含这些工具或参考服务；这不等于实际业务宿主的开发链已经安全。

相关公告说明了旧版 Vite 开发服务的文件访问问题与 esbuild 开发服务的跨源读取问题：[Vite 大小写文件系统绕过](https://github.com/advisories/GHSA-c24v-8rfc-w8vw)、[Vite `.map` 路径访问](https://github.com/advisories/GHSA-4w7w-66w2-5vf9)、[esbuild 开发服务 CORS](https://github.com/advisories/GHSA-67mh-4wv8-2f99)。`npm audit` 给出 Vite 5.4.21 的部分自动修复建议，但 2026 年的 `.map` 公告将 `<=6.4.1` 列为受影响范围；因此不能只按自动修复建议宣称 Vite 5.4.21 已清除全部告警。具体风险还取决于开发服务是否暴露、文件系统及敏感文件位置；发布前应重新核对权威公告和最终锁定版本。

## 支持范围决策

- 首版正式支持声明仅写 OIDC、CAS、SAML 的**宿主后端会话模式**。WS-Fed 已完成本机独立 STS/RP 互操作与 Vue/React 浏览器流程；Negotiate 已完成临时本地域的真实 Kerberos 验票、HTTP/HTTPS 双宿主与 Firefox SDK 流程，见[验证记录](../tasks/negotiate-integration/verification.md)。两者仍是扩展实验入口：WS-Fed 缺真实业务 STS/RP 验收，Negotiate 缺企业域、受管浏览器、企业证书链与代理验收；本机结果不能代替生产联调。
- Vue 3.4.0、React 19.3.0、Vite 5.0.0 为已测版本点，不推出框架版本范围。Vite 是宿主工具，不是 SDK 的依赖或正式包内容。Webpack 暂缓。
- 本域登出通过；IdP 全局登出、真实生产 SSO、完整 SSR、跨源 API 与各类浏览器版本不在已验证声明中。

## 最终发布动作前的核对

1. 固定正式包名、registry、版本、许可证和发布账号；在干净 Git 提交上运行全量测试与审计，记录结果。
2. 打出确切 tarball，复查 `files`、`exports`、类型和哈希；用该文件在真实宿主安装并完成目标环境联调。
3. 对照支持矩阵与剩余风险审阅发布说明。得到用户对**目标 registry、包名、版本和最终发布**的确认后再向 registry 发布；发布后核对 registry 返回的版本与可安装性。
