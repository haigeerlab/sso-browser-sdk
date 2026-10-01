import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('../../services/protocol-fixture/server.mjs', import.meta.url));

export function startFixture(t, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixturePath], {
      env: { ...process.env, SSO_FIXTURE_PORT: '0', ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Fixture startup timed out: ${output}`));
    }, 10000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/Fixture: (http:\/\/127\.0\.0\.1:\d+)\/app-a\//);
      if (match) {
        clearTimeout(timeout);
        t.after(async () => {
          if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill();
            await exited;
          }
        });
        resolve({ child, origin: match[1] });
      }
    });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Fixture exited before startup (${code}): ${output}`));
    });
  });
}

export function firstCookie(response) {
  return response.headers.get('set-cookie')?.split(';')[0];
}

export function request(url, options = {}) {
  return fetch(url, { redirect: 'manual', ...options });
}
