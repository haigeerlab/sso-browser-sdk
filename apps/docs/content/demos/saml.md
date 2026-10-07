# SAML 双宿主 Demo

参考环境：`samlify` 2.13.1 IdP + 独立 `@node-saml/node-saml` 5.1.0 SP，真实签名的 Redirect/POST 流程。

## 启动

先准备 Node 22、OpenSSL、JDK 和 npm 依赖；在仓库根目录：

```bash
npm run build:hosts
SSO_SAML_REFERENCE_PORT=43977 npm run start --workspace=@sso-test/saml-reference
```

打开 `http://127.0.0.1:43977/app-a/?protocol=saml`，测试用户 `demo` / `demo`；B 为同端口 `/app-b/?protocol=saml`。

本轮文档示例：`SSO_DOCS_PROTOCOL=saml npm run docs:examples`，使用终端输出地址。临时签名证书由服务启动时用 OpenSSL 生成。

## 操作与预期

A 首次登录后显示 demo，B 无须再输入密码；刷新恢复；B 本域退出不影响 A，B 手动登录恢复。在新的中心会话中点击取消，回到业务页看到失败反馈；主动重试可以成功。

## 路径和元数据

| 用途 | 路径 |
| --- | --- |
| 中心元数据 | `http://localhost:43977/saml/metadata` |
| SP 元数据 | `http://127.0.0.1:43977/<app>/auth/saml/metadata` |
| ACS（POST） | `http://127.0.0.1:43977/<app>/auth/saml/acs` |
| 登录入口 | `/<app>/auth/saml/start` |
| 会话 / 退出 | `/<app>/auth/session` / `/<app>/auth/logout` |

`<app>` 为 `app-a` 或 `app-b`；使用随机端口的文档启动器时相应替换端口。

复测：`node --test tests/interop/saml-reference.test.mjs`。若报 `ERR_INVALID_XML` 且此前安装时跳过 scripts，先核对 JDK 和 XSD 验证器编译，不关闭校验。详情见[协议说明](../protocols/saml)。

## 停止与限制

Ctrl+C 删除临时证书与私钥。生产需要管理 IdP 可信证书、轮换、HTTPS 和共享关联/重放存储；当前内存环境不满足这些部署条件。
