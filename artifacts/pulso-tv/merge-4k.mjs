import fs from 'node:fs/promises';
const dir='artifacts/pulso-tv';
const old=JSON.parse(await fs.readFile(`${dir}/responsive.json`,'utf8'));
const uhd=JSON.parse(await fs.readFile(`${dir}/responsive-4k.json`,'utf8'));
const merged=old.map(r=>r.w===3840?uhd.find(n=>n.state===r.state):r);
if(merged.some(r=>!r))throw new Error('Missing 4K capture');
await fs.writeFile(`${dir}/responsive.json`,JSON.stringify(merged,null,2));
