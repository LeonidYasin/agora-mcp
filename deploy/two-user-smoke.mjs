// Explicit opt-in live test: creates synthetic items, persists matches, deactivates its items.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Client } from '../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
const url = process.argv[2];
if (!url || !url.startsWith('https://')) throw new Error('Usage: node deploy/two-user-smoke.mjs https://HOST/agora/mcp');
const tokens = ['a', 'b'].map(id => fs.readFileSync(`/root/agora-invites/agora-test-${id}.token`, 'utf8').trim());
assert.notEqual(tokens[0], tokens[1], 'Two independent tokens required');
const clients = tokens.map(() => new Client({name:'agora-live-smoke',version:'1'}, {capabilities:{}}));
const created = [];
let failed = false;
function payload(result) { return result.structuredContent ?? JSON.parse(result.content[0].text); }
async function call(client, name, args={}) {
  const result = await client.callTool({name, arguments:args});
  if(result.isError) throw new Error('MCP test action failed: '+name);
  return payload(result);
}
async function submit(client, name, text) {
  const result=await call(client,name,{text,category:'it',tags:['agora-live-qa'],geo:'online'});
  created.push({client,id:result.item_id,active:true});return result.item_id;
}
async function withdraw(client,id) {
  await call(client,'deactivate_item',{item_id:id});created.find(x=>x.id===id).active=false;
}
const marker=`[AGORA-LIVE-QA-${Date.now()}] Synthetic test, not a real service. `;
try {
  for(let i=0;i<2;i++) await clients[i].connect(new StreamableHTTPClientTransport(new URL(url), {
    requestInit:{headers:{Authorization:'Bearer '+tokens[i]}}
  }));
  const [a,b]=clients;
  assert.equal((await a.listTools()).tools.length,5);console.log('PASS MCP initialize/discovery');
  const offer=await submit(a,'submit_offer',marker+'Kotlin Android development consultation online.');
  const ownWant=await submit(a,'submit_want',marker+'Need Kotlin Android development consultation online.');
  const want=await submit(b,'submit_want',marker+'Need Kotlin Android development consultation online.');
  const unrelated=await submit(b,'submit_want',marker+'Need a plumber to repair a bathroom.');
  const english=await submit(b,'submit_offer',marker+'English conversation tutoring online.');
  const aItems=(await call(a,'get_my_items')).items,bItems=(await call(b,'get_my_items')).items;
  assert.notEqual(aItems.find(x=>x.item_id===offer).owner_id,bItems.find(x=>x.item_id===want).owner_id);
  assert.ok(!aItems.some(x=>x.item_id===want));console.log('PASS distinct users and own listing');
  const first=await call(a,'search_matches',{item_id:offer,limit:50});
  assert.ok(!first.items.some(x=>x.item_id===ownWant));
  const idx=first.items.findIndex(x=>x.item_id===want);assert.ok(idx>=0);
  assert.equal(first.items.length,first.matches.length);
  for(const match of first.matches)assert.ok(match.score>=0 && match.score<=1);
  const wrongIdx=first.items.findIndex(x=>x.item_id===unrelated);
  if(wrongIdx>=0)assert.ok(idx<wrongIdx,'Relevant fixture must rank above unrelated fixture');
  assert.ok(first.items[idx].text.includes('Kotlin'));console.log('PASS readable cross-user match, self exclusion and fixture ranking');
  const second=await call(a,'search_matches',{item_id:offer,limit:50});
  assert.equal(first.matches[idx].match_id,second.matches[second.items.findIndex(x=>x.item_id===want)].match_id);
  console.log('PASS match upsert stability');
  for(const name of ['search_matches','deactivate_item']) {
    const rejected=await b.callTool({name,arguments:{item_id:offer}});assert.equal(rejected.isError,true);
  }
  console.log('PASS foreign ownership operations rejected');
  const wantSide=await call(a,'search_matches',{item_id:ownWant,limit:50});
  assert.ok(wantSide.items.some(x=>x.item_id===english && x.type==='offer'));
  console.log('PASS want-side search returns offer cards');
  await withdraw(b,want);
  const after=await call(a,'search_matches',{item_id:offer,limit:50});assert.ok(!after.items.some(x=>x.item_id===want));
  assert.equal((await b.callTool({name:'deactivate_item',arguments:{item_id:want}})).isError,true);
  console.log('PASS withdrawal and no false success');
} catch(error) { failed=true;console.error('FAIL:',error.message); }
finally {
  for(const item of created.filter(x=>x.active)) {
    try {await withdraw(item.client,item.id);}catch {failed=true;console.error('CLEANUP REQUIRED item_id:',item.id);}
  }
  for(const client of clients) {try{await client.close();}catch{}}
  console.log('Cleanup attempted for this run only; pre-existing items untouched.');
}
process.exit(failed?1:0);
