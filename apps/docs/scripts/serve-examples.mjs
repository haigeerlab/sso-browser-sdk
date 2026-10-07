import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import { repo, prepareConsumer, buildExamples } from './consumer.mjs';

const protocol = process.env.SSO_DOCS_PROTOCOL ?? 'oidc';
const appA = process.env.SSO_DOCS_APP_A ?? 'vue';
const services = { oidc: 'services/oidc-reference/server.mjs', cas: 'services/cas-reference/reference.mjs',
  saml: 'services/saml-reference/server.mjs', wsfed: 'services/wsfed-reference/server.mjs' };
if (!services[protocol]) throw new Error('SSO_DOCS_PROTOCOL must be oidc, cas, saml or wsfed');
if (!['vue', 'typescript'].includes(appA)) throw new Error('SSO_DOCS_APP_A must be vue or typescript');
const cwd = await prepareConsumer();
let child;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  const build = await buildExamples(cwd, { protocol, appA, demo: true });
  if (!stopping) {
    child = spawn(process.execPath, [services[protocol]], { cwd: repo, stdio: 'inherit',
      env: { ...process.env, SSO_COMPAT_BUILD_ROOT: build } });
    console.log(`Documentation sources: ${appA} App A + React App B; protocol=${protocol}`);
    const [code] = await once(child, 'exit');
    if (!stopping && code) process.exitCode = code;
  }
} finally {
  await stop();
  await rm(cwd, { recursive: true, force: true });
}
