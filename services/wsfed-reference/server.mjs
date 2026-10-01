import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import wsfed from 'wsfed';
import wsfedRp from 'passport-wsfed-saml2';
import xmldom from '@xmldom/xmldom';

// Private interoperability service: Auth0 node-wsfed STS and passport-wsfed-saml2 RP validator.
// Both run only in this test workspace; browser SDK never parses a token.
const { SAML } = wsfedRp.SAML;
const { DOMParser } = xmldom;
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const temp = mkdtempSync(join(tmpdir(), 'sso-wsfed-reference-'));
process.on('exit', () => rmSync(temp, { recursive: true, force: true }));
const keyPath = join(temp, 'sts.key');
const certPath = join(temp, 'sts.crt');
const openssl = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=local-wsfed-sts'],
{ stdio: 'ignore' });
if (openssl.status !== 0) throw new Error('Unable to generate temporary STS certificate');
const privateKey = readFileSync(keyPath, 'utf8');
const certificate = readFileSync(certPath, 'utf8');
const certificateBody = certificate.replace(/-----[^-]+-----|\s/g, '');
const requestedPort = Number(process.env.SSO_WSFED_REFERENCE_PORT ?? 0);
const centerTtlMs = Number(process.env.SSO_WSFED_REFERENCE_CENTER_TTL_MS ?? 300000);
const pending = new Map();
const centerSessions = new Map();
const hostSessions = new Map();
const usedAssertions = new Set();
const stats = { centerLogins: 0, responsesIssued: 0, callbacks: 0, rejected: 0, rejectionReasons: [] };
let origin;
let centerOrigin;
let issuer;

