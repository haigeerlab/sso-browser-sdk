import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
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
const legacySession = params.get('legacySession') === '1';
const sso = createSSO({
  session: legacySession
    ? {
      endpoint: '/app-b/auth/legacy-session',
      map: (payload) => ({ authenticated: true, user: payload.profile }),
    }
    : { endpoint: '/app-b/auth/session' },
  logout: { endpoint: '/app-b/auth/logout' },
  adapter: adapter({ loginEndpoint: `/app-b/auth/${protocol}/start` }),
});

function App() {
  const [state, setState] = useState(sso.getState());
  useEffect(() => {
    const unsubscribe = sso.onAuthChange(setState);
    void sso.ensureAuthenticated().catch(() => {});
    return unsubscribe;
  }, []);

  return React.createElement('main', null,
    React.createElement('h1', null, 'React SSO example'),
    React.createElement('p', null, state.status === 'authenticated'
      ? `authenticated: ${state.user.id}` : state.status),
    React.createElement('button', { onClick: () => sso.login() }, '登录'),
    React.createElement('button', { onClick: () => { void sso.logout(); } }, '登出'),
    React.createElement('a', { href: protocol === 'oidc' ? '/app-a/' : `/app-a/?protocol=${protocol}` }, 'App A'));
}

createRoot(document.getElementById('root')).render(React.createElement(App));
