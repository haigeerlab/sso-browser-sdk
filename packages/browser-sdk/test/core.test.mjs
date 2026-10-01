import test from 'node:test';
import assert from 'node:assert/strict';
import { createSSO } from '../dist/index.js';

const origin = 'https://app.example.test';

function clientWith(response, overrides = {}) {
  const requests = [];
  const navigations = [];
  const client = createSSO({
    session: { endpoint: '/sso/session' },
    adapter: {
      loginUrl: ({ returnTo }) => `/sso/login?returnTo=${encodeURIComponent(returnTo)}`,
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (response instanceof Error) throw response;
      return response;
    },
    navigate: (url) => navigations.push(url),
    currentUrl: () => `${origin}/orders?tab=open`,
    ...overrides,
  });
  return { client, requests, navigations };
}

test('authenticated session uses the host response and notifies subscribers', async () => {
  const { client, requests } = clientWith(new Response(JSON.stringify({
    authenticated: true,
    user: { id: 'u-1' },
  }), { status: 200 }));
  const states = [];
  client.onAuthChange((state) => states.push(state.status));

  const session = await client.getSession();

  assert.deepEqual(session, { status: 'authenticated', user: { id: 'u-1' } });
  assert.deepEqual(states, ['checking', 'authenticated']);
  assert.equal(requests[0].url, '/sso/session');
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.equal(requests[0].options.cache, 'no-store');
});

test('401 means unauthenticated; a network error is not treated as logged out', async () => {
  const guest = clientWith(new Response(null, { status: 401 })).client;
  assert.deepEqual(await guest.getSession(), { status: 'unauthenticated' });

  const broken = clientWith(new Error('network down')).client;
  await assert.rejects(broken.getSession(), /network down/);
  assert.equal(broken.getState().status, 'error');
});

test('host-specific session payload can be mapped without changing SDK code', async () => {
  const { client } = clientWith(new Response(JSON.stringify({
    data: { account: { id: 'u-2' } },
  }), { status: 200 }), {
    session: {
      endpoint: '/me',
      map: (payload) => ({ authenticated: Boolean(payload.data.account), user: payload.data.account }),
    },
  });

  assert.deepEqual(await client.getSession(), { status: 'authenticated', user: { id: 'u-2' } });
});

test('login preserves a same-origin target and rejects an external return URL', () => {
  const { client, navigations } = clientWith(new Response(null, { status: 401 }));

  client.login({ returnTo: '/orders?tab=open' });
  assert.equal(navigations[0], '/sso/login?returnTo=%2Forders%3Ftab%3Dopen');
  assert.throws(() => client.login({ returnTo: 'https://attacker.example/' }), /returnTo/);
  assert.equal(navigations.length, 1);
});

test('logout posts to the host backend and clears state only after success', async () => {
  const { client, requests } = clientWith(new Response(JSON.stringify({
    authenticated: true,
    user: { id: 'u-1' },
  }), { status: 200 }), {
    logout: { endpoint: '/sso/logout' },
  });
  await client.getSession();

  await client.logout();

  assert.equal(requests[1].url, '/sso/logout');
  assert.equal(requests[1].options.method, 'POST');
  assert.equal(requests[1].options.credentials, 'same-origin');
  assert.deepEqual(client.getState(), { status: 'unauthenticated' });
});

test('failed backend logout keeps the authenticated state', async () => {
  let call = 0;
  const { client } = clientWith(null, {
    logout: { endpoint: '/sso/logout' },
    fetch: async () => ++call === 1
      ? new Response(JSON.stringify({ authenticated: true, user: { id: 'u-1' } }), { status: 200 })
      : new Response(null, { status: 500 }),
  });
  await client.getSession();
  await assert.rejects(client.logout(), /Logout request failed: 500/);
  assert.equal(client.getState().status, 'authenticated');
});

test('a logout fetch redirect is rejected instead of being mistaken for success', async () => {
  const { client } = clientWith(null, {
    logout: { endpoint: '/sso/logout' },
    fetch: async () => ({ ok: true, redirected: true, status: 200 }),
  });

  await assert.rejects(client.logout(), /must not redirect/);
});

test('automatic login redirects once and reports a loop if the backend still has no session', async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const { client, navigations } = clientWith(new Response(null, { status: 401 }), { storage });

  await client.ensureAuthenticated();
  assert.deepEqual(navigations, ['/sso/login?returnTo=%2Forders%3Ftab%3Dopen']);
  await assert.rejects(client.ensureAuthenticated(), /login loop/i);
  assert.equal(navigations.length, 1);
  assert.equal(client.getState().status, 'error');
});

test('automatic login clears its attempt marker after session recovery', async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  let authenticated = false;
  const { client } = clientWith(null, {
    storage,
    fetch: async () => new Response(authenticated
      ? JSON.stringify({ authenticated: true, user: { id: 'u-1' } })
      : null, { status: authenticated ? 200 : 401 }),
  });

  await client.ensureAuthenticated();
  authenticated = true;
  assert.equal((await client.ensureAuthenticated()).status, 'authenticated');
  assert.equal(values.size, 0);
});

test('canceling a manual login reports an error without starting another automatic login', async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const { client, navigations } = clientWith(new Response(null, { status: 401 }), { storage });

  client.login();
  await assert.rejects(client.ensureAuthenticated(), /login loop/i);
  assert.equal(navigations.length, 1);
  assert.equal(client.getState().status, 'error');

  client.login();
  assert.equal(navigations.length, 2);
});

test('a session response started before logout cannot restore authenticated state', async () => {
  let finishSession;
  const { client } = clientWith(null, {
    logout: { endpoint: '/sso/logout' },
    fetch: async (url) => url === '/sso/logout'
      ? new Response(null, { status: 204 })
      : new Promise((resolve) => { finishSession = resolve; }),
  });

  const pending = client.getSession();
  await client.logout();
  finishSession(new Response(JSON.stringify({ authenticated: true, user: { id: 'u-1' } }), { status: 200 }));

  await assert.rejects(pending, /superseded/);
  assert.equal(client.getState().status, 'unauthenticated');
});

test('simultaneous protected-page checks share one navigation', async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const { client, navigations, requests } = clientWith(new Response(null, { status: 401 }), { storage });

  const first = client.ensureAuthenticated();
  const second = client.ensureAuthenticated();
  await Promise.all([first, second]);

  assert.equal(requests.length, 1);
  assert.equal(navigations.length, 1);
});
