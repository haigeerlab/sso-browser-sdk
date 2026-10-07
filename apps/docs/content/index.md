---
layout: home
hero:
  name: SSO Browser SDK
  text: 把业务应用接入后端会话
  tagline: 一套浏览器 API，连接已有 OIDC、CAS、SAML 认证后端，完成登录导航、会话恢复与本域退出。
  actions:
    - theme: brand
      text: 开始接入
      link: /guide/prerequisites
    - theme: alt
      text: 运行双宿主 Demo
      link: /demos/overview
features:
  - title: 先核对后端
    details: 协议由业务后端处理。前端只需要会话查询、同源登录入口与登出接口。
    link: /backend/contract
  - title: 使用完整示例
    details: 原生 TypeScript、Vue、React 示例与文档共用源文件，并从 SDK tarball 隔离安装验证。
    link: /frameworks/typescript
  - title: 按协议接入
    details: OIDC、CAS、SAML 已有本机互操作证据。WS-Fed 与 Negotiate 保留实验状态。
    link: /reference/support
---

## 当前版本

包为 `sso-browser-sdk-prototype@0.0.0`，尚未发布到 npm registry。请按[安装指南](./guide/quick-start)使用源码构建的 tarball。生产认证中心与真实业务宿主仍需单独验收。

推荐阅读顺序：[接入前检查](./guide/prerequisites) → [安装](./guide/quick-start) → [Vue](./frameworks/vue) 或 [React](./frameworks/react) → [后端接口](./backend/contract) → [协议配置](./protocols/oidc) → [排错](./deployment/troubleshooting)。
