# developer-docs 验证与开发者审阅

日期：2026-10-07。验证时分支：`main`。基准提交：`8868268ff05314724f25ceb00706827ef1433936`；本轮结果属于基准之上的文档改动，交付整理至本地分支 `codex/developer-docs`。未推送、未部署、未发布 npm 包。

## 本批结论

文档站与包 README 已可供首次接入者使用。按页面展示的源文件，从实际 SDK tarball 安装到隔离的普通 ESM 项目，原生 TypeScript、Vue、React 示例均能类型检查与构建。浏览器实际运行证明它们可以接入仓库的独立协议参考后端。

当前 SDK 在“宿主后端处理认证协议、前端消费本域 Cookie 会话”的限定范围内具备完整接口闭环：查询、自动导航、回跳后恢复、订阅、防循环、主动重试与本域退出。一个认证中心支持标准协议，并不意味着只配置中心 URL 就能接入；宿主必须提供文档所述会话、启动与退出接口，并正确实现协议回调。

这仍是私有 `0.0.0` 原型。生产认证中心、真实业务宿主、企业域策略与正式发行尚未验收；WS-Fed、Negotiate 继续标记实验。SDK 不做前端令牌管理或全局单点登出。

## 定界与覆盖

本批按五个范围进行一次系统检查，覆盖 **5/5**；候选均已分类，本批次审查完成。

| 范围 | 检查内容 | 结果 |
| --- | --- | --- |
| 公共 SDK 接口 | `packages/browser-sdk/src/index.ts`、dist 类型和包 exports；状态、六个方法、并发与异常语义 | 文档与源码一致 |
| 五协议入口与 HTTP 契约 | 五个 adapter/redirect；四种参考服务实际路由、历史协议证据 | 登录导航由前端处理，换码/验票/验签/协商由后端处理；路径已明确对照 |
| 框架示例与首次阅读 | README → 安装 → shared client/feedback → TS/Vue/React → Demo | 页面引用源文件，隔离安装和真实浏览器流程通过 |
| 文档站 | 23 页、导航、搜索、代码展示、手机阅读、根/子路径 | 构建与浏览器通过 |
| 打包、依赖与回归 | tarball 文件、锁文件差异、安装、审计、默认回归、CI 文档步骤 | 既有版本不变；新增文档不进入 SDK 包 |

排除：生产后台全量安全审计、全部协议可选模式、线上托管、真实业务系统、所有浏览器/构建器、完整 SSR/RSC、企业 Kerberos 验收。本轮没有重跑可选本地 Kerberos 实验，引用其已存在记录。

正确性检查以源码和运行结果为依据；可读性通过首次阅读顺序及完整文件布局核对；架构保持无框架 SDK 与私有文档工作区分离；安全检查覆盖示例输出、回跳与后端责任说明；性能方面使用静态文档、本地索引和现有默认主题，没有新增远端数据请求或业务轮询。未进行正式性能基准或完整无障碍认证。

## 首次使用者路径

1. 从包 README 能确认包名、私有原型状态、需要业务后端，以及为什么不能直接 registry 安装。
2. 安装指南给出构建、生成 tgz、在业务目录安装的完整命令；示例从包 exports 导入，没有 workspace 源码别名。
3. 后端契约给出 JSON、401/200 未登录、登录启动/回调、Cookie、本域 POST 退出；通用 `/sso/*` 与 Demo `/app-*/auth/*` 不再混用。
4. TS/Vue/React 页面给出共享文件、入口、HTML、全部按钮及失败处理；Vue/React 不需要额外认证插件或路由依赖。
5. Demo 页面说明准备条件、测试账号、地址来源、操作预期和停止方式；区分参考实现与简版夹具。
6. API/生命周期说明导航不等待认证结束、订阅不回放、并发首个回跳参数、防循环、取消后手动重试和本域退出边界。

## 稳定发现与处理

审查结论（Required/FYI）和处理优先级（P 级）分别记录，不作自动换算。

