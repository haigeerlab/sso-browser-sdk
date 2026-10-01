import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Provider from 'oidc-provider';
import * as oidc from 'openid-client';

// Local interoperability service. Dev interactions and ephemeral signing keys are test-only.
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const secret = 'local-reference-client-secret';
const sessions = new Map();
const pending = new Map();
const stats = { starts: 0, callbacks: 0, tokenExchanges: 0 };
let appOrigin;
let centerOrigin;
let providerHandler;
let clients;

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
  return pathname.match(/^\/(app-a|app-b)(?:\/|$)/)?.[1];
}

async function hostRequest(req, res) {
  const url = new URL(req.url ?? '/', appOrigin);
  if (url.pathname === '/__stats') {
    send(res, 200, JSON.stringify(stats), { 'Content-Type': 'application/json' });
    return;
  }
  const app = appName(url.pathname);
  if (!app) return send(res, 404);

  if (url.pathname === `/${app}/`) {
    const page = await readFile(join(root, app === 'app-a'
      ? 'apps/compat/build/vue/index.html' : 'apps/compat/build/react/index.html'));
    send(res, 200, page, { 'Content-Type': 'text/html; charset=utf-8' });
    return;
  }
  if (new RegExp(`^/${app}/assets/[\\w-]+\\.js$`).test(url.pathname)) {
    const source = await readFile(join(root, 'apps/compat/build', app === 'app-a' ? 'vue' : 'react',
      'assets', url.pathname.split('/').at(-1)));
    send(res, 200, source, { 'Content-Type': 'text/javascript; charset=utf-8' });
    return;
  }
  if (url.pathname === `/${app}/auth/session`) {
    const session = cookies(req)[`session_${app}`];
    if (!session || !sessions.has(session)) return send(res, 401);
    send(res, 200, JSON.stringify({ authenticated: true, user: { id: sessions.get(session) } }),
      { 'Content-Type': 'application/json' });
    return;
  }
  if (url.pathname === `/${app}/auth/oidc/start`) {
    const returnTo = url.searchParams.get('returnTo') ?? `/${app}/`;
    if (!returnTo.startsWith(`/${app}/`) || returnTo.startsWith('//')) {
      return send(res, 400, 'Invalid returnTo');
    }
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const verifier = oidc.randomPKCECodeVerifier();
    const challenge = await oidc.calculatePKCECodeChallenge(verifier);
    pending.set(state, { app, returnTo, verifier, nonce });
    stats.starts += 1;
    const target = oidc.buildAuthorizationUrl(clients.get(app), {
      redirect_uri: `${appOrigin}/${app}/auth/oidc/callback`,
      response_type: 'code',
      scope: 'openid',
      state, nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    redirect(res, target.href);
    return;
  }
  if (url.pathname === `/${app}/auth/oidc/callback`) {
    stats.callbacks += 1;
    const state = url.searchParams.get('state');
    const record = state && pending.get(state);
    if (!record || record.app !== app) return send(res, 400, 'Invalid state');
    pending.delete(state);
    if (url.searchParams.has('error')) {
      redirect(res, `${appOrigin}${record.returnTo}`);
      return;
    }
    try {
      const tokens = await oidc.authorizationCodeGrant(clients.get(app), url, {
        pkceCodeVerifier: record.verifier,
        expectedState: state,
        expectedNonce: record.nonce,
        idTokenExpected: true,
      });
      const user = tokens.claims()?.sub;
      if (!user) return send(res, 400, 'Missing subject');
      stats.tokenExchanges += 1;
      const session = randomUUID();
      sessions.set(session, user);
      redirect(res, `${appOrigin}${record.returnTo}`, {
        'Set-Cookie': `session_${app}=${session}; HttpOnly; SameSite=Lax; Path=/${app}/`,
      });
    } catch {
      send(res, 400, 'Invalid authorization response');
    }
    return;
  }
  if (url.pathname === `/${app}/auth/logout` && req.method === 'POST') {
    const session = cookies(req)[`session_${app}`];
    if (session) sessions.delete(session);
    send(res, 204, '', {
      'Set-Cookie': `session_${app}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/${app}/`,
    });
    return;
  }
  send(res, 404);
}

export async function startReference({ sessionTTLSeconds } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host?.startsWith('localhost:')) return providerHandler(req, res);
      await hostRequest(req, res);
    } catch (error) {
      send(res, 500, String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  appOrigin = `http://127.0.0.1:${port}`;
  centerOrigin = `http://localhost:${port}`;

  const provider = new Provider(centerOrigin, {
    clients: ['app-a', 'app-b'].map((app) => ({
      client_id: app,
      client_secret: secret,
      redirect_uris: [`${appOrigin}/${app}/auth/oidc/callback`],
      response_types: ['code'],
    })),
    cookies: { keys: [randomBytes(32).toString('hex')] },
    ...(sessionTTLSeconds === undefined ? {} : {
      clockTolerance: 0,
      ttl: { Session: () => sessionTTLSeconds },
    }),
    async findAccount(_ctx, id) {
      return { accountId: id, async claims() { return { sub: id }; } };
    },
    async loadExistingGrant(ctx) {
      const grantId = ctx.oidc.result?.consent?.grantId
        || ctx.oidc.session.grantIdFor(ctx.oidc.client.clientId);
      if (grantId) return ctx.oidc.provider.Grant.find(grantId);
      // Both registered clients are trusted first-party apps with pre-agreed openid access.
      const grant = new ctx.oidc.provider.Grant({
        accountId: ctx.oidc.account.accountId,
        clientId: ctx.oidc.client.clientId,
      });
      grant.addOIDCScope('openid');
      await grant.save();
      return grant;
    },
  });
  providerHandler = provider.callback();
  clients = new Map(await Promise.all(['app-a', 'app-b'].map(async (app) => [
    app, await oidc.discovery(new URL(centerOrigin), app, secret, undefined, {
      execute: [oidc.allowInsecureRequests], // Local HTTP fixture only.
    }),
  ])));
  return {
    origin: appOrigin,
    centerOrigin,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startReference().then(({ origin }) => {
    process.stdout.write(`OIDC reference: ${origin}/app-a/ and ${origin}/app-b/\n`);
  }).catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });
}
