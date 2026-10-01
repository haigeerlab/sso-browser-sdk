import test from 'node:test';
import assert from 'node:assert/strict';
import { oidcAdapter } from 'sso-browser-sdk-prototype/oidc';
import { startReference } from '../../services/oidc-reference/server.mjs';

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
      const name = cookie.split('=')[0];
      if (!cookies.has(target.hostname)) cookies.set(target.hostname, new Map());
      if (/Max-Age=0/i.test(item)) cookies.get(target.hostname).delete(name);
      else cookies.get(target.hostname).set(name, cookie);
    }
    return response;
  }
  return { request };
}

async function completeLogin(request, startUrl, stopBeforeCallback = false) {
  let current = startUrl;
  const prompts = [];
  for (let i = 0; i < 25; i++) {
    if (stopBeforeCallback && new URL(current).pathname.endsWith('/auth/oidc/callback')) {
      return { url: current, prompts };
    }
    const response = await request(current);
    if (response.status >= 300 && response.status < 400) {
      current = new URL(response.headers.get('location'), current).href;
      continue;
    }
    assert.equal(response.status, 200, `unexpected response at ${new URL(current).pathname}`);
    const html = await response.text();
    const prompt = html.match(/name="prompt" value="(login|consent)"/)?.[1];
    if (!prompt) return { url: current, prompts };
    prompts.push(prompt);
    const action = html.match(/<form[^>]+action="([^"]+)"/)?.[1];
    assert.ok(action, 'provider interaction must include a form action');
    const fields = prompt === 'login'
      ? { prompt, login: 'demo', password: 'demo' }
      : { prompt };
    const submitted = await request(new URL(action, current), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
    });
    assert.ok(submitted.status >= 300 && submitted.status < 400);
    current = new URL(submitted.headers.get('location'), current).href;
  }
  throw new Error('OIDC redirect loop in reference flow');
}

async function reachLoginInteraction(request, startUrl) {
  let current = startUrl;
  for (let i = 0; i < 10; i++) {
    const response = await request(current);
    if (response.status >= 300 && response.status < 400) {
      current = new URL(response.headers.get('location'), current).href;
      continue;
    }
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /name="prompt" value="login"/);
    return { url: current, html };
  }
  throw new Error('OIDC login interaction was not reached');
}

test('real OIDC provider completes code + PKCE and shares its login across two hosts', async (t) => {
  const reference = await startReference();
  t.after(() => reference.close());
  const { request } = browser();

  const discovery = await request(`${reference.centerOrigin}/.well-known/openid-configuration`);
  assert.equal(discovery.status, 200);
  const metadata = await discovery.json();
  assert.equal(metadata.issuer, reference.centerOrigin);
  assert.ok(metadata.code_challenge_methods_supported.includes('S256'));

  const appA = oidcAdapter({ loginEndpoint: '/app-a/auth/oidc/start' });
  const first = await completeLogin(request, reference.origin + appA.loginUrl({ returnTo: '/app-a/' }));
  assert.equal(new URL(first.url).pathname, '/app-a/');
  assert.deepEqual(first.prompts, ['login']);
  const sessionA = await request(`${reference.origin}/app-a/auth/session`);
  assert.deepEqual(await sessionA.json(), { authenticated: true, user: { id: 'demo' } });

  const appB = oidcAdapter({ loginEndpoint: '/app-b/auth/oidc/start' });
  const second = await completeLogin(request, reference.origin + appB.loginUrl({ returnTo: '/app-b/' }));
  assert.equal(new URL(second.url).pathname, '/app-b/');
  assert.deepEqual(second.prompts, []);
  const sessionB = await request(`${reference.origin}/app-b/auth/session`);
  assert.deepEqual(await sessionB.json(), { authenticated: true, user: { id: 'demo' } });

  const third = await completeLogin(request, reference.origin + appA.loginUrl({ returnTo: '/app-a/' }), true);
  const callback = new URL(third.url);
  assert.ok(callback.searchParams.get('code'));
  const invalidState = new URL(callback);
  invalidState.searchParams.set('state', 'invalid');
  assert.equal((await request(invalidState)).status, 400);
  assert.equal((await request(callback)).status, 302);
  assert.equal((await request(callback)).status, 400);

  assert.equal((await request(`${reference.origin}/app-b/auth/logout`, { method: 'POST' })).status, 204);
  assert.equal((await request(`${reference.origin}/app-b/auth/session`)).status, 401);
  assert.equal((await request(`${reference.origin}/app-a/auth/session`)).status, 200);
  const restored = await completeLogin(request, reference.origin + appB.loginUrl({ returnTo: '/app-b/' }));
  assert.deepEqual(restored.prompts, []);
  assert.equal((await request(`${reference.origin}/app-b/auth/session`)).status, 200);

  const stats = await (await request(`${reference.origin}/__stats`)).json();
  assert.equal(stats.starts, 4);
  assert.equal(stats.tokenExchanges, 4);
});

test('an expired center session requires a new login on another host', async (t) => {
  const reference = await startReference({ sessionTTLSeconds: 2 });
  t.after(() => reference.close());
  const { request } = browser();
  const appA = oidcAdapter({ loginEndpoint: '/app-a/auth/oidc/start' });
  const appB = oidcAdapter({ loginEndpoint: '/app-b/auth/oidc/start' });

  const first = await completeLogin(request, reference.origin + appA.loginUrl({ returnTo: '/app-a/' }));
  assert.deepEqual(first.prompts, ['login']);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const second = await completeLogin(request, reference.origin + appB.loginUrl({ returnTo: '/app-b/' }));
  assert.deepEqual(second.prompts, ['login']);
  assert.equal((await request(`${reference.origin}/app-b/auth/session`)).status, 200);
});

test('canceling at the provider returns to the host without creating a session', async (t) => {
  const reference = await startReference();
  t.after(() => reference.close());
  const { request } = browser();
  const appA = oidcAdapter({ loginEndpoint: '/app-a/auth/oidc/start' });
  const interaction = await reachLoginInteraction(request,
    reference.origin + appA.loginUrl({ returnTo: '/app-a/' }));
  const abortPath = interaction.html.match(/href="([^"]+\/abort)"/)?.[1];
  assert.ok(abortPath);
  const aborted = await request(new URL(abortPath, interaction.url));
  assert.ok(aborted.status >= 300 && aborted.status < 400);
  const continuation = new URL(aborted.headers.get('location'), interaction.url);
  const callback = new URL((await completeLogin(request, continuation.href, true)).url);
  assert.equal(callback.searchParams.get('error'), 'access_denied');

  const result = await request(callback);
  assert.equal(result.status, 302);
  assert.equal(new URL(result.headers.get('location')).pathname, '/app-a/');
  assert.equal((await request(`${reference.origin}/app-a/auth/session`)).status, 401);
});
