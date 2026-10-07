import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const buildRoot = process.env.SSO_COMPAT_BUILD_ROOT ?? join(root, 'apps/compat/build');
const parser = new XMLParser();

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

export async function startHost(centerOrigin) {
  const pending = new Map();
  const sessions = new Map();
  const stats = { starts: 0, callbacks: 0, validations: 0 };
  let origin;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', origin);
      if (url.pathname === '/__stats') {
        send(res, 200, JSON.stringify(stats), { 'Content-Type': 'application/json' });
        return;
      }
      const app = url.pathname.match(/^\/(app-a|app-b)(?:\/|$)/)?.[1];
      if (!app) return send(res, 404);
      if (url.pathname === `/${app}/`) {
        const page = await readFile(join(buildRoot, app === 'app-a' ? 'vue' : 'react', 'index.html'));
        return send(res, 200, page, { 'Content-Type': 'text/html; charset=utf-8' });
      }
      if (new RegExp(`^/${app}/assets/[\\w-]+\\.js$`).test(url.pathname)) {
        const source = await readFile(join(buildRoot, app === 'app-a' ? 'vue' : 'react',
          'assets', url.pathname.split('/').at(-1)));
        return send(res, 200, source, { 'Content-Type': 'text/javascript; charset=utf-8' });
      }
      if (url.pathname === `/${app}/auth/session`) {
        const id = cookie(req, `session_${app}`);
        if (!id || !sessions.has(id)) return send(res, 401);
        return send(res, 200, JSON.stringify({ authenticated: true, user: { id: sessions.get(id) } }),
          { 'Content-Type': 'application/json' });
      }
      if (url.pathname === `/${app}/auth/cas/start`) {
        const returnTo = url.searchParams.get('returnTo') ?? `/${app}/`;
        if (!returnTo.startsWith(`/${app}/`) || returnTo.startsWith('//')) {
          return send(res, 400, 'Invalid returnTo');
        }
        const state = randomUUID();
        const service = `${origin}/${app}/auth/cas/callback?state=${state}`;
        pending.set(state, { app, service, returnTo });
        stats.starts += 1;
        const target = new URL('/cas/login', centerOrigin);
        target.searchParams.set('service', service);
        return redirect(res, target.href);
      }
      if (url.pathname === `/${app}/auth/cas/callback`) {
        stats.callbacks += 1;
        const state = url.searchParams.get('state');
        const ticket = url.searchParams.get('ticket');
        const record = state && pending.get(state);
        if (!record || record.app !== app) return send(res, 400, 'Invalid callback');
        pending.delete(state);
        const failed = () => {
          const target = new URL(record.returnTo, origin);
          target.searchParams.set('ssoError', 'cas_validation_failed');
          redirect(res, target.href);
        };
        if (!ticket) return failed();
        const validation = new URL('/cas/serviceValidate', centerOrigin);
        validation.searchParams.set('service', record.service);
        validation.searchParams.set('ticket', ticket);
        stats.validations += 1;
        const response = await fetch(validation);
        if (!response.ok) return send(res, 502, 'CAS validation unavailable');
        const payload = parser.parse(await response.text());
        const user = payload['cas:serviceResponse']?.['cas:authenticationSuccess']?.['cas:user'];
        if (typeof user !== 'string' || !user) return failed();
        const id = randomUUID();
        sessions.set(id, user);
        return redirect(res, `${origin}${record.returnTo}`, {
          'Set-Cookie': `session_${app}=${id}; HttpOnly; SameSite=Lax; Path=/${app}/`,
        });
      }
      if (url.pathname === `/${app}/auth/logout` && req.method === 'POST') {
        const id = cookie(req, `session_${app}`);
        if (id) sessions.delete(id);
        return send(res, 204, '', {
          'Set-Cookie': `session_${app}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/${app}/`,
        });
      }
      send(res, 404);
    } catch (error) {
      send(res, 500, String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
