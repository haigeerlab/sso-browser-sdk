import test from 'node:test';
import assert from 'node:assert/strict';
import { createSSO } from '../dist/index.js';
import { oidcAdapter } from '../dist/oidc.js';

test('OIDC adapter uses the host login endpoint while preserving its query parameters', () => {
  const navigations = [];
  const client = createSSO({
    session: { endpoint: '/auth/session' },
    adapter: oidcAdapter({ loginEndpoint: '/auth/oidc/start?tenant=acme' }),
    navigate: (url) => navigations.push(url),
    currentUrl: () => 'https://app.example.test/reports',
  });

  client.login({ returnTo: '/reports?year=2026' });

  assert.equal(navigations[0], '/auth/oidc/start?tenant=acme&returnTo=%2Freports%3Fyear%3D2026');
});

test('OIDC adapter rejects an external host login endpoint', () => {
  assert.throws(() => oidcAdapter({ loginEndpoint: 'https://attacker.example/start' }), /loginEndpoint/);
  assert.throws(() => oidcAdapter({ loginEndpoint: '//attacker.example/start' }), /loginEndpoint/);
});
