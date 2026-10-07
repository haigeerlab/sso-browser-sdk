import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, readFile, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

export const repo = fileURLToPath(new URL('../../../', import.meta.url));
const exec = promisify(execFile);
export async function run(command, args, cwd = repo) {
  try { return await exec(command, args, { cwd, maxBuffer: 8 * 1024 * 1024 }); }
  catch (error) { throw new Error(`${command} ${args.join(' ')}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`, { cause: error }); }
}

export async function prepareConsumer() {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'sso-documentation-')));
  try {
    const packed = await run('npm', ['pack', '--workspace=sso-browser-sdk-prototype', '--pack-destination', cwd, '--json']);
    const tarball = join(cwd, JSON.parse(packed.stdout)[0].filename);
    await cp(join(repo, 'apps/docs/examples'), join(cwd, 'examples'), { recursive: true });
    await writeFile(join(cwd, 'package.json'), JSON.stringify({
      private: true, type: 'module',
      dependencies: { 'sso-browser-sdk-prototype': `file:${tarball}`, vue: '3.4.0', react: '19.3.0', 'react-dom': '19.3.0' },
      devDependencies: { vite: '5.0.0', '@vitejs/plugin-vue': '5.0.1', typescript: '6.0.3',
        'vue-tsc': '3.3.11', '@types/react': '19.3.0', '@types/react-dom': '19.3.0' },
    }, null, 2));
    await run('npm', ['install', '--prefer-offline', '--ignore-scripts', '--no-audit', '--no-fund'], cwd);
    const installed = await realpath(join(cwd, 'node_modules/sso-browser-sdk-prototype'));
    assert.ok(installed.startsWith(await realpath(cwd)), 'SDK must be installed from tarball, not workspace symlink');
    const config = { compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
      strict: true, jsx: 'react-jsx', lib: ['ES2022', 'DOM'], skipLibCheck: true, noEmit: true, rootDir: 'examples',
      types: ['react', 'react-dom'], ignoreDeprecations: '6.0' }, include: ['examples/**/*.ts', 'examples/**/*.tsx', 'examples/**/*.vue'] };
    await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify(config));
    return cwd;
  } catch (error) { await rm(cwd, { recursive: true, force: true }); throw error; }
}

export async function buildExamples(cwd, { protocol = 'oidc', appA = 'vue', demo = false } = {}) {
  const require = createRequire(join(cwd, 'package.json'));
  const { build } = await import(pathToFileURL(join(dirname(require.resolve('vite/package.json')), 'dist/node/index.js')));
  const { default: vue } = await import(pathToFileURL(join(dirname(require.resolve('@vitejs/plugin-vue')), 'index.mjs')));
  const factories = { oidc: 'oidcAdapter', cas: 'casAdapter', saml: 'samlAdapter', wsfed: 'wsFedAdapter' };
  if (!factories[protocol]) throw new Error('SSO_DOCS_PROTOCOL must be oidc, cas, saml or wsfed');
  if (!['vue', 'typescript'].includes(appA)) throw new Error('SSO_DOCS_APP_A must be vue or typescript');
  for (const [framework, app] of [[appA, 'app-a'], ['react', 'app-b']]) {
    const clientFile = join(cwd, 'examples/shared/client.ts');
    const client = await readFile(clientFile, 'utf8');
    await build({
      configFile: false, root: join(cwd, 'examples', framework), base: `/${app}/`,
      logLevel: 'warn',
      plugins: [vue(), ...(demo ? [{ name: 'documented-reference-endpoints',
        load(id) {
          if (id !== clientFile) return;
          return client.replaceAll('oidcAdapter', factories[protocol])
            .replace("sso-browser-sdk-prototype/oidc", `sso-browser-sdk-prototype/${protocol}`)
            .replaceAll('/sso/session', `/${app}/auth/session`)
            .replaceAll('/sso/logout', `/${app}/auth/logout`)
            .replaceAll('/sso/oidc/start', `/${app}/auth/${protocol}/start`);
        },
      }] : [])],
      esbuild: { jsx: 'automatic' },
      build: { outDir: join(cwd, 'build', app === 'app-a' ? 'vue' : 'react'), emptyOutDir: true },
    });
  }
  return join(cwd, 'build');
}
