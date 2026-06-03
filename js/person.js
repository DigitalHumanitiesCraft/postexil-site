const id = new URLSearchParams(location.search).get('id');
const map = L.map('map',{zoomControl:false,attributionControl:false}).setView([48,8],4);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{maxZoom:19}).addTo(map);
addEventListener('resize',()=>map.invalidateSize());

const esc=s=>(s??'').toString().replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const md=s=>esc(s).replace(/\*([^*]+)\*/g,'<em>$1</em>');
const leer=(text,quelle)=>`<div class="leer"><span class="st">NICHT ERFASST</span>
  <span class="tx">${esc(text)}${quelle?` <span class="src">Quelle: ${esc(quelle)}</span>`:''}</span></div>`;
const dedup=arr=>arr.filter((x,i)=>i===0||x[0]!==arr[i-1][0]||x[1]!==arr[i-1][1]);

if(!id){
  document.getElementById('sheet').innerHTML=
    '<p class="lead">Keine Person ausgewählt.</p><p><a href="index.html" class="mono">‹ zurück zur Karte</a></p>';
} else {
  Promise.all([
    fetch(`data/persons/${id}.json`).then(r=>{ if(!r.ok) throw 0; return r.json(); }),
    fetch('data/geo.json').then(r=>r.json())
  ]).then(([p,geo])=>render(p,geo)).catch(()=>{
    document.getElementById('sheet').innerHTML=
      '<p class="lead">Person nicht gefunden.</p><p><a href="index.html" class="mono">‹ zurück zur Karte</a></p>';
  });
}

function render(p,geo){
  document.title=`${p.name.vor} ${p.name.nach} · Post-Exile Translation`;
  const s=document.getElementById('sheet');
  const dates=`<span class="mono">✶ ${p.geb?.jahr??'?'}${p.geb?.ort?' '+esc(p.geb.ort):''}</span>
    <span class="mono">† ${p.tod?.jahr??'?'}${p.tod?.ort?' '+esc(p.tod.ort):''}</span>`;
  const konst = p.konstellation ? `<span class="stamp">${esc(p.konstellation)}</span>` : '';
  let html=`<div class="cat"><span class="kicker">Übersetzer:in · Kartei</span><span class="kicker">Nº ${p.name_id}</span></div>
    <h1 class="name">${esc(p.name.vor)} ${esc(p.name.nach)}</h1>
    <div class="sub">${dates}${konst}</div>`;
  if(p.story_md){
    const paras = p.story_md.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);
    if(paras.length){
      html += `<p class="lead">${md(paras[0])}</p>`;
      if(paras.length>1){
        html += `<section><div class="fl"><span>Einleitung</span><span>Biographie (Entwurf)</span></div>`
          + paras.slice(1).map(t=>`<p style="margin-bottom:14px">${md(t)}</p>`).join('')
          + `</section>`;
      }
    }
  }

  // Stationen
  html+=`<section><div class="fl"><span>Stationen</span><span>Exilstationen-Erfassung</span></div>`;
  if(p.trajectory?.length){
    html+=`<p>${p.trajectory.map(t=>`${esc(t.ort||t.land)}${t.jahr?` (${t.jahr})`:''}`).join(' → ')}</p>`;
  } else html+=leer('Hier stünde der Exil-Weg dieser Person.','Exilstationen-Erfassung');
  html+=`</section>`;

  // Uebersetzungen
  html+=`<section><div class="fl"><span>Übersetzungen</span><span>DLBT + Recherche</span></div>`;
  html+=renderWerke(p);
  html+=`</section>`;

  // Sprachen
  html+=`<section><div class="fl"><span>Sprachen</span><span>Sprachen-Erfassung</span></div>`;
  if(p.sprachen && (p.sprachen.z?.length||p.sprachen.a?.length)){
    html+=`<p>Aus dem ${esc((p.sprachen.a||['?']).join(', '))} ins ${esc((p.sprachen.z||['?']).join(', '))}.</p>`;
  } else html+=leer('Hier stünden die Sprachen, aus denen und in die diese Person übersetzt hat.','Sprachen-Erfassung');
  html+=`</section>`;

  // Weiterfuehrende Links / Provenienz (US-C4): externe Identifier (Wikidata/Wikipedia/DLBT)
  html+=`<section><div class="fl"><span>Weiterführende Links</span><span>Provenienz</span></div>`;
  html+=renderLinks(p);
  html+=`</section>`;
  s.innerHTML=html;

  drawRoute(p,geo); drawLife(p);
}

