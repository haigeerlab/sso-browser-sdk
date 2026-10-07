import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: 'SSO Browser SDK',
  description: '通过业务后端会话接入 SSO 的浏览器 SDK。',
  srcDir: 'content',
  base: process.env.DOCS_BASE || '/',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: '开始接入', link: '/guide/prerequisites' },
      { text: '运行 Demo', link: '/demos/overview' },
      { text: 'API', link: '/api/config' },
      { text: '支持范围', link: '/reference/support' },
    ],
    sidebar: [
      { text: '开始使用', items: [
        { text: '接入前检查', link: '/guide/prerequisites' },
        { text: '安装与最小接入', link: '/guide/quick-start' },
        { text: '登录与会话生命周期', link: '/guide/lifecycle' },
      ] },
      { text: '框架接入', items: [
        { text: '原生 TypeScript', link: '/frameworks/typescript' },
        { text: 'Vue', link: '/frameworks/vue' },
        { text: 'React', link: '/frameworks/react' },
      ] },
      { text: '后端对接', items: [
        { text: '通用 HTTP 契约', link: '/backend/contract' },
        { text: 'OIDC', link: '/protocols/oidc' },
        { text: 'CAS', link: '/protocols/cas' },
        { text: 'SAML', link: '/protocols/saml' },
        { text: 'WS-Fed · 实验', link: '/protocols/wsfed' },
        { text: 'Negotiate · 实验', link: '/protocols/negotiate' },
      ] },
      { text: '运行示例', items: [
        { text: '联调准备与文档示例', link: '/demos/overview' },
        { text: 'OIDC 双宿主', link: '/demos/oidc' },
        { text: 'CAS 双宿主', link: '/demos/cas' },
        { text: 'SAML 双宿主', link: '/demos/saml' },
        { text: '实验协议', link: '/demos/experimental' },
      ] },
      { text: 'API', items: [
        { text: 'createSSO 与配置', link: '/api/config' },
        { text: '方法、状态与适配器', link: '/api/client' },
      ] },
      { text: '部署与排错', items: [
        { text: 'Cookie、代理与路径', link: '/deployment/hosting' },
        { text: '常见失败', link: '/deployment/troubleshooting' },
        { text: '支持矩阵与证据', link: '/reference/support' },
      ] },
    ],
    search: { provider: 'local', options: {
      locales: { root: { translations: {
        button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
        modal: { noResultsText: '没有找到相关内容', resetButtonTitle: '清空搜索',
          displayDetails: '显示详细结果', backButtonTitle: '关闭搜索',
          footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' } },
      } } },
    } },
    outline: { label: '本页内容', level: [2, 3] },
    docFooter: { prev: '上一页', next: '下一页' },
    sidebarMenuLabel: '文档目录',
    returnToTopLabel: '回到顶部',
    darkModeSwitchLabel: '主题',
    lastUpdated: { text: '最后更新' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/haigeerlab/sso-browser-sdk' }],
    footer: { message: '后端负责认证协议，前端消费本域会话。', copyright: 'MIT · Haigeerlab Contributors' },
  },
});
