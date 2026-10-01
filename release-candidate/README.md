# SSO 浏览器 SDK 本地首版候选快照

日期：2026-10-01。已按用户选择把 Negotiate 保留为实验入口，首版正式支持声明仅覆盖 OIDC、CAS、SAML 的宿主后端会话模式。WS-Fed 也仍是实验入口。此文件记录可审阅的**本地原型包快照**，不是已发布的稳定版本。

## 确切产物

- 文件：[sso-browser-sdk-prototype-0.0.0.tgz](sso-browser-sdk-prototype-0.0.0.tgz)
- SHA-256：`c198fdda6c7e77841a10a18f25f750f741bccbd56a50e5c9373afbe23bf5f242`
- 包标识：`sso-browser-sdk-prototype@0.0.0`，仍为 `private: true`；正式包名、版本和 registry 待定。
- `npm pack` 报告 17 个文件、压缩大小 7611 字节、解包大小 19750 字节。仅包含 MIT LICENSE、包 README、package.json、`dist` 下的 ESM 与类型声明；无运行时依赖、测试服务、证书或私钥。
- 从同一源码在独立临时目录再次执行 `npm pack`，得到相同的 SHA-256。tarball 是本机候选交付物，按 `.gitignore` 不纳入 Git；版本库保留此记录与可重建的源码。
- 对应本地源码基线提交：`3f4b56e874be3226f3e1559ce06d236575072afe`。该提交已包含在公开 GitHub `main` 的历史中，但不是版本标签。
- 包保留 `/wsfed`、`/negotiate` 子入口以供实验接入，**不表示首版正式支持**。根入口与 `/oidc`、`/cas`、`/saml` 是首版候选的正式接口范围。

## 本轮验证

| 检查 | 结果 |
| --- | --- |
| `npm test` | 通过：SDK 单测 20/20、Vue 3.4.0 / React 19.3.0 的 Vite 5.0.0 构建、tarball 隔离兼容 4/4、交互 29/29、独立互操作 20/20。 |
| 确切 tarball 独立安装 | 在私有临时目录离线安装成功；根入口与五个协议子入口均可由 Node ESM 导入，包内 LICENSE 与源码一致。临时消费者已删除。 |
| 包内容与哈希 | 使用 `npm pack --workspace=sso-browser-sdk-prototype --pack-destination release-candidate --json`、`tar -tzf` 和 `shasum -a 256` 核对。 |
| SDK 生产依赖审计 | `npm audit --omit=dev --workspace=sso-browser-sdk-prototype --json`：0 项告警。 |
| 首次 GitHub CI | [运行 36872579563](https://github.com/haigeerlab/sso-browser-sdk/actions/runs/36872579563) 在提交 `18ae946` 上通过全量回归、SDK 生产审计与包清单检查。 |
| 全仓审计 | `npm audit --json`：8 个包级告警（2 high、6 moderate），位于私有 Vite 5 兼容宿主与 WS-Fed 参考服务依赖链；见[发布检查表](../docs/SSO_首版发布检查表.md)。 |

## 尚未满足的稳定发布门槛

项目已在 [GitHub](https://github.com/haigeerlab/sso-browser-sdk) 公开托管，采用 MIT 许可证，首次 runner 回归通过；仍没有正式包名、目标 registry、版本策略或发布标签；也没有真实业务宿主与实际认证中心的生产前 HTTPS、Cookie、代理及业务 API 验收。目标浏览器版本与开发链安全处置仍需确定。Negotiate 的企业域验收见[待办](../tasks/negotiate-integration/todo.md)，不会因这份候选快照自动完成。完整门槛见[发布检查表](../docs/SSO_首版发布检查表.md)。

确定正式发布目标并完成真实宿主联调后，应在可追溯提交上重新构建、回归和审计，生成新的确切 tarball；不能直接把此 `private: true`、`0.0.0` 快照视作可发布包。
