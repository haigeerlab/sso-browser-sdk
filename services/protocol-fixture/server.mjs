import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// This fixture tests browser/backend flow, not production protocol security validation.
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const compatBuildRoot = process.env.SSO_COMPAT_BUILD_ROOT ?? join(root, 'apps/compat/build');
const requestedPort = Number(process.env.SSO_FIXTURE_PORT ?? 43893);
const casTicketTtlMs = Number(process.env.SSO_CAS_TICKET_TTL_MS ?? 300000);
const casCenterTtlMs = Number(process.env.SSO_CAS_CENTER_TTL_MS ?? 300000);
const samlResponseTtlMs = Number(process.env.SSO_SAML_RESPONSE_TTL_MS ?? 300000);
const samlCenterTtlMs = Number(process.env.SSO_SAML_CENTER_TTL_MS ?? 300000);
const wsFedResponseTtlMs = Number(process.env.SSO_WSFED_RESPONSE_TTL_MS ?? 300000);
const wsFedCenterTtlMs = Number(process.env.SSO_WSFED_CENTER_TTL_MS ?? 300000);
let appOrigin;
let centerOrigin;
let centerCookie;
let casCenterCookie;
let samlCenterCookie;
let wsFedCenterCookie;
const pending = new Map();
const codes = new Map();
const casPending = new Map();
const casTickets = new Map();
const casCenterSessions = new Map();
const samlPending = new Map();
const samlResponses = new Map();
const samlCenterSessions = new Map();
const wsFedPending = new Map();
const wsFedResponses = new Map();
const wsFedCenterSessions = new Map();
const sessions = new Map();
const stats = {
  centerLogins: 0, centerAuthorizations: 0, centerCancels: 0, appCallbacks: 0,
  casCenterLogins: 0, casTicketsIssued: 0, casValidationAttempts: 0, casCallbacks: 0,
  samlCenterLogins: 0, samlResponsesIssued: 0, samlCallbacks: 0,
  wsFedCenterLogins: 0, wsFedResponsesIssued: 0, wsFedCallbacks: 0,
};

function send(res, status, body = '', headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function redirect(res, location, headers = {}) {
  send(res, 302, '', { Location: location, ...headers });
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie ?? '').split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), part.slice(index + 1)];
  }));
}

function appName(pathname) {
  const match = pathname.match(/^\/(app-a|app-b)(?:\/|$)/);
  return match?.[1];
}

function casRequest(service) {
  try {
    const url = new URL(service);
    const app = appName(url.pathname);
    const state = url.searchParams.get('state');
    const record = state && casPending.get(state);
    if (app && url.origin === appOrigin && url.pathname === `/${app}/auth/cas/callback`
      && record?.app === app && record.service === service) return record;
  } catch { /* An invalid service is rejected below. */ }
  return undefined;
}

function issueCasTicket(res, service, headers = {}) {
  const ticket = `ST-${randomUUID()}`;
  casTickets.set(ticket, { service, expiresAt: Date.now() + casTicketTtlMs });
  stats.casTicketsIssued += 1;
  const target = new URL(service);
  target.searchParams.set('ticket', ticket);
  redirect(res, target.href, headers);
}

async function formFields(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return new URLSearchParams(body);
}

function samlRequest(state, encoded) {
  const record = state && samlPending.get(state);
  if (!record || !encoded) return undefined;
  try {
    const xml = inflateRawSync(Buffer.from(encoded, 'base64')).toString('utf8');
    if (xml.includes(`ID="${record.requestId}"`)
      && xml.includes(`AssertionConsumerServiceURL="${record.acs}"`)) return record;
  } catch { /* Invalid SAMLRequest. */ }
  return undefined;
}

function samlPostPage(res, state, record, headers = {}) {
  const responseId = `_${randomUUID()}`;
  samlResponses.set(responseId, {
    state, requestId: record.requestId, acs: record.acs,
    expiresAt: Date.now() + samlResponseTtlMs,
  });
  stats.samlResponsesIssued += 1;
  const xml = `<samlp:Response ID="${responseId}" xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" InResponseTo="${record.requestId}" Destination="${record.acs}"><saml:NameID>demo</saml:NameID></samlp:Response>`;
  const encoded = Buffer.from(xml).toString('base64');
  send(res, 200, `<!doctype html><meta charset="utf-8"><h1>正在返回宿主</h1>
    <form method="post" action="${record.acs}">
      <input type="hidden" name="SAMLResponse" value="${encoded}">
      <input type="hidden" name="RelayState" value="${state}">
      <button type="submit">继续</button></form><script>document.forms[0].submit()</script>`,
  { 'Content-Type': 'text/html; charset=utf-8', ...headers });
}

