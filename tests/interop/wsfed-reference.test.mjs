import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../../services/wsfed-reference/server.mjs', import.meta.url));

function launch(t, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, SSO_WSFED_REFERENCE_PORT: '0', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`WS-Fed reference startup timed out: ${output}`)); }, 15000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/WS-Fed reference: (http:\/\/127\.0\.0\.1:\d+)\/app-a\//);
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
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`WS-Fed reference exited (${code}): ${output}`)); });
  });
}

function request(url, options = {}) { return fetch(url, { redirect: 'manual', ...options }); }
function firstCookie(response) { return response.headers.get('set-cookie')?.split(';')[0]; }
function hidden(html, name) {
  const value = html.match(new RegExp(`<input type="hidden"\\s+name="${name}"\\s+value="([^"]+)"`))?.[1];
  assert.ok(value, `missing ${name}`);
  return value.replaceAll('&quot;', '"').replaceAll('&#34;', '"').replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

async function start(origin, app, returnTo = `/${app}/?protocol=wsfed`) {
  const target = new URL(`/${app}/auth/wsfed/start`, origin);
  target.searchParams.set('returnTo', returnTo);
  const response = await request(target);
  assert.equal(response.status, 302);
  const center = new URL(response.headers.get('location'));
  assert.equal(center.pathname, '/wsfed/passive');
  assert.equal(center.searchParams.get('wa'), 'wsignin1.0');
  assert.equal(center.searchParams.get('wtrealm'), `urn:reference:${app}`);
  assert.equal(center.searchParams.get('wreply'), `${origin}/${app}/auth/wsfed/callback`);
  assert.ok(center.searchParams.get('wctx'));
  return center;
}

async function issue(center, centerCookie) {
  const landing = await request(center, centerCookie ? { headers: { Cookie: centerCookie } } : {});
  assert.equal(landing.status, 200, await landing.clone().text());
  const html = await landing.text();
  if (!html.includes('WS-Fed 认证中心登录')) return { page: html, centerCookie, prompted: false };
  const login = await request(new URL('/wsfed/login', center.origin), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ wctx: hidden(html, 'wctx'), username: 'demo', password: 'demo' }),
  });
  assert.equal(login.status, 302, await login.clone().text());
  const cookie = firstCookie(login);
  const tokenPage = await request(login.headers.get('location'), { headers: { Cookie: cookie } });
  assert.equal(tokenPage.status, 200, await tokenPage.clone().text());
  return { page: await tokenPage.text(), centerCookie: cookie, prompted: true };
}

async function postToken(page, override = {}) {
  const action = page.match(/<form method="post" name="hiddenform" action="([^"]+)"/)?.[1];
  assert.ok(action, 'missing WS-Fed token form');
  const fields = { wa: hidden(page, 'wa'), wresult: hidden(page, 'wresult'),
    wctx: hidden(page, 'wctx'), ...override };
  const response = await request(action, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
  return { action, fields, response };
}

test('independent WS-Fed STS and RP validator establish A/B sessions with signed SAML 1.1', async (t) => {
  const origin = await launch(t);
  const first = await issue(await start(origin, 'app-a'));
  assert.equal(first.prompted, true);
  assert.match(hidden(first.page, 'wresult'), /RequestSecurityTokenResponse/);
  assert.match(hidden(first.page, 'wresult'), /<saml:Assertion[^>]*MajorVersion="1" MinorVersion="1"/);
  const postedA = await postToken(first.page);
  assert.equal(postedA.response.status, 302, await postedA.response.clone().text());
  const cookieA = firstCookie(postedA.response);
  assert.equal((await request(`${origin}/app-a/auth/session`, { headers: { Cookie: cookieA } })).status, 200);
  assert.equal((await request(`${origin}/app-b/auth/session`, { headers: { Cookie: cookieA } })).status, 401);

  const second = await issue(await start(origin, 'app-b'), first.centerCookie);
  assert.equal(second.prompted, false);
  const postedB = await postToken(second.page);
  assert.equal(postedB.response.status, 302);
  const cookieB = firstCookie(postedB.response);
  assert.equal((await request(`${origin}/app-b/auth/session`, { headers: { Cookie: cookieB } })).status, 200);
  const stats = await (await request(`${origin}/__stats`)).json();
  assert.equal(stats.centerLogins, 1);
  assert.equal(stats.responsesIssued, 2);
  assert.equal(stats.rejected, 0, stats.rejectionReasons.join('; '));
});

test('independent RP rejects modified signature and wrong signed audience', async (t) => {
  const origin = await launch(t);
  const first = await issue(await start(origin, 'app-a'));
  const original = hidden(first.page, 'wresult');
  const modified = original.replace('demo@example.test', 'evil@example.test');
  assert.notEqual(modified, original);
  const tampered = await postToken(first.page, { wresult: modified });
  assert.equal(new URL(tampered.response.headers.get('location')).searchParams.get('ssoError'), 'wsfed_validation_failed');
  const wrongAudience = await start(origin, 'app-a');
  wrongAudience.searchParams.set('scenario', 'audience');
  const issued = await issue(wrongAudience, first.centerCookie);
  const rejected = await postToken(issued.page);
  assert.equal(new URL(rejected.response.headers.get('location')).searchParams.get('ssoError'), 'wsfed_validation_failed');
  assert.equal((await request(`${origin}/app-a/auth/session`)).status, 401);
  const stats = await (await request(`${origin}/__stats`)).json();
  assert.equal(stats.rejected, 2);
  assert.match(stats.rejectionReasons[0], /signature/i);
  assert.match(stats.rejectionReasons[1], /audience/i);
});

