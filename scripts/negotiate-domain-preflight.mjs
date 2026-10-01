import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { negotiateAdapter } from 'sso-browser-sdk-prototype/negotiate';

function hostOrigin(value, allowHttpLoopback) {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('origin must contain only scheme and host');
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowHttpLoopback && loopback && url.protocol === 'http:')) {
    throw new Error('origin must use HTTPS');
  }
  return url.origin;
}

function sameOriginPath(origin, path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
    throw new Error('endpoint must be a same-origin path');
  }
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new Error('endpoint must be a same-origin path');
  return url;
}

export async function checkNegotiateHost(config, {
  fetcher = fetch, allowHttpLoopback = false,
} = {}) {
  const origin = hostOrigin(config.origin, allowHttpLoopback);
  const session = sameOriginPath(origin, config.sessionEndpoint ?? '/sso/session');
  const returnTo = config.returnTo ?? '/';
  if (typeof returnTo !== 'string' || !returnTo.startsWith('/')
    || returnTo.startsWith('//') || new URL(returnTo, origin).origin !== origin) {
    throw new Error('returnTo must be a same-origin path');
  }
  const adapter = negotiateAdapter({
    loginEndpoint: config.loginEndpoint ?? '/sso/negotiate/start',
    returnToParam: config.returnToParam,
  });
  const start = new URL(adapter.loginUrl({ returnTo }), origin);
  const unsafe = new URL(adapter.loginUrl({ returnTo: '//invalid.example/' }), origin);
  const options = { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10000) };
  const [sessionResponse, startResponse, unsafeResponse] = await Promise.all([
    fetcher(session, options), fetcher(start, options), fetcher(unsafe, options),
  ]);

  let anonymousSession = sessionResponse.status === 401;
  if (sessionResponse.status === 200) {
    try {
      anonymousSession = (await sessionResponse.json())?.authenticated === false;
    } catch {
      anonymousSession = false;
    }
  }
  const rejectedStatus = unsafeResponse.status >= 400 && unsafeResponse.status < 500
    && !unsafeResponse.headers.has('www-authenticate');
  const checks = {
    anonymousSession,
    sessionHasNoChallenge: !sessionResponse.headers.has('www-authenticate'),
    dedicatedChallenge: startResponse.status === 401
      && /(?:^|,)\s*Negotiate(?:\s|,|$)/i.test(startResponse.headers.get('www-authenticate') ?? ''),
    challengeHasNoSessionCookie: !startResponse.headers.has('set-cookie'),
    unsafeReturnRejected: rejectedStatus && !unsafeResponse.headers.has('set-cookie'),
  };
  return {
    origin,
    scope: 'anonymous-http-contract',
    kerberosVerified: false,
    statuses: {
      session: sessionResponse.status,
      start: startResponse.status,
      unsafeReturn: unsafeResponse.status,
    },
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node scripts/negotiate-domain-preflight.mjs <config.json>');
  const config = JSON.parse(await readFile(file, 'utf8'));
  const a = hostOrigin(config.appA?.origin, false);
  const b = hostOrigin(config.appB?.origin, false);
  if (a === b) throw new Error('App A and App B must use distinct HTTPS origins');
  const results = await Promise.all([
    checkNegotiateHost(config.appA),
    checkNegotiateHost(config.appB),
  ]);
  process.stdout.write(`${JSON.stringify({ passed: results.every((item) => item.passed),
    kerberosVerified: false, hosts: results }, null, 2)}\n`);
  if (results.some((item) => !item.passed)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Negotiate preflight failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
