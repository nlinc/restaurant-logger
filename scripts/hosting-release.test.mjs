import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { sourceSnapshot, prepare, check, verify, waitForVisibility } from './hosting-release.mjs';

async function fixture(t, editPolicy = x => x) {
    const root = await mkdtemp(resolve(tmpdir(), 'miles-hosting-source-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = resolve(root, 'source'); await mkdir(resolve(source, 'public'), { recursive: true });
    await mkdir(resolve(source, 'scripts')); await cp(new URL('./hosting-release.mjs', import.meta.url), resolve(source, 'scripts/hosting-release.mjs'));
    const assets = { 'index.html': '<title>__BUILD_COMMIT__</title>', 'sw.js': 'const CACHE_NAME="same-manual-version";', 'app.js':'const source="synthetic";', 'icon.png':Buffer.from([0,128,255]) };
    for (const [name, bytes] of Object.entries(assets)) await writeFile(resolve(source, 'public', name), bytes);
    const policy = editPolicy({ schema:1,app:'synthetic',assets:Object.keys(assets).map(path => ({source:'public/'+path,path})),stampFiles:['index.html'],checks:[['node','--check','public/app.js']] });
    await writeFile(resolve(source, '.release-policy.json'), JSON.stringify(policy));
    await writeFile(resolve(source, 'firebase.json'), JSON.stringify({ hosting:{public:'public'},functions:{source:'private-functions'},firestore:{rules:'private.rules'} }));
    await writeFile(resolve(source, 'private.txt'), 'synthetic private exclusion');
    const env={...process.env,GIT_AUTHOR_NAME:'Synthetic fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Synthetic fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
    const git=(...args)=>execFileSync('git',['-C',source,...args],{env,encoding:'utf8'}).trim();
    git('init','--quiet');git('add','.release-policy.json','firebase.json','public','scripts');
    const tree=git('write-tree');const sha=git('commit-tree',tree,'-m','Disposable synthetic fixture');git('update-ref','HEAD',sha);
    return {root,source,sha,output:resolve(root,'artifact'),git};
}
test('actual CLI prepares exact committed inputs without private/backend surfaces and refuses reuse',async t=>{
 const f=await fixture(t);
 const result=spawnSync(process.execPath,['scripts/hosting-release.mjs','candidate',f.output,f.sha],{cwd:f.source,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout.trim().split('\n').at(-1)).assets,4);
 const m=await check(f.source,f.output,f.sha);assert.equal(m.sha,f.sha);
 assert.equal((await readFile(resolve(f.output,'public/index.html'),'utf8')),`<title>${f.sha.slice(0,7)}</title>`);
 assert.equal((await readFile(resolve(f.output,'public/sw.js'),'utf8')),'const CACHE_NAME="same-manual-version";');
 assert.deepEqual(Object.keys(JSON.parse(await readFile(resolve(f.output,'firebase.json')))),['hosting']);
 await assert.rejects(prepare(f.source,f.output,f.sha),/EEXIST/);
 await writeFile(resolve(f.output,'unexpected.txt'),'must not ship');await assert.rejects(check(f.source,f.output,f.sha),/only Hosting/);
});
test('false revision, dirty source and unsafe policy fail before artifact creation',async t=>{
 const f=await fixture(t);assert.throws(()=>sourceSnapshot(f.source,'0'.repeat(40)),/source HEAD/);
 await writeFile(resolve(f.source,'public/app.js'),'dirty');await assert.rejects(prepare(f.source,f.output,f.sha),/dirty/);
 for (const source of ['../outside.js','functions/index.js','AGENTS.md','public/.env']) {
  const bad=await fixture(t,p=>({...p,assets:[{source,path:'app.js'}]}));assert.throws(()=>sourceSnapshot(bad.source,bad.sha),/Unsafe/);
 }
});
test('symlinks, missing/changed source-bound bytes and forged inventories are refused',async t=>{
 const f=await fixture(t);await prepare(f.source,f.output,f.sha);
 const file=resolve(f.output,'public/app.js');await writeFile(file,'wrong');
 let m=JSON.parse(await readFile(resolve(f.output,'public/release.json')));m.assets['app.js']='0'.repeat(64);await writeFile(resolve(f.output,'public/release.json'),JSON.stringify(m));
 await assert.rejects(check(f.source,f.output,f.sha),/Source\/asset mismatch/);
 await rm(file);await symlink(resolve(f.source,'public/app.js'),file);await assert.rejects(check(f.source,f.output,f.sha),/symlink/);
 const alias=resolve(f.root,'artifact-alias');await symlink(f.output,alias);await assert.rejects(check(f.source,alias,f.sha),/real directory/);
});
test('served proof handles canonical root, exact intent, stale/corrupt/oversized/redirected assets and visibility deadline',async t=>{
 const f=await fixture(t);await prepare(f.source,f.output,f.sha);let fault='',stale=0;const seen=[];
 const server=createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');seen.push(u.pathname);assert.equal(u.searchParams.get('release'),f.sha);
  if(u.pathname==='/index.html'){res.writeHead(301,{location:'/'}).end();return;}
  const name=u.pathname==='/'?'index.html':u.pathname.slice(1);
  if(fault==='redirect'&&name==='app.js'){res.writeHead(302,{location:'/'}).end();return;}
  const wrong=(name==='release.json'&&stale-->0)||(fault===name);
  const bytes=wrong?Buffer.from('x'.repeat(80000)):await readFile(resolve(f.output,'public',name));res.end(bytes);
 });
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(Number(process.env.PROCESS_TEST_PORT||19920),'127.0.0.1',done);});
 t.after(()=>new Promise(done=>{server.closeAllConnections();server.close(done);}));
 const url=`http://127.0.0.1:${server.address().port}/`;
 assert.equal((await verify(f.source,f.output,f.sha,url)).assets,4);assert.ok(seen.includes('/'));assert.ok(!seen.includes('/index.html'));
 for(fault of ['app.js','sw.js','index.html','release.json','redirect'])await assert.rejects(verify(f.source,f.output,f.sha,url));
 fault='';stale=2;await waitForVisibility(f.source,f.output,f.sha,url,{timeoutMs:2000,pollMs:5});
 fault='app.js';await assert.rejects(waitForVisibility(f.source,f.output,f.sha,url,{timeoutMs:50,pollMs:5}));
 await assert.rejects(verify(f.source,f.output,f.sha,'https://user:secret@example.test/'),/credential-free/);
});

test('actual candidate command stops before artifact output when the declared gate is red',async t=>{
 const f=await fixture(t,p=>({...p,checks:[['node','-e','process.exit(17)']]}));
 const result=spawnSync(process.execPath,['scripts/hosting-release.mjs','candidate',f.output,f.sha],{cwd:f.source,encoding:'utf8'});
 assert.notEqual(result.status,0);await assert.rejects(readFile(resolve(f.output,'firebase.json')),/ENOENT/);
});
