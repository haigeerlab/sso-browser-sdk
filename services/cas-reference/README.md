# 独立 CAS 互操作环境

本目录使用 `django-cas-server` 3.1.0 和 Django 5.2.17 作为独立 CAS 协议提供方，验证浏览器 SDK 经宿主后端接入时的真实 `/login`、Service Ticket 与 `/serviceValidate` 流程。它与 `services/protocol-fixture` 的自制简版夹具分开，不进入 SDK npm 包。

在仓库根目录首次准备环境（Python 3.10+）：

```sh
python3 -m venv services/cas-reference/.venv
services/cas-reference/.venv/bin/python -m pip install -r services/cas-reference/requirements.lock
npm install
npm run build:hosts
```

随后运行 `npm test`。CAS 互操作也可单独执行 `node --test tests/interop/cas-reference.test.mjs`。浏览器手动复测时运行 `node services/cas-reference/reference.mjs`，访问输出的 App A 地址，测试账号与密码均为 `demo`。

每次测试在系统临时目录创建 SQLite 数据库，只登记当前 App A/B 的回调 `service`，退出后清理。提供方位于 `localhost`，宿主位于 `127.0.0.1`；两者使用不同站点 Cookie。本环境使用 HTTP、Django 开发服务、固定测试账号和开发密钥，仅用于本机互操作，不是生产 CAS 部署模板。

直接依赖列在 `requirements.txt`，`requirements.lock` 固定本次实测的完整 Python 依赖版本。参考提供方的安装方式与服务登记规则见 [django-cas-server 文档](https://django-cas-server.readthedocs.io/en/latest/README.html)，票据和 `service` 语义见 [Apereo CAS 3.0 规范](https://apereo.github.io/cas/7.3.x/protocol/CAS-Protocol-Specification.html)。
