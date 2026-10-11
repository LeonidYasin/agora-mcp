#!/usr/bin/env python3
"""Deterministic project topology. Graph data covers all source files; views keep it readable."""
from pathlib import Path
import json
import re
import subprocess
import html
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/assets';OUT.mkdir(parents=True,exist_ok=True)
nodes={};edges=[]
def node(i,label,kind,view,source='',status=None):
 nodes[i]={'id':i,'label':label,'kind':kind,'view':view,'source':source,'status':status or ('conceptual' if kind=='concept' else 'documented' if view in {'workflow','repository'} else 'implemented')}
def edge(a,b,label,kind,source):
 edges.append({'from':a,'to':b,'label':label,'kind':kind,'source':source,'status':'planned' if kind=='planned' else 'conceptual' if kind=='conceptual' else 'documented' if kind in {'inventory','documentation','workflow'} else 'implemented'})
core=[
('agora','Agora MCP','project','runtime','README.md'),
('agent-a','Личный агент A','client','runtime','docs/parallel-testing.md'),
('agent-b','Личный агент B','client','runtime','docs/parallel-testing.md'),
('caddy','Caddy /agora/*','service','runtime','deploy/enable-agora-caddy.py'),
('node','Node 22 · MCP :3011','service','runtime','mcp-server/src/index.ts'),
('postgres','PostgreSQL + pgvector','storage','runtime','db/migrations/001_init.sql'),
('jina','Jina v3 · 1024','provider','runtime','deploy/configure-jina.py'),
('systemd','systemd · user agora','service','runtime','deploy/agora-mcp.service'),
('legacy','Старые MCP :3001/:3002','service','runtime','docs/deploy-shared-domain.md'),
('users','users · token_hash','table','data','db/migrations/002_auth_and_protocol_alignment.sql'),
('items','items · offer / want','table','data','db/migrations/001_init.sql'),
('matches','matches · UNIQUE pair','table','data','db/migrations/002_auth_and_protocol_alignment.sql'),
('auth','Bearer → SHA-256','security','data','mcp-server/src/auth.ts'),
('search','Cosine search + upsert','logic','data','mcp-server/src/db.ts'),
('wire','synapse/v0 item / match','schema','data','mcp-server/src/protocol.ts'),
('issue','Issue','workflow','workflow','CONTRIBUTING.md'),
('branch','Отдельная ветка','workflow','workflow','AGENTS.md'),
('pr','PR + review','workflow','workflow','.github/pull_request_template.md'),
('ci','Build / unit / smoke / docs','workflow','workflow','.github/workflows/ci.yml'),
('main','Защищённая main','workflow','workflow','CONTRIBUTING.md'),
('pages','Статические GitHub Pages','documentation','workflow','.github/workflows/pages.yml'),
('manual','Разрешённый VPS deploy','workflow','workflow','docs/operations.md'),
('noking','NoKing · идеи обмена','concept','ecosystem','README.md'),
('civis','Civis · отдельный проект','concept','ecosystem','README.md'),
('mcp-server','mcp-server · canonical protocol','schema','ecosystem','docs/synapse-protocol.md'),
('synapse','synapse · общий формат','concept','ecosystem','docs/synapse-protocol.md'),
('synapse2','synapse2 · общий формат','concept','ecosystem','docs/synapse-protocol.md'),
]
for args in core:node(*args)
for a,b,l,k,s in [
('agent-a','caddy','HTTPS + token A','runtime','docs/parallel-testing.md'),
('agent-b','caddy','HTTPS + token B','runtime','docs/parallel-testing.md'),
('caddy','node','strip /agora; Host loopback','deployment','deploy/enable-agora-caddy.py'),
('caddy','legacy','existing X-Api-Key routes','deployment','docs/deploy-shared-domain.md'),
('systemd','node','ExecStart / privileges','deployment','deploy/agora-mcp.service'),
('node','postgres','parameterized SQL','runtime','mcp-server/src/db.ts'),
('node','jina','publish text → vector','runtime','mcp-server/src/embeddings.ts'),
('auth','users','hash lookup → owner','security','mcp-server/src/auth.ts'),
('users','items','user_id FK; owns','schema','db/migrations/001_init.sql'),
('items','matches','offer/want FK; pair','schema','db/migrations/001_init.sql'),
('items','search','active; other owner; opposite type','runtime','mcp-server/src/db.ts'),
('search','matches','UPSERT score; keep outcome','runtime','mcp-server/src/db.ts'),
('search','wire','candidate cards + match objects','runtime','mcp-server/src/index.ts'),
('issue','branch','scope first','workflow','AGENTS.md'),
('branch','pr','linked issue','workflow','.github/pull_request_template.md'),
('pr','ci','checks','workflow','.github/workflows/ci.yml'),
('ci','main','review + explicit merge','workflow','CONTRIBUTING.md'),
('main','pages','docs build → deploy','documentation','.github/workflows/pages.yml'),
('main','manual','separate authorization','workflow','docs/operations.md'),
('manual','systemd','runtime update','deployment','docs/operations.md'),
('noking','agora','implementation-first inspiration','conceptual','README.md'),
('civis','agora','separate domain/scope','conceptual','README.md'),
('mcp-server','wire','canonical protocol copy','schema','docs/synapse-protocol.md'),
('synapse','wire','format context; no auto sync','conceptual','docs/synapse-protocol.md'),
('synapse2','wire','format context; no auto sync','conceptual','docs/synapse-protocol.md'),
('wire','agora','implemented item/match subset','schema','mcp-server/src/protocol.ts'),
]:edge(a,b,l,k,s)
# Target platform: explicit planned nodes/edges, never mixed into deployed runtime view.
for args in [
('platform','Полная Agora','project','product','docs/vision.md'),
('market','Маркет offer / want\nсейчас: Stage 0','logic','product','mcp-server/src/index.ts'),
('google','Google identity','concept','product','docs/identity-and-access.md'),
('selfservice','MCP OAuth / аккаунт','concept','product','docs/identity-and-access.md'),
('invites','Приглашения / доступ','concept','product','docs/identity-and-access.md'),
('usage','Учёт / лимиты / кредиты','concept','product','docs/economy.md'),
('payments','Тарифы / оплаты','concept','product','docs/economy.md'),
('republic','Республика','concept','product','docs/governance.md'),
('constitution','Правила и права','concept','governance','docs/governance.md'),
('parliament','Парламент','concept','governance','docs/governance.md'),
('electoral','Избирательные органы','concept','governance','docs/governance.md'),
('courts','Суды','concept','governance','docs/governance.md'),
('appeals','Апелляции / гарантии','concept','governance','docs/governance.md'),
('mandates','Полномочия / мандаты','concept','governance','docs/governance.md'),
('audit','Аудит / приватность','concept','governance','docs/governance.md'),
]:
 node(*args,status='implemented' if args[0]=='market' else 'planned')
