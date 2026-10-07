# 安装与最小接入

前提：你已核对[后端接口](../backend/contract)，业务应用使用 ESM。以下代码面向浏览器，在客户端运行。

## 构建当前 SDK 包

在仓库根目录运行，使用 Node 22.22.0；首次安装还需 JDK，因为仓库包含 SAML 参考验证器。

```bash
npm ci
npm run build --workspace=sso-browser-sdk-prototype
mkdir -p /private/tmp/sso-sdk-package
npm pack --workspace=sso-browser-sdk-prototype --pack-destination /private/tmp/sso-sdk-package
```

然后在**业务项目目录**运行：

```bash
npm install /private/tmp/sso-sdk-package/sso-browser-sdk-prototype-0.0.0.tgz
```

`/private/tmp` 是当前 macOS 示例路径；其他系统可以使用自己的临时目录，并把安装路径改成实际生成的 tgz。包内只有 ESM、类型、README 和 LICENSE，无运行时依赖。不要从 `packages/browser-sdk/src` 导入业务代码。

::: info 尚未发布
正式包名、版本和 registry 未确定。上述 tgz 是本次源码构建产物；已有候选快照不会随 README 修改自动更新。重新打包后记录自己的哈希与源码提交。
:::

## 初始化一个客户端

建立 `src/sso/client.ts`，将三个路径替换成业务后端提供的路径。

<<< ../../examples/shared/client.ts

若用户字段不是 `{ id: string }`，修改 `User`，并保证后端响应或 `session.map` 返回对应结构。TypeScript 泛型不会在运行时验证用户字段。

## 在客户端入口调用

```ts
import { sso } from './sso/client';

async function start() {
  try {
    const session = await sso.ensureAuthenticated();
    if (session.status === 'authenticated') {
      console.log('会话已恢复', session.user.id);
    }
    // 未登录时已经开始页面导航，不在这里加载受保护内容。
  } catch (error) {
    console.error('登录检查失败，等待用户手动重试', error);
  }
}
void start();
```

这段是 API 最小使用；完整页面、按钮和错误展示见[原生 TypeScript](../frameworks/typescript)、[Vue](../frameworks/vue)、[React](../frameworks/react)。不要在错误处理里反复调用 `ensureAuthenticated()`。

## 换一个协议

将 `oidcAdapter` 改为 `casAdapter` 或 `samlAdapter`，同步修改 `loginEndpoint`。配置对象的会话和登出接口可以保持相同契约。协议中心地址、客户端密钥和协议回调配置都属于后端。

接口参数不叫 `returnTo` 时使用 `returnToParam: 'next'`；见[配置 API](../api/config)。

## 确认接入成功

1. 首次访问：会话接口返回未登录，页面导航到同源登录入口。
2. 认证中心完成登录：后端校验回调、设置会话 Cookie，回到原页面。
3. 页面再次加载：会话接口返回用户，显示已登录；刷新后仍恢复。
4. 点击本域退出：POST 成功，页面显示未登录；不要立即再次自动登录。
5. 取消或回调失败：保留失败反馈，用户能手动重试，没有跳转循环。

先运行仓库环境验证流程，见[Demo 总览](../demos/overview)。生产环境仍需检查 HTTPS、Cookie、代理和业务 API 权限。
