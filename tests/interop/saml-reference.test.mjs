import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const serverPath = fileURLToPath(new URL('../../services/saml-reference/server.mjs', import.meta.url));

function launch(t, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, SSO_SAML_REFERENCE_PORT: '0', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`SAML reference startup timed out: ${output}`)); }, 15000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/SAML Reference: (http:\/\/127\.0\.0\.1:\d+)\/app-a\//);
      if (match) {
        clearTimeout(timer);
        t.after(async () => {
          if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill();
            await exited;
          }
        });
        resolve(match[1]);
      }
    });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`SAML reference exited (${code}): ${output}`)); });
  });
}

function request(url, options = {}) { return fetch(url, { redirect: 'manual', ...options }); }
function firstCookie(response) { return response.headers.get('set-cookie')?.split(';')[0]; }
function hidden(html, name) {
  const value = html.match(new RegExp(`<input type="hidden" name="${name}" value="([^"]+)"`))?.[1];
  assert.ok(value, `missing ${name}`);
  return value;
}

async function start(origin, app) {
  const response = await request(`${origin}/${app}/auth/saml/start?returnTo=${encodeURIComponent(`/${app}/?protocol=saml`)}`);
  assert.equal(response.status, 302);
  const center = new URL(response.headers.get('location'));
  assert.equal(center.pathname, '/saml/sso');
  const xml = inflateRawSync(Buffer.from(center.searchParams.get('SAMLRequest'), 'base64')).toString();
  assert.match(xml, /<samlp:AuthnRequest/);
  assert.match(xml, new RegExp(`AssertionConsumerServiceURL="${origin}/${app}/auth/saml/acs"`));
  return center;
}

async function issue(center, centerCookie) {
  const landing = await request(center, centerCookie ? { headers: { Cookie: centerCookie } } : {});
  const html = await landing.text();
  assert.equal(landing.status, 200, html);
  if (html.includes('SAML 认证中心登录')) {
    const login = await request(new URL('/saml/login', center.origin), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ state: hidden(html, 'state'), username: 'demo', password: 'demo' }),
    });
    assert.equal(login.status, 200);
    return { page: await login.text(), centerCookie: firstCookie(login), prompted: true };
  }
  return { page: html, centerCookie, prompted: false };
}

async function acs(page, override = {}) {
  const action = page.match(/<form method="post" action="([^"]+)"/)?.[1];
  assert.ok(action);
  const fields = { SAMLResponse: hidden(page, 'SAMLResponse'), RelayState: hidden(page, 'RelayState'), ...override };
  return { action, fields, response: await request(action, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  }) };
}

test('independent samlify IdP and node-saml SP establish separate A/B sessions', async (t) => {
  const origin = await launch(t);
  const metadata = await request(`http://localhost:${new URL(origin).port}/saml/metadata`);
  assert.match(await metadata.text(), /IDPSSODescriptor/);
  const first = await issue(await start(origin, 'app-a'));
  assert.equal(first.prompted, true);
  const postedA = await acs(first.page);
  assert.equal(postedA.response.status, 302);
  const cookieA = firstCookie(postedA.response);
  assert.equal((await request(`${origin}/app-a/auth/session`, { headers: { Cookie: cookieA } })).status, 200);

  const second = await issue(await start(origin, 'app-b'), first.centerCookie);
  assert.equal(second.prompted, false);
  const postedB = await acs(second.page);
  assert.equal(postedB.response.status, 302);
  const cookieB = firstCookie(postedB.response);
  assert.equal((await request(`${origin}/app-b/auth/session`, { headers: { Cookie: cookieB } })).status, 200);
  const stats = await (await request(`${origin}/__stats`)).json();
  assert.equal(stats.centerLogins, 1);
  assert.equal(stats.responsesIssued, 2);
});