function wsFedRequest(fields) {
  const context = fields.get('wctx');
  const record = context && wsFedPending.get(context);
  if (record && fields.get('wa') === 'wsignin1.0'
    && fields.get('wtrealm') === record.realm
    && fields.get('wreply') === record.reply) return { context, record };
  return undefined;
}

function wsFedPostPage(res, context, record, headers = {}) {
  const responseId = randomUUID();
  wsFedResponses.set(responseId, { context, realm: record.realm, reply: record.reply,
    expiresAt: Date.now() + wsFedResponseTtlMs });
  stats.wsFedResponsesIssued += 1;
  send(res, 200, `<!doctype html><meta charset="utf-8"><h1>正在返回宿主</h1>
    <form method="post" action="${record.reply}">
      <input type="hidden" name="wa" value="wsignin1.0">
      <input type="hidden" name="wresult" value="${responseId}">
      <input type="hidden" name="wctx" value="${context}">
      <button type="submit">继续</button></form><script>document.forms[0].submit()</script>`,
  { 'Content-Type': 'text/html; charset=utf-8', ...headers });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', appOrigin);
    const center = req.headers.host?.startsWith('localhost:');

    if (url.pathname === '/__stats') {
      send(res, 200, JSON.stringify(stats), { 'Content-Type': 'application/json' });
      return;
    }

    if (/^\/app-a\/assets\/[\w-]+\.js$/.test(url.pathname)) {
      const source = await readFile(join(compatBuildRoot, 'vue/assets', url.pathname.split('/').at(-1)));
      send(res, 200, source, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return;
    }
    if (/^\/app-b\/assets\/[\w-]+\.js$/.test(url.pathname)) {
      const source = await readFile(join(compatBuildRoot, 'react/assets', url.pathname.split('/').at(-1)));
      send(res, 200, source, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return;
    }

    if (center) {
      if (url.pathname === '/wsfed/passive' && req.method === 'GET') {
        const request = wsFedRequest(url.searchParams);
        if (!request) return send(res, 400, 'Invalid WS-Fed request');
        const { context, record } = request;
        const centerSession = wsFedCenterSessions.get(cookies(req)[wsFedCenterCookie]);
        if (centerSession && Date.now() < centerSession.expiresAt) {
          wsFedPostPage(res, context, record);
          return;
        }
        send(res, 200, `<!doctype html><meta charset="utf-8"><h1>WS-Fed 认证中心登录</h1>
          <form method="post" action="/wsfed/login">
            <input type="hidden" name="wa" value="wsignin1.0">
            <input type="hidden" name="wtrealm" value="${record.realm}">
            <input type="hidden" name="wreply" value="${record.reply}">
            <input type="hidden" name="wctx" value="${context}">
            <input type="hidden" name="username" value="demo">
            <input type="hidden" name="password" value="demo">
            <button type="submit">以 demo 登录</button></form>
            <a href="/wsfed/cancel?wctx=${context}">取消登录</a>`,
        { 'Content-Type': 'text/html; charset=utf-8' });
        return;
      }
      if (url.pathname === '/wsfed/cancel' && req.method === 'GET') {
        const context = url.searchParams.get('wctx');
        const record = context && wsFedPending.get(context);
        if (!record) return send(res, 400, 'Invalid wctx');
        wsFedPending.delete(context);
        const target = new URL(record.returnTo, appOrigin);
        target.searchParams.set('ssoError', 'wsfed_login_canceled');
        redirect(res, target.href);
        return;
      }
      if (url.pathname === '/wsfed/login' && req.method === 'POST') {
        const fields = await formFields(req);
        const request = wsFedRequest(fields);
        if (!request) return send(res, 400, 'Invalid WS-Fed request');
        if (fields.get('username') !== 'demo' || fields.get('password') !== 'demo') {
          return send(res, 401, 'Invalid credentials');
        }
        stats.wsFedCenterLogins += 1;
        const centerSession = randomUUID();
        wsFedCenterSessions.set(centerSession, { expiresAt: Date.now() + wsFedCenterTtlMs });
        wsFedPostPage(res, request.context, request.record, {
          'Set-Cookie': `${wsFedCenterCookie}=${centerSession}; HttpOnly; SameSite=Lax; Path=/wsfed/`,
        });
        return;
      }
      if (url.pathname === '/saml/sso' && req.method === 'GET') {
        const state = url.searchParams.get('RelayState');
        const encoded = url.searchParams.get('SAMLRequest');
        const record = samlRequest(state, encoded);
        if (!record) return send(res, 400, 'Invalid AuthnRequest');
        const centerSession = samlCenterSessions.get(cookies(req)[samlCenterCookie]);
        if (centerSession && Date.now() < centerSession.expiresAt) {
          samlPostPage(res, state, record);
          return;
        }
        send(res, 200, `<!doctype html><meta charset="utf-8"><h1>SAML 认证中心登录</h1>
          <form method="post" action="/saml/login">
            <input type="hidden" name="SAMLRequest" value="${encoded}">
            <input type="hidden" name="RelayState" value="${state}">
            <input type="hidden" name="username" value="demo">
            <input type="hidden" name="password" value="demo">
            <button type="submit">以 demo 登录</button></form>
            <a href="/saml/cancel?RelayState=${encodeURIComponent(state)}">取消登录</a>`,
        { 'Content-Type': 'text/html; charset=utf-8' });
        return;
      }
      if (url.pathname === '/saml/cancel' && req.method === 'GET') {
        const state = url.searchParams.get('RelayState');
        const record = state && samlPending.get(state);
        if (!record) return send(res, 400, 'Invalid RelayState');
        samlPending.delete(state);
        const target = new URL(record.returnTo, appOrigin);
        target.searchParams.set('ssoError', 'saml_login_canceled');
        redirect(res, target.href);
        return;
      }
      if (url.pathname === '/saml/login' && req.method === 'POST') {
        const fields = await formFields(req);
        const state = fields.get('RelayState');
        const record = samlRequest(state, fields.get('SAMLRequest'));
        if (!record) return send(res, 400, 'Invalid AuthnRequest');
        if (fields.get('username') !== 'demo' || fields.get('password') !== 'demo') {
          return send(res, 401, 'Invalid credentials');
        }
        stats.samlCenterLogins += 1;
        const centerSession = randomUUID();
        samlCenterSessions.set(centerSession, { expiresAt: Date.now() + samlCenterTtlMs });
        samlPostPage(res, state, record, {
          'Set-Cookie': `${samlCenterCookie}=${centerSession}; HttpOnly; SameSite=Lax; Path=/saml/`,
        });
        return;
      }
      if (url.pathname === '/cas/login' && req.method === 'GET') {
        const service = url.searchParams.get('service');
        if (!service || !casRequest(service)) return send(res, 400, 'Unauthorized service');
        const centerSession = casCenterSessions.get(cookies(req)[casCenterCookie]);
        if (centerSession && Date.now() < centerSession.expiresAt) {
          issueCasTicket(res, service);
          return;
        }
        send(res, 200, `<!doctype html><meta charset="utf-8"><h1>CAS 认证中心登录</h1>
          <form method="post" action="/cas/login">
            <input type="hidden" name="service" value="${service.replaceAll('&', '&amp;')}">
            <input type="hidden" name="username" value="demo">
            <input type="hidden" name="password" value="demo">
            <button type="submit">以 demo 登录</button></form>
            <a href="/cas/cancel?service=${encodeURIComponent(service)}">取消登录</a>`,
        { 'Content-Type': 'text/html; charset=utf-8' });
        return;
      }
      if (url.pathname === '/cas/cancel' && req.method === 'GET') {
        const service = url.searchParams.get('service');
        const record = service && casRequest(service);
        if (!record) return send(res, 400, 'Unauthorized service');
        casPending.delete(new URL(service).searchParams.get('state'));
        redirect(res, `${appOrigin}${record.returnTo}`);
        return;
      }
      if (url.pathname === '/cas/login' && req.method === 'POST') {
        const fields = await formFields(req);
        const service = fields.get('service');
        if (!service || !casRequest(service)) return send(res, 400, 'Unauthorized service');
        if (fields.get('username') !== 'demo' || fields.get('password') !== 'demo') {
          return send(res, 401, 'Invalid credentials');
        }
        stats.casCenterLogins += 1;
        const centerSession = randomUUID();
        casCenterSessions.set(centerSession, { expiresAt: Date.now() + casCenterTtlMs });
        issueCasTicket(res, service, {
          'Set-Cookie': `${casCenterCookie}=${centerSession}; HttpOnly; SameSite=Lax; Path=/cas/`,
        });
        return;
      }
      if (url.pathname === '/cas/serviceValidate') {
        stats.casValidationAttempts += 1;
        const service = url.searchParams.get('service');
        const ticket = url.searchParams.get('ticket');
        const record = ticket && casTickets.get(ticket);
        if (ticket) casTickets.delete(ticket);
        const valid = record && record.service === service && Date.now() < record.expiresAt;
        const body = valid
          ? '<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess><cas:user>demo</cas:user></cas:authenticationSuccess></cas:serviceResponse>'
          : `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationFailure code="${record && record.service !== service ? 'INVALID_SERVICE' : 'INVALID_TICKET'}">Invalid ticket</cas:authenticationFailure></cas:serviceResponse>`;
        send(res, 200, body, { 'Content-Type': 'application/xml; charset=utf-8' });
        return;
      }
      if (url.pathname === '/idp/authorize') {
        stats.centerAuthorizations += 1;
        const state = url.searchParams.get('state');
        const record = state && pending.get(state);
        if (!record) return send(res, 400, 'Unknown state');
        if (cookies(req)[centerCookie] !== 'demo') {
          send(res, 200, `<!doctype html><meta charset="utf-8"><h1>认证中心登录</h1>
            <form method="post" action="/idp/login?next=${encodeURIComponent(url.pathname + url.search)}">
              <button type="submit">以 demo 登录</button></form>
            <a href="/idp/cancel?state=${state}">取消登录</a>`,
          { 'Content-Type': 'text/html; charset=utf-8' });
          return;
        }
        const code = randomUUID();
        codes.set(code, state);
        redirect(res, `${appOrigin}/${record.app}/auth/oidc/callback?code=${code}&state=${state}`);
        return;
      }
      if (url.pathname === '/idp/cancel') {
        const state = url.searchParams.get('state');
        const record = state && pending.get(state);
        if (!record) return send(res, 400, 'Unknown state');
        pending.delete(state);
        stats.centerCancels += 1;
        redirect(res, `${appOrigin}${record.returnTo}`);
        return;
      }
      if (url.pathname === '/idp/login' && req.method === 'POST') {
        const next = url.searchParams.get('next');
        if (!next?.startsWith('/idp/authorize?')) return send(res, 400, 'Invalid next');
        stats.centerLogins += 1;
        redirect(res, next, { 'Set-Cookie': `${centerCookie}=demo; HttpOnly; SameSite=Lax; Path=/` });
        return;
      }
      return send(res, 404, 'Center route not found');
    }

    const app = appName(url.pathname);
    if (!app) return send(res, 404, 'App route not found');
    if (url.pathname === `/${app}/`) {
      const page = await readFile(join(compatBuildRoot, app === 'app-a'
        ? 'vue/index.html'
        : 'react/index.html'));
      send(res, 200, page, { 'Content-Type': 'text/html; charset=utf-8' });
      return;
    }
    if (url.pathname === `/${app}/auth/session`) {
      const session = cookies(req)[`session_${app}`];
      if (!session || !sessions.has(session)) return send(res, 401);
      send(res, 200, JSON.stringify({ authenticated: true, user: { id: sessions.get(session) } }),
        { 'Content-Type': 'application/json' });
      return;
    }
    if (app === 'app-b' && url.pathname === '/app-b/auth/legacy-session') {
      const session = cookies(req)['session_app-b'];
      if (!session || !sessions.has(session)) return send(res, 401);
      send(res, 200, JSON.stringify({ loggedIn: true, profile: { id: sessions.get(session) } }),
        { 'Content-Type': 'application/json' });
      return;
    }
    if (url.pathname === `/${app}/auth/oidc/start`) {
      const customReturnParam = app === 'app-a' && url.searchParams.get('compat') === 'next';
      const returnTo = customReturnParam
        ? url.searchParams.get('next')
        : url.searchParams.get('returnTo') ?? `/${app}/`;
      if (!returnTo) return send(res, 400, 'Missing next');
      if (!returnTo.startsWith(`/${app}/`) || returnTo.startsWith('//')) {
        return send(res, 400, 'Invalid returnTo');
      }
      const state = randomUUID();
      pending.set(state, { app, returnTo });
      redirect(res, `${centerOrigin}/idp/authorize?client_id=${app}&state=${state}`);
      return;
    }
    if (url.pathname === `/${app}/auth/saml/start`) {
      const returnTo = url.searchParams.get('returnTo') ?? `/${app}/`;
      if (!returnTo.startsWith(`/${app}/`) || returnTo.startsWith('//')) {
        return send(res, 400, 'Invalid returnTo');
      }
      const cleanReturnTo = new URL(returnTo, appOrigin);
      cleanReturnTo.searchParams.delete('ssoError');
      const state = randomUUID();
      const requestId = `_${randomUUID()}`;
      const acs = `${appOrigin}/${app}/auth/saml/acs`;
      samlPending.set(state, { app, requestId, acs,
        returnTo: cleanReturnTo.pathname + cleanReturnTo.search + cleanReturnTo.hash });
      const xml = `<samlp:AuthnRequest ID="${requestId}" xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" AssertionConsumerServiceURL="${acs}"/>`;
      const encoded = deflateRawSync(Buffer.from(xml)).toString('base64');
      const target = new URL('/saml/sso', centerOrigin);
      target.searchParams.set('SAMLRequest', encoded);
      target.searchParams.set('RelayState', state);
      redirect(res, target.href);
      return;
    }
    if (url.pathname === `/${app}/auth/wsfed/start` && req.method === 'GET') {
      const returnTo = url.searchParams.get('returnTo') ?? `/${app}/`;
      if (!returnTo.startsWith(`/${app}/`) || returnTo.startsWith('//')) {
        return send(res, 400, 'Invalid returnTo');
      }
      const cleanReturnTo = new URL(returnTo, appOrigin);
      cleanReturnTo.searchParams.delete('ssoError');
      const context = randomUUID();
      const realm = `urn:fixture:${app}`;
      const reply = `${appOrigin}/${app}/auth/wsfed/callback`;
      wsFedPending.set(context, { app, realm, reply,
        returnTo: cleanReturnTo.pathname + cleanReturnTo.search + cleanReturnTo.hash });
      const target = new URL('/wsfed/passive', centerOrigin);
      target.searchParams.set('wa', 'wsignin1.0');
      target.searchParams.set('wtrealm', realm);
      target.searchParams.set('wreply', reply);
      target.searchParams.set('wctx', context);
      redirect(res, target.href);
      return;
    }
    if (url.pathname === `/${app}/auth/wsfed/callback` && req.method === 'POST') {
      stats.wsFedCallbacks += 1;
      const fields = await formFields(req);
      const context = fields.get('wctx');
      const record = context && wsFedPending.get(context);
      if (!record || record.app !== app) return send(res, 400, 'Invalid wctx');
      wsFedPending.delete(context);
      const issued = wsFedResponses.get(fields.get('wresult'));
      if (fields.get('wresult')) wsFedResponses.delete(fields.get('wresult'));
      if (fields.get('wa') !== 'wsignin1.0' || !issued || issued.context !== context
        || issued.realm !== record.realm || issued.reply !== record.reply
        || Date.now() >= issued.expiresAt) {
        const target = new URL(record.returnTo, appOrigin);
        target.searchParams.set('ssoError', 'wsfed_validation_failed');
        redirect(res, target.href);
        return;
      }
      const session = randomUUID();
      sessions.set(session, 'demo');
      redirect(res, `${appOrigin}${record.returnTo}`, {
        'Set-Cookie': `session_${app}=${session}; HttpOnly; SameSite=Lax; Path=/${app}/`,
      });
      return;
    }
    if (url.pathname === `/${app}/auth/saml/acs` && req.method === 'POST') {
      stats.samlCallbacks += 1;
      const fields = await formFields(req);
      const state = fields.get('RelayState');
      const record = state && samlPending.get(state);
      if (!record || record.app !== app) return send(res, 400, 'Invalid RelayState');
      const failed = () => {
        samlPending.delete(state);
        const target = new URL(record.returnTo, appOrigin);
        target.searchParams.set('ssoError', 'saml_validation_failed');
        redirect(res, target.href);
      };
      let xml;
      try { xml = Buffer.from(fields.get('SAMLResponse') ?? '', 'base64').toString('utf8'); }
      catch { return failed(); }
      const responseId = xml.match(/<samlp:Response ID="([^"]+)"/)?.[1];
      const issued = responseId && samlResponses.get(responseId);
      if (responseId) samlResponses.delete(responseId);
      if (!issued || issued.state !== state || issued.requestId !== record.requestId
        || issued.acs !== record.acs || Date.now() >= issued.expiresAt
        || !xml.includes(`InResponseTo="${record.requestId}"`)
        || !xml.includes(`Destination="${record.acs}"`)
        || !xml.includes('<saml:NameID>demo</saml:NameID>')) {
        return failed();
      }
      samlPending.delete(state);
      const session = randomUUID();
      sessions.set(session, 'demo');
      redirect(res, `${appOrigin}${record.returnTo}`, {
        'Set-Cookie': `session_${app}=${session}; HttpOnly; SameSite=Lax; Path=/${app}/`,
      });
      return;
    }
    if (url.pathname === `/${app}/auth/cas/start`) {
      const returnTo = url.searchParams.get('returnTo') ?? `/${app}/`;
      if (!returnTo.startsWith(`/${app}/`) || returnTo.startsWith('//')) {
        return send(res, 400, 'Invalid returnTo');
      }
      const state = randomUUID();
      const service = `${appOrigin}/${app}/auth/cas/callback?state=${state}`;
      casPending.set(state, { app, service, returnTo });
      redirect(res, `${centerOrigin}/cas/login?service=${encodeURIComponent(service)}`);
      return;
    }
    if (url.pathname === `/${app}/auth/cas/callback`) {
      stats.casCallbacks += 1;
      const state = url.searchParams.get('state');
      const ticket = url.searchParams.get('ticket');
      const record = state && casPending.get(state);
      if (!record || record.app !== app) return send(res, 400, 'Invalid callback');
      casPending.delete(state);
      const failed = () => {
        const target = new URL(record.returnTo, appOrigin);
        target.searchParams.set('ssoError', 'cas_validation_failed');
        redirect(res, target.href);
      };
      if (!ticket) return failed();
      const validation = new URL('/cas/serviceValidate', centerOrigin);
      validation.searchParams.set('service', record.service);
      validation.searchParams.set('ticket', ticket);
      const result = await fetch(validation);
      const body = await result.text();
      // The fixture only accepts its fixed demo response; production backends need a real XML parser.
      if (!result.ok || !body.includes('<cas:authenticationSuccess><cas:user>demo</cas:user>')) {
        return failed();
      }
      const session = randomUUID();
      sessions.set(session, 'demo');
      redirect(res, `${appOrigin}${record.returnTo}`, {
        'Set-Cookie': `session_${app}=${session}; HttpOnly; SameSite=Lax; Path=/${app}/`,
      });
      return;
    }
    if (url.pathname === `/${app}/auth/oidc/callback`) {
      stats.appCallbacks += 1;
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      const record = state && pending.get(state);
      if (!record || record.app !== app || !code || codes.get(code) !== state) {
        return send(res, 400, 'Invalid callback');
      }
      pending.delete(state);
      codes.delete(code);
      const session = randomUUID();
      sessions.set(session, 'demo');
      redirect(res, `${appOrigin}${record.returnTo}`, {
        'Set-Cookie': `session_${app}=${session}; HttpOnly; SameSite=Lax; Path=/${app}/`,
      });
      return;
    }
    if (url.pathname === `/${app}/auth/logout` && req.method === 'POST') {
      const session = cookies(req)[`session_${app}`];
      if (session) sessions.delete(session);
      send(res, 204, '', { 'Set-Cookie': `session_${app}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/${app}/` });
      return;
    }
    send(res, 404, 'App route not found');
  } catch (error) {
    send(res, 500, String(error));
  }
});

server.listen(requestedPort, () => {
  const port = server.address().port;
  appOrigin = `http://127.0.0.1:${port}`;
  centerOrigin = `http://localhost:${port}`;
  centerCookie = `center_${port}`;
  casCenterCookie = `cas_center_${port}`;
  samlCenterCookie = `saml_center_${port}`;
  wsFedCenterCookie = `wsfed_center_${port}`;
  process.stdout.write(`Fixture: ${appOrigin}/app-a/ and ${appOrigin}/app-b/\n`);
});
