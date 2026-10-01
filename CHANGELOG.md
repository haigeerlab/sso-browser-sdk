# Changelog

## Unreleased — 本地首版候选（2026-10-01）

### Added

- 无框架依赖的浏览器 SDK：宿主会话查询、同源登录导航、自动跳转防循环、状态订阅、手动重试与本域登出。
- OIDC 授权码、CAS 票据和 SAML 2.0 的宿主后端会话接入入口；协议票据与断言由宿主后端验证。
- Vue 3.4.0、React 19.3.0 和 Vite 5.0.0 的隔离包安装与代表流程验证。

### Experimental

- WS-Federation Web Passive 入口已完成本机独立 STS/RP 与浏览器互操作，仍待真实业务环境验收。
- HTTP Negotiate 入口已完成本地真实 Kerberos、双宿主 HTTPS 与 Firefox SDK 互操作，仍待企业域和受管浏览器验收。

### Release status

- 当前仅有 `sso-browser-sdk-prototype@0.0.0` 的[本地候选快照](release-candidate/README.md)，未发布到 registry。
- 首版正式支持声明限于 OIDC、CAS、SAML 的宿主后端会话模式。真实业务宿主、正式包坐标、许可证、CI 与生产部署仍需验收或确定。