test('independent RP rejects wrong signed issuer and altered reply address', async (t) => {
  const origin = await launch(t);
  const center = await start(origin, 'app-a');
  const alteredReply = new URL(center);
  alteredReply.searchParams.set('wreply', `${origin}/app-b/auth/wsfed/callback`);
  assert.equal((await request(alteredReply)).status, 400);
  center.searchParams.set('scenario', 'issuer');
  const issued = await issue(center);
  const posted = await postToken(issued.page);
  assert.equal(new URL(posted.response.headers.get('location')).searchParams.get('ssoError'), 'wsfed_validation_failed');
  const stats = await (await request(`${origin}/__stats`)).json();
  assert.match(stats.rejectionReasons[0], /wrong_issuer/);
});

test('independent RP rejects expired token, replay, invalid realm and unsafe returnTo', async (t) => {
  const origin = await launch(t);
  assert.equal((await request(`${origin}/app-a/auth/wsfed/start?returnTo=${encodeURIComponent('//evil.example/')}`)).status, 400);
  const invalid = await start(origin, 'app-a');
  invalid.searchParams.set('wtrealm', 'urn:reference:wrong');
  assert.equal((await request(invalid)).status, 400);
  const expired = await start(origin, 'app-a');
  expired.searchParams.set('scenario', 'expired');
  const issuedExpired = await issue(expired);
  const rejected = await postToken(issuedExpired.page);
  assert.equal(new URL(rejected.response.headers.get('location')).searchParams.get('ssoError'), 'wsfed_validation_failed');
  const healthy = await issue(await start(origin, 'app-a'), issuedExpired.centerCookie);
  const accepted = await postToken(healthy.page);
  assert.equal(accepted.response.status, 302);
  const replay = await request(accepted.action, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(accepted.fields),
  });
  assert.equal(replay.status, 400);
  const stats = await (await request(`${origin}/__stats`)).json();
  assert.match(stats.rejectionReasons[0], /expired|time|valid/i);
});

test('a signed assertion cannot be reused with a fresh wctx', async (t) => {
  const origin = await launch(t);
  const first = await issue(await start(origin, 'app-a'));
  const accepted = await postToken(first.page);
  assert.equal(accepted.response.status, 302);
  const second = await issue(await start(origin, 'app-a'), first.centerCookie);
  const replay = await postToken(second.page, { wresult: accepted.fields.wresult });
  assert.equal(new URL(replay.response.headers.get('location')).searchParams.get('ssoError'), 'wsfed_validation_failed');
  const stats = await (await request(`${origin}/__stats`)).json();
  assert.match(stats.rejectionReasons[0], /replayed_assertion/);
});

test('local logout preserves the other app and center session restores login', async (t) => {
  const origin = await launch(t);
  const first = await issue(await start(origin, 'app-a'));
  const postedA = await postToken(first.page);
  const cookieA = firstCookie(postedA.response);
  const second = await issue(await start(origin, 'app-b'), first.centerCookie);
  const postedB = await postToken(second.page);
  const cookieB = firstCookie(postedB.response);
  assert.equal((await request(`${origin}/app-b/auth/logout`, { method: 'POST', headers: { Cookie: cookieB } })).status, 204);
  assert.equal((await request(`${origin}/app-b/auth/session`, { headers: { Cookie: cookieB } })).status, 401);
  assert.equal((await request(`${origin}/app-a/auth/session`, { headers: { Cookie: cookieA } })).status, 200);
  const restored = await issue(await start(origin, 'app-b'), first.centerCookie);
  assert.equal(restored.prompted, false);
  assert.equal((await postToken(restored.page)).response.status, 302);
});

test('expired center session prompts again, cancel remains recoverable', async (t) => {
  const origin = await launch(t, { SSO_WSFED_REFERENCE_CENTER_TTL_MS: '300' });
  const first = await issue(await start(origin, 'app-a'));
  assert.equal((await postToken(first.page)).response.status, 302);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const center = await start(origin, 'app-b');
  const landing = await request(center, { headers: { Cookie: first.centerCookie } });
  assert.match(await landing.text(), /WS-Fed 认证中心登录/);
  const cancel = await request(new URL(`/wsfed/cancel?wctx=${center.searchParams.get('wctx')}`, center.origin));
  assert.equal(new URL(cancel.headers.get('location')).searchParams.get('ssoError'), 'wsfed_login_canceled');
  const retry = await issue(await start(origin, 'app-b', '/app-b/?protocol=wsfed&ssoError=wsfed_login_canceled'));
  const posted = await postToken(retry.page);
  assert.equal(posted.response.headers.get('location'), `${origin}/app-b/?protocol=wsfed`);
});
