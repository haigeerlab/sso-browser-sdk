import assert from 'node:assert/strict';
import test from 'node:test';
import { createSSO } from 'sso-browser-sdk-prototype';
import { oidcAdapter } from 'sso-browser-sdk-prototype/oidc';
import { startFixture, firstCookie, request } from '../integration/fixture.mjs';

test('custom return parameter and session mapping work with host backend variants', async (t) => {
  const { origin } = await startFixture(t);
  const adapter = oidcAdapter({
    loginEndpoint: '/app-a/auth/oidc/start?compat=next',
    returnToParam: 'next',
  });
  const returnTo = '/app-a/?returnParam=next';
  const startUrl = adapter.loginUrl({ returnTo });
  assert.equal(new URL(startUrl, origin).searchParams.get('next'), returnTo);
  assert.equal((await request(`${origin}/app-a/auth/oidc/start?compat=next`)).status, 400);

  const startA = await request(origin + startUrl);
  assert.equal(startA.status, 302);
  const authorizeA = new URL(startA.headers.get('location'));
  const login = await request(new URL(
    `/idp/login?next=${encodeURIComponent(authorizeA.pathname + authorizeA.search)}`,
    authorizeA.origin,
  ), { method: 'POST' });
  const centerCookie = firstCookie(login);
  const authorizedA = await request(new URL(login.headers.get('location'), authorizeA.origin), {
    headers: { Cookie: centerCookie },
  });
  const completedA = await request(authorizedA.headers.get('location'));
  assert.equal(new URL(completedA.headers.get('location')).search, '?returnParam=next');

  const startB = await request(`${origin}/app-b/auth/oidc/start?returnTo=${encodeURIComponent('/app-b/?legacySession=1')}`);
  const authorizedB = await request(startB.headers.get('location'), {
    headers: { Cookie: centerCookie },
  });
  const completedB = await request(authorizedB.headers.get('location'));
  const cookieB = firstCookie(completedB);
  const legacyResponse = await request(`${origin}/app-b/auth/legacy-session`, {
    headers: { Cookie: cookieB },
  });
  assert.deepEqual(await legacyResponse.json(), { loggedIn: true, profile: { id: 'demo' } });

  const sso = createSSO({
    session: {
      endpoint: `${origin}/app-b/auth/legacy-session`,
      map: (payload) => ({ authenticated: true, user: payload.profile }),
    },
    adapter: oidcAdapter({ loginEndpoint: '/app-b/auth/oidc/start' }),
    fetch: (url, options) => fetch(url, {
      ...options, headers: { ...options.headers, Cookie: cookieB },
    }),
  });
  assert.deepEqual(await sso.getSession(), { status: 'authenticated', user: { id: 'demo' } });
  assert.equal((await request(`${origin}/app-b/auth/legacy-session`)).status, 401);
});
