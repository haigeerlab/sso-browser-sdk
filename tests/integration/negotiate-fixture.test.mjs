import test from 'node:test';
import assert from 'node:assert/strict';
import { createSSO } from 'sso-browser-sdk-prototype';
import { negotiateAdapter } from 'sso-browser-sdk-prototype/negotiate';
import { startNegotiateFixture } from '../../services/negotiate-fixture/server.mjs';

function request(url, options = {}) {
  return fetch(url, { redirect: 'manual', ...options });
}

function firstCookie(response) {
  return response.headers.get('set-cookie')?.split(';')[0];
}

function startUrl(origin, app, returnTo = `/${app}/?protocol=negotiate`) {
  const adapter = negotiateAdapter({ loginEndpoint: `/${app}/auth/negotiate/start` });
  return origin + adapter.loginUrl({ returnTo });
}

test('Negotiate challenges only the dedicated navigation endpoint', async (t) => {
  const { origin } = await startNegotiateFixture(t);
  const session = await request(`${origin}/app-a/auth/session`);
  assert.equal(session.status, 401);
  assert.equal(session.headers.get('www-authenticate'), null);

  const challenge = await request(startUrl(origin, 'app-a'));
  assert.equal(challenge.status, 401);
  assert.equal(challenge.headers.get('www-authenticate'), 'Negotiate');
  assert.equal(challenge.headers.get('cache-control'), 'no-store');
});

test('Negotiate fixture rejects unsafe return targets and supplied identity headers', async (t) => {
  const { origin } = await startNegotiateFixture(t);
  for (const returnTo of ['//evil.example/', '/app-b/', 'https://evil.example/',
    '/app-a/../app-b/', '/app-a/%5c%5cevil.example/']) {
    const response = await request(startUrl(origin, 'app-a', returnTo));
    assert.equal(response.status, 400, returnTo);
  }

  const spoofed = await request(startUrl(origin, 'app-a'), {
    headers: {
      Authorization: 'Negotiate fake-token',
      'X-Remote-User': 'admin',
    },
  });
  assert.equal(spoofed.status, 302);
  assert.equal(new URL(spoofed.headers.get('location')).searchParams.get('ssoError'),
    'negotiate_failed');
  assert.equal(spoofed.headers.get('set-cookie'), null);
  assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401);
});

test('scripted multi-round verifier creates independent A/B sessions and local logout', async (t) => {
  const rounds = new Set();
  const { origin } = await startNegotiateFixture(t, {
    verify({ app, authorization }) {
      if (authorization === `Negotiate ${app}-step-1`) {
        rounds.add(app);
        return { status: 'continue', challenge: 'fixture-step-2' };
      }
      if (authorization === `Negotiate ${app}-step-2` && rounds.delete(app)) {
        return { status: 'authenticated', mechanism: 'Kerberos', user: 'demo' };
      }
      return { status: 'rejected' };
    },
  });

  for (const app of ['app-a', 'app-b']) {
    const url = startUrl(origin, app);
    assert.equal((await request(url)).headers.get('www-authenticate'), 'Negotiate');
    const continued = await request(url, {
      headers: { Authorization: `Negotiate ${app}-step-1` },
    });
    assert.equal(continued.status, 401);
    assert.equal(continued.headers.get('www-authenticate'), 'Negotiate fixture-step-2');
    const completed = await request(url, {
      headers: { Authorization: `Negotiate ${app}-step-2` },
    });
    assert.equal(completed.status, 302);
    assert.equal(completed.headers.get('location'), `${origin}/${app}/?protocol=negotiate`);
    const cookie = firstCookie(completed);
    assert.ok(cookie.startsWith(`session_${app}=`));
    assert.equal((await request(`${origin}/${app}/auth/session`,
      { headers: { Cookie: cookie } })).status, 200);
    const otherApp = app === 'app-a' ? 'app-b' : 'app-a';
    assert.equal((await request(`${origin}/${otherApp}/auth/session`,
      { headers: { Cookie: cookie } })).status, 401);
    if (app === 'app-a') {
      const logout = await request(`${origin}/app-a/auth/logout`, {
        method: 'POST', headers: { Cookie: cookie },
      });
      assert.equal(logout.status, 204);
      assert.equal((await request(`${origin}/app-a/auth/session`,
        { headers: { Cookie: cookie } })).status, 401);
    }
  }
});

test('NTLM fallback, expired session and abandoned challenge do not stay logged in', async (t) => {
  const { origin } = await startNegotiateFixture(t, {
    sessionTtlMs: 0,
    verify({ authorization }) {
      return { status: 'authenticated', mechanism: authorization.includes('ntlm')
        ? 'NTLM' : 'Kerberos', user: 'demo' };
    },
  });
  const url = startUrl(origin, 'app-a');
  assert.equal((await request(url)).status, 401);
  assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401);

  const ntlm = await request(url, { headers: { Authorization: 'Negotiate fixture-ntlm' } });
  assert.equal(ntlm.status, 302);
  assert.equal(firstCookie(ntlm), undefined);
  assert.equal(new URL(ntlm.headers.get('location')).searchParams.get('ssoError'),
    'negotiate_failed');

  const kerberos = await request(url, { headers: { Authorization: 'Negotiate fixture-kerberos' } });
  assert.equal(kerberos.status, 302);
  const cookie = firstCookie(kerberos);
  assert.ok(cookie);
  assert.equal((await request(`${origin}/app-a/auth/session`,
    { headers: { Cookie: cookie } })).status, 401);
});

test('SDK stops automatic retries and allows manual retry after the fixture challenge', async (t) => {
  const { origin } = await startNegotiateFixture(t, {
    verify({ authorization }) {
      return authorization === 'Negotiate fixture-approved'
        ? { status: 'authenticated', mechanism: 'Kerberos', user: 'demo' }
        : { status: 'rejected' };
    },
  });
  let cookie = '';
  const values = new Map();
  const navigations = [];
  const client = createSSO({
    session: { endpoint: '/app-a/auth/session' },
    logout: { endpoint: '/app-a/auth/logout' },
    adapter: negotiateAdapter({ loginEndpoint: '/app-a/auth/negotiate/start' }),
    currentUrl: () => `${origin}/app-a/?protocol=negotiate&ssoError=old`,
    navigate: (url) => navigations.push(url),
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    fetch: (url, options) => request(new URL(url, origin), {
      ...options, headers: { ...options.headers, Cookie: cookie },
    }),
  });

  assert.equal((await client.ensureAuthenticated()).status, 'unauthenticated');
  assert.equal(navigations.length, 1);
  assert.equal((await request(origin + navigations[0])).status, 401);
  await assert.rejects(client.ensureAuthenticated(), /login loop/i);
  assert.equal(navigations.length, 1);
  assert.equal(client.getState().status, 'error');

  client.login();
  assert.equal(navigations.length, 2);
  const completed = await request(origin + navigations[1], {
    headers: { Authorization: 'Negotiate fixture-approved' },
  });
  assert.equal(completed.status, 302);
  assert.equal(new URL(completed.headers.get('location')).searchParams.has('ssoError'), false);
  cookie = firstCookie(completed);
  assert.deepEqual(await client.ensureAuthenticated(),
    { status: 'authenticated', user: { id: 'demo' } });
  assert.equal(values.size, 0);
  await client.logout();
  assert.equal(client.getState().status, 'unauthenticated');
  assert.equal((await client.getSession()).status, 'unauthenticated');
});
