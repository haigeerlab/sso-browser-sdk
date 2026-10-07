# Capability Map: SSO 浏览器 SDK

> 由 `/spec` 的 Phase 0 产出。**必须经人工评审后才能往下走。**
> Addy 原文：把图搞错代价很大，评审十行不算什么。

## 目标

为已有后端的 Vue、React 等浏览器业务应用提供一个无框架依赖的 SSO SDK 包。业务方按认证中心与宿主后端的协议能力选择接入方式、配置少量端点和响应映射，即可复用统一的登录、会话恢复与登出流程；协议验证和业务 API 鉴权由后端负责。

<!-- 这一段是 Proposal 评审的目标指纹底本（`spec-digest.py` 计算）。
     改写目标会让已发布的 Proposal 被判为过期，所以改了先人工评审；追加模块不需要改这里。
     标题必须是 `## 目标`（或 `## Goal`）—— 指纹脚本按标题定位这一节。 -->

## 模块

| Module id | Responsibility | Depends on |
|---|---|---|
| sdk-core | 定义宿主会话契约，交付无框架依赖的状态、导航与包构建基础。 | — |
| oidc-integration | 接入宿主后端 OIDC 授权码模式，并验证真实提供方的双宿主登录与失败路径。 | sdk-core |
| cas-integration | 接入宿主后端 CAS 票据模式，并验证验票、中心会话复用与失败路径。 | sdk-core |
| saml-integration | 接入宿主后端 SAML 模式，并验证 ACS 回调、会话恢复与失败路径。 | sdk-core |
| host-compatibility | 验证同一 SDK 在 Vue 3.4.0、React 与 Vite 5.0.0 宿主中的接入边界。 | sdk-core,oidc-integration,cas-integration,saml-integration |
| release-readiness | 汇总 OIDC、CAS、SAML 与宿主兼容证据、后端要求和包内容，确定首版可发布范围。 | oidc-integration,cas-integration,saml-integration,host-compatibility |
| wsfed-integration | 接入宿主后端 WS-Federation 被动登录模式，验证真实提供方交互并补充扩展版本验收。 | sdk-core,release-readiness |
| developer-docs | 交付开发者文档站与包 README，验证按协议和框架接入后端会话的可执行示例。 | sdk-core, release-readiness, wsfed-integration |
| negotiate-integration | 接入 HTTP Negotiate 模式，在受管浏览器和域环境中验证交互并补充扩展版本验收。 | sdk-core,release-readiness |

Build order: sdk-core → oidc-integration → cas-integration → saml-integration → host-compatibility → release-readiness → wsfed-integration → developer-docs → negotiate-integration

<!-- Spec Guard 按严格串行推进。为兼容上游格式，逗号分组会按左到右顺序展开为单模块步骤，不代表并行授权。 -->

---

## 评审记录

- [x] 模块边界确认（砍掉或替换一个模块，不需要重写其他模块的需求）
- [x] 依赖方向单向无环（互相依赖 = 它们本来就是一个模块）
- [x] module id 已定稿（kebab-case，之后绝不改名 —— 同一个 id 同时是
      `spec/<id>.md`、`tasks/<id>/`、`.agent/state.json` 的 `activeModule` 和 Proposal 中的模块名，
      已发布的 Proposal 改不动）
- [x] 构建顺序符合依赖拓扑

评审人：用户（对上一轮提出的八模块边界与首版三协议建议回复“继续”）
日期：2026-10-01
