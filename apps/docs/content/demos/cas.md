# CAS 双宿主 Demo

参考环境：Django 5.2.17、`django-cas-server` 3.1.0 中心 + Node 宿主验票后端。首次必须安装 Python 锁定依赖。

## 启动

在仓库根目录：

```bash
python3 -m venv services/cas-reference/.venv
services/cas-reference/.venv/bin/python -m pip install -r services/cas-reference/requirements.lock
npm run build:hosts
node services/cas-reference/reference.mjs
```

访问终端输出的 App A 地址，使用 `demo` / `demo` 登录；App B 地址也由终端输出。中心 Django 与宿主 Node 使用不同端口/站点，采用每次生成的临时 SQLite 数据库和登记规则。

本轮文档示例：`SSO_DOCS_PROTOCOL=cas npm run docs:examples`。

## 操作与预期

A 首次登录显示 demo；B 借中心会话直接登录；刷新保持；B 退出不影响 A；B 主动登录恢复。错误密码应停留中心表单，不发票据也不建立宿主会话。

取消登录不是所有 CAS 产品的标准回调能力，Django 参考环境不要期待与简版夹具完全相同的取消按钮。过期/错误 service/重放的拒绝用互操作测试复测。

## 路径

宿主：`/<app>/auth/session`、`/<app>/auth/cas/start`、`/<app>/auth/cas/callback`、`/<app>/auth/logout`。中心 `/cas/login` 与 `/cas/serviceValidate`。service 包含由后端保存的一次性 state。

复测：`node --test tests/interop/cas-reference.test.mjs`。接入参数见[CAS](../protocols/cas)，环境说明见 [参考服务 README](https://github.com/haigeerlab/sso-browser-sdk/blob/main/services/cas-reference/README.md)。

## 停止与限制

按 Ctrl+C，启动器停止 Django 进程并删除临时数据库。HTTP、测试账号、开发密钥和临时注册只用于本机；不要作为生产 CAS 部署模板。
