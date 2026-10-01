# sdk-core 验证记录（2026-10-01）

## 契约核对

- `packages/browser-sdk/src/index.ts` 提供 Spec 规定的六个公共方法、五态会话模型及可注入的环境依赖；`redirect.ts` 只负责宿主后端登录入口的导航参数。
- 单元用例覆盖宿主响应映射、`401` 与网络错误区分、同源回跳、自动跳转防循环、并发受保护页面检查、登出失败和旧会话请求覆盖风险。
- 宿主会话查询和登出由 SDK 调用，身份提供方交互及业务 API 鉴权仍由宿主后端负责；本模块不宣称协议互操作能力。

## 命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm test --workspace=sso-browser-sdk-prototype` | TypeScript 构建通过，19 项单元测试通过；其中根入口和五个子路径在 Node 环境成功导入。 |
| `npm pack --workspace=sso-browser-sdk-prototype --dry-run --json --cache /private/tmp/sso-npm-cache` | 16 个文件，约 5.8 kB；仅 README、dist 入口与类型、package.json，无示例、测试服务或测试文件。 |

首次在默认沙箱运行构建时，向 SDK 目录写入 `dist` 被文件系统权限拒绝（TS5033）；在用户指定的项目目录获得写入权限后重跑，构建和测试均通过。此失败不涉及代码断言。

## 联调补正（2026-10-01）

- 用户已评审公共契约。真实 OIDC 联调发现：主动登录后取消会清除尝试标记，返回宿主时再次触发自动登录。新增单元测试先复现失败，再让 `login()` 记录本次导航尝试；用户主动重试仍可再次导航。
- `npm test --workspace=sso-browser-sdk-prototype`：类型构建通过，20/20 单元测试通过。
- 重新构建 Vue/React 示例后，在 Codex 内置浏览器验证 Vue App A：首次取消显示 `error`；点击“登录”后再次取消仍返回 App A 并显示 `error`，没有自动跳转到认证中心。
- 真实业务宿主、生产认证中心和全局单点登出不属于本模块已验证范围。