test('independent SP rejects a tampered signature, wrong audience, recipient and request correlation', async (t) => {
  const origin = await launch(t);
  for (const scenario of ['signature', 'audience', 'recipient', 'correlation']) {
    const center = await start(origin, 'app-a');
    if (scenario !== 'signature') center.searchParams.set('scenario', scenario);
    const issued = await issue(center);
    const original = hidden(issued.page, 'SAMLResponse');
    const changed = Buffer.from(Buffer.from(original, 'base64').toString().replace(
      'demo@example.test', 'attacker@example.test')).toString('base64');
    if (scenario === 'signature') assert.notEqual(changed, original);
    const posted = await acs(issued.page, scenario === 'signature' ? { SAMLResponse: changed } : {});
    assert.equal(posted.response.status, 302, scenario);
    assert.equal(new URL(posted.response.headers.get('location')).searchParams.get('ssoError'),
      'saml_validation_failed', scenario);
    assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401, scenario);
  }
  const stats = await (await request(`${origin}/__stats`)).json();
  assert.equal(stats.rejected, 4);
  assert.match(stats.rejectionReasons[0], /signature/i);
  assert.match(stats.rejectionReasons[1], /audience/i);
  assert.match(stats.rejectionReasons[2], /wrong_destination|wrong_recipient/i);
  assert.match(stats.rejectionReasons[3], /InResponseTo|subjectInResponseTo/i);
});

test('expired assertion and replay cannot create a new host session', async (t) => {
  const origin = await launch(t, { SSO_SAML_REFERENCE_MAX_ASSERTION_AGE_MS: '1' });
  const issued = await issue(await start(origin, 'app-a'));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const posted = await acs(issued.page);
  assert.equal(posted.response.status, 302);
  assert.equal(new URL(posted.response.headers.get('location')).searchParams.get('ssoError'),
    'saml_validation_failed');
  assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401);
  const expiredStats = await (await request(`${origin}/__stats`)).json();
  assert.match(expiredStats.rejectionReasons[0], /expired|time|valid/i);

  const healthyOrigin = await launch(t);
  const healthy = await issue(await start(healthyOrigin, 'app-a'));
  const first = await acs(healthy.page);
  assert.equal(first.response.status, 302);
  const second = await request(first.action, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(first.fields),
  });
  assert.equal(second.status, 400);
  assert.equal((await request(`${healthyOrigin}/app-a/auth/session`)).status, 401);
});

test('local logout removes only App B session and IdP session restores it', async (t) => {
  const origin = await launch(t);
  const first = await issue(await start(origin, 'app-a'));
  const postedA = await acs(first.page);
  const cookieA = firstCookie(postedA.response);
  const second = await issue(await start(origin, 'app-b'), first.centerCookie);
  const postedB = await acs(second.page);
  const cookieB = firstCookie(postedB.response);
  const logout = await request(`${origin}/app-b/auth/logout`, { method: 'POST', headers: { Cookie: cookieB } });
  assert.equal(logout.status, 204);
  assert.equal((await request(`${origin}/app-b/auth/session`, { headers: { Cookie: cookieB } })).status, 401);
  assert.equal((await request(`${origin}/app-a/auth/session`, { headers: { Cookie: cookieA } })).status, 200);
  const restored = await issue(await start(origin, 'app-b'), first.centerCookie);
  assert.equal(restored.prompted, false);
  assert.equal((await acs(restored.page)).response.status, 302);
});

test('SP rejects unsafe returnTo and removes a stale SSO error on manual retry', async (t) => {
  const origin = await launch(t);
  const unsafe = await request(`${origin}/app-a/auth/saml/start?returnTo=${encodeURIComponent('//attacker.example/')}`);
  assert.equal(unsafe.status, 400);
  const startResponse = await request(`${origin}/app-a/auth/saml/start?returnTo=${encodeURIComponent('/app-a/?protocol=saml&ssoError=saml_login_canceled')}`);
  assert.equal(startResponse.status, 302);
  const issued = await issue(new URL(startResponse.headers.get('location')));
  const posted = await acs(issued.page);
  assert.equal(posted.response.status, 302);
  assert.equal(posted.response.headers.get('location'), `${origin}/app-a/?protocol=saml`);
});
