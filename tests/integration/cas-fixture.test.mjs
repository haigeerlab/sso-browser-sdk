import test from 'node:test';
import assert from 'node:assert/strict';
import { casAdapter } from 'sso-browser-sdk-prototype/cas';
import { startFixture, firstCookie, request } from './fixture.mjs';

async function startCas(origin, app) {
  const adapter = casAdapter({ loginEndpoint: `/${app}/auth/cas/start` });
  const start = await request(origin + adapter.loginUrl({ returnTo: `/${app}/` }));
  assert.equal(start.status, 302);
  const centerUrl = new URL(start.headers.get('location'));
  assert.equal(centerUrl.pathname, '/cas/login');
  const service = centerUrl.searchParams.get('service');
  assert.match(service, new RegExp(`/${app}/auth/cas/callback\\?state=`));
  return { centerUrl, service };
}

async function loginAtCenter(centerUrl, service) {
  return request(centerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ service, username: 'demo', password: 'demo' }),
  });
}

test('CAS ticket is validated by each host backend and one center session serves both hosts', async (t) => {
  const { origin } = await startFixture(t);
  const appA = await startCas(origin, 'app-a');
  const loginPage = await request(appA.centerUrl);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /CAS 认证中心登录/);

  const login = await loginAtCenter(appA.centerUrl, appA.service);
  assert.equal(login.status, 302);
  const centerCookie = firstCookie(login);
  assert.match(centerCookie, /^cas_center_\d+=.+$/);
  const callbackA = login.headers.get('location');
  assert.match(new URL(callbackA).searchParams.get('ticket'), /^ST-/);
  const completedA = await request(callbackA);
  assert.equal(completedA.status, 302);
  const cookieA = firstCookie(completedA);
  assert.equal((await request(`${origin}/app-a/auth/session`, { headers: { Cookie: cookieA } })).status, 200);
  assert.equal((await request(callbackA)).status, 400);

  const appB = await startCas(origin, 'app-b');
  const issuedB = await request(appB.centerUrl, { headers: { Cookie: centerCookie } });
  assert.equal(issuedB.status, 302);
  const completedB = await request(issuedB.headers.get('location'));
  const cookieB = firstCookie(completedB);
  assert.equal((await request(`${origin}/app-b/auth/session`, { headers: { Cookie: cookieB } })).status, 200);

  const stats = await (await request(`${origin}/__stats`)).json();
  assert.equal(stats.casCenterLogins, 1);
  assert.equal(stats.casTicketsIssued, 2);
  assert.equal(stats.casValidationAttempts, 2);
});

test('CAS rejects wrong service and consumes the ticket even when validation fails', async (t) => {
  const { origin } = await startFixture(t);
  const appA = await startCas(origin, 'app-a');
  const issued = await loginAtCenter(appA.centerUrl, appA.service);
  const callback = new URL(issued.headers.get('location'));
  const ticket = callback.searchParams.get('ticket');
  const validate = new URL('/cas/serviceValidate', appA.centerUrl.origin);
  validate.searchParams.set('ticket', ticket);
  validate.searchParams.set('service', `${origin}/app-b/auth/cas/callback`);
  assert.match(await (await request(validate)).text(), /INVALID_SERVICE/);
  validate.searchParams.set('service', appA.service);
  assert.match(await (await request(validate)).text(), /INVALID_TICKET/);
  const rejected = await request(callback);
  assert.equal(rejected.status, 302);
  assert.equal(new URL(rejected.headers.get('location')).searchParams.get('ssoError'), 'cas_validation_failed');
  assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401);
});

test('CAS rejects an expired ticket and an external return target', async (t) => {
  const { origin } = await startFixture(t, { SSO_CAS_TICKET_TTL_MS: '0' });
  const invalid = await request(`${origin}/app-a/auth/cas/start?returnTo=${encodeURIComponent('/app-b/')}`);
  assert.equal(invalid.status, 400);

  const appA = await startCas(origin, 'app-a');
  const issued = await loginAtCenter(appA.centerUrl, appA.service);
  const rejected = await request(issued.headers.get('location'));
  assert.equal(rejected.status, 302);
  assert.equal(new URL(rejected.headers.get('location')).searchParams.get('ssoError'), 'cas_validation_failed');
  assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401);
});

test('an expired CAS center session requires login again for another host', async (t) => {
  const { origin } = await startFixture(t, { SSO_CAS_CENTER_TTL_MS: '0' });
  const appA = await startCas(origin, 'app-a');
  const login = await loginAtCenter(appA.centerUrl, appA.service);
  assert.equal((await request(login.headers.get('location'))).status, 302);

  const appB = await startCas(origin, 'app-b');
  const center = await request(appB.centerUrl, { headers: { Cookie: firstCookie(login) } });
  assert.equal(center.status, 200);
  assert.match(await center.text(), /CAS 认证中心登录/);
  assert.equal((await request(`${origin}/app-b/auth/session`)).status, 401);
});

test('CAS rejects bad credentials and a callback without a ticket', async (t) => {
  const { origin } = await startFixture(t);
  const appA = await startCas(origin, 'app-a');
  const badLogin = await request(appA.centerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ service: appA.service, username: 'demo', password: 'wrong' }),
  });
  assert.equal(badLogin.status, 401);
  assert.equal(firstCookie(badLogin), undefined);
  const missingTicket = await request(appA.service);
  assert.equal(missingTicket.status, 302);
  assert.equal(new URL(missingTicket.headers.get('location')).searchParams.get('ssoError'), 'cas_validation_failed');
  assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401);
});

test('canceling CAS login returns to the host without creating a session', async (t) => {
  const { origin } = await startFixture(t);
  const appA = await startCas(origin, 'app-a');
  const cancel = new URL('/cas/cancel', appA.centerUrl.origin);
  cancel.searchParams.set('service', appA.service);

  const response = await request(cancel);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), `${origin}/app-a/`);
  assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401);
  assert.equal((await request(appA.service)).status, 400);
});
