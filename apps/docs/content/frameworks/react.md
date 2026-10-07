# React 接入

在现有 React + Vite 的 TypeScript 项目安装[SDK tarball](../guide/quick-start)。本轮文档消费者验证使用 React/React DOM 19.3.0。

```text
src/
  shared/client.ts
  shared/feedback.ts
  react/App.tsx
  react/main.tsx
index.html  # <div id="root"></div>
```

复制[共享客户端](./typescript#共享客户端)与[错误反馈文件](./typescript#错误反馈)，将 `/sso/*` 改为后端实际路径。

## 完整组件

<<< ../../examples/react/App.tsx

App A 链接只用于双宿主 Demo。Promise 拒绝被显式捕获，避免取消登录或退出失败变成未处理异常。

## 客户端入口

<<< ../../examples/react/main.tsx

<<< ../../examples/react/index.html

HTML 放到项目根目录时，把 script 路径改为 `/src/react/main.tsx`。已有应用只添加认证组件，保留原入口。

## StrictMode 与实例生命周期

开发模式下 StrictMode 会额外执行 Effect 的 setup/cleanup。示例将 `sso` 放在模块中，所有挂载使用同一个实例；SDK 对重叠的 `ensureAuthenticated()` 共用一次操作。cleanup 取消订阅，`active` 避免已卸载 Effect 更新错误状态。

不要在每次 render 或 Effect 内新建客户端。StrictMode 的行为不等于生产模式重复执行，也不需要关闭 StrictMode 来接入。[React 官方说明](https://react.dev/reference/react/StrictMode)

## 检查

按[文档示例步骤](../demos/overview)运行。确认登录、刷新恢复、本域退出和手动重试。这里只检查客户端挂载，不声明 React Server Components、完整 SSR 或所有路由库兼容。
