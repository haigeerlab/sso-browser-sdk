import { createApp, h, onMounted, onUnmounted, ref } from 'vue';
import { createSSO } from 'sso-browser-sdk-prototype';
import { oidcAdapter } from 'sso-browser-sdk-prototype/oidc';
import { casAdapter } from 'sso-browser-sdk-prototype/cas';
import { samlAdapter } from 'sso-browser-sdk-prototype/saml';
import { wsFedAdapter } from 'sso-browser-sdk-prototype/wsfed';

const params = new URLSearchParams(window.location.search);
const requestedProtocol = params.get('protocol');
const protocol = requestedProtocol === 'cas' || requestedProtocol === 'saml' || requestedProtocol === 'wsfed'
  ? requestedProtocol : 'oidc';
const adapter = { oidc: oidcAdapter, cas: casAdapter, saml: samlAdapter, wsfed: wsFedAdapter }[protocol];
const customReturnParam = protocol === 'oidc' && params.get('returnParam') === 'next';
const sso = createSSO({
  session: { endpoint: '/app-a/auth/session' },
  logout: { endpoint: '/app-a/auth/logout' },
  adapter: adapter({
    loginEndpoint: `/app-a/auth/${protocol}/start${customReturnParam ? '?compat=next' : ''}`,
    ...(customReturnParam ? { returnToParam: 'next' } : {}),
  }),
});

createApp({
  setup() {
    const state = ref(sso.getState());
    let unsubscribe;
    onMounted(() => {
      unsubscribe = sso.onAuthChange((next) => { state.value = next; });
      void sso.ensureAuthenticated().catch(() => {});
    });
    onUnmounted(() => unsubscribe?.());

    return () => h('main', [
      h('h1', 'Vue SSO example'),
      h('p', state.value.status === 'authenticated'
        ? `authenticated: ${state.value.user.id}` : state.value.status),
      h('button', { onClick: () => sso.login() }, '登录'),
      h('button', { onClick: () => { void sso.logout(); } }, '登出'),
      h('a', { href: protocol === 'oidc' ? '/app-b/' : `/app-b/?protocol=${protocol}` }, 'App B'),
    ]);
  },
}).mount('#app');
