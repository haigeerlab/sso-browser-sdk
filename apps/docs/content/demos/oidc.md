# OIDC 双宿主 Demo

参考环境：Node `oidc-provider` 9.12.2 + `openid-client` 6.8.8。中心和宿主后端都在本机，宿主是真实授权码/PKCE 客户端。

## 启动

完成[环境准备](./overview#准备)后，在仓库根目录：

```bash
npm run start --workspace=@sso-test/oidc-reference
```

终端输出随机端口的 `http://127.0.0.1:<port>/app-a/` 和 `/app-b/`，前者 Vue、后者 React。中心地址是相同端口的 `localhost`，不要把它改成 `127.0.0.1`。

使用本轮文档示例：`npm run docs:examples`。地址仍以终端输出为准。

## 操作与预期

1. 打开 A，中心开发登录页出现。使用测试标识 `demo` 按页面完成开发登录交互。
2. 回到 A，页面显示 `demo` 用户；刷新仍已登录。
3. 打开 B，复用中心会话，不再输入中心凭据。
4. B 本域退出后未登录，A 不受影响；B 主动登录可再次恢复。
5. 在新浏览器会话中取消中心交互，宿主不建立会话；前端停止自动重试并提供手动按钮。

OIDC 中心使用库的开发交互页，与 CAS/SAML 的固定密码页不同，不保证每个页面都采用 `demo/demo` 表单。

## 路径对照

| 用途 | A | B |
| --- | --- | --- |
| 会话 | `/app-a/auth/session` | `/app-b/auth/session` |
| 登录 | `/app-a/auth/oidc/start` | `/app-b/auth/oidc/start` |
| 回调 | `/app-a/auth/oidc/callback` | `/app-b/auth/oidc/callback` |
| 退出 | `/app-a/auth/logout` | `/app-b/auth/logout` |

自动化复测：`node --test tests/interop/oidc-reference.test.mjs`。前端基本配置见[OIDC 接入](../protocols/oidc)，服务源码见 [server.mjs](https://github.com/haigeerlab/sso-browser-sdk/blob/main/services/oidc-reference/server.mjs)。

## 停止与限制

按 Ctrl+C。服务内存会话和临时开发签名材料不会作为生产配置保留；重启会使中心会话消失。真实 issuer、多实例和 HTTPS 接入需另验收。
