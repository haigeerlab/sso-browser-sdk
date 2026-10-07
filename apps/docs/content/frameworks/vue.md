# Vue 接入

在现有 Vue 3 + Vite 的 TypeScript 项目安装[SDK tarball](../guide/quick-start)。本轮文档消费者验证使用 Vue 3.4.0，文档站自身的 Vue 版本不代表 SDK 的兼容矩阵。

```text
src/
  shared/client.ts
  shared/feedback.ts
  vue/App.vue
  vue/main.ts
index.html  # <div id="app"></div>
```

## 客户端和错误反馈

复制[共享客户端](./typescript#共享客户端)与[错误反馈文件](./typescript#错误反馈)。将客户端的三个 `/sso/*` 路径修改为后端实际路径。已有项目可以沿用自己的入口，只需挂载下面的组件。

## 完整组件

<<< ../../examples/vue/App.vue

App B 链接只用于仓库双宿主 Demo，业务项目中改为自己的页面或删除。`shallowRef` 保留 SDK 的状态对象；订阅和自动检查在客户端挂载时建立，卸载时取消订阅。

## 入口与 HTML

<<< ../../examples/vue/main.ts

<<< ../../examples/vue/index.html

将 HTML 放到业务项目根目录时，把 script 路径改为 `/src/vue/main.ts`。已有 Vue 项目保留自己的 HTML 和入口，不要重复 mount。

## 运行与检查

按[文档示例启动步骤](../demos/overview)在真实参考后端上运行这份组件。确认显示已登录用户、刷新恢复、退出后保持未登录、失败可以重试。

这里没有增加 Vue 插件、Pinia 或路由依赖。受保护页面挂载时检查，公共页面改用 `getSession()`；不要在每次未登录状态变化时自动再跳转。SSR 场景必须在客户端创建/使用实例，完整 SSR 尚未验收。[Vue 生命周期说明](https://vuejs.org/api/composition-api-lifecycle.html)
