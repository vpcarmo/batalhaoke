import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const results={};
for(const [name,args] of [['invites',['--test','tests/integration/operator-invites.integration.mjs']],['commercial',['tests/commercial-postgres-lifecycle-concurrency.mjs']]]){
 const r=spawnSync(process.execPath,args,{encoding:'utf8'});
 fs.writeFileSync(`artifacts/pulso-tv/integration-${name}.log`,r.stdout+r.stderr);
 results[name]={exitCode:r.status,missingDatabaseConfiguration:(r.stdout+r.stderr).includes('Set ')};
}
fs.writeFileSync('artifacts/pulso-tv/integration.json',JSON.stringify(results,null,2)); console.log(results);
