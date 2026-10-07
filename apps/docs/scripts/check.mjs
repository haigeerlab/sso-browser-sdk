import assert from 'node:assert/strict';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repo, run, prepareConsumer, buildExamples } from './consumer.mjs';

const content = join(repo, 'apps/docs/content');
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
}
const markdown = (await files(content)).filter((file) => file.endsWith('.md'));
const pages = new Map(await Promise.all(markdown.map(async (file) => [file, await readFile(file, 'utf8')])));
for (const [file, source] of pages) {
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = match[1];
    if (/^(https?:|mailto:)/.test(link)) continue;
    const [path, anchor] = link.split('#');
    const target = path ? resolve(path.startsWith('/') ? content : dirname(file), path.replace(/^\//, '')) + (path.endsWith('.md') ? '' : '.md') : file;
    assert.ok(pages.has(target), `Broken documentation link: ${file} → ${link}`);
    if (anchor) {
      const headings = [...pages.get(target).matchAll(/^#{1,6}\s+(.+)$/gm)].map((heading) => heading[1].toLowerCase()
        .replace(/[`*]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-'));
      assert.ok(headings.includes(decodeURIComponent(anchor)), `Missing anchor: ${file} → ${link}`);
    }
  }
}
console.log(`Documentation links and anchors: ${pages.size} pages passed`);
const cwd = await prepareConsumer();
try {
  await run(join(cwd, 'node_modules/.bin/tsc'), ['--noEmit'], cwd);
  await run(join(cwd, 'node_modules/.bin/vue-tsc'), ['--noEmit'], cwd);
  await run(join(cwd, 'node_modules/.bin/tsc'), ['--noEmit', 'false', '--outDir', 'compiled'], cwd);
  const protocols = await import(pathToFileURL(join(cwd, 'compiled/shared/protocols.js')));
  for (const name of ['oidc', 'cas', 'saml', 'wsfed', 'negotiate']) {
    assert.equal(protocols[name].loginUrl({ returnTo: '/orders?tab=open' }), `/sso/${name}/start?returnTo=%2Forders%3Ftab%3Dopen`);
  }
  const { mapLegacySession } = await import(pathToFileURL(join(cwd, 'compiled/shared/custom-config.js')));
  assert.deepEqual(mapLegacySession({ loggedIn: false }), { authenticated: false });
  assert.deepEqual(mapLegacySession({ loggedIn: true, profile: { id: 'u1' } }), { authenticated: true, user: { id: 'u1' } });
  assert.throws(() => mapLegacySession({ loggedIn: true }), /Invalid/);
  await buildExamples(cwd);
  await buildExamples(cwd, { appA: 'typescript' });
  for (const protocol of ['oidc', 'cas', 'saml', 'wsfed']) {
    await buildExamples(cwd, { protocol, demo: true });
  }
  console.log('Tarball isolation, TS/Vue/React types and builds, five adapters and session mapping: passed');
} finally { await rm(cwd, { recursive: true, force: true }); }
