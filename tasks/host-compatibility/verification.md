# host-compatibility 验证记录

日期：2026-10-01。机器：macOS，Node 22.22.0，npm 10.9.4。SDK 包：`sso-browser-sdk-prototype@0.0.0`，ESM，`private` 原型。

## 包与宿主矩阵

| 消费者 | 框架 | 构建工具 | SDK 来源 | 根入口及 OIDC/CAS/SAML 子路径 | TypeScript | Vite 开发服务 | 生产构建 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 隔离 Vue 宿主 | Vue 3.4.0 | Vite 5.0.0、plugin-vue 5.0.1 | 同一次 `npm pack` tarball | 通过 | TypeScript 6.0.3 通过 | 通过 | 通过 |
| 隔离 React 宿主 | React/React DOM 19.3.0 | Vite 5.0.0 | 同一次 `npm pack` tarball | 通过 | TypeScript 6.0.3 通过 | 通过 | 通过 |

复现命令：`npm run test:compat`。脚本在系统临时目录创建两个独立 `package.json`，从 SDK tarball 安装，检查安装路径位于临时消费者目录而非工作区软链接，然后检查运行时和 `.d.ts` 导出、Vite 开发页面和转换后的入口、生产构建。临时安装目录在测试结束后删除。根目录 `npm test` 已接入这项测试；完整回归为 SDK 单元测试 20/20、兼容测试 4/4、简版交互测试 14/14、独立协议互操作测试 13/13，均通过。

`npm pack --workspace=sso-browser-sdk-prototype --dry-run --json`：16 个文件，约 6.2 kB tarball；仅含 `README.md`、`package.json`、`dist/*.js` 与 `dist/*.d.ts`。包没有运行时 `dependencies` 或 `bundled` 项，未包含 Vue、React、Vite、测试服务、证书和私钥。直接在 Node 中导入打包模块通过，说明模块导入阶段不依赖浏览器全局对象；这不等于完整 SSR 集成验证。

## 浏览器实测

浏览器：Codex 内置浏览器（Chromium；当前浏览器控制接口未提供精确版本）。可复现打包宿主页面：

```bash
SSO_PACKED_BUILD_DIR=/tmp/sso-packed-build npm run test:compat
SSO_COMPAT_BUILD_ROOT=/tmp/sso-packed-build SSO_FIXTURE_PORT=0 node services/protocol-fixture/server.mjs
```

第二条命令输出实际端口。此轮在 `127.0.0.1:55405` 的简版后端上加载从 tarball 隔离安装构建的 Vue/React 页面，人工浏览器操作结果如下：

| 场景 | 观察结果 |
| --- | --- |
| Vue `?returnParam=next` 首次 OIDC 登录 | 跳至中心；以 demo 登录后回到原查询参数，显示 `authenticated: demo`。后端要求 `next`，未提供时返回 400。 |
| Vue 刷新 | 会话恢复，仍显示 `authenticated: demo`。 |
| React `?legacySession=1` | 无需再次输入中心凭据，`session.map` 将 `loggedIn/profile` 响应映射为 `authenticated: demo`；刷新后仍恢复。 |
| React 本域登出 | 页面显示 `unauthenticated`；另一宿主的会话保持有效。 |
| React SAML 取消与重试 | 取消后回到宿主，显示 `error`；点击“登录”再次跳转，登录成功后显示 `authenticated: demo`，旧 `ssoError` 查询参数被去除。 |

浏览器最终成功页面的错误级控制台日志为空。OIDC、CAS、SAML 的协议校验细节仍由各模块独立互操作测试承担；本模块的浏览器验证聚焦宿主兼容和代表路径。

## 边界

- 本轮未获得内置浏览器的精确 Chromium 版本，浏览器版本矩阵仍需在发布准备阶段用可识别版本的浏览器补齐；不能把本记录扩展为所有 Chromium 版本承诺。
- 未验证 Webpack、Vue 2、其他 React/Vite 版本、跨源 API、SSR 全流程、生产反向代理和真实业务 IdP/SP。生产后端仍需按 SDK README 的会话与协议契约验收。
- 首次隔离安装需要 npm registry 可用或相应依赖已缓存；测试使用 `--prefer-offline`，不依赖工作区软链接。