nodes['pages']['status']='prepared'
for a,b,label,source in [
('platform','market','первый приоритет','docs/vision.md'),
('google','selfservice','внешний вход','docs/identity-and-access.md'),
('invites','selfservice','политика доступа','docs/identity-and-access.md'),
('selfservice','market','постоянный owner','docs/identity-and-access.md'),
('payments','usage','кредиты / оплата','docs/economy.md'),
('usage','market','лимиты / учёт','docs/economy.md'),
('platform','republic','будущие институты','docs/vision.md'),
('republic','constitution','основание','docs/governance.md'),
('constitution','parliament','законодательство','docs/governance.md'),
('constitution','electoral','выборы','docs/governance.md'),
('constitution','courts','разбирательства','docs/governance.md'),
('parliament','mandates','границы','docs/governance.md'),
('electoral','mandates','мандаты','docs/governance.md'),
('courts','appeals','пересмотр','docs/governance.md'),
('mandates','audit','подотчётность','docs/governance.md'),
('appeals','audit','процедуры / данные','docs/governance.md'),
('selfservice','users','безопасная привязка / миграция','docs/identity-and-access.md'),
('usage','items','ресурсы / публикация','docs/economy.md'),
('republic','market','правила в утверждённых границах','docs/governance.md'),
]: edge(a,b,label,'planned',source)
# Whole repository inventory + explicit TypeScript imports + relative documentation references.
files=[]
for p in ROOT.rglob('*'):
 if not p.is_file():continue
 rel=p.relative_to(ROOT).as_posix()
 if any(part in {'.git','node_modules','__pycache__','_site','dist'} for part in p.relative_to(ROOT).parts):continue
 if rel.startswith('docs/assets/') or rel.endswith('.pyc'):continue
 files.append(rel)
