# 本机联调与文档示例

仓库有两类环境：简版夹具只验证导航和会话约定；独立参考实现验证真实协议。完整接入演示优先使用后者，仍不等同生产环境。

## 准备

在仓库根目录，使用 Node 22.22.0、Python 3.10+、OpenSSL 和含 java/javac 的 JDK：

```bash
npm ci
python3 -m venv services/cas-reference/.venv
services/cas-reference/.venv/bin/python -m pip install -r services/cas-reference/requirements.lock
npm run build:hosts
```

只有 CAS 需要 Python 环境；SAML 首次 npm 安装需要 JDK 编译 XSD 验证器。安装时若跳过 scripts，需 `npm rebuild @authenio/xsd-schema-validator`。准备条件来自各服务 README，不要将安装失败误判为 SDK 接入失败。

## 运行页面中展示的源码

```bash
npm run docs:examples
```

启动器从 SDK tarball 隔离安装并构建文档中的 Vue App A、React App B，启动独立 OIDC 后端，输出两个访问地址。每个宿主使用自身 `/app-*/auth/*` 接口，代替业务示例中的 `/sso/*`；协议仍由参考后端处理。

选择其他协议，或将 App A 换为原生 TypeScript：

```bash
SSO_DOCS_PROTOCOL=cas npm run docs:examples
SSO_DOCS_PROTOCOL=saml npm run docs:examples
SSO_DOCS_PROTOCOL=wsfed npm run docs:examples
SSO_DOCS_APP_A=typescript npm run docs:examples
```

等待终端输出 reference 地址，再打开 App A 和 App B。测试用户按对应协议页面操作。按 Ctrl+C 停止，临时消费者、生成的测试材料随退出清理。首次隔离安装需要 npm registry 或已有缓存。

`npm run docs:check` 运行链接/锚点、示例隔离安装、TS/Vue/React 类型与构建、协议配置和映射检查。它不等同浏览器或生产协议验收。

## 开发者检查顺序

1. App A 首次登录，返回显示用户。
2. 刷新 App A，恢复本域会话。
3. 打开 App B，不再次输入中心凭据，建立 B 的本域会话。
4. B 本域退出，A 保持；B 查询会话仍未登录。
5. B 主动登录，中心会话有效时恢复。
6. 新的无中心会话浏览器中，尝试取消或错误密码，不能建立业务会话；错误能展示或保持在中心登录页，可以重试。

同一浏览器中 `localhost` 是中心、`127.0.0.1` 是宿主；两个示例应用在一个来源的不同路径。生产双宿主 Cookie 和跨站部署需额外验收。

每次只运行一个协议 Demo。参考宿主使用相同的 Cookie 名和路径，而浏览器 Cookie 不按端口隔离；在同一浏览器同时运行不同协议会互相覆盖会话。切换协议前停止原服务；新服务不识别旧 Cookie，首次会重新认证。

## 原有兼容示例

也可以按 [OIDC](./oidc)、[CAS](./cas)、[SAML](./saml) 页面直接启动参考服务，它们默认加载 `apps/compat/build` 的旧示例；文档示例启动器通过可选构建目录加载本轮源文件，两者不要混淆。

简版夹具启动：

```bash
npm run build:hosts
npm run start --workspace=@sso-test/protocol-fixture
```

默认 `http://127.0.0.1:43893/app-a/`，协议用 `?protocol=cas`、`saml`、`wsfed` 选择。这里的响应/令牌替身不能当作协议安全校验实现。
