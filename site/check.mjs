import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'_site');
const pages=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'content.json'),'utf8'));
let refs=0;
for(const p of pages){
 const html=fs.readFileSync(path.join(out,p.slug+'.html'),'utf8');
 for(const match of html.matchAll(/(?:href|src)="([^"]+)"/g)){
  const href=match[1];if(/^(https?:|mailto:|#)/.test(href))continue;
  const file=path.resolve(out,href.split('#')[0]);
  if(!file.startsWith(out+path.sep)||!fs.existsSync(file))throw new Error(`Broken local link ${p.slug}: ${href}`);
  refs++;
 }
 if(!html.includes('lang="ru"')||!html.includes('aria-label="Документация"'))throw new Error('Accessibility structure missing');
}
const graph=JSON.parse(fs.readFileSync(path.join(root,'docs/assets/project-graph.json'),'utf8'));
const ids=new Set(graph.nodes.map(n=>n.id));
for(const edge of graph.edges){if(!ids.has(edge.from)||!ids.has(edge.to))throw new Error('Unknown graph node');if(!fs.existsSync(path.join(root,edge.source)))throw new Error('Unknown graph source: '+edge.source);}
const sources=fs.readdirSync(path.join(root,'mcp-server/src')).filter(x=>x.endsWith('.ts'));
for(const source of sources){
 const from='file:mcp-server/src/'+source, text=fs.readFileSync(path.join(root,'mcp-server/src',source),'utf8');
 if(!ids.has(from))throw new Error('Source missing from graph');
 for(const m of text.matchAll(/from\s+["'](\.[^"']+)["']/g)){
  const to='file:'+path.posix.normalize(path.posix.join('mcp-server/src',m[1])).replace(/\.js$/,'.ts');
  if(!graph.edges.some(e=>e.from===from&&e.to===to&&e.kind==='dependency'))throw new Error('Import absent from graph');
 }
}
console.log(`PASS ${pages.length} HTML routes, ${refs} local references, graph endpoints/sources/TS imports.`);

for(const id of ['selfservice','invites','usage','payments','republic','parliament','electoral','courts']){
 const n=graph.nodes.find(x=>x.id===id);if(!n||n.status!=='planned')throw new Error('Target capability must stay planned: '+id);
}
for(const e of graph.edges.filter(x=>x.kind==='planned'))if(e.status!=='planned')throw new Error('Planned edge status missing');
for(const slug of ['vision','access','economy','republic'])if(!pages.some(p=>p.slug===slug))throw new Error('Vision route missing');
const topics=JSON.parse(fs.readFileSync(path.join(root,'docs/assets/mindmap-topics.json'),'utf8'));
const maps=fs.readFileSync(path.join(out,'maps.html'),'utf8');for(const topic of Object.keys(topics))if(!maps.includes(topic))throw new Error('Mobile mindmap topic missing');
console.log('PASS target-layer planned status and shared desktop/mobile mindmap topics.');
