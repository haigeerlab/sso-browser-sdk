import test from 'node:test';
import assert from 'node:assert/strict';
import { wsFedAdapter } from 'sso-browser-sdk-prototype/wsfed';
import { startFixture, firstCookie, request } from './fixture.mjs';

function hidden(html, name) {
  const value = html.match(new RegExp(`<input type="hidden" name="${name}" value="([^"]+)"`))?.[1];
  assert.ok(value, `missing ${name} form field`);
  return value;
}

async function start(origin, app, returnTo = `/${app}/?protocol=wsfed`) {
  const adapter = wsFedAdapter({ loginEndpoint: `/${app}/auth/wsfed/start` });
  const response = await request(origin + adapter.loginUrl({ returnTo }));
  assert.equal(response.status, 302);
  const center = new URL(response.headers.get('location'));
  assert.equal(center.pathname, '/wsfed/passive');
  assert.equal(center.searchParams.get('wa'), 'wsignin1.0');
  assert.equal(center.searchParams.get('wtrealm'), `urn:fixture:${app}`);
  assert.equal(center.searchParams.get('wreply'), `${origin}/${app}/auth/wsfed/callback`);
  assert.match(center.searchParams.get('wctx'), /^[0-9a-f-]{36}$/);
  return center;
}

async function login(center) {
  return request(new URL('/wsfed/login', center.origin), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      wa: center.searchParams.get('wa'), wtrealm: center.searchParams.get('wtrealm'),
      wreply: center.searchParams.get('wreply'), wctx: center.searchParams.get('wctx'),
      username: 'demo', password: 'demo',
    }),
  });
}

async function complete(page, override = {}) {
  const html = await page.text();
  const action = html.match(/<form method="post" action="([^"]+)"/)?.[1];
  assert.ok(action, 'missing WS-Fed callback form');
  const fields = {
    wa: hidden(html, 'wa'), wresult: hidden(html, 'wresult'),
    wctx: hidden(html, 'wctx'), ...override,
  };
  const response = await request(action, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
  return { action, fields, response };
}

test('WS-Fed Web Passive POST establishes separate app sessions with one center login', async (t) => {
  const { origin } = await startFixture(t);
  const centerA = await start(origin, 'app-a');
  const loginPage = await request(centerA);
  assert.match(await loginPage.text(), /WS-Fed 认证中心登录/);
  const issuedA = await login(centerA);
  const centerCookie = firstCookie(issuedA);
  assert.match(centerCookie, /^wsfed_center_\d+=[0-9a-f-]{36}$/);
  const completedA = await complete(issuedA);
  assert.equal(completedA.response.status, 302);
  assert.equal(completedA.response.headers.get('location'), `${origin}/app-a/?protocol=wsfed`);
  const cookieA = firstCookie(completedA.response);
  assert.equal((await request(`${origin}/app-a/auth/session`, { headers: { Cookie: cookieA } })).status, 200);
  assert.equal((await request(`${origin}/app-b/auth/session`, { headers: { Cookie: cookieA } })).status, 401);
  assert.equal((await request(completedA.action, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(completedA.fields),
  })).status, 400);

  const centerB = await start(origin, 'app-b');
  const issuedB = await request(centerB, { headers: { Cookie: centerCookie } });
  const completedB = await complete(issuedB);
  assert.equal(completedB.response.status, 302);
  const cookieB = firstCookie(completedB.response);
  assert.equal((await request(`${origin}/app-b/auth/session`, { headers: { Cookie: cookieB } })).status, 200);
  const logoutA = await request(`${origin}/app-a/auth/logout`, { method: 'POST', headers: { Cookie: cookieA } });
  assert.equal(logoutA.status, 204);
  assert.equal((await request(`${origin}/app-a/auth/session`, { headers: { Cookie: cookieA } })).status, 401);
  assert.equal((await request(`${origin}/app-b/auth/session`, { headers: { Cookie: cookieB } })).status, 200);
  const stats = await (await request(`${origin}/__stats`)).json();
  assert.equal(stats.wsFedCenterLogins, 1);
  assert.equal(stats.wsFedResponsesIssued, 2);
  assert.equal(stats.wsFedCallbacks, 3);
});

