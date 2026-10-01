import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import samlify from 'samlify';
import validator from '@authenio/samlify-xsd-schema-validator';
import nodeSaml from '@node-saml/node-saml';
import xmldom from '@xmldom/xmldom';

// Private interoperability service: samlify IdP, independent node-saml SP.
const { SAML } = nodeSaml;
const { DOMParser } = xmldom;
samlify.setSchemaValidator(validator);
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const temp = mkdtempSync(join(tmpdir(), 'sso-saml-reference-'));
process.on('exit', () => rmSync(temp, { recursive: true, force: true }));
const keyPath = join(temp, 'idp.key');
const certPath = join(temp, 'idp.crt');
const openssl = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=local-saml-idp'],
{ stdio: 'ignore' });
if (openssl.status !== 0) throw new Error('Unable to generate temporary IdP certificate');
const privateKey = readFileSync(keyPath, 'utf8');
const certificate = readFileSync(certPath, 'utf8');
const requestedPort = Number(process.env.SSO_SAML_REFERENCE_PORT ?? 0);
const centerTtlMs = Number(process.env.SSO_SAML_REFERENCE_CENTER_TTL_MS ?? 300000);
const maxAssertionAgeMs = Number(process.env.SSO_SAML_REFERENCE_MAX_ASSERTION_AGE_MS ?? 300000);
const pending = new Map();
const centerPending = new Map();
const centerSessions = new Map();
const hostSessions = new Map();
const requestCaches = { 'app-a': new Map(), 'app-b': new Map() };
const stats = { centerLogins: 0, responsesIssued: 0, callbacks: 0, rejected: 0, rejectionReasons: [] };
let origin;
let centerOrigin;
let idp;
let idpSp;