files=sorted(files)
for rel in files:
 node('file:'+rel,rel,'file','repository',rel)
 edge('agora','file:'+rel,'repository member','inventory',rel)
for rel in files:
 if rel.endswith('.ts'):
  for imported in re.findall(r'from\s+["\'](\.[^"\']+)["\']',(ROOT/rel).read_text()):
   target=(ROOT/rel).parent/imported
   target=target.with_suffix('.ts').resolve().relative_to(ROOT).as_posix()
   if target in files:edge('file:'+rel,'file:'+target,'imports','dependency',rel)
 if rel.endswith('.md'):
  for link in re.findall(r'\]\(([^)]+)\)',(ROOT/rel).read_text()):
   if '://' in link or link.startswith('#'):continue
   target=((ROOT/rel).parent/link.split('#')[0]).resolve()
   try:dest=target.relative_to(ROOT).as_posix()
   except ValueError:continue
   if dest in files:edge('file:'+rel,'file:'+dest,'documents / links','documentation',rel)
# Deduplicate deterministic edges.
edges=list({json.dumps(e,sort_keys=True):e for e in edges}.values())
data={'scope':'Repository and deployed market runtime plus explicitly PLANNED public access, economy and republican institutions; conceptual ecosystem is not federation.',
      'nodes':list(nodes.values()),'edges':edges}