// Externe Identifier-Links (US-C4). Reihenfolge fix; nur vorhandene Keys werden gezeigt.
// Fehlt der Wikidata-Qid -> In-situ-Leerstelle (konsistent mit der uebrigen Seite).
const LINKLABELS={wikidata:'Wikidata', wikipedia:'Wikipedia', dlbt_translator_query:'DLBT'};
const SAFE_URL=/^https?:\/\//i;   // nur http(s) rendern (defense-in-depth gegen javascript:/data:)
function renderLinks(p){
  const el=p.external_links||{};
  const items=['wikidata','wikipedia','dlbt_translator_query']
    .filter(k=>el[k]&&SAFE_URL.test(el[k]))
    .map(k=>`<a class="xlink" href="${esc(el[k])}" target="_blank" rel="noopener" aria-label="${LINKLABELS[k]} (öffnet in neuem Tab)">${LINKLABELS[k]} <span aria-hidden="true">↗</span></a>`);
  if(!items.length) return leer('Hier stünden Verweise zu Wikidata, Wikipedia und DLBT.','Wikidata-Verknüpfung');
  return `<p class="xlinks">${items.join('')}</p>`;
}

// Werke nach Original (Autor/Titel) gruppieren: Erstausgabe = Werk, spaetere Ausgaben =
// Nachauflagen (DLBT-Jahr ist Ausgabejahr, nicht Erstuebersetzung). Sabine-Cross-References
// (dlbt-Dubletten) raus. Kein stumpfer >=1945-Filter (versteckt sonst Vor-Exil-Werke).
function renderWerke(p){
  const all=(p.werke||[]).filter(x=>!x.cross_reference_of);
  if(!all.length) return leer('Hier stünden die übersetzten Werke dieser Person.','DLBT + Recherche');
  const groups=new Map();
  all.forEach(x=>{ const k=(x.orig_autor||x.titel||'').toLowerCase().trim();
    (groups.get(k)||groups.set(k,[]).get(k)).push(x); });
  const works=[...groups.values()].map(g=>{
    g.sort((a,b)=>(a.jahr||0)-(b.jahr||0));
    const work=g[0];
    const reps=g.slice(1).filter(x=>x.jahr&&work.jahr&&x.jahr>work.jahr);
    return {work,reps};
  }).sort((a,b)=>(a.work.jahr||0)-(b.work.jahr||0));
  return works.map(({work:x,reps})=>{
    const rep=reps.length
      ? `<span class="reps">+ ${reps.length} ${reps.length===1?'Nachauflage':'Nachauflagen'} bis ${Math.max(...reps.map(r=>r.jahr))}</span>` : '';
    return `<div class="work"><span class="yr">${x.jahr??'?'}</span>
      <span><span class="ti">${esc(x.titel)}</span>${rep}<br><span class="me">${esc(x.orig_autor||'')}</span></span>
      <span class="pair">${esc(x.orig_sprache||'?')} → ${esc(x.ziel_sprache||'?')}</span></div>`;
  }).join('');
}

