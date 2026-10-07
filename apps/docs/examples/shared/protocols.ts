import { oidcAdapter } from 'sso-browser-sdk-prototype/oidc';
import { casAdapter } from 'sso-browser-sdk-prototype/cas';
import { samlAdapter } from 'sso-browser-sdk-prototype/saml';
import { wsFedAdapter } from 'sso-browser-sdk-prototype/wsfed';
import { negotiateAdapter } from 'sso-browser-sdk-prototype/negotiate';

// #region oidc
export const oidc = oidcAdapter({ loginEndpoint: '/sso/oidc/start' });
// #endregion oidc
// #region cas
export const cas = casAdapter({ loginEndpoint: '/sso/cas/start' });
// #endregion cas
// #region saml
export const saml = samlAdapter({ loginEndpoint: '/sso/saml/start' });
// #endregion saml
// #region wsfed
export const wsfed = wsFedAdapter({ loginEndpoint: '/sso/wsfed/start' });
// #endregion wsfed
// #region negotiate
export const negotiate = negotiateAdapter({ loginEndpoint: '/sso/negotiate/start' });
// #endregion negotiate
