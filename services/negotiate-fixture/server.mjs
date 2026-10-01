import http from 'node:http';
import { randomUUID } from 'node:crypto';

// HTTP interaction fixture only. The injected verifier is a test double, not GSSAPI.
export async function startNegotiateFixture(t, { verify = () => ({ status: 'rejected' }),
  sessionTtlMs = 300000 } = {}) {
  const sessions = new Map();
  let origin;

  const server = http.createServer(async (req, res) => {
    const send = (status, body = '', headers = {}) => {
      res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
      res.end(body);
    };
    const redirect = (location, headers = {}) => send(302, '', { Location: location, ...headers });

    try {
      const url = new URL(req.url, origin);
      const app = url.pathname.match(/^\/(app-a|app-b)\//)?.[1];
      if (!app) return send(404);
      const cookieName = `session_${app}`;
      const sessionId = (req.headers.cookie ?? '').split(';').map((part) => part.trim())
        .find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);

      if (url.pathname === `/${app}/auth/session` && req.method === 'GET') {
        const session = sessionId && sessions.get(sessionId);
        if (!session || session.app !== app || Date.now() >= session.expiresAt) {
          return send(401);
        }
        return send(200, JSON.stringify({ authenticated: true, user: { id: session.user } }),
          { 'Content-Type': 'application/json' });
      }

      if (url.pathname === `/${app}/auth/logout` && req.method === 'POST') {
        if (sessionId) sessions.delete(sessionId);
        return send(204, '', {
          'Set-Cookie': `${cookieName}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/${app}/`,
        });
      }

      if (url.pathname !== `/${app}/auth/negotiate/start` || req.method !== 'GET') {
        return send(404);
      }

      const input = url.searchParams.get('returnTo') ?? `/${app}/`;
      const path = input.split(/[?#]/, 1)[0];
      if (!input.startsWith(`/${app}/`) || path.includes('\\') || /%(2f|5c)/i.test(path)) {
        return send(400, 'Invalid returnTo');
      }
      const target = new URL(input, origin);
      if (target.origin !== origin || !target.pathname.startsWith(`/${app}/`)) {
        return send(400, 'Invalid returnTo');
      }
      target.searchParams.delete('ssoError');

      const authorization = req.headers.authorization;
      if (!authorization) {
        return send(401, '', { 'WWW-Authenticate': 'Negotiate' });
      }
      const result = await verify({ app, authorization });
      if (result.status === 'continue') {
        return send(401, '', { 'WWW-Authenticate': `Negotiate ${result.challenge}` });
      }
      if (result.status !== 'authenticated' || result.mechanism !== 'Kerberos'
        || typeof result.user !== 'string' || !result.user) {
        target.searchParams.set('ssoError', 'negotiate_failed');
        return redirect(target.href);
      }

      const id = randomUUID();
      sessions.set(id, { app, user: result.user, expiresAt: Date.now() + sessionTtlMs });
      return redirect(target.href, {
        'Set-Cookie': `${cookieName}=${id}; HttpOnly; SameSite=Lax; Path=/${app}/`,
      });
    } catch {
      return send(500);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return { origin };
}
