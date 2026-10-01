import test from 'node:test';
import assert from 'node:assert/strict';
import { oidcAdapter } from 'sso-browser-sdk-prototype/oidc';
import { startFixture, firstCookie, request } from './fixture.mjs';

async function assertHostAssets(origin, app) {
  const page = await request(`${origin}/${app}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  const script = html.match(/src="(\/(?:app-a|app-b)\/assets\/[^"]+\.js)"/);
  assert.ok(script, `${app} should load a built entry script`);
  assert.equal((await request(origin + script[1])).status, 200);
}

test('two host sessions share one center login and reject replayed callbacks', async (t) => {
  const { origin } = await startFixture(t);

  await assertHostAssets(origin, 'app-a');
  await assertHostAssets(origin, 'app-b');
  assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401);

  const appA = oidcAdapter({ loginEndpoint: '/app-a/auth/oidc/start' });
  const startA = await request(origin + appA.loginUrl({ returnTo: '/app-a/' }));
  assert.equal(startA.status, 302);
  const authorizeA = new URL(startA.headers.get('location'));
  assert.equal(authorizeA.hostname, 'localhost');
  assert.equal((await request(authorizeA)).status, 200);

  const login = await request(new URL(`/idp/login?next=${encodeURIComponent(authorizeA.pathname + authorizeA.search)}`, authorizeA.origin), {
    method: 'POST',
  });
  const centerCookie = firstCookie(login);
  assert.equal(login.status, 302);
  assert.match(centerCookie, /^center_\d+=demo$/);

  const authorizedA = await request(new URL(login.headers.get('location'), authorizeA.origin), {
    headers: { Cookie: centerCookie },
  });
  const callbackA = authorizedA.headers.get('location');
  assert.equal(authorizedA.status, 302);
  const completedA = await request(callbackA);
  const cookieA = firstCookie(completedA);
  assert.equal(completedA.status, 302);
  assert.match(cookieA, /^session_app-a=/);
  const sessionA = await request(`${origin}/app-a/auth/session`, { headers: { Cookie: cookieA } });
  assert.deepEqual(await sessionA.json(), { authenticated: true, user: { id: 'demo' } });

  const appB = oidcAdapter({ loginEndpoint: '/app-b/auth/oidc/start' });
  const startB = await request(origin + appB.loginUrl({ returnTo: '/app-b/' }));
  const authorizedB = await request(startB.headers.get('location'), {
    headers: { Cookie: centerCookie },
  });
  assert.equal(authorizedB.status, 302);
  const completedB = await request(authorizedB.headers.get('location'));
  const cookieB = firstCookie(completedB);
  const sessionB = await request(`${origin}/app-b/auth/session`, { headers: { Cookie: cookieB } });
  assert.deepEqual(await sessionB.json(), { authenticated: true, user: { id: 'demo' } });

  const stats = await (await request(`${origin}/__stats`)).json();
  assert.equal(stats.centerLogins, 1);
  assert.equal(stats.appCallbacks, 2);
  assert.equal((await request(callbackA)).status, 400);

  const logoutB = await request(`${origin}/app-b/auth/logout`, {
    method: 'POST',
    headers: { Cookie: cookieB },
  });
  assert.equal(logoutB.status, 204);
  assert.equal((await request(`${origin}/app-b/auth/session`, { headers: { Cookie: cookieB } })).status, 401);
  assert.equal((await request(`${origin}/app-a/auth/session`, { headers: { Cookie: cookieA } })).status, 200);
});

test('invalid return target and canceled center login leave the host unauthenticated', async (t) => {
  const { origin } = await startFixture(t);

  const invalid = await request(`${origin}/app-a/auth/oidc/start?returnTo=${encodeURIComponent('/app-b/')}`);
  assert.equal(invalid.status, 400);

  const start = await request(`${origin}/app-a/auth/oidc/start?returnTo=${encodeURIComponent('/app-a/')}`);
  const authorize = new URL(start.headers.get('location'));
  const state = authorize.searchParams.get('state');
  const centerPage = await request(authorize);
  assert.equal(centerPage.status, 200);
  const cancel = await request(`${authorize.origin}/idp/cancel?state=${state}`);
  assert.equal(cancel.status, 302);
  assert.equal(cancel.headers.get('location'), `${origin}/app-a/`);
  assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401);
  assert.equal((await request(authorize)).status, 400);

  const stats = await (await request(`${origin}/__stats`)).json();
  assert.equal(stats.centerCancels, 1);
  assert.equal(stats.centerLogins, 0);
  assert.equal(stats.appCallbacks, 0);
});

test('invalid OIDC callback cannot create a host session and missing center cookie requires login', async (t) => {
  const { origin } = await startFixture(t);

  const startA = await request(`${origin}/app-a/auth/oidc/start?returnTo=/app-a/`);
  const authorizeA = new URL(startA.headers.get('location'));
  const loginA = await request(new URL(`/idp/login?next=${encodeURIComponent(authorizeA.pathname + authorizeA.search)}`, authorizeA.origin), {
    method: 'POST',
  });
  const centerCookie = firstCookie(loginA);
  const ticketA = await request(new URL(loginA.headers.get('location'), authorizeA.origin), {
    headers: { Cookie: centerCookie },
  });
  const invalidCallback = new URL(ticketA.headers.get('location'));
  invalidCallback.searchParams.set('code', 'invalid');
  assert.equal((await request(invalidCallback)).status, 400);
  assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401);

  const startB = await request(`${origin}/app-b/auth/oidc/start?returnTo=/app-b/`);
  const authorizeB = new URL(startB.headers.get('location'));
  const centerPage = await request(authorizeB);
  assert.equal(centerPage.status, 200);
  assert.match(await centerPage.text(), /认证中心登录/);
  assert.equal((await request(`${origin}/app-b/auth/session`)).status, 401);
});
