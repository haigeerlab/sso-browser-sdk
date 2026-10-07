# 实验协议 Demo

## WS-Fed

需要 Node 22、OpenSSL 和 npm 依赖。独立 STS/RP 签发并验证 SAML 1.1：

```bash
npm run build:hosts
SSO_WSFED_REFERENCE_PORT=43912 npm run start --workspace=@sso-test/wsfed-reference
```

打开 `http://127.0.0.1:43912/app-a/?protocol=wsfed`，以 `demo/demo` 登录，再访问 `/app-b/?protocol=wsfed`。复用中心登录、刷新、本域退出及手动恢复均可验证；新中心会话可取消并重试。

本轮文档示例：`SSO_DOCS_PROTOCOL=wsfed npm run docs:examples`。复测：`node --test tests/interop/wsfed-reference.test.mjs`。

realm 为 `urn:reference:app-a` / `urn:reference:app-b`，reply 为各自 `/<app>/auth/wsfed/callback`，issuer 位于中心 `/wsfed/issuer`。参考库有测试依赖告警，不推荐生产部署。Ctrl+C 停止并清理临时证书。[协议说明](../protocols/wsfed)

## Negotiate 的本地真实 Kerberos 实验

此项不使用 `docs:examples` 启动器，也不是普通 Node 登录表单。需要 Python 3、JDK、OpenSSL、支持 GSS-API/SPNEGO 的 curl，以及 MIT Kerberos KDC 管理工具。

```bash
npm run test:kerberos:local
```

可选 Firefox 自验还需 geckodriver：

```bash
SSO_KERBEROS_FIREFOX="/Applications/Firefox.app/Contents/MacOS/firefox" npm run test:kerberos:local
```

脚本生成临时测试域、随机身份材料、两宿主服务主体和本地 HTTP/HTTPS 服务，执行真实验票、独立会话、退出与负例，完成后自动退出清理。Firefox 在专用自动化会话中接受临时自签名证书，不证明企业证书链信任。

完整环境变量和证据边界见 [实验 README](https://github.com/haigeerlab/sso-browser-sdk/blob/main/tests/interop/kerberos-lab/README.md)。没有企业域或浏览器策略时，不勾选两项[企业域验收](https://github.com/haigeerlab/sso-browser-sdk/blob/main/tasks/negotiate-integration/todo.md)。

匿名接口预检：`node scripts/negotiate-domain-preflight.mjs /private/tmp/negotiate-domain-config.json`，需先按[模板](https://github.com/haigeerlab/sso-browser-sdk/blob/main/tasks/negotiate-integration/domain-validation.md)填真实配置；预检不发送域凭据，不证明 Kerberos。
