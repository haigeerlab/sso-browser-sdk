import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNegotiateHost } from '../../scripts/negotiate-domain-preflight.mjs';
import { startNegotiateFixture } from '../../services/negotiate-fixture/server.mjs';

test('Negotiate preflight verifies only anonymous HTTP contract on both fixture hosts', async (t) => {
  const { origin } = await startNegotiateFixture(t);
  for (const app of ['app-a', 'app-b']) {
    const result = await checkNegotiateHost({
      origin,
      sessionEndpoint: `/${app}/auth/session`,
      loginEndpoint: `/${app}/auth/negotiate/start`,
      returnTo: `/${app}/`,
    }, { allowHttpLoopback: true });
    assert.equal(result.passed, true);
    assert.equal(result.kerberosVerified, false);
    assert.deepEqual(result.statuses, { session: 401, start: 401, unsafeReturn: 400 });
    assert.equal(Object.values(result.checks).every(Boolean), true);
  }
});

test('Negotiate preflight rejects non-HTTPS remote origins before sending requests', async () => {
  await assert.rejects(checkNegotiateHost({
    origin: 'http://intranet.example.test',
  }, { fetcher: () => { throw new Error('unexpected request'); } }), /HTTPS/);
});

test('Negotiate preflight does not accept a redirect as proof of unsafe return rejection', async () => {
  const result = await checkNegotiateHost({ origin: 'https://app.example.test' }, {
    fetcher: async (url) => {
      if (url.pathname === '/sso/session') return new Response(null, { status: 401 });
      if (url.searchParams.get('returnTo') === '//invalid.example/') {
        return new Response(null, {
          status: 302,
          headers: { Location: '/error?next=https://invalid.example/' },
        });
      }
      return new Response(null, {
        status: 401,
        headers: { 'WWW-Authenticate': 'Negotiate' },
      });
    },
  });
  assert.equal(result.passed, false);
  assert.equal(result.checks.unsafeReturnRejected, false);
  assert.equal(result.kerberosVerified, false);
});

test('Negotiate preflight accepts the standard anonymous JSON session', async () => {
  const result = await checkNegotiateHost({ origin: 'https://app.example.test' }, {
    fetcher: async (url) => {
      if (url.pathname === '/sso/session') {
        return Response.json({ authenticated: false });
      }
      if (url.searchParams.get('returnTo') === '//invalid.example/') {
        return new Response(null, { status: 400 });
      }
      return new Response(null, {
        status: 401,
        headers: { 'WWW-Authenticate': 'Negotiate' },
      });
    },
  });
  assert.equal(result.passed, true);
  assert.equal(result.checks.anonymousSession, true);
  assert.equal(result.kerberosVerified, false);
});