function drawRoute(p,geo){
  const seq=[];
  const g=p.geb&&(geo[p.geb.ort]||geo[p.geb.land]); if(g)seq.push(g);
  (p.trajectory||[]).forEach(t=>{ const c=geo[t.ort]||geo[t.land]; if(c)seq.push(c); });
  const all=dedup(seq);                                  // aufeinanderfolgende gleiche Orte zusammenfassen
  const cap=document.getElementById('tafelcap');
  if(all.length>=2){
    L.polyline(all,{color:'#2d4a5a',weight:2,opacity:.8,dashArray:'2,7'}).addTo(map);
    all.forEach(x=>L.circleMarker(x,{radius:5,color:'#2d4a5a',weight:2,fillColor:'#faf5e9',fillOpacity:1}).addTo(map));
    map.fitBounds(L.latLngBounds(all),{padding:[40,40]});
    cap.textContent=`TAFEL · ${all.length} STATIONEN`;
  } else if(all.length===1){
    L.circleMarker(all[0],{radius:5,color:'#2d4a5a',weight:2,fillColor:'#faf5e9',fillOpacity:1}).addTo(map);
    map.setView(all[0],5);
    cap.textContent='TAFEL · 1 ORT ERFASST';
  } else {
    cap.textContent='TAFEL · KEINE ROUTE ERFASST';
  }
}

const TYP={geburt:'Geburt', tod:'Tod', exil_start:'Beginn des Exils', flucht:'Flucht',
  remigration:'Remigration (Rückkehr)', werks_hoehepunkt:'Höhepunkt der Werkarbeit',
  exil:'Exilstation', wirkung:'Wirkungsort'};

// Lebenslinie: maszstabsgetreu von Geburt bis Tod. Die 1945-Marke sitzt an ihrer ECHTEN
// proportionalen Position (nicht optisch mittig) — sonst wirken die Abstaende verwirrend.
// Punkte = Ereignisse, Hover/Klick zeigt sie in der Zeile darunter. Nur wenn BEIDE Jahre
// erfasst sind, sonst In-situ-Leerstelle (keine erfundene Achse).
function drawLife(p){
  const lab=document.querySelector('.life .lab'), hint=lab.querySelector('.hint');
  const bar=document.getElementById('bar'), yrs=document.getElementById('yrs'), ev=document.getElementById('lifeevent');
  const a=p.geb?.jahr, b=p.tod?.jahr;
  if(!a||!b){
    if(hint) hint.textContent='';
    bar.style.display='none';
    yrs.innerHTML='<span class="src">Lebensdaten nicht vollständig erfasst</span>';
    ev.innerHTML='';
    return;
  }
  const span=Math.max(1,b-a), pct=y=>Math.max(0,Math.min(100,(y-a)/span*100));
  const has45 = a<1945 && b>1945;
  bar.style.display='';
  let inner='';
  if(b>1945) inner+=`<span class="seg45" style="left:${pct(1945)}%"></span>`;
  if(has45)  inner+=`<span class="div45" style="left:${pct(1945)}%"></span>`;
  bar.innerHTML=inner;
  yrs.innerHTML=`<span class="g">${a}</span>`
    +(has45?`<span class="y45" style="left:${pct(1945)}%">1945</span>`:'')
    +`<span class="t">${b}</span>`;

  const events=(p.events||[]).filter(e=>e.jahr);
  const ph='<span class="ph">Punkt auf der Linie für ein Ereignis</span>';
  if(hint) hint.textContent=events.length?'— Punkt anklicken oder überfahren':'';
  ev.innerHTML=events.length?ph:'';
  events.forEach(e=>{
    const m=document.createElement('span');
    m.className='mk'+(e.jahr>=1945?' post':'');
    m.style.left=pct(e.jahr)+'%'; m.tabIndex=0;
    const label=e.label||TYP[e.typ]||'Ereignis';
    m.setAttribute('aria-label',`${e.jahr}: ${label}`);
    const show=()=>{ ev.innerHTML=`<b>${e.jahr}</b> — ${esc(label)}`; };
    const hide=()=>{ ev.innerHTML=ph; };
    m.addEventListener('mouseenter',show); m.addEventListener('focus',show);
    m.addEventListener('mouseleave',hide); m.addEventListener('blur',hide);
    m.addEventListener('click',show);
    bar.appendChild(m);
  });
}
