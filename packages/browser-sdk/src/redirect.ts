import type { ProtocolAdapter } from './index.js';

export interface BackendRedirectConfig {
  loginEndpoint: string;
  returnToParam?: string;
}

export function backendRedirectAdapter(config: BackendRedirectConfig): ProtocolAdapter {
  const { loginEndpoint, returnToParam = 'returnTo' } = config;
  if (!loginEndpoint.startsWith('/') || loginEndpoint.startsWith('//') || loginEndpoint.includes('#')) {
    throw new Error('loginEndpoint must be a same-origin path without a fragment');
  }
  const base = new URL('https://local.invalid');
  const endpoint = new URL(loginEndpoint, base);
  if (endpoint.origin !== base.origin) {
    throw new Error('loginEndpoint must be a same-origin path');
  }
  if (!returnToParam || /[?&#=]/.test(returnToParam)) {
    throw new Error('returnToParam must be a non-empty query parameter name');
  }

  return {
    loginUrl({ returnTo }) {
      const url = new URL(endpoint);
      url.searchParams.set(returnToParam, returnTo);
      return url.pathname + url.search;
    },
  };
}