| 编号 | 结论 | 优先级 | 证据、影响与处理 |
| --- | --- | --- | --- |
| DOC-001 | Required，已处理 | P2 | 源码中 `ensureAuthenticated` 导航后返回未登录，SDK 不解析 `ssoError`。若示例暗示等待整次登录或自动显示回调错误，首次接入者会用错。README、API、生命周期和完整示例已明确这些行为。 |
| DOC-002 | Required，已修复并复验 | P2 | 浏览器取消 SAML/WS-Fed 后，初始化的取消文案被防循环 catch 覆盖成 Cookie 排错文案。shared/feedback 现在优先保留白名单回调文案；TS、Vue、React 均显示“登录已取消，可以手动重试”，手动重试成功。 |
| DOC-003 | Required，已修复并复验 | P2 | `npm run docs:preview -- --port 4174` 的端口曾被内层 npm 消耗。根脚本补参数分隔符；实际静态预览使用 4174 并通过子路径浏览器验证。dev/build 同样支持转发。 |
| DOC-004 | FYI，已补文档并调整验证顺序 | P2 | 四种参考宿主使用相同 `session_<app>` Cookie 名及 Path；同一浏览器同时运行多个协议会覆盖会话，因为 Cookie 不按端口隔离。CAS/SAML 按单一协议重新认证后，B 退出、A 保持均通过。Demo 总览要求依次运行。此项是本机联调限制，不归为 SDK 会话隔离缺陷。 |
| DOC-005 | Required，已修复 | P2 | 初选文档 Vue 版本被 npm audit 报告服务器渲染告警。仅文档工作区锁定 Vue 3.5.43 后审计为 0；原有 Vue 3.4.0/Vite 5.0.0 不变。 |
| DOC-006 | FYI，保留发行缺口 | P2 | 包仍 `private:true`、版本 0.0.0；线上文档未部署，README 的新增 GitHub 页面链接需推送后可用，当前入口是本地站点。没有把本机互操作或文档完成当作生产发布批准。 |
| DOC-007 | FYI，已有环境风险 | P2 | 完整仓库依赖审计仍有 11 项；SDK 生产依赖与文档工作区为 0。支持矩阵公开记录范围；没有对既有协议参考库进行越界升级。 |

没有发现本轮范围内阻塞文档接入的未修复 SDK 缺陷。稳定业务错误码、请求超时/取消、更多发行格式等属于当前未提供的能力，不能在文档中承诺。业务提供的 map/listener/navigate 等回调必须正确处理自身异常；本批没有扩展这些注入点的健壮性实现。

计数：已分类 7 项；待调查 0；排除/重复候选 0；本轮文档待修复 0；本轮待入账缺陷 0。已处理项归属本模块 plan/todo；没有创建外部事项，也不声称既有发行/依赖缺口已关闭。

## 可重复命令与结果

| 命令或检查 | 本轮结果 |
| --- | --- |
| `npm ci` | 干净安装通过，包括既有安装脚本；报告原有依赖告警 |
| `npm run docs:build` | 最终根路径构建通过：VitePress 2.0.0-alpha.20、Vite 8.3.3 |
| `DOCS_BASE=/sso-browser-sdk/ npm run docs:build` | 最终子路径构建通过；静态预览与导航实际验证 |
| `npm run docs:check` | 最终 23 页链接/锚点、隔离 tarball、TS/Vue/React 类型与构建、五协议 URL、session map 正反例通过 |
| 映射检查变异验证 | 临时将 map 的 loggedIn true 条件反转，检查在运行映射时按预期失败；恢复原文件后完整 docs:check 再次通过 |
| `npm test` | 20 单测 + 4 兼容 + 29 集成 + 20 互操作 = 73，通过，0 跳过 |
| `npm ls vite vue vitepress`（对应工作区） | 文档 Vue 3.5.43/Vite 8.3.3；compat Vue 3.4.0/Vite 5.0.0 |
| lockfile 对照 HEAD | 既有路径版本变化 0，删除路径 0；新增 157 个工作区/依赖条目 |
| `npm audit --workspace=@sso-docs/site --json` | 0 项 |
| `npm audit --workspace=sso-browser-sdk-prototype --omit=dev --json` | 0 项；包本身无运行时依赖 |
| `npm audit --json` | 全仓库 11 项：6 high、5 moderate；涉及 Vue/Vite 兼容与 XML/WS-Fed 参考链 |
| `npm pack --workspace=sso-browser-sdk-prototype --dry-run --json` | 17 文件；dist JS/类型、README、LICENSE、manifest，无文档站或框架依赖 |
| `git diff --check` | 通过 |
| Spec Guard phase/artifacts | 能力图与模块结构通过；旧 tracker 字段为退役提醒；最终 gate 经用户“继续”确认后记录完成 |

