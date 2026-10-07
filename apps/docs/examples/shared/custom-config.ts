import { createSSO, type SessionPayload } from 'sso-browser-sdk-prototype';
import { oidcAdapter } from 'sso-browser-sdk-prototype/oidc';
import type { User } from './client';

export function mapLegacySession(payload: unknown): SessionPayload<User> {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid session');
  const value = payload as Record<string, unknown>;
  if (value.loggedIn === false) return { authenticated: false };
  const profile = value.profile;
  if (value.loggedIn === true && profile && typeof profile === 'object'
    && 'id' in profile && typeof profile.id === 'string') {
    return { authenticated: true, user: { id: profile.id } };
  }
  throw new Error('Invalid authenticated profile');
}

export function createCustomClient(csrfToken: string) {
  return createSSO<User>({
    session: { endpoint: '/auth/session', map: mapLegacySession },
    adapter: oidcAdapter({ loginEndpoint: '/auth/oidc/login', returnToParam: 'next' }),
    logout: { endpoint: '/auth/logout', headers: { 'X-CSRF-Token': csrfToken } },
  });
}
