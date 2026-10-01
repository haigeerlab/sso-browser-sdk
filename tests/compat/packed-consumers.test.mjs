import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createServer } from 'node:net';
import test from 'node:test';

const runFile = promisify(execFile);
const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const examples = join(repo, 'apps/compat');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function run(command, args, cwd) {
  try {
    return await runFile(command, args, { cwd, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`, { cause: error });
  }
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.close();
  await once(server, 'close');
  return port;
}

async function checkDevServer(cwd, config, base) {
  const port = await freePort();
  const child = spawn(join(cwd, 'node_modules/.bin/vite'), [
    '--config', config, '--host', '127.0.0.1', '--strictPort', '--port', String(port),
  ], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  try {
    let response;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Vite exited: ${output}`);
      try {
        response = await fetch(`http://127.0.0.1:${port}${base}`);
        if (response.ok) break;
      } catch { /* Wait for the server to listen. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(response?.status, 200, `Vite did not serve ${base}: ${output}`);
    const html = await response.text();
    assert.match(html, /main\.js/);
    const main = await fetch(`http://127.0.0.1:${port}${base}main.js`);
    assert.equal(main.status, 200, `Vite did not transform main.js: ${output}`);
    assert.match(await main.text(), /sso-browser-sdk-prototype/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
}

async function checkConsumer(parent, tarball, framework) {
  const cwd = join(parent, framework);
  const app = framework === 'vue' ? 'app-a' : 'app-b';
  const config = framework === 'vue' ? 'vite.config.js' : 'vite.react.config.js';
  await mkdir(cwd, { recursive: true });
  await cp(join(examples, framework), join(cwd, framework), { recursive: true });
  await cp(join(examples, config), join(cwd, config));
  await writeFile(join(cwd, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    scripts: { build: `vite build --config ${config}` },
    dependencies: {
      'sso-browser-sdk-prototype': `file:${tarball}`,
      ...(framework === 'vue'
        ? { vue: '3.4.0' }
        : { react: '19.3.0', 'react-dom': '19.3.0' }),
    },
    devDependencies: {
      vite: '5.0.0',
      typescript: '6.0.3',
      ...(framework === 'vue' ? { '@vitejs/plugin-vue': '5.0.1' } : {}),
    },
  }, null, 2));
  await run(npm, ['install', '--prefer-offline', '--ignore-scripts', '--no-audit', '--no-fund'], cwd);

  const installed = await realpath(join(cwd, 'node_modules/sso-browser-sdk-prototype'));
  assert.equal(installed.startsWith(await realpath(cwd)), true,
    `SDK escaped isolated consumer: ${installed}`);
  assert.notEqual(installed, join(repo, 'packages/browser-sdk'));
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dependencies ?? {}, {});
  for (const subpath of ['.', './oidc', './cas', './saml', './negotiate']) {
    assert.ok(manifest.exports[subpath]?.types);
    assert.ok(manifest.exports[subpath]?.import);
  }

  await writeFile(join(cwd, 'check.mjs'), `
import { createSSO } from 'sso-browser-sdk-prototype';
import { oidcAdapter } from 'sso-browser-sdk-prototype/oidc';
import { casAdapter } from 'sso-browser-sdk-prototype/cas';
import { samlAdapter } from 'sso-browser-sdk-prototype/saml';
import { negotiateAdapter } from 'sso-browser-sdk-prototype/negotiate';
if ([createSSO, oidcAdapter, casAdapter, samlAdapter, negotiateAdapter].some((value) => typeof value !== 'function')) {
  throw new Error('A published entry point is missing');
}
`);
  await run(process.execPath, ['check.mjs'], cwd);
  await writeFile(join(cwd, 'check.ts'), `
import { createSSO, type SSOConfig } from 'sso-browser-sdk-prototype';
import { oidcAdapter } from 'sso-browser-sdk-prototype/oidc';
import { casAdapter } from 'sso-browser-sdk-prototype/cas';
import { samlAdapter } from 'sso-browser-sdk-prototype/saml';
import { negotiateAdapter } from 'sso-browser-sdk-prototype/negotiate';
const adapters = [oidcAdapter, casAdapter, samlAdapter, negotiateAdapter];
const config: SSOConfig<{ id: string }> = {
  session: { endpoint: '/auth/session', map: () => ({ authenticated: true, user: { id: 'demo' } }) },
  adapter: adapters[0]({ loginEndpoint: '/auth/start', returnToParam: 'next' }),
};
const sso = createSSO(config);
void sso.getState();
`);
  await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
    lib: ['ES2022', 'DOM'], strict: true, noEmit: true,
  }, files: ['check.ts'] }, null, 2));
  await run(join(cwd, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], cwd);
  await checkDevServer(cwd, config, `/${app}/`);
  await run(npm, ['run', 'build'], cwd);
  const html = await readFile(join(cwd, 'build', framework, 'index.html'), 'utf8');
  assert.match(html, /assets\/index-/);
  if (process.env.SSO_PACKED_BUILD_DIR) {
    await cp(join(cwd, 'build', framework), join(process.env.SSO_PACKED_BUILD_DIR, framework),
      { recursive: true });
  }
}

test('packed SDK installs into isolated Vue and React Vite 5 consumers', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'sso-packed-consumers-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  await run(npm, ['run', 'build', '--workspace=sso-browser-sdk-prototype'], repo);
  const pack = await run(npm, ['pack', '--workspace=sso-browser-sdk-prototype', '--pack-destination', temp, '--json'], repo);
  const [info] = JSON.parse(pack.stdout);
  const tarball = join(temp, info.filename);
  assert.equal(info.files.some((file) => /(?:test|services|\.pem|\.key)/.test(file.path)), false);
  if (process.env.SSO_PACKED_BUILD_DIR) {
    await mkdir(process.env.SSO_PACKED_BUILD_DIR, { recursive: true });
  }
  await t.test('Vue 3.4.0', () => checkConsumer(temp, tarball, 'vue'));
  await t.test('React 19.3.0', () => checkConsumer(temp, tarball, 'react'));
});
