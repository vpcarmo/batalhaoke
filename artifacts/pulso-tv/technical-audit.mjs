import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import ts from '../../node_modules/typescript/lib/typescript.js';
const out='artifacts/pulso-tv';
const results={};
for(const [label,args] of [ ['typescript',['node_modules/typescript/bin/tsc','--noEmit']], ['tests',['node_modules/vitest/vitest.mjs','run']], ['build',['node_modules/vite/bin/vite.js','build']], ['eslint',['node_modules/eslint/bin/eslint.js','src/routes/tv.tsx','src/components/karaoke/ArenaBackdrop.tsx']], ['format',['node_modules/prettier/bin/prettier.cjs','--check','src/styles.css','src/routes/tv.tsx','src/components/karaoke/ArenaBackdrop.tsx']] ]){
 const r=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:20*1024*1024});fs.writeFileSync(`${out}/${label}.log`,r.stdout+r.stderr);results[label]={exitCode:r.status,error:r.error?.message};
}
const git=(args)=>spawnSync('git',args,{encoding:'utf8'});
const diff=git(['diff','--check']);results.diffCheck={exitCode:diff.status};
const base=git(['show','HEAD:src/routes/tv.tsx']).stdout;
const current=fs.readFileSync('src/routes/tv.tsx','utf8');
const player=source=>{const file=ts.createSourceFile('tv.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let result;function visit(n){if(ts.isJsxElement(n)&&n.openingElement.tagName.getText(file)==='PlaybackPlayer'||ts.isJsxSelfClosingElement(n)&&n.tagName.getText(file)==='PlaybackPlayer'){result={jsx:n.getText(file),ancestors:[]};for(let p=n.parent;p;p=p.parent)if(ts.isJsxElement(p))result.ancestors.push(p.openingElement.tagName.getText(file));}ts.forEachChild(n,visit);}visit(file);return result;};
const before=player(base),after=player(current);
results.player={jsxUnchanged:before.jsx===after.jsx,ancestorsUnchanged:JSON.stringify(before.ancestors)===JSON.stringify(after.ancestors),ancestors:after.ancestors};
const changed=git(['diff','--name-only']).stdout.trim().split('\n');results.changedTrackedFiles=changed;
results.protectedFilesUntouched=changed.filter(f=>f.startsWith('src/')).every(f=>['src/routes/tv.tsx','src/styles.css','src/components/karaoke/ArenaBackdrop.tsx'].includes(f));
results.player.fileUnchanged=git(['diff','--exit-code','HEAD','--','src/components/karaoke/PlaybackPlayer.tsx']).status===0;
const scan=source=>{const file=ts.createSourceFile('tv.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let list=[];function visit(n){if(ts.isCallExpression(n)&&(n.expression.getText(file).startsWith('use')||n.expression.getText(file).includes('useEffect')))list.push(n.getText(file));ts.forEachChild(n,visit);}visit(file);return list;};
results.tvHooksUnchanged=JSON.stringify(scan(base))===JSON.stringify(scan(current));
fs.writeFileSync(`${out}/technical.json`,JSON.stringify(results,null,2));console.log(results);