CI 已增加 docs:build 和 docs:check。本轮未推送，未声称新的远端 CI 运行通过。

## 浏览器实际结果

浏览器：Codex 内置 Chromium 系浏览器，接口未暴露精确版本；没有读取凭据存储。以下仅使用本机合成测试账号。

| 示例/站点 | 操作与结果 |
| --- | --- |
| 文档根路径 | 首页 → 前提 → Vue；中文“会话”搜索返回对应章节；代码片段完整渲染；日志无 warning/error |
| 文档子路径 | `/sso-browser-sdk/` → Vue → HTTP 契约，资源与链接均保留 base；390×844 阅读无整页横向溢出，目录可展开/导航；视口已恢复 |
| OIDC Vue A + React B | 首次 alice 登录、A 刷新恢复、B 无再次凭据建立会话、B 退出保持未登录、A 查询仍登录 |
| CAS Vue A + React B | demo 错误密码停留中心、不建立会话；正确密码成功、B 免再次凭据、B 退出后 A 查询保持登录、B 主动登录恢复 |
| SAML Vue A + React B | 取消能停止自动导航，主动重试成功；真实签名回调显示 demo@example.test；B 免再次凭据、B 退出后 A 保持登录 |
| WS-Fed Vue A + React B | 中心登录及签名回调成功，B 免再次凭据、本域退出隔离、中心会话恢复；最终重建后两框架取消提示正确、主动重试成功 |
| SAML 原生 TS A | 最终 shared feedback：取消提示正确、主动重试成功、刷新恢复、本域退出；日志无 warning/error |

框架页面提及 React StrictMode 的开发 Effect 重放机制，实例去重有单测和源码证据；本轮页面浏览器演示使用生产构建，没有额外承诺对全部开发模式/SSR 行为完成验收。

参考服务的开发密钥/内存适配器、SAML 缺少 SingleLogoutService 提示属于已说明的本机环境边界。没有通过关闭验签/XML 校验或删除失败用例换取通过。

截图：[首页](./artifacts/home.jpg)、[手机阅读](./artifacts/mobile.jpg)、[取消反馈](./artifacts/cancel.jpg)。临时参考服务和消费者已退出清理；文档根路径预览保留在 `http://127.0.0.1:4173/`，也可自行运行 `npm run docs:dev`。

## 收尾与后续前提

本轮实现与 AI 验证完成。展示站点、README 和此报告后，用户于 2026-10-07 回复“继续”，确认本轮结果并允许收尾；已勾选 `tasks/developer-docs/todo.md` 的最终 gate。此确认不代表用户亲自重跑了全部浏览器或协议测试，也不授权远端发布。

按能力图核对，下一个模块 `negotiate-integration` 仍有两项企业环境验收未完成：真实域与受管浏览器的双宿主 Kerberos 登录，以及 SPN/凭据/NTLM/代理负例。已有本地实验不能替代它们。后续需要两个实际 HTTPS 宿主地址、域/SPN、服务端验证模块、受管浏览器策略及代理拓扑；没有这些上下文，不扩大本轮文档完成声明。
