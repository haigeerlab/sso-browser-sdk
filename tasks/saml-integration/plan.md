# saml-integration 实施计划

依据：[SAML 模块 Spec](../../spec/saml-integration.md)。SDK 仅导航到同源宿主 SP；SAML XML、证书、断言和本域会话由后端处理。参考服务只用于测试，不进入 SDK 发布包。

## 切片 1：基线与缺口

- 核对 `/saml` 适配器、公共会话 API、简版双宿主夹具和现有测试；运行单元及 SAML 集成测试。
- 记录已证明的 Redirect/POST 链路与尚未证明的失败反馈、中心会话过期及真实签名校验。

## 切片 2：简版交互异常路径

- 先补失败测试，再以最小改动覆盖认证取消、错误凭据、中心会话过期和 ACS 失败后的业务页可见状态与手动重试。
- 只把简版夹具用于导航和状态流转；不得把 XML 字符串匹配当作 SAML 安全验证。

## 切片 3：真实 SAML 互操作

- 以固定版本的独立 IdP、SP 实现搭建私有参考环境；记录可信证书、元数据、实体标识、ACS、启动与复现命令。私钥只在测试运行时生成。
- 验证 A/B 双宿主中心会话复用、独立本域会话、签名篡改、受众/接收方不符、过期、请求关联失败和重放。后端验证必须发生在 ACS 建立会话之前。

## 切片 4：浏览器与收尾

- 在真实浏览器验证 Vue A 首次登录、React B 免再次登录、本域登出后恢复和失败状态。
- 运行 `npm test`、SDK 打包清单和 Spec Guard 产物检查；更新测试说明、SDK 接入文档与 `verification.md`，明确尚未验证的生产条件。

## 边界

- 首版只覆盖 SP 发起的 HTTP-Redirect AuthnRequest 和 HTTP-POST Response；SLO、IdP 发起登录、Artifact 与 ECP 留待独立模块。
- Vue 3.4.0、Vite 5.0.0 约束保持；Webpack 暂不考虑。