test('WS-Fed rejects cross-app returnTo and tampered realm, reply or action', async (t) => {
  const { origin } = await startFixture(t);
  assert.equal((await request(`${origin}/app-a/auth/wsfed/start?returnTo=${encodeURIComponent('/app-b/')}`)).status, 400);
  assert.equal((await request(`${origin}/app-a/auth/wsfed/start?returnTo=${encodeURIComponent('//evil.example/')}`)).status, 400);
  const center = await start(origin, 'app-a');
  for (const [field, value] of [['wtrealm', 'urn:fixture:evil'], ['wreply', `${origin}/app-b/auth/wsfed/callback`], ['wa', 'wsignout1.0']]) {
    const invalid = new URL(center);
    invalid.searchParams.set(field, value);
    assert.equal((await request(invalid)).status, 400);
  }
  assert.equal((await request(center)).status, 200);
});

test('WS-Fed bad response, expired response and replay do not establish sessions', async (t) => {
  const { origin } = await startFixture(t, { SSO_WSFED_RESPONSE_TTL_MS: '0' });
  const issued = await login(await start(origin, 'app-a'));
  const html = await issued.text();
  const action = html.match(/<form method="post" action="([^"]+)"/)?.[1];
  const wctx = hidden(html, 'wctx');
  const wresult = hidden(html, 'wresult');
  assert.equal((await request(action, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ wa: 'wsignin1.0', wresult, wctx: 'unknown' }),
  })).status, 400);
  const expired = await request(action, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ wa: 'wsignin1.0', wresult, wctx }),
  });
  assert.equal(expired.status, 302);
  assert.equal(new URL(expired.headers.get('location')).searchParams.get('ssoError'), 'wsfed_validation_failed');
  assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401);
  assert.equal((await request(action, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ wa: 'wsignin1.0', wresult, wctx }),
  })).status, 400);
});

test('WS-Fed invalid credentials and cancellation return visible failure without login', async (t) => {
  const { origin } = await startFixture(t);
  const center = await start(origin, 'app-a');
  const rejected = await request(new URL('/wsfed/login', center.origin), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      wa: 'wsignin1.0', wtrealm: center.searchParams.get('wtrealm'),
      wreply: center.searchParams.get('wreply'), wctx: center.searchParams.get('wctx'),
      username: 'demo', password: 'wrong',
    }),
  });
  assert.equal(rejected.status, 401);
  const canceled = await request(new URL(`/wsfed/cancel?wctx=${center.searchParams.get('wctx')}`, center.origin));
  assert.equal(canceled.status, 302);
  assert.equal(new URL(canceled.headers.get('location')).searchParams.get('ssoError'), 'wsfed_login_canceled');
  assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401);
  assert.equal((await request(center)).status, 400);
  assert.equal((await request(`${origin}/app-a/auth/wsfed/callback`, { method: 'POST' })).status, 400);
});

test('WS-Fed expired center session asks App B to authenticate again', async (t) => {
  const { origin } = await startFixture(t, { SSO_WSFED_CENTER_TTL_MS: '0' });
  const first = await login(await start(origin, 'app-a'));
  const centerCookie = firstCookie(first);
  assert.equal((await complete(first)).response.status, 302);
  const second = await request(await start(origin, 'app-b'), { headers: { Cookie: centerCookie } });
  assert.match(await second.text(), /WS-Fed 认证中心登录/);
  const stats = await (await request(`${origin}/__stats`)).json();
  assert.equal(stats.wsFedCenterLogins, 1);
  assert.equal(stats.wsFedResponsesIssued, 1);
});

test('WS-Fed bad action consumes pending request, and a retry clears stale error', async (t) => {
  const { origin } = await startFixture(t);
  const first = await login(await start(origin, 'app-a'));
  const html = await first.text();
  const action = html.match(/<form method="post" action="([^"]+)"/)?.[1];
  const fields = { wa: 'wsignout1.0', wresult: hidden(html, 'wresult'), wctx: hidden(html, 'wctx') };
  const rejected = await request(action, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
  assert.equal(new URL(rejected.headers.get('location')).searchParams.get('ssoError'), 'wsfed_validation_failed');
  assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401);
  assert.equal((await request(action, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  })).status, 400);

  const retry = await start(origin, 'app-a', '/app-a/?protocol=wsfed&ssoError=wsfed_validation_failed');
  const issued = await login(retry);
  const accepted = await complete(issued);
  assert.equal(accepted.response.headers.get('location'), `${origin}/app-a/?protocol=wsfed`);
});
