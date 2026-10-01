import test from 'node:test';
import assert from 'node:assert/strict';
import { createSSO } from 'sso-browser-sdk-prototype';
import { oidcAdapter } from 'sso-browser-sdk-prototype/oidc';
import { samlAdapter } from 'sso-browser-sdk-prototype/saml';
import { casAdapter } from 'sso-browser-sdk-prototype/cas';
import { wsFedAdapter } from 'sso-browser-sdk-prototype/wsfed';
import { negotiateAdapter } from 'sso-browser-sdk-prototype/negotiate';

test('the package exports its framework-free core and five backend-session entries', () => {
  assert.equal(typeof createSSO, 'function');
  for (const create of [oidcAdapter, samlAdapter, casAdapter, wsFedAdapter, negotiateAdapter]) {
    assert.equal(typeof create, 'function');
  }
});
