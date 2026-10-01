# oidc-integration 验证记录

## 既有证据核对（2026-10-01）

| 场景 | 证据 | 状态 |
| --- | --- | --- |
| 同源宿主登录入口与回跳参数 | `packages/browser-sdk/test/oidc.test.mjs`、`redirect-adapters.test.mjs` | 单元测试已覆盖 |
| 双宿主共用中心会话、本域 Cookie 独立、无效回调与重放 | `tests/integration/oidc-fixture.test.mjs` | 简版夹具已覆盖；不证明真实 OIDC |
| 发现文档、授权码 + PKCE、令牌交换、`state` 篡改、回调重放、本域登出后恢复 | `tests/interop/oidc-reference.test.mjs` | `oidc-provider` 9.12.2 与 `openid-client` 6.8.8 互操作已覆盖 |
| Vue App A 登录一次，React App B 无额外交互，B 本域登出不影响 A，B 可恢复 | `tasks/oidc-reference-evidence-2026-10-01.md` | Codex 内置浏览器已实测 |
| 中心会话真实过期后再次进入 B | `tests/interop/oidc-reference.test.mjs`：参考提供方中心会话 2 秒过期后，B 再次要求登录 | 已通过 |
| 取消或认证中心错误回调后的业务页面可见反馈 | 真实提供方 `/abort` 返回 `access_denied`，宿主不建立会话；内置浏览器两次取消均回到 Vue App A 并显示 `error` | 已通过 |
| 生产认证中心、真实业务宿主与全局单点登出 | 尚无目标环境 | 不在本模块已通过范围 |

参考实现使用本机 HTTP、内存适配器、临时签名密钥和开发登录交互页；这些配置只供互操作测试。自动化与浏览器的详细步骤见 [OIDC 参考实现记录](../oidc-reference-evidence-2026-10-01.md)。

已修正 `packages/browser-sdk/README.md` 中“真实 OIDC 尚未验证”的过时表述；文档现在区分真实参考实现互操作与生产认证中心、真实业务宿主验收。

## 异常路径与完整回归（2026-10-01）

- 真实参考提供方增加短中心会话测试：A 登录后等待 2.5 秒，B 必须重新出现登录交互。测试明确将提供方 `clockTolerance` 设为 0，避免默认 15 秒容差掩盖到期行为。
- 真实提供方取消登录返回 `access_denied`；宿主回调在验证 `state` 后清除待处理记录、返回业务页面且不创建本域会话。无效 `state` 仍返回 400。
- SDK 核心补正主动登录尝试标记。Vue App A 浏览器实测“首次自动登录取消 → 错误页 → 点击登录 → 再次取消 → 错误页”，没有循环跳转。
- 根目录 `npm test` 通过：20 项 SDK 单元测试、Vue 3.4.0 和 React 的 Vite 5.0.0 构建、8 项简版协议交互测试、3 项真实 OIDC 互操作测试。
- 生产认证中心与真实业务宿主仍需独立接入验收；全局单点登出、刷新令牌不在本模块范围。本机参考服务使用开发专用内存存储、临时签名密钥和 HTTP，不能直接用于生产。