function cookie(req, name) {
  return (req.headers.cookie ?? '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function realm(app) { return `urn:reference:${app}`; }
function reply(app) { return `${origin}/${app}/auth/wsfed/callback`; }

function parseSignedAssertion(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const assertion = doc.documentElement;
  if (assertion.localName !== 'Assertion') throw new Error('wrong_assertion_root');
  const id = assertion.getAttribute('AssertionID');
  const conditions = Array.from(assertion.getElementsByTagName('*'))
    .find((item) => item.localName === 'Conditions');
  const before = Date.parse(conditions?.getAttribute('NotBefore') ?? '');
  const after = Date.parse(conditions?.getAttribute('NotOnOrAfter') ?? '');
  if (!id || !Number.isFinite(before) || !Number.isFinite(after)) throw new Error('missing_assertion_conditions');
  if (Date.now() < before || Date.now() >= after) throw new Error('expired_assertion');
  return id;
}

function validateToken(app, token) {
  const validator = new SAML({ cert: certificateBody, realm: realm(app), recipientUrl: reply(app),
    checkExpiration: true, checkCertExpiration: true, clockSkew: 0,
    checkAudience: true, checkRecipient: true });
  return new Promise((resolve, reject) => {
    validator.validateSignature(token, {
      signaturePath: "//*[local-name(.)='Assertion'][1]/*[local-name(.)='Signature' and namespace-uri(.)='http://www.w3.org/2000/09/xmldsig#']",
    }, (signatureError, signed) => {
      if (signatureError) return reject(signatureError);
      let id;
      try { id = parseSignedAssertion(signed); }
      catch (error) { return reject(error); }
      validator.parseAssertion(signed, (parseError, profile) => {
        if (parseError) return reject(parseError);
        if (profile.issuer !== issuer) return reject(new Error('wrong_issuer'));
        if (usedAssertions.has(id)) return reject(new Error('replayed_assertion'));
        if (!profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier']) {
          return reject(new Error('missing_name_identifier'));
        }
        usedAssertions.add(id);
        resolve(profile);
      });
    });
  });
}

const app = express();
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.get('/__stats', (req, res) => res.json(stats));

function validPassive(req) {
  const context = req.query.wctx;
  const record = typeof context === 'string' && pending.get(context);
  return record && req.query.wa === 'wsignin1.0'
    && req.query.wtrealm === realm(record.app)
    && req.query.wreply === reply(record.app) ? { context, record } : undefined;
}

function issueToken(audience, lifetime, tokenIssuer = issuer) {
  return wsfed.auth({ issuer: tokenIssuer, cert: certificate, key: privateKey,
    signatureAlgorithm: 'rsa-sha256', digestAlgorithm: 'sha256',
    ...(audience ? { audience } : {}), ...(lifetime ? { lifetime } : {}),
    getUserFromRequest: () => ({ id: 'demo', displayName: 'Demo User', emails: [{ value: 'demo@example.test' }] }),
    getPostURL: (wtrealm, wreply, req, done) => {
      const found = validPassive(req);
      if (!found) return done(new Error('Invalid passive request'));
      stats.responsesIssued += 1;
      done(null, reply(found.record.app));
    },
  });
}

app.get('/wsfed/passive', (req, res, next) => {
  const found = validPassive(req);
  if (!found) return res.status(400).send('Invalid passive request');
  const center = centerSessions.get(cookie(req, 'wsfed_reference_center'));
  if (!center || Date.now() >= center.expiresAt) {
    if (['audience', 'expired', 'issuer'].includes(req.query.scenario)) {
      const centerRequest = new URL(found.record.centerRequest);
      centerRequest.searchParams.set('scenario', req.query.scenario);
      found.record.centerRequest = centerRequest.href;
    }
    return res.type('html').send(`<!doctype html><meta charset="utf-8"><h1>WS-Fed 认证中心登录</h1>
      <form method="post" action="/wsfed/login"><input type="hidden" name="wctx" value="${found.context}">
      <input name="username" value="demo"><input name="password" type="password" value="demo">
      <button type="submit">以 demo 登录</button></form>
      <a href="/wsfed/cancel?wctx=${found.context}">取消登录</a>`);
  }
  if (req.query.scenario === 'audience') return issueToken('urn:reference:wrong')(req, res, next);
  if (req.query.scenario === 'expired') return issueToken(undefined, -60)(req, res, next);
  if (req.query.scenario === 'issuer') return issueToken(undefined, undefined, `${centerOrigin}/wrong-issuer`)(req, res, next);
  return issueToken()(req, res, next);
});

app.post('/wsfed/login', (req, res) => {
  const context = req.body.wctx;
  const record = pending.get(context);
  if (!record) return res.status(400).send('Unknown wctx');
  if (req.body.username !== 'demo' || req.body.password !== 'demo') {
    return res.status(401).send('Invalid credentials');
  }
  const session = randomUUID();
  centerSessions.set(session, { expiresAt: Date.now() + centerTtlMs });
  stats.centerLogins += 1;
  res.set('Set-Cookie', `wsfed_reference_center=${session}; HttpOnly; SameSite=Lax; Path=/wsfed/`);
  res.redirect(302, record.centerRequest);
});

app.get('/wsfed/cancel', (req, res) => {
  const context = req.query.wctx;
  const record = pending.get(context);
  if (!record) return res.status(400).send('Unknown wctx');
  pending.delete(context);
  const target = new URL(record.returnTo, origin);
  target.searchParams.set('ssoError', 'wsfed_login_canceled');
  res.redirect(302, target.href);
});

app.use(async (req, res, next) => {
  const path = new URL(req.url, origin).pathname;
  const appName = path.match(/^\/(app-a|app-b)(?:\/|$)/)?.[1];
  if (!appName) return next();
  if (path === `/${appName}/auth/session`) {
    const session = hostSessions.get(cookie(req, `session_${appName}`));
    if (!session) return res.sendStatus(401);
    return res.json({ authenticated: true, user: { id: session } });
  }
  if (path === `/${appName}/auth/logout` && req.method === 'POST') {
    hostSessions.delete(cookie(req, `session_${appName}`));
    res.set('Set-Cookie', `session_${appName}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/${appName}/`);
    return res.sendStatus(204);
  }
  if (path === `/${appName}/auth/wsfed/start` && req.method === 'GET') {
    const returnTo = req.query.returnTo ?? `/${appName}/?protocol=wsfed`;
    if (typeof returnTo !== 'string' || !returnTo.startsWith(`/${appName}/`) || returnTo.startsWith('//')) {
      return res.status(400).send('Invalid returnTo');
    }
    const cleanReturnTo = new URL(returnTo, origin);
    cleanReturnTo.searchParams.delete('ssoError');
    const context = randomUUID();
    const centerRequest = new URL('/wsfed/passive', centerOrigin);
    centerRequest.searchParams.set('wa', 'wsignin1.0');
    centerRequest.searchParams.set('wtrealm', realm(appName));
    centerRequest.searchParams.set('wreply', reply(appName));
    centerRequest.searchParams.set('wctx', context);
    pending.set(context, { app: appName, centerRequest: centerRequest.href,
      returnTo: cleanReturnTo.pathname + cleanReturnTo.search + cleanReturnTo.hash });
    return res.redirect(302, centerRequest.href);
  }
  if (path === `/${appName}/auth/wsfed/callback` && req.method === 'POST') {
    stats.callbacks += 1;
    const context = req.body.wctx;
    const record = pending.get(context);
    if (!record || record.app !== appName) return res.status(400).send('Invalid wctx');
    pending.delete(context);
    const failed = (reason) => {
      stats.rejected += 1;
      stats.rejectionReasons.push(reason);
      const target = new URL(record.returnTo, origin);
      target.searchParams.set('ssoError', 'wsfed_validation_failed');
      res.redirect(302, target.href);
    };
    if (req.body.wa !== 'wsignin1.0' || typeof req.body.wresult !== 'string') return failed('invalid_action_or_token');
    try {
      const profile = await validateToken(appName, req.body.wresult);
      const session = randomUUID();
      hostSessions.set(session, profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier']);
      res.set('Set-Cookie', `session_${appName}=${session}; HttpOnly; SameSite=Lax; Path=/${appName}/`);
      return res.redirect(302, new URL(record.returnTo, origin).href);
    } catch (error) { return failed(error.message); }
  }
  if (path === `/${appName}/` && req.method === 'GET') {
    const page = await readFile(join(root, appName === 'app-a'
      ? 'apps/compat/build/vue/index.html' : 'apps/compat/build/react/index.html'));
    return res.type('html').send(page);
  }
  if (/^\/(app-a|app-b)\/assets\/[\w-]+\.js$/.test(path)) {
    const asset = await readFile(join(root, appName === 'app-a'
      ? 'apps/compat/build/vue/assets' : 'apps/compat/build/react/assets', path.split('/').at(-1)));
    return res.type('js').send(asset);
  }
  return next();
});

app.use((error, req, res, next) => {
  stats.rejected += 1;
  stats.rejectionReasons.push(error.message);
  res.status(400).send('Rejected');
});

const server = app.listen(requestedPort, () => {
  const port = server.address().port;
  origin = `http://127.0.0.1:${port}`;
  centerOrigin = `http://localhost:${port}`;
  issuer = `${centerOrigin}/wsfed/issuer`;
  process.stdout.write(`WS-Fed reference: ${origin}/app-a/ and ${origin}/app-b/\n`);
});
