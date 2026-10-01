import test from 'node:test';
import assert from 'node:assert/strict';
import { samlAdapter } from 'sso-browser-sdk-prototype/saml';
import { startFixture, firstCookie, request } from './fixture.mjs';

function hidden(html, name) {
  const value = html.match(new RegExp(`<input type="hidden" name="${name}" value="([^"]+)"`))?.[1];
  assert.ok(value, `missing ${name} form field`);
  return value;
}

async function startSaml(origin, app) {
  const adapter = samlAdapter({ loginEndpoint: `/${app}/auth/saml/start` });
  const start = await request(origin + adapter.loginUrl({ returnTo: `/${app}/?protocol=saml` }));
  assert.equal(start.status, 302);
  const centerUrl = new URL(start.headers.get('location'));
  assert.equal(centerUrl.pathname, '/saml/sso');
  assert.ok(centerUrl.searchParams.get('SAMLRequest'));
  assert.ok(centerUrl.searchParams.get('RelayState'));
  return centerUrl;
}

async function loginAtCenter(centerUrl) {
  return request(new URL('/saml/login', centerUrl.origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      SAMLRequest: centerUrl.searchParams.get('SAMLRequest'),
      RelayState: centerUrl.searchParams.get('RelayState'),
      username: 'demo', password: 'demo',
    }),
  });
}

async function postAcs(page, override = {}) {
  const html = await page.text();
  const action = html.match(/<form method="post" action="([^"]+)"/)?.[1];
  assert.ok(action, 'missing ACS form');
  const fields = {
    SAMLResponse: hidden(html, 'SAMLResponse'),
    RelayState: hidden(html, 'RelayState'),
    ...override,
  };
  return { action, fields, response: await request(action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  }) };
}

test('SAML Redirect and POST bindings establish separate host sessions with one center login', async (t) => {
  const { origin } = await startFixture(t);
  const centerA = await startSaml(origin, 'app-a');
  const loginPage = await request(centerA);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /SAML 认证中心登录/);

  const issuedA = await loginAtCenter(centerA);
  const centerCookie = firstCookie(issuedA);
  assert.match(centerCookie, /^saml_center_\d+=[0-9a-f-]{36}$/);
  const completedA = await postAcs(issuedA);
  assert.equal(completedA.response.status, 302);
  assert.equal(completedA.response.headers.get('location'), `${origin}/app-a/?protocol=saml`);
  const cookieA = firstCookie(completedA.response);
  assert.equal((await request(`${origin}/app-a/auth/session`, { headers: { Cookie: cookieA } })).status, 200);
  const replay = await request(completedA.action, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(completedA.fields),
  });
  assert.equal(replay.status, 400);

  const centerB = await startSaml(origin, 'app-b');
  const issuedB = await request(centerB, { headers: { Cookie: centerCookie } });
  assert.equal(issuedB.status, 200);
  const completedB = await postAcs(issuedB);
  assert.equal(completedB.response.status, 302);
  const cookieB = firstCookie(completedB.response);
  assert.equal((await request(`${origin}/app-b/auth/session`, { headers: { Cookie: cookieB } })).status, 200);

  const stats = await (await request(`${origin}/__stats`)).json();
  assert.equal(stats.samlCenterLogins, 1);
  assert.equal(stats.samlResponsesIssued, 2);
});

test('SAML rejects invalid request, mismatched RelayState and expired response', async (t) => {
  const { origin } = await startFixture(t, { SSO_SAML_RESPONSE_TTL_MS: '0' });
  const invalid = await request(`${origin}/app-a/auth/saml/start?returnTo=${encodeURIComponent('/app-b/')}`);
  assert.equal(invalid.status, 400);

  const center = await startSaml(origin, 'app-a');
  const tampered = new URL(center);
  tampered.searchParams.set('SAMLRequest', 'invalid');
  assert.equal((await request(tampered)).status, 400);

  const issued = await loginAtCenter(center);
  const html = await issued.text();
  const action = html.match(/<form method="post" action="([^"]+)"/)?.[1];
  const response = hidden(html, 'SAMLResponse');
  const state = hidden(html, 'RelayState');
  const invalidState = await request(action, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ SAMLResponse: response, RelayState: 'invalid' }),
  });
  assert.equal(invalidState.status, 400);
  const expired = await request(action, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ SAMLResponse: response, RelayState: state }),
  });
  assert.equal(expired.status, 302);
  assert.equal(new URL(expired.headers.get('location')).searchParams.get('ssoError'), 'saml_validation_failed');
  assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401);
});

test('SAML center session expires and App B must authenticate again', async (t) => {
  const { origin } = await startFixture(t, { SSO_SAML_CENTER_TTL_MS: '0' });
  const first = await loginAtCenter(await startSaml(origin, 'app-a'));
  const centerCookie = firstCookie(first);
  assert.equal((await postAcs(first)).response.status, 302);

  const second = await request(await startSaml(origin, 'app-b'), { headers: { Cookie: centerCookie } });
  assert.match(await second.text(), /SAML 认证中心登录/);
  const stats = await (await request(`${origin}/__stats`)).json();
  assert.equal(stats.samlCenterLogins, 1);
  assert.equal(stats.samlResponsesIssued, 1);
});

test('SAML rejected credentials and cancel do not establish a host session', async (t) => {
  const { origin } = await startFixture(t);
  const center = await startSaml(origin, 'app-a');
  const rejected = await request(new URL('/saml/login', center.origin), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      SAMLRequest: center.searchParams.get('SAMLRequest'),
      RelayState: center.searchParams.get('RelayState'),
      username: 'demo', password: 'wrong',
    }),
  });
  assert.equal(rejected.status, 401);
  assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401);

  const cancel = new URL('/saml/cancel', center.origin);
  cancel.searchParams.set('RelayState', center.searchParams.get('RelayState'));
  const canceled = await request(cancel);
  assert.equal(canceled.status, 302);
  assert.equal(new URL(canceled.headers.get('location')).searchParams.get('ssoError'), 'saml_login_canceled');
  assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401);
  assert.equal((await request(center)).status, 400);
});

test('SAML invalid response returns an error to the business page and consumes the pending request', async (t) => {
  const { origin } = await startFixture(t);
  const issued = await loginAtCenter(await startSaml(origin, 'app-a'));
  const html = await issued.text();
  const action = html.match(/<form method="post" action="([^"]+)"/)?.[1];
  const state = hidden(html, 'RelayState');
  const rejected = await request(action, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ SAMLResponse: 'invalid', RelayState: state }),
  });
  assert.equal(rejected.status, 302);
  assert.equal(new URL(rejected.headers.get('location')).searchParams.get('ssoError'), 'saml_validation_failed');
  assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401);
  const replay = await request(action, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ SAMLResponse: hidden(html, 'SAMLResponse'), RelayState: state }),
  });
  assert.equal(replay.status, 400);
});