function send(res, status, body = '', headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function redirect(res, location, headers = {}) {
  send(res, 302, '', { Location: location, ...headers });
}

function cookie(req, name) {
  return (req.headers.cookie ?? '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function cacheFor(app) {
  const entries = requestCaches[app];
  return {
    async saveAsync(key, value) { entries.set(key, value); return { key, value }; },
    async getAsync(key) { return entries.get(key) ?? null; },
    async removeAsync(key) { const value = entries.get(key) ?? null; entries.delete(key); return value; },
  };
}

function acsMismatch(profile, app, requestId) {
  const xml = profile.getSamlResponseXml?.();
  if (!xml) return 'missing_response_xml';
  const doc = new DOMParser({ errorHandler: { error: (message) => { throw new Error(message); },
    fatalError: (message) => { throw new Error(message); } } }).parseFromString(xml, 'application/xml');
  const response = doc.documentElement;
  if (response.localName !== 'Response') return 'wrong_response_root';
  if (response.getAttribute('Destination') !== acs(app)) return 'wrong_destination';
  if (response.getAttribute('InResponseTo') !== requestId) return 'wrong_response_to';
  const confirmations = Array.from(doc.getElementsByTagNameNS(
    'urn:oasis:names:tc:SAML:2.0:assertion', 'SubjectConfirmationData'));
  if (confirmations.length === 0) return 'missing_subject_confirmation';
  if (confirmations.some((item) => item.getAttribute('Recipient') !== acs(app))) return 'wrong_recipient';
  if (confirmations.some((item) => item.getAttribute('InResponseTo') !== requestId)) return 'wrong_subject_to';
  return undefined;
}

function entity(app) { return `${origin}/${app}/auth/saml/metadata`; }
function acs(app) { return `${origin}/${app}/auth/saml/acs`; }

function sp(app, requestId) {
  return new SAML({
    issuer: entity(app), audience: entity(app), callbackUrl: acs(app),
    entryPoint: `${centerOrigin}/saml/sso`, idpCert: certificate,
    idpIssuer: `${centerOrigin}/saml/metadata`,
    wantAssertionsSigned: true, wantAuthnResponseSigned: true,
    validateInResponseTo: 'always', cacheProvider: cacheFor(app),
    requestIdExpirationPeriodMs: 300000, acceptedClockSkewMs: 0,
    maxAssertionAgeMs, signatureAlgorithm: 'sha256', identifierFormat: null,
    ...(requestId ? { generateUniqueId: () => requestId } : {}),
  });
}

async function fields(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return new URLSearchParams(body);
}

function postPage(res, record, centerCookie) {
  const postBinding = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';
  const responseSp = record.scenario === 'audience'
    ? samlify.ServiceProvider({ entityID: `${origin}/unregistered-sp`, wantAssertionsSigned: true,
      wantMessageSigned: true, assertionConsumerService: [{ Binding: postBinding, Location: acs(record.app) }] })
    : record.scenario === 'recipient'
      ? samlify.ServiceProvider({ entityID: entity(record.app), wantAssertionsSigned: true,
        wantMessageSigned: true, assertionConsumerService: [{ Binding: postBinding, Location: `${origin}/wrong-acs` }] })
      : idpSp[record.app];
  const requestInfo = record.scenario === 'correlation'
    ? { extract: { request: { id: `_${randomUUID()}` } } } : record.requestInfo;
  return idp.createLoginResponse(responseSp, requestInfo, 'post',
    { email: 'demo@example.test' }).then(({ context }) => {
    stats.responsesIssued += 1;
    send(res, 200, `<!doctype html><meta charset="utf-8"><h1>正在返回宿主</h1>
      <form method="post" action="${acs(record.app)}">
      <input type="hidden" name="SAMLResponse" value="${context}">
      <input type="hidden" name="RelayState" value="${record.state}">
      <button type="submit">继续</button></form><script>document.forms[0].submit()</script>`,
    { 'Content-Type': 'text/html; charset=utf-8',
      ...(centerCookie ? { 'Set-Cookie': `saml_reference_center=${centerCookie}; HttpOnly; SameSite=Lax; Path=/saml/` } : {}) });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', origin);
    if (url.pathname === '/__stats') {
      send(res, 200, JSON.stringify(stats), { 'Content-Type': 'application/json' });
      return;
    }
    if (req.headers.host?.startsWith('localhost:')) {
      if (url.pathname === '/saml/metadata') {
        send(res, 200, idp.getMetadata(), { 'Content-Type': 'application/xml' });
        return;
      }
      if (url.pathname === '/saml/sso' && req.method === 'GET') {
        const state = url.searchParams.get('RelayState');
        const expected = state && pending.get(state);
        if (!expected || !url.searchParams.get('SAMLRequest')) return send(res, 400, 'Unknown request');
        const requestInfo = await idp.parseLoginRequest(idpSp[expected.app], 'redirect',
          { query: Object.fromEntries(url.searchParams) });
        if (requestInfo.extract.request.id !== expected.requestId) return send(res, 400, 'Wrong request ID');
        const scenario = url.searchParams.get('scenario');
        const record = { app: expected.app, state, requestInfo,
          scenario: ['audience', 'recipient', 'correlation'].includes(scenario) ? scenario : undefined };
        centerPending.set(state, record);
        const centerSession = centerSessions.get(cookie(req, 'saml_reference_center'));
        if (centerSession && Date.now() < centerSession.expiresAt) return await postPage(res, record);
        send(res, 200, `<!doctype html><meta charset="utf-8"><h1>SAML 认证中心登录</h1>
          <form method="post" action="/saml/login"><input type="hidden" name="state" value="${state}">
          <input name="username" value="demo"><input name="password" type="password" value="demo">
          <button type="submit">以 demo 登录</button></form>
          <a href="/saml/cancel?state=${state}">取消登录</a>`,
        { 'Content-Type': 'text/html; charset=utf-8' });
        return;
      }
      if (url.pathname === '/saml/login' && req.method === 'POST') {
        const form = await fields(req);
        const record = centerPending.get(form.get('state'));
        if (!record) return send(res, 400, 'Unknown request');
        if (form.get('username') !== 'demo' || form.get('password') !== 'demo') return send(res, 401, 'Invalid credentials');
        const session = randomUUID();
        centerSessions.set(session, { expiresAt: Date.now() + centerTtlMs });
        stats.centerLogins += 1;
        await postPage(res, record, session);
        return;
      }
      if (url.pathname === '/saml/cancel') {
        const state = url.searchParams.get('state');
        const record = state && centerPending.get(state);
        if (!record) return send(res, 400, 'Unknown request');
        centerPending.delete(state);
        const target = new URL(pending.get(state).returnTo, origin);
        pending.delete(state);
        target.searchParams.set('ssoError', 'saml_login_canceled');
        redirect(res, target.href);
        return;
      }
      return send(res, 404);
    }

    const app = url.pathname.match(/^\/(app-a|app-b)(?:\/|$)/)?.[1];
    if (!app) return send(res, 404);
    if (url.pathname === `/${app}/auth/saml/metadata`) {
      send(res, 200, sp(app).generateServiceProviderMetadata(null, null),
        { 'Content-Type': 'application/xml' });
      return;
    }
    if (url.pathname === `/${app}/auth/session`) {
      const session = cookie(req, `session_${app}`);
      if (!session || !hostSessions.has(session)) return send(res, 401);
      send(res, 200, JSON.stringify({ authenticated: true, user: { id: hostSessions.get(session) } }),
        { 'Content-Type': 'application/json' });
      return;
    }
    if (url.pathname === `/${app}/auth/logout` && req.method === 'POST') {
      const session = cookie(req, `session_${app}`);
      if (session) hostSessions.delete(session);
      send(res, 204, '', { 'Set-Cookie': `session_${app}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/${app}/` });
      return;
    }
    if (url.pathname === `/${app}/auth/saml/start`) {
      const returnTo = url.searchParams.get('returnTo') ?? `/${app}/?protocol=saml`;
      if (!returnTo.startsWith(`/${app}/`) || returnTo.startsWith('//')) return send(res, 400, 'Invalid returnTo');
      const cleanReturnTo = new URL(returnTo, origin);
      cleanReturnTo.searchParams.delete('ssoError');
      const state = randomUUID();
      const requestId = `_${randomUUID()}`;
      pending.set(state, { app, returnTo: cleanReturnTo.pathname + cleanReturnTo.search + cleanReturnTo.hash, requestId });
      redirect(res, await sp(app, requestId).getAuthorizeUrlAsync(state));
      return;
    }
    if (url.pathname === `/${app}/auth/saml/acs` && req.method === 'POST') {
      stats.callbacks += 1;
      const form = await fields(req);
      const state = form.get('RelayState');
      const record = state && pending.get(state);
      if (!record || record.app !== app) return send(res, 400, 'Invalid RelayState');
      pending.delete(state);
      centerPending.delete(state);
      const failed = (reason) => {
        stats.rejected += 1;
        stats.rejectionReasons.push(reason);
        const target = new URL(record.returnTo, origin);
        target.searchParams.set('ssoError', 'saml_validation_failed');
        redirect(res, target.href);
      };
      try {
        if (!form.get('SAMLResponse')) return failed('missing_response');
        const { profile } = await sp(app).validatePostResponseAsync({ SAMLResponse: form.get('SAMLResponse') });
        if (!profile?.nameID) return failed('missing_name_id');
        if (profile.issuer !== idp.entityMeta.getEntityID()) return failed('wrong_issuer');
        if (profile.inResponseTo !== record.requestId) return failed('wrong_profile_to');
        const mismatch = acsMismatch(profile, app, record.requestId);
        if (mismatch) return failed(mismatch);
        const session = randomUUID();
        hostSessions.set(session, profile.nameID);
        redirect(res, new URL(record.returnTo, origin).href, {
          'Set-Cookie': `session_${app}=${session}; HttpOnly; SameSite=Lax; Path=/${app}/`,
        });
      } catch (error) { failed(error.message); }
      return;
    }
    if (url.pathname === `/${app}/`) {
      const page = await readFile(join(root, app === 'app-a'
        ? 'apps/compat/build/vue/index.html' : 'apps/compat/build/react/index.html'));
      send(res, 200, page, { 'Content-Type': 'text/html; charset=utf-8' });
      return;
    }
    if (/^\/(app-a|app-b)\/assets\/[\w-]+\.js$/.test(url.pathname)) {
      const asset = await readFile(join(root, app === 'app-a'
        ? 'apps/compat/build/vue/assets' : 'apps/compat/build/react/assets', url.pathname.split('/').at(-1)));
      send(res, 200, asset, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return;
    }
    send(res, 404);
  } catch (error) {
    send(res, 500, String(error));
  }
});

server.listen(requestedPort, () => {
  const port = server.address().port;
  origin = `http://127.0.0.1:${port}`;
  centerOrigin = `http://localhost:${port}`;
  idp = samlify.IdentityProvider({
    entityID: `${centerOrigin}/saml/metadata`, privateKey, signingCert: certificate,
    isAssertionEncrypted: false,
    nameIDFormat: ['urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress'],
    singleSignOnService: [{ Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect', Location: `${centerOrigin}/saml/sso` }],
  });
  idpSp = Object.fromEntries(['app-a', 'app-b'].map((app) => [app, samlify.ServiceProvider({
    entityID: entity(app), wantAssertionsSigned: true, wantMessageSigned: true,
    assertionConsumerService: [{ Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST', Location: acs(app), isDefault: true }],
  })]));
  process.stdout.write(`SAML Reference: ${origin}/app-a/ and ${origin}/app-b/\n`);
});
