import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost } from './host.mjs';

const serviceDir = dirname(fileURLToPath(import.meta.url));
const python = join(serviceDir, '.venv/bin/python');

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export async function startReference({ ticketValidity = 60 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sso-cas-reference-'));
  const port = await freePort();
  const centerOrigin = `http://localhost:${port}`;
  const host = await startHost(centerOrigin);
  const env = {
    ...process.env,
    SSO_CAS_DB: join(dir, 'cas.sqlite3'),
    SSO_CAS_HOST_PORT: String(new URL(host.origin).port),
    SSO_CAS_TICKET_VALIDITY: String(ticketValidity),
  };
  let child;
  async function close() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
  try {
    for (const args of [['manage.py', 'migrate', '--noinput'], ['seed.py']]) {
      const result = spawnSync(python, args, { cwd: serviceDir, env, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
    }
    child = spawn(python, ['manage.py', 'runserver', `localhost:${port}`, '--noreload'], {
      cwd: serviceDir, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(`CAS provider exited: ${output}`);
      try {
        const response = await fetch(`${centerOrigin}/cas/login`);
        if (response.status === 200) return { origin: host.origin, centerOrigin, close };
      } catch { /* Wait for the local provider to bind. */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`CAS provider startup timed out: ${output}`);
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startReference().then((reference) => {
    process.stdout.write(`CAS reference: ${reference.origin}/app-a/?protocol=cas and ${reference.origin}/app-b/?protocol=cas\n`);
    process.once('SIGINT', () => { void reference.close().then(() => process.exit(0)); });
    process.once('SIGTERM', () => { void reference.close().then(() => process.exit(0)); });
  }).catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });
}
