# 支持矩阵与验证证据

当前包：`sso-browser-sdk-prototype@0.0.0`，ESM、类型声明、无运行时依赖，`private: true`。未发布 registry 稳定版。

## 能力范围

| 能力 | 当前证据 | 边界 |
| --- | --- | --- |
| SDK 核心 | 单测：状态、会话、防循环、导航、并发和本域退出 | 前端接入层，不代替后端认证和权限 |
| OIDC | 独立提供方/客户端授权码 + PKCE、双宿主与失败流程 | 本机 HTTP 参考环境，生产 issuer 未验收 |
| CAS | 独立 Django CAS 中心、真实验票、双宿主与负例 | 不覆盖代理票据、renew/gateway、全局 SLO |
| SAML | 独立 IdP/SP、验签/关联/时间/重放、双宿主 | SP 发起 Redirect/POST，其他模式未承诺 |
| WS-Fed | 独立 STS/RP、签名 SAML 1.1 和浏览器流程 | 实验；参考库告警和生产 RP/STS 待处理 |
| Negotiate | 本地真实 Kerberos、HTTP/HTTPS、可选 Firefox | 实验；企业域和受管浏览器两项验收仍未完成 |

## 宿主和浏览器

既有隔离消费者验证版本点：Vue 3.4.0、React/React DOM 19.3.0、Vite 5.0.0、TypeScript 6.0.3、Node 22.22.0。Vite 是宿主工具，SDK 不依赖它。文档站自身的依赖不扩展该矩阵。

Codex 内置浏览器已完成代表流程，但接口未暴露精确 Chromium 版本。Negotiate 单独记录本地 Firefox 版本及策略。没有对所有浏览器、Safari、Webpack、Vue 2、完整 SSR、跨源 API 或路由库作验证承诺。

## 复测与证据

仓库根目录 `npm test` 运行核心、既有打包宿主、简版交互和四种独立协议互操作。`npm run docs:check` 单独核对文档链接与真实 tarball 示例。Kerberos 实验是可选项，不在默认 CI 中。

- [SDK 核心](https://github.com/haigeerlab/sso-browser-sdk/blob/main/tasks/sdk-core/verification.md)
- [OIDC](https://github.com/haigeerlab/sso-browser-sdk/blob/main/tasks/oidc-integration/verification.md)、[CAS](https://github.com/haigeerlab/sso-browser-sdk/blob/main/tasks/cas-integration/verification.md)、[SAML](https://github.com/haigeerlab/sso-browser-sdk/blob/main/tasks/saml-integration/verification.md)
- [宿主兼容](https://github.com/haigeerlab/sso-browser-sdk/blob/main/tasks/host-compatibility/verification.md)
- [WS-Fed](https://github.com/haigeerlab/sso-browser-sdk/blob/main/tasks/wsfed-integration/verification.md)、[Negotiate](https://github.com/haigeerlab/sso-browser-sdk/blob/main/tasks/negotiate-integration/verification.md)
- [发布检查表](https://github.com/haigeerlab/sso-browser-sdk/blob/main/docs/SSO_首版发布检查表.md)

历史验证记录按时间保留；当前页面综合各模块较新的证据，不能把早期“只有入口”当作当前全部进展。

## 安全与正式发布

2026-10-07 的依赖审计：SDK 生产依赖和文档工作区均为 0 项；完整仓库为 11 项（6 high、5 moderate），涉及既有兼容环境和协议参考服务的依赖。文档新增依赖没有改变原有锁定版本。依赖快照会变化，发布前以最终审计为准。不要把参考服务器当成生产后端。

正式发布仍需要确定包名/registry/版本、最终 tarball、目标浏览器版本，以及至少一个真实业务宿主对实际认证中心的 HTTPS、Cookie、代理、多实例与业务 API 验收。