(OUT/'project-graph.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
colors={'client':'#E5F2FC','service':'#F0EFED','storage':'#E8F1EC','provider':'#FBEBDE','table':'#E8F1EC','security':'#FCE9E7','logic':'#E5F2FC','schema':'#E5F2FC','workflow':'#F0EFED','documentation':'#E5F2FC','concept':'#FBEBDE','project':'#E5F2FC','file':'#F9F8F7'}
def dot_file(name,ids,selected,rankdir='TB'):
 lines=['digraph G {',f'graph [rankdir={rankdir}, bgcolor="white", pad="0.35", nodesep="0.4", ranksep="0.65", splines=polyline];',
        'node [shape=box, style="rounded,filled", fontname="Arial", fontsize=16, margin="0.2,0.15", color="#E6E5E3", fontcolor="#2C2C2B"];',
        'edge [fontname="Arial", fontsize=13, color="#7D7A75", fontcolor="#55534F", arrowsize=0.7];']
 for i in ids:
  n=nodes[i];label=n['label']+('\n[план]' if n['status']=='planned' else '');lines.append(f'{json.dumps(i)} [label={json.dumps(label,ensure_ascii=False)}, fillcolor="{colors[n["kind"]]}"];')
 for e in selected:
  style='dashed' if e['kind'] in {'conceptual','planned'} else 'solid'
  lines.append(f'{json.dumps(e["from"])} -> {json.dumps(e["to"])} [label={json.dumps(e["label"],ensure_ascii=False)}, style={style}];')
 lines.append('}')
 path=OUT/(name+'.dot');path.write_text('\n'.join(lines)+'\n')
 subprocess.run(['dot','-Tsvg',str(path),'-o',str(OUT/(name+'.svg'))],check=True)
for view in ['runtime','data','workflow','ecosystem','product','governance']:
 ids=[i for i,n in nodes.items() if n['view']==view]
 if view=='ecosystem':ids+=['agora','wire']
 if view=='workflow':ids+=['systemd']
 if view=='governance':ids+=['republic']
 selected=[e for e in edges if e['from'] in ids and e['to'] in ids and not (view=='product' and e['from']=='republic' and e['to']=='market')]
 dot_file('graph-'+view,ids,selected)
# Full graph as editable DOT/JSON and a source file for graph tools; avoid an unreadable overview SVG.
lines=['digraph Project {','graph [rankdir=LR];','node [shape=box];']
for i,n in nodes.items():
 label=n["label"]+("\n[план]" if n["status"]=="planned" else "");lines.append(f'{json.dumps(i)} [label={json.dumps(label,ensure_ascii=False)}];')
for e in edges:
 style="dashed" if e["status"] in {"planned","conceptual"} else "solid";lines.append(f'{json.dumps(e["from"])} -> {json.dumps(e["to"])} [label={json.dumps(e["label"],ensure_ascii=False)}, style={style}];')
lines.append('}')
(OUT/'project-full.dot').write_text('\n'.join(lines)+'\n')
# Mindmap: distinct organizational hierarchy, not inferred runtime dependencies.
branches={
'Маркет — приоритет':['Предлагаю / хочу / совпадения','Свои записи / актуальность','Качество и полезность'],
'Вход — план':['Google → аккаунт Agora','MCP OAuth / полномочия','Телефон / linking позже'],
'Приглашения — план':['Политика доступа к пилоту','Рефералы / стартовые кредиты','Отзыв / сроки / аудит'],
'Экономика — план':['Учёт → лимиты → кредиты','Себестоимость → тарифы','Оплата сервиса, не сделки'],
'Республика — план':['Парламент / инициативы','Избирательные органы','Суды / апелляции'],
'Гарантии — дизайн':['Правила / права / мандаты','Приватность / аудит','Оплата ≠ политические права'],
'Пилот — сейчас':['5 tools / ручной bearer','Node / PG / Caddy / Jina','CI + live; A/B pending'],
'Доставка':['Market-first → safe onboarding','Биллинг после измерений','Институты отдельными этапами'],
}
(OUT/'mindmap-topics.json').write_text(json.dumps(branches,ensure_ascii=False,indent=2)+'\n')
node('mind-root','Agora MCP','project','mindmap')
ids=['mind-root'];me=[]
for index,(label,leaves) in enumerate(branches.items()):
 parent='mind-'+str(index);node(parent,label,'service','mindmap');ids.append(parent);me.append({'from':'mind-root','to':parent,'label':'','kind':'hierarchy'})
 for j,leaf in enumerate(leaves):
  child=parent+'-'+str(j);node(child,leaf,'file','mindmap');ids.append(child);me.append({'from':parent,'to':child,'label':'','kind':'hierarchy'})
dot_file('mindmap',ids,me,'LR')
(OUT/'mindmap.mmd').write_text('mindmap\n  root((Agora MCP))\n'+''.join('    '+k+'\n'+''.join('      '+v+'\n' for v in vals) for k,vals in branches.items()))
print('Generated typed graph, implemented/planned status, 6 readable views and mindmap.')
# Compact, accessible hierarchy: eight topic boxes retain all leaf labels.
svg=['<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="740" viewBox="0 0 1100 740" role="img" aria-labelledby="title desc">','<title id="title">Agora MCP — mindmap</title>','<desc id="desc">Восемь направлений проекта и все дочерние темы.</desc>','<rect width="1100" height="740" fill="white"/>']
for index,(label,leaves) in enumerate(branches.items()):
 x=20 if index<4 else 675;y=20+(index%4)*180
 sx=425 if index<4 else 675;tx=465 if index<4 else 635
 svg.append(f'<path d="M {sx} {y+72} H {445 if index<4 else 655} V 370 H {tx}" fill="none" stroke="#B8B5B0" stroke-width="2"/>')
 svg.append(f'<rect x="{x}" y="{y}" width="405" height="144" rx="12" fill="#F9F8F7" stroke="#E6E5E3"/>')
 svg.append(f'<text x="{x+18}" y="{y+33}" font-family="Arial,sans-serif" font-size="23" font-weight="700" fill="#2C2C2B">{html.escape(label)}</text>')
 for j,leaf in enumerate(leaves):svg.append(f'<text x="{x+18}" y="{y+66+j*28}" font-family="Arial,sans-serif" font-size="20" fill="#55534F">{html.escape(leaf)}</text>')
svg+=['<rect x="465" y="333" width="170" height="74" rx="12" fill="#E5F2FC" stroke="#8DC2E8"/>','<text x="550" y="377" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" font-weight="700" fill="#2C2C2B">Agora MCP</text>','</svg>']
(OUT/'mindmap.svg').write_text('\n'.join(svg)+'\n')
