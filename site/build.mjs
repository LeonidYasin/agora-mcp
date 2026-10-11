import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { marked } from 'marked';
const root=path.resolve(import.meta.dirname,'..'), out=path.join(root,'_site');
const pages=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'content.json'),'utf8'));
const map=new Map(pages.map(p=>[p.file,p.slug+'.html']));
const graph=JSON.parse(fs.readFileSync(path.join(root,'docs/assets/project-graph.json'),'utf8'));
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const slug=s=>s.toLowerCase().replace(/<[^>]+>/g,'').replace(/[^\p{L}\p{N}\s_-]/gu,'').replace(/\s+/g,'-');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(path.join(out,'assets'),{recursive:true});fs.mkdirSync(path.join(out,'downloads'),{recursive:true});
fs.copyFileSync(path.join(import.meta.dirname,'style.css'),path.join(out,'assets/style.css'));
for(const file of fs.readdirSync(path.join(root,'docs/assets')))fs.copyFileSync(path.join(root,'docs/assets',file),path.join(out,'assets',file));
const downloads=[];
for(const file of fs.readdirSync(path.join(root,'deploy')).filter(f=>/\.(py|sh|mjs|service|example)$/.test(f))){
 const src=path.join(root,'deploy',file);fs.copyFileSync(src,path.join(out,'downloads',file));
 downloads.push({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex')});
}
fs.writeFileSync(path.join(out,'downloads/SHA256SUMS.txt'),downloads.map(x=>`${x.sha256}  ${x.file}`).join('\n')+'\n');
function target(current,href){
 if(/^(https?:|mailto:|#)/.test(href))return href;
 const [base,hash]=href.split('#');const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(current),base));
 if(map.has(resolved))return './'+map.get(resolved)+(hash?'#'+hash:'');
 if(resolved.startsWith('docs/assets/'))return './assets/'+path.posix.basename(resolved);
 if(resolved.startsWith('deploy/') && downloads.some(d=>d.file===path.posix.basename(resolved)))return './downloads/'+path.posix.basename(resolved);
 return 'https://github.com/LeonidYasin/agora-mcp/blob/main/'+resolved+(hash?'#'+hash:'');
}
function mobileText(asset){
 if(asset==='mindmap.svg'){
  const topics=JSON.parse(fs.readFileSync(path.join(root,'docs/assets/mindmap-topics.json'),'utf8'));
  return '<div class="map-mobile"><strong>Текстовая mindmap</strong><ul>'+Object.entries(topics).map(([topic,leaves])=>'<li><strong>'+esc(topic)+'</strong><ul>'+leaves.map(l=>'<li>'+esc(l)+'</li>').join('')+'</ul></li>').join('')+'</ul></div>';
 }
 const view=asset.replace('graph-','').replace('.svg','');const ids=new Set(graph.nodes.filter(n=>n.view===view).map(n=>n.id));
 if(view==='ecosystem'){ids.add('agora');ids.add('wire');}if(view==='workflow')ids.add('systemd');if(view==='governance')ids.add('republic');
 const labels=new Map(graph.nodes.map(n=>[n.id,n.label]));
 return '<div class="map-mobile"><strong>Связи схемы</strong><ul>'+graph.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)).map(e=>'<li>'+esc(labels.get(e.from))+' → '+esc(labels.get(e.to))+'<br><small>'+esc(e.label)+' · '+esc(e.kind)+' · '+esc(e.status)+'</small></li>').join('')+'</ul></div>';
}
function fullGraph(){
 const labels=new Map(graph.nodes.map(n=>[n.id,n.label]));
 return `<details><summary>Все связи: файлы, импорты, документы и runtime</summary><label for="graph-search">Поиск по узлам или типу связи</label><input id="graph-search" type="search" placeholder="Например: auth.ts, deployment, conceptual"><ul class="edge-list">${graph.edges.map(e=>`<li data-edge>${esc(labels.get(e.from))} → ${esc(labels.get(e.to))}<small>${esc(e.label)} · ${esc(e.kind)} · ${esc(e.status)} · <a href="${esc(target('README.md',e.source))}">источник</a></small></li>`).join('')}</ul></details><script>(()=>{const input=document.getElementById('graph-search');input.addEventListener('input',()=>{const q=input.value.toLowerCase();for(const row of document.querySelectorAll('[data-edge]'))row.hidden=!row.textContent.toLowerCase().includes(q);});})();</script>`;
}
for(const p of pages){
 const renderer=new marked.Renderer();
 renderer.link=(href,title,text)=>`<a href="${esc(target(p.file,href))}"${title?` title="${esc(title)}"`:''}>${text}</a>`;
 renderer.image=(href,title,text)=>{
  const dst=target(p.file,href),name=path.posix.basename(href);
  return `<figure class="diagram"><img src="${esc(dst)}" alt="${esc(text)}">${mobileText(name)}<figcaption>${esc(text)} · <a href="${esc(dst)}">открыть SVG</a></figcaption></figure>`;
 };
 renderer.heading=(text,level,raw)=>`<h${level} id="${esc(slug(raw))}">${text}</h${level}>\n`;
 renderer.table=(header,body)=>`<div class="table-wrap"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
 let body=marked.parse(fs.readFileSync(path.join(root,p.file),'utf8'),{renderer,gfm:true});
 if(p.slug==='index')body=`<section class="hero"><div class="eyebrow">Маркет сейчас · полная Agora в плане</div><h1>Общий слой обмена<br>для личных AI-агентов</h1><p>Первый приоритет — «предлагаю ↔ хочу» из AI-чата. Полная задумка: самостоятельный вход, приглашения, экономика использования и республиканские институты. Пока работает технический market-пилот; остальные слои — план.</p><code>https://leonid-mcp.duckdns.org/agora/mcp</code></section><div class="quick"><a href="./vision.html"><strong>Полная задумка Agora</strong><span>Маркет, вход, экономика и будущая республика</span></a><a href="./parallel.html"><strong>Проверить из двух чатов</strong><span>Технический пилот: независимые владельцы A/B</span></a><a href="./maps.html"><strong>Посмотреть все связи</strong><span>Реальный runtime отдельно от planned-платформы</span></a><a href="./live-report.html"><strong>Что действительно проверено</strong><span>Живые результаты отдельно от pending и CI</span></a></div>`+body.replace(/^<h1[^>]*>.*?<\/h1>\s*/s,'');
 if(p.slug==='maps')body+=fullGraph();
 const groups=[...new Set(pages.map(x=>x.group))];
 const nav=groups.map(g=>`<h2>${g}</h2><ul>${pages.filter(x=>x.group===g).map(x=>`<li><a href="./${x.slug}.html"${x.slug===p.slug?' aria-current="page"':''}>${esc(x.title)}</a></li>`).join('')}</ul>`).join('');
 const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.title)} · Agora MCP</title><meta name="description" content="Agora: маркет offer/want, публичный доступ, экономика, республика; планы отдельно от runtime"><link rel="stylesheet" href="./assets/style.css"></head><body><header class="top"><a class="brand" href="./index.html">Agora MCP</a><nav aria-label="Быстрые ссылки"><a href="./parallel.html">Тестировать</a><a href="./maps.html">Карта проекта</a><a href="https://github.com/LeonidYasin/agora-mcp">GitHub ↗</a></nav></header><div class="layout"><aside class="sidebar"><details open><summary>Документация</summary><nav aria-label="Документация">${nav}</nav></details><script>(()=>{if(window.matchMedia("(max-width:800px)").matches)document.querySelector(".sidebar details").open=false;})();</script></aside><main class="article"><div class="meta">Stage 0 · документация и наблюдения 2026-10-11 · <a href="https://github.com/LeonidYasin/agora-mcp/blob/main/${p.file}">Markdown source</a></div>${body}<footer class="footer">Текущий manual-token пилот. OAuth, billing и республика — planned. Документация не запускает deployment.<br>Ключи Jina, пароли БД и пользовательские токены никогда не публикуются здесь.</footer></main></div></body></html>`;
 fs.writeFileSync(path.join(out,p.slug+'.html'),html);
}
fs.writeFileSync(path.join(out,'.nojekyll'),'');
console.log(`Built ${pages.length} documentation routes, diagrams and private-free downloads.`);
