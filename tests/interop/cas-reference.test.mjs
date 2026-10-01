import test from 'node:test';
import assert from 'node:assert/strict';
import { casAdapter } from 'sso-browser-sdk-prototype/cas';
import { startReference } from '../../services/cas-reference/reference.mjs';

function browser() {
  const cookies = new Map();
  async function request(url, options = {}) {
    const target = new URL(url);
    const jar = cookies.get(target.hostname);
    const headers = new Headers(options.headers);
    if (jar?.size) headers.set('Cookie', [...jar.values()].join('; '));
    const response = await fetch(target, { redirect: 'manual', ...options, headers });
    for (const item of response.headers.getSetCookie()) {
      const cookie = item.split(';')[0];
      const name = cookie.split('=')[0].trim();
      if (!cookies.has(target.hostname)) cookies.set(target.hostname, new Map());
      if (/Max-Age=0/i.test(item)) cookies.get(target.hostname).delete(name);
      else cookies.get(target.hostname).set(name, cookie);
    }
    return response;
  }
  return { request };
}

function fieldsFrom(html) {
  const fields = new URLSearchParams();
  for (const match of html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g)) {
    fields.set(match[1], match[2].replaceAll('&amp;', '&'));
  }
  return fields;
}

async function submitLogin(request, url, html, password = 'demo') {
  const fields = fieldsFrom(html);
  fields.set('username', 'demo');
  fields.set('password', password);
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: fields,
  });
}

async function followLogin(request, startUrl, { stopBeforeCallback = false } = {}) {
  let current = startUrl;
  const prompts = [];
  for (let i = 0; i < 20; i++) {
    if (stopBeforeCallback && new URL(current).pathname.endsWith('/auth/cas/callback')) {
      return { url: current, prompts };
    }
    const response = await request(current);
    if (response.status >= 300 && response.status < 400) {
      current = new URL(response.headers.get('location'), current).href;
      continue;
    }
    assert.equal(response.status, 200, `unexpected CAS response at ${current}`);
    const html = await response.text();
    if (!html.includes('id="login_form"')) return { url: current, prompts };
    prompts.push('login');
    const submitted = await submitLogin(request, current, html);
    assert.ok(submitted.status >= 300 && submitted.status < 400);
    current = new URL(submitted.headers.get('location'), current).href;
  }
  throw new Error('CAS redirect loop in reference flow');
}

function startUrl(origin, app) {
  const adapter = casAdapter({ loginEndpoint: `/${app}/auth/cas/start` });
  return origin + adapter.loginUrl({ returnTo: `/${app}/?protocol=cas` });
}

test('independent CAS provider shares one center login across two hosts and preserves local logout', async (t) => {
  const reference = await startReference();
  t.after(() => reference.close());
  const { request } = browser();

  const first = await followLogin(request, startUrl(reference.origin, 'app-a'));
  assert.equal(new URL(first.url).pathname, '/app-a/');
  assert.deepEqual(first.prompts, ['login']);
  const sessionA = await request(`${reference.origin}/app-a/auth/session`);
  assert.deepEqual(await sessionA.json(), { authenticated: true, user: { id: 'demo' } });

  const second = await followLogin(request, startUrl(reference.origin, 'app-b'));
  assert.equal(new URL(second.url).pathname, '/app-b/');
  assert.deepEqual(second.prompts, []);
  assert.equal((await request(`${reference.origin}/app-b/auth/session`)).status, 200);

  assert.equal((await request(`${reference.origin}/app-b/auth/logout`, { method: 'POST' })).status, 204);
  assert.equal((await request(`${reference.origin}/app-b/auth/session`)).status, 401);
  assert.equal((await request(`${reference.origin}/app-a/auth/session`)).status, 200);
  const restored = await followLogin(request, startUrl(reference.origin, 'app-b'));
  assert.deepEqual(restored.prompts, []);
  assert.equal((await request(`${reference.origin}/app-b/auth/session`)).status, 200);
});

test('independent CAS provider rejects a ticket for the wrong service and consumes it', async (t) => {
  const reference = await startReference();
  t.after(() => reference.close());
  const { request } = browser();
  const issued = await followLogin(request, startUrl(reference.origin, 'app-a'), { stopBeforeCallback: true });
  const callback = new URL(issued.url);
  const ticket = callback.searchParams.get('ticket');
  assert.match(ticket, /^ST-/);

  const wrong = new URL('/cas/serviceValidate', reference.centerOrigin);
  wrong.searchParams.set('service', `${reference.origin}/app-b/auth/cas/callback?state=${callback.searchParams.get('state')}`);
  wrong.searchParams.set('ticket', ticket);
  assert.match(await (await request(wrong)).text(), /authenticationFailure/);
  const rejected = await request(callback);
  assert.equal(rejected.status, 302);
  assert.equal(new URL(rejected.headers.get('location')).searchParams.get('ssoError'), 'cas_validation_failed');
  assert.equal((await request(`${reference.origin}/app-a/auth/session`)).status, 401);
});

test('independent CAS provider and host reject replay of a successful callback', async (t) => {
  const reference = await startReference();
  t.after(() => reference.close());
  const { request } = browser();
  const issued = await followLogin(request, startUrl(reference.origin, 'app-a'), { stopBeforeCallback: true });
  const callback = new URL(issued.url);
  assert.match(callback.searchParams.get('ticket'), /^ST-/);
  assert.equal((await request(callback)).status, 302);
  assert.equal((await request(callback)).status, 400);
  assert.equal((await request(`${reference.origin}/app-a/auth/session`)).status, 200);
});

test('independent CAS provider rejects an expired ticket', async (t) => {
  const reference = await startReference({ ticketValidity: 0 });
  t.after(() => reference.close());
  const { request } = browser();
  const issued = await followLogin(request, startUrl(reference.origin, 'app-a'), { stopBeforeCallback: true });
  assert.match(new URL(issued.url).searchParams.get('ticket'), /^ST-/);
  const rejected = await request(issued.url);
  assert.equal(rejected.status, 302);
  assert.equal(new URL(rejected.headers.get('location')).searchParams.get('ssoError'), 'cas_validation_failed');
  assert.equal((await request(`${reference.origin}/app-a/auth/session`)).status, 401);
});

test('independent CAS provider keeps bad credentials on its login page without a host session', async (t) => {
  const reference = await startReference();
  t.after(() => reference.close());
  const { request } = browser();
  const start = await request(startUrl(reference.origin, 'app-a'));
  assert.equal(start.status, 302);
  const loginUrl = start.headers.get('location');
  const page = await request(loginUrl);
  assert.equal(page.status, 200);
  const submitted = await submitLogin(request, loginUrl, await page.text(), 'wrong');
  assert.equal(submitted.status, 200);
  assert.match(await submitted.text(), /login_form/);
  assert.equal((await request(`${reference.origin}/app-a/auth/session`)).status, 401);
});
