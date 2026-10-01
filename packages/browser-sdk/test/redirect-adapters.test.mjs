import test from 'node:test';
import assert from 'node:assert/strict';
import { oidcAdapter } from '../dist/oidc.js';
import { samlAdapter } from '../dist/saml.js';
import { casAdapter } from '../dist/cas.js';
import { wsFedAdapter } from '../dist/wsfed.js';
import { negotiateAdapter } from '../dist/negotiate.js';

for (const [name, create] of [
  ['OIDC', oidcAdapter],
  ['SAML', samlAdapter],
  ['CAS', casAdapter],
  ['WS-Fed', wsFedAdapter],
  ['Negotiate', negotiateAdapter],
]) {
  test(`${name} backend-session adapter accepts a host-specific return parameter`, () => {
    const adapter = create({ loginEndpoint: '/auth/start?tenant=acme', returnToParam: 'next' });
    assert.equal(adapter.loginUrl({ returnTo: '/orders?id=1' }),
      '/auth/start?tenant=acme&next=%2Forders%3Fid%3D1');
    assert.throws(() => create({ loginEndpoint: '/\\attacker.example/start' }), /loginEndpoint/);
  });
}
