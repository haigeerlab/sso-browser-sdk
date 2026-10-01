export type Session<User = unknown> =
  | { status: 'authenticated'; user: User }
  | { status: 'unauthenticated' };

export type AuthState<User = unknown> =
  | { status: 'unknown' }
  | { status: 'checking' }
  | Session<User>
  | { status: 'error'; error: unknown };

export type SessionPayload<User> =
  | { authenticated: true; user: User }
  | { authenticated: false };

export interface ProtocolAdapter {
  loginUrl(input: { returnTo: string }): string;
}

export interface SSOConfig<User> {
  session: {
    endpoint: string;
    credentials?: RequestCredentials;
    map?: (payload: unknown) => SessionPayload<User>;
  };
  adapter: ProtocolAdapter;
  logout?: {
    endpoint: string;
    headers?: HeadersInit | (() => HeadersInit);
  };
  fetch?: typeof globalThis.fetch;
  navigate?: (url: string) => void;
  currentUrl?: () => string;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

function defaultMap<User>(payload: unknown): SessionPayload<User> {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid session response');
  const value = payload as Record<string, unknown>;
  if (value.authenticated === false) return { authenticated: false };
  if (value.authenticated === true && 'user' in value) {
    return { authenticated: true, user: value.user as User };
  }
  throw new Error('Invalid session response');
}

export function createSSO<User = unknown>(config: SSOConfig<User>) {
  let state: AuthState<User> = { status: 'unknown' };
  let sessionRevision = 0;
  let ensureInFlight: Promise<Session<User>> | undefined;
  const listeners = new Set<(state: AuthState<User>) => void>();
  const fetcher = config.fetch ?? globalThis.fetch;
  const currentUrl = config.currentUrl ?? (() => globalThis.location.href);
  const navigate = config.navigate ?? ((url: string) => globalThis.location.assign(url));
  const attemptKey = `sso:auto-login:${config.session.endpoint}`;

  function getStorage() {
    if (config.storage) return config.storage;
    try {
      return globalThis.sessionStorage;
    } catch {
      return undefined;
    }
  }

  function setState(next: AuthState<User>): void {
    state = next;
    for (const listener of listeners) listener(state);
  }

  function safeReturnTo(input?: string): string {
    const base = new URL(currentUrl());
    const target = new URL(input ?? base.href, base);
    if (target.origin !== base.origin) throw new Error('Invalid returnTo: cross-origin URL');
    return target.pathname + target.search + target.hash;
  }

  async function getSession(): Promise<Session<User>> {
    const revision = ++sessionRevision;
    function commit(session: Session<User>): Session<User> {
      if (revision !== sessionRevision) throw new Error('Session check superseded');
      setState(session);
      return session;
    }
    setState({ status: 'checking' });
    try {
      const response = await fetcher(config.session.endpoint, {
        credentials: config.session.credentials ?? 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (response.status === 401) {
        return commit({ status: 'unauthenticated' });
      }
      if (!response.ok) throw new Error(`Session request failed: ${response.status}`);
      const payload: unknown = await response.json();
      const mapped = (config.session.map ?? defaultMap<User>)(payload);
      if (mapped.authenticated === false) {
        return commit({ status: 'unauthenticated' });
      }
      if (mapped.authenticated !== true || !('user' in mapped)) {
        throw new Error('Invalid session response');
      }
      return commit({ status: 'authenticated', user: mapped.user });
    } catch (error) {
      if (revision === sessionRevision) setState({ status: 'error', error });
      throw error;
    }
  }

  function login(input: { returnTo?: string } = {}): void {
    const returnTo = safeReturnTo(input.returnTo);
    const url = config.adapter.loginUrl({ returnTo });
    const storage = getStorage();
    storage?.setItem(attemptKey, '1');
    try {
      navigate(url);
    } catch (error) {
      storage?.removeItem(attemptKey);
      throw error;
    }
  }

  async function performEnsureAuthenticated(input: { returnTo?: string }): Promise<Session<User>> {
    const session = await getSession();
    const storage = getStorage();
    if (session.status === 'authenticated') {
      storage?.removeItem(attemptKey);
      return session;
    }

    try {
      if (!storage) throw new Error('Automatic login requires sessionStorage');
      if (storage.getItem(attemptKey)) throw new Error('Automatic login loop detected');
      const returnTo = safeReturnTo(input.returnTo);
      const url = config.adapter.loginUrl({ returnTo });
      storage.setItem(attemptKey, '1');
      try {
        navigate(url);
      } catch (error) {
        storage.removeItem(attemptKey);
        throw error;
      }
      return session;
    } catch (error) {
      setState({ status: 'error', error });
      throw error;
    }
  }

  function ensureAuthenticated(input: { returnTo?: string } = {}): Promise<Session<User>> {
    if (ensureInFlight) return ensureInFlight;
    const operation = performEnsureAuthenticated(input);
    ensureInFlight = operation;
    const clear = () => {
      if (ensureInFlight === operation) ensureInFlight = undefined;
    };
    void operation.then(clear, clear);
    return operation;
  }

  async function logout(): Promise<void> {
    if (!config.logout) throw new Error('Logout endpoint is not configured');
    const response = await fetcher(config.logout.endpoint, {
      method: 'POST',
      credentials: config.session.credentials ?? 'same-origin',
      headers: typeof config.logout.headers === 'function'
        ? config.logout.headers()
        : config.logout.headers,
    });
    if (response.redirected) throw new Error('Logout endpoint must not redirect');
    if (!response.ok) throw new Error(`Logout request failed: ${response.status}`);
    sessionRevision += 1;
    setState({ status: 'unauthenticated' });
  }

  function onAuthChange(listener: (state: AuthState<User>) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { getState: () => state, getSession, ensureAuthenticated, login, logout, onAuthChange };
}
