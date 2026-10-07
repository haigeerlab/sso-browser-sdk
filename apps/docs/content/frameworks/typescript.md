# 原生 TypeScript

在已有 Vite TypeScript 客户端项目中安装[SDK tarball](../guide/quick-start)。建立如下文件；示例页面不使用路由库。

```text
src/
  shared/client.ts
  shared/feedback.ts
  typescript/main.ts
index.html
```

## 共享客户端

<<< ../../examples/shared/client.ts

## 错误反馈

<<< ../../examples/shared/feedback.ts

防循环文案匹配当前原型的英文错误消息，属于示例的友好提示；升级 SDK 时需复核。通用失败仍有反馈，不把这条消息当作稳定错误码。若后端已经返回取消或失败码，示例保留其白名单文案。

`ssoError` 是业务页和后端约定，不是协议标准字段。未知码显示通用错误，不把 URL 内容直接放入 HTML。若后端使用不同参数，请修改该函数。

## HTML 与入口

<<< ../../examples/typescript/index.html

复制到项目根目录时，将 script 的 `src="/main.ts"` 改为 `src="/src/typescript/main.ts"`。保留页面元素 ID，供入口绑定。

<<< ../../examples/typescript/main.ts

## 检查

先保证同源后端路径可访问，再运行项目。可以直接[运行文档源文件示例](../demos/overview)，无须自行搭后端；文档示例服务器会将三条业务契约路径替换为参考环境的真实路径。

自动登录只发生在页面入口；点击退出后保持未登录，点击“查询会话”不会再次导航。页面离开时取消订阅。需要路由守卫的项目可在自己选用的路由生命周期调用 SDK，但本轮没有对所有路由库作兼容承诺。
