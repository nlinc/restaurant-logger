/** Portable source-bound Hosting preparation. No dependencies or deployment side effects. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const marker = 'release.json';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 32 * 1024 * 1024 });
const safe = name => typeof name === 'string' && /^[A-Za-z0-9_/-]+(?:\.[A-Za-z0-9_-]+)*$/.test(name)
    && name.split('/').every(part => part && !part.startsWith('.') && !['node_modules','functions','docs','tests','test'].includes(part));
const fullSha = sha => assert.match(sha ?? '', /^[a-f0-9]{40}$/, 'Supply the full intended Git revision');

export function sourceSnapshot(root, sha) {
    fullSha(sha); root = resolve(root);
    assert.equal(git(root, 'rev-parse', 'HEAD').toString().trim(), sha, 'Intended revision must equal source HEAD');
    const policy = JSON.parse(git(root, 'show', `${sha}:.release-policy.json`).toString());
    assert.equal(policy.schema, 1); assert.match(policy.app, /^[a-z0-9-]+$/);
    assert.ok(Array.isArray(policy.assets) && policy.assets.length && policy.assets.length < 1000);
    const seen = new Set(); const assets = Object.create(null);
    for (const item of policy.assets) {
        const runtimeExtension = /\.(?:html|js|mjs|css|json|webmanifest|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|otf|mp4|webm)$/i;
        assert.ok(safe(item.source) && safe(item.path) && runtimeExtension.test(item.source) && runtimeExtension.test(item.path) && item.path !== marker && !seen.has(item.path), 'Unsafe or duplicate asset policy');
        seen.add(item.path);
        const entry = git(root, 'ls-tree', sha, '--', item.source).toString();
        assert.match(entry, /^100(?:644|755) blob [a-f0-9]{40}\t/, 'Source must be a committed regular file');
        let bytes = git(root, 'show', `${sha}:${item.source}`);
        assert.ok(policy.stampFiles === undefined || Array.isArray(policy.stampFiles));
        if ((policy.stampFiles || []).includes(item.path)) {
            assert.ok(bytes.toString().includes('__BUILD_COMMIT__'), `Missing existing stamp in ${item.path}`);
            bytes = Buffer.from(bytes.toString().replaceAll('__BUILD_COMMIT__', sha.slice(0, 7)));
        }
        assets[item.path] = bytes;
    }
    assert.ok(assets['index.html'], 'Hosting entry is required');
    for (const file of policy.stampFiles || []) assert.ok(seen.has(file), 'Stamp file outside reviewed surface');
    // Verify local source boundaries before publishing; unrelated retained work is never copied.
    const inputPaths = ['.release-policy.json', 'firebase.json', ...policy.assets.map(item => item.source)];
    assert.equal(git(root, 'status', '--porcelain', '--untracked-files=all', '--', ...inputPaths).length, 0, 'Release input is dirty');
    const config = JSON.parse(git(root, 'show', `${sha}:firebase.json`).toString());
    assert.ok(config.hosting && !Array.isArray(config.hosting) && typeof config.hosting.public === 'string', 'Single Hosting site required');
    const hosting = { ...config.hosting, public: 'public' };
    // The artifact is already prepared: repository lifecycle hooks must not mutate/rebuild it.
    delete hosting.predeploy; delete hosting.postdeploy;
    hosting.headers = [...(hosting.headers || []), { source: '/release.json', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] }];
    const configBytes = Buffer.from(JSON.stringify({ hosting }, null, 2) + '\n');
    return { policy, assets, configBytes, sha };
}

async function files(root) {
    const stat = await lstat(root);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Artifact root must be a real directory');
    const result = [];
    for (const name of await readdir(root)) {
        const stat = await lstat(join(root, name));
        assert.ok(!stat.isSymbolicLink(), `Artifact symlink refused: ${name}`);
        if (stat.isDirectory()) result.push(...(await files(join(root, name))).map(item => `${name}/${item}`));
        else { assert.ok(stat.isFile(), 'Artifact special file refused'); result.push(name); }
    }
    return result.sort();
}

function identityFor(snapshot, builtAt = new Date().toISOString()) {
    return { schema: 1, app: snapshot.policy.app, sha: snapshot.sha, builtAt,
        hostingConfigSha256: digest(snapshot.configBytes),
        assets: Object.fromEntries(Object.keys(snapshot.assets).sort().map(name => [name, digest(snapshot.assets[name])])) };
}
function validateIdentity(actual, expected) {
    assert.ok(actual && Number.isFinite(Date.parse(actual.builtAt)), 'Invalid diagnostic build date');
    for (const field of ['schema','app','sha','hostingConfigSha256']) assert.equal(actual[field], expected[field], `Wrong release ${field}`);
    assert.deepEqual(actual.assets, expected.assets, 'Release asset identity differs');
}
export async function prepare(root, output, sha) {
    const snapshot = sourceSnapshot(root, sha); output = resolve(output);
    const distance = relative(resolve(root), output);
    assert.ok(distance && !snapshot.policy.assets.some(item => resolve(root, item.source) === output), 'Output must not overwrite source');
    assert.ok(output !== resolve(root, 'public') && !distance.startsWith('public' + sep), 'Output must be outside source public directory');
    await mkdir(output); await mkdir(join(output, 'public'));
    for (const [name, bytes] of Object.entries(snapshot.assets)) {
        await mkdir(dirname(join(output, 'public', name)), { recursive: true });
        await writeFile(join(output, 'public', name), bytes, { flag: 'wx' });
    }
    await writeFile(join(output, 'firebase.json'), snapshot.configBytes, { flag: 'wx' });
    await writeFile(join(output, 'public', marker), JSON.stringify(identityFor(snapshot), null, 2) + '\n', { flag: 'wx' });
    return check(root, output, sha);
}
export async function check(root, output, sha) {
    const snapshot = sourceSnapshot(root, sha); const expected = identityFor(snapshot);
    const rootStat = await lstat(output);
    assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'Artifact root must be a real directory');
    assert.deepEqual((await readdir(output)).sort(), ['firebase.json','public'], 'Artifact must contain only Hosting config and public assets');
    const inventory = ['firebase.json', `public/${marker}`, ...Object.keys(snapshot.assets).map(name => 'public/' + name)].sort();
    assert.deepEqual(await files(resolve(output)), inventory, 'Unexpected or missing artifact entry');
    assert.deepEqual(await readFile(join(output, 'firebase.json')), snapshot.configBytes, 'Hosting-only configuration differs');
    for (const [name, bytes] of Object.entries(snapshot.assets)) assert.deepEqual(await readFile(join(output, 'public', name)), bytes, `Source/asset mismatch: ${name}`);
    const actual = JSON.parse(await readFile(join(output, 'public', marker), 'utf8')); validateIdentity(actual, expected); return actual;
}
function origin(url) {
    const base = new URL(url);
    assert.ok(!base.username && !base.password && !base.search && !base.hash && base.pathname === '/', 'Use a bare credential-free origin');
    assert.ok(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname)), 'HTTPS or owned loopback fixture required');
    return base;
}
async function responseBytes(response, limit) {
    assert.equal(response.status, 200, 'Served asset unavailable');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; assert.ok(size <= limit, 'Served response exceeds expected size'); chunks.push(Buffer.from(chunk)); }
    return Buffer.concat(chunks, size);
}
export async function verify(root, output, sha, url, { signal, fetcher = fetch } = {}) {
    const expected = await check(root, output, sha); const base = origin(url);
    const request = async (name, limit) => {
        const endpoint = new URL(name === 'index.html' ? '' : name, base); endpoint.searchParams.set('release', sha);
        const response = await fetcher(endpoint, { cache: 'no-store', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
        return responseBytes(response, limit);
    };
    validateIdentity(JSON.parse((await request(marker, 65536)).toString()), expected);
    for (const [name, hash] of Object.entries(expected.assets)) {
        const local = await readFile(join(output, 'public', name));
        assert.equal(digest(await request(name, local.length)), hash, `Served bytes differ: ${name}`);
    }
    return { sha, app: expected.app, assets: Object.keys(expected.assets).length, origin: base.origin };
}
export async function waitForVisibility(root, output, sha, url, { timeoutMs = 45000, pollMs = 2000 } = {}) {
    await check(root, output, sha); origin(url);
    assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && Number.isInteger(pollMs) && pollMs > 0);
    const controller = new AbortController(); const until = Date.now() + timeoutMs;
    const timer = setTimeout(() => controller.abort(new Error('Release visibility deadline exceeded')), timeoutMs);
    let observation = 0;
    try { for (;;) {
        try { return await verify(root, output, sha, url, { signal: controller.signal }); }
        catch (error) {
            if (controller.signal.aborted || Date.now() >= until) throw error;
            console.error(`Intended release not yet visible (read ${++observation}): ${error.message.split('\n')[0]}`);
            await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, until - Date.now())));
        }
    } } finally { clearTimeout(timer); }
}
export async function gate(root) {
    const policy = JSON.parse(await readFile(join(root, '.release-policy.json'), 'utf8'));
    assert.ok(Array.isArray(policy.checks) && policy.checks.length, 'Declare the actual project gate');
    for (const command of policy.checks) {
        assert.ok(Array.isArray(command) && command.length > 1 && command.every(item => typeof item === 'string')
            && ['node','npm','python3'].includes(command[0]), 'Use structured project commands, not shell text');
        console.log(`Project gate: ${JSON.stringify(command)}`);
        execFileSync(command[0], command.slice(1), { cwd: root, stdio: 'inherit' });
    }
}
async function main() {
    const [command, output, sha, url, ...extra] = process.argv.slice(2);
    assert.ok(['candidate','check','verify-url','gate'].includes(command) && (command === 'gate' ? !output : output && sha) && !extra.length && (command === 'verify-url' ? url : !url),
        'Usage: node scripts/hosting-release.mjs gate; candidate|check OUTPUT FULL_SHA; verify-url OUTPUT FULL_SHA ORIGIN');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    if (command === 'gate') { await gate(root); return; }
    if (command === 'candidate') { sourceSnapshot(root, sha); await gate(root); }
    const result = command === 'candidate' ? await prepare(root, output, sha) : command === 'check' ? await check(root, output, sha) : await waitForVisibility(root, output, sha, url);
    console.log(JSON.stringify({ command, sha, app: result.app, assets: typeof result.assets === 'number' ? result.assets : Object.keys(result.assets).length }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
