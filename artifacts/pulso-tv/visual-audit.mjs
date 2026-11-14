import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/Valmir Carmo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out='artifacts/pulso-tv';
const defaultProvider=(await fs.readFile('src/lib/playback/registry.ts','utf8')).match(/DEFAULT_PROVIDER[^=]*=\s*"([^"]+)"/)[1];
const scrollOnly=process.argv.includes('--scroll');
const uhdOnly=process.argv.includes('--4k');
const fallbackOnly=process.argv.includes('--fallback');
const supplement=process.argv.includes('--supplement');
const resultsFile=`${out}/${supplement?'responsive-supplement':scrollOnly?'responsive-scroll':uhdOnly?'responsive-4k':fallbackOnly?'responsive-fallback':'responsive'}.json`;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.newContext();
const page=await context.newPage();
await context.routeWebSocket('**/*', ws=>ws.close());
page.on('pageerror',e=>console.log('PAGEERROR',state,e.message));
const p=(id,name,n)=>({id,name,stage_name:name,participant_number:n,session_id:'test-session'});
const participants=[p('a','Mariana Costa',1),p('b','Rafael Santos',2),p('c','Luiza Oliveira',3)];
const perf=(id,participant,status)=>({id,participant_id:participant.id,participant,source:{provider:defaultProvider,external_id:'fixture-not-playable',title:'Uma canção para toda a plateia'},status,like_count:24,dislike_count:2,created_at:'2026-01-01',ended_at:'2026-01-01'});
const match={id:'match',participant_a_id:'a',participant_b_id:'b',status:'scheduled',voting_status:'idle',created_at:'2026-01-01'};
let state='opening'; let imageFailure='';
const snapshot=()=>{
 const session={id:'test-session',session_type:'free',status:'active',tv_enabled:true,show_qr_on_tv:true,public_code:'TEST-TV',venue_id:null,voting_mode:'like_only'};
 let performances=[],matches=[],championship=null;
 if(state==='interval') performances=[perf('done',participants[0],'completed')];
 if(state==='live'||state==='long-live') performances=[perf('active',state==='long-live'?p('a','Maria Aparecida de Albuquerque e Vasconcelos',1):participants[0],'active')];
 if(state==='long-song') {const item=perf('active',participants[0],'active');item.source.title='Uma canção com um título muito extenso para conferir a leitura completa da música sem esconder palavras importantes nem cobrir o vídeo ou o QR Code';performances=[item];}
 if(state==='session-disabled') session.tv_enabled=false;
 if(['preparation','duel','vote','long-vote','victory'].includes(state)) {session.session_type='x1'; matches=state==='preparation'?[]:[{...match}];}
 if(state==='vote'||state==='long-vote') {session.x1_voting_mode='after_both_performances'; matches[0]={...match,status:'in_progress',voting_status:'open',voting_ends_at:new Date(Date.now()+60000).toISOString()};}
 if(state==='victory') {matches=[{...match,status:'completed',winner_participant_id:'a'}];performances=[{...perf('done',participants[0],'completed'),match_id:'match',match_slot:'a'}];}
 if(state.startsWith('championship')) {session.session_type='championship'; championship={title:'Campeonato de vozes',status:state==='championship-victory'?'completed':'final',format:8,entries:participants.map(p=>({id:p.id,participantId:p.id,displayName:p.name})),matches:[{id:'final',stage:'final',matchNumber:1,entryAId:'a',entryBId:'b',winnerEntryId:state==='championship-victory'?'a':null,status:state==='championship-victory'?'completed':'in_progress',votingStatus:state==='championship-vote'?'open':'closed',votingEndsAt:new Date(Date.now()+60000).toISOString(),votesA:24,votesB:18}]};}
 if(state==='championship-waiting') {championship.status='group_stage';championship.matches=[];championship.entries=championship.entries.map(entry=>({...entry,groupLetter:'A'}));}
 const visibleParticipants=state==='long-vote'?participants.map((item,index)=>({...item,stage_name:index===0?'Maria Aparecida de Albuquerque e Vasconcelos':'João Guilherme de Oliveira e Albuquerque'})):participants;
 return {kind:'tv',venueId:null,session:state==='opening'?null:session,participants:visibleParticipants,performances,matches,championship};
};
await context.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.origin!=='http://127.0.0.1:8080')return route.abort();
 if(u.pathname.includes('/_serverFn/')) {
  const name=JSON.parse(Buffer.from(u.pathname.split('/').at(-1),'base64url').toString()).export;
  let result;
  if(name.startsWith('getTvState'))result={paired:!['pairing','pairing-error'].includes(state),disabled:state==='tv-disabled',activeSessionId:state==='opening'?null:'test-session',venueName:'Local de teste',venueDeviceName:'TV de teste'};
  else if(name.includes('KaraokeSnapshot'))result=snapshot();
  else if(name.startsWith('registerTvDevice'))result=state==='pairing-error'?{}:{pairingCode:'ABC123'};
  else if(name.startsWith('getX1MatchTally'))result={a:24,b:18,serverNow:Date.now()};
  else if(name.includes('acquire'))return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'Test fixture: playback not authorized'})});
  else return route.fulfill({contentType:'application/json',body:JSON.stringify({result:null})});
  return route.fulfill({contentType:'application/json',body:JSON.stringify({result})});
 }
 if(imageFailure&&u.pathname.includes('pulso-arena-')&&(imageFailure==='all'||u.pathname.endsWith('.webp')))return route.abort();
 return route.continue();
});
const sizes=supplement?[[320,568],[568,320],[768,1024],[1280,720],[2560,1080],[3840,2160]]:fallbackOnly?[[1280,720]]:uhdOnly?[[3840,2160]]:scrollOnly?[[320,568],[568,320],[800,360]]:process.argv.includes('--quick')?[[320,568],[568,320],[1280,720]]:[[320,568],[360,800],[390,844],[430,932],[568,320],[800,360],[844,390],[932,430],[768,1024],[1024,768],[1366,768],[1280,720],[1920,1080],[3840,2160]];
const states=supplement?['long-vote','long-song','championship-waiting','tv-disabled','session-disabled','pairing-error']:fallbackOnly?['waiting']:scrollOnly?['live','long-live']:['opening','pairing','waiting','interval','preparation','duel','vote','victory','championship-vote','championship-victory','live','long-live'];
const results=[];
for(const [w,h] of sizes)for(const s of states){
 state=s;
 await page.setViewportSize({width:w,height:h});
 await page.goto('http://127.0.0.1:8080/tv',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.body.innerText.includes('BatalhaOkê')&&!document.body.innerText.includes('Conectando…'));
 await page.evaluate(()=>document.fonts.ready);
 await page.waitForTimeout(100);
 const metrics=await page.evaluate(()=>{
  const main=document.querySelector('main');
  const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
  const header=rect(main.querySelector('.tv-brand')),content=rect(main.querySelector('.tv-content')),audio=rect(main.querySelector('.tv-audio-prompt'));
  return {scene:main.dataset.scene,overlap:!!content&&((header&&header.y+header.height>content.y+1)||(audio&&content.y+content.height>audio.y+1)),scrollX:Math.max(document.documentElement.scrollWidth,main.scrollWidth)>innerWidth+1,scrollY:main.scrollHeight>main.clientHeight+1,main:rect(main),player:rect(document.querySelector('.tv-video .relative')),panel:rect(document.querySelector('.tv-performance-panel')),image:document.querySelector('.pulso-arena-backdrop img')?.currentSrc,bodyText:document.body.innerText.slice(0,130)};
 });
 const file=`${s}-${w}x${h}.png`;
 await page.screenshot({path:`${out}/${file}`});
 if(scrollOnly){await page.locator('main').evaluate(el=>el.scrollTop=el.scrollHeight);await page.screenshot({path:`${out}/${s}-${w}x${h}-bottom.png`});}
 results.push({state:s,w,h,file,...metrics,...(supplement?await page.evaluate(()=>({pageScrollY:document.documentElement.scrollHeight>innerHeight+1,title:document.querySelector('.tv-performance-panel > p.font-display')?.textContent,qrRect:(()=>{const r=document.querySelector('.session-qr svg')?.getBoundingClientRect();return r?{width:r.width,height:r.height}:null})()})): {})});
 await fs.writeFile(resultsFile,JSON.stringify(results,null,2));
}
if(scrollOnly||uhdOnly){await browser.close();process.exit(0);}
state='live';
await page.goto('http://127.0.0.1:8080/tv',{waitUntil:'networkidle'});
await page.locator('.tv-video .relative').waitFor();
const playerNode=await page.locator('.tv-video .relative').elementHandle();
let stable=true;
for(const [width,height] of sizes){await page.setViewportSize({width,height});stable=stable&&await playerNode.evaluate(el=>el===document.querySelector('.tv-video .relative'));}
results.push({playerNodeStableAcrossBreakpoints:stable});
if(supplement){await fs.writeFile(resultsFile,JSON.stringify(results,null,2));await browser.close();process.exit(0);}
const transitions=[];
for(const [next,scene] of [['waiting','waiting'],['vote','duel'],['victory','victory'],['live','live'],['waiting','waiting']]){
 state=next;
 await page.waitForFunction(expected=>document.querySelector('main')?.dataset.scene===expected,scene,{timeout:15000});
 await page.waitForTimeout(100);
 transitions.push({state,scene,image:await page.locator('.pulso-arena-backdrop img').count()?await page.locator('.pulso-arena-backdrop img').getAttribute('src'):null});
}
results.push({transitions});
for(const failure of ['webp','all']) {state='waiting';imageFailure=failure;await page.setViewportSize({width:1280,height:720});await page.goto('http://127.0.0.1:8080/tv',{waitUntil:'networkidle'});await page.waitForTimeout(1000);await page.screenshot({path:`${out}/fallback-${failure}.png`});results.push({failure,image:await page.locator('.pulso-arena-backdrop').evaluate(el=>({img:!!el.querySelector('img'),src:el.querySelector('img')?.currentSrc,complete:el.querySelector('img')?.complete})),qr:await page.locator('.session-qr svg').evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,paths:[...el.querySelectorAll('path')].map(p=>({fill:p.getAttribute('fill'),length:p.getAttribute('d')?.length}))}))});}
await fs.writeFile(resultsFile,JSON.stringify(results,null,2));
console.log(JSON.stringify(results.filter(r=>r.scrollX||r.scrollY||r.failure),null,2));
await browser.close();
