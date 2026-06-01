const map = L.map('map',{zoomControl:false,attributionControl:false}).setView([48.5,10],4.3);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{maxZoom:19}).addTo(map);
addEventListener('resize',()=>map.invalidateSize());

const strip=document.getElementById('strip');
const search=document.getElementById('search');
const chip=document.getElementById('chip');
const cap=document.getElementById('cap');
const wegehint=document.getElementById('wegehint');
const flows=L.layerGroup().addTo(map);   // Wege zuerst -> unter den Kreisen
const circles=L.layerGroup().addTo(map);

let people=[];      // alle
let view=[];        // nach Namenssuche
let layer='geb';    // geb | exil | remig | tod
let wege=false;
let noPlace=0;      // Personen ohne verortbaren Ort
let lastQuery='';

const esc=s=>(s??'').toString().replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const plural=n=>n===1?'Person':'Personen';

const LAYERS={
  geb:  {rolle:'Geburt',      fill:'#7a6f59', verb:'geboren',       noun:'Geburtsort',   suffix:'verortet'},
  exil: {rolle:'Exil',        fill:'#5f7a86', verb:'im Exil',       noun:'Exilstation',  suffix:'mit Exil'},
  remig:{rolle:'Remigration', fill:'#5f8a64', verb:'zurückgekehrt', noun:'Rückkehr-Ort', suffix:'mit Rückkehr-Daten'},
  tod:  {rolle:'Tod',         fill:'#8a6f86', verb:'gestorben',     noun:'Sterbeort',    suffix:'mit Sterbeort'},
};

/* ---------- Strip (Kartei-Karten) ---------- */
function ordered(list){
  const sorted=list.slice().sort((a,b)=>(a.nach||'').localeCompare(b.nach||'','de'));
  const gold=sorted.filter(p=>p.gold).sort((a,b)=>a.name_id-b.name_id);
  return [...gold, ...sorted.filter(p=>!p.gold)];
}
function card(p){
  const a=document.createElement('a');
  a.href=`person.html?id=${p.name_id}`;
  a.className='card'+(p.gold?' gold':'');
  const yr=(p.geb_jahr||p.tod_jahr)?`${p.geb_jahr??'?'}–${p.tod_jahr??'?'}`:'Lebensdaten n. e.';
  const tag=p.gold?'<span class="tag">ausgearbeitet</span>':'';
  a.innerHTML=tag+`<span class="no">Nº ${p.name_id}</span>`
    +`<span class="nm">${esc(p.nach)}<br><span class="vn">${esc(p.vor)}</span></span>`
    +`<span class="yr">${yr}</span>`;
  return a;
}
function renderStrip(list, emptyMsg){
  if(!list.length){ strip.innerHTML=`<div class="empty">${emptyMsg||'Keine Personen.'}</div>`; return; }
  const frag=document.createDocumentFragment();
  ordered(list).forEach(p=>frag.appendChild(card(p)));
  strip.innerHTML=''; strip.appendChild(frag); strip.scrollLeft=0;
}
function emptyMsgFor(){ return lastQuery?`Keine Person zu „${esc(lastQuery)}" gefunden — Suche leeren.`:'Keine Personen.'; }

/* ---------- Orts-Ebenen (Aggregat-Kreise je Rolle) ---------- */
function aggregate(list,rolle){
  const m=new Map();
  list.forEach(p=>(p.route||[]).forEach(n=>{
    if(n.rolle!==rolle) return;
    let g=m.get(n.ort);
    if(!g){g={ort:n.ort,coord:n.coord,level:n.level,ids:new Set(),people:[]};m.set(n.ort,g);}
    if(!g.ids.has(p.name_id)){g.ids.add(p.name_id);g.people.push(p);}
  }));
  return [...m.values()];
}
const radius=n=>3+Math.sqrt(n)*2.3;
function renderMap(list){
  circles.clearLayers();
  const L0=LAYERS[layer];
  aggregate(list,L0.rolle).sort((a,b)=>b.people.length-a.people.length).forEach(g=>{
    const n=g.people.length, land=g.level==='land';   // Land-Zentroid = ungenauer -> hohl/gestrichelt
    const c=L.circleMarker(g.coord,{radius:radius(n),color:'#3a332a',
      weight:land?1.1:1, dashArray:land?'2,3':null,
      fillColor:L0.fill, fillOpacity:land?.13:.48, opacity:.78});
    c.bindTooltip(`${esc(g.ort)}${land?' (nur Land erfasst)':''} · ${n} ${plural(n)} ${L0.verb}`,{direction:'top'});
    c.on('click',e=>{L.DomEvent.stop(e);selectPlace(g,L0.verb);});
    c.addTo(circles);
  });
}

/* ---------- Wege (aggregierte Routen-Linien) ---------- */
function edges(list){
  const m=new Map();
  list.forEach(p=>{
    const r=p.route||[];
    for(let i=0;i<r.length-1;i++){
      const a=r[i].coord,b=r[i+1].coord;
      if(a[0]===b[0]&&a[1]===b[1]) continue;           // Selbst-Schleife
      const k=a.join(',')+'>'+b.join(',');
      let e=m.get(k); if(!e){e={a,b,n:0};m.set(k,e);}
      e.n++;
    }
  });
  return [...m.values()];
}
function renderFlows(list){
  flows.clearLayers();
  wegehint.style.display=wege?'block':'none';
  if(!wege) return;
  const full=list.length===people.length;             // Vollbestand: Einzelkanten ausduennen
  edges(list).filter(e=>!full||e.n>=2).sort((x,y)=>x.n-y.n).forEach(e=>{
    L.polyline([e.a,e.b],{color:'#3a332a',weight:Math.min(6,.5+Math.sqrt(e.n)*.8),
      opacity:Math.min(.5,.12+e.n*.03)}).addTo(flows);
  });
}

/* ---------- Ortsfilter (Klick auf Kreis) ---------- */
function selectPlace(g,verb){
  renderStrip(g.people);
  chip.innerHTML=`<b>${esc(g.ort)}</b> · ${g.people.length} ${plural(g.people.length)} ${verb} <span class="x">alle&nbsp;✕</span>`;
  chip.style.display='inline-flex';
}
function clearPlace(){ chip.style.display='none'; renderStrip(view, emptyMsgFor()); }
map.on('click',clearPlace);
chip.addEventListener('click',clearPlace);

/* ---------- Ebenen-Umschalter + Wege-Schalter ---------- */
function setLayer(l){
  layer=l;
  document.querySelectorAll('.toggle button').forEach(b=>{
    const on=b.dataset.l===l; b.classList.toggle('on',on); b.setAttribute('aria-pressed',on?'true':'false');
  });
  const L0=LAYERS[l];
  const placed=people.filter(p=>(p.route||[]).some(n=>n.rolle===L0.rolle)).length;
  cap.innerHTML=`Kreis = <b>${L0.noun}</b>, Größe = Anzahl Personen.<br>${placed} von ${people.length} ${L0.suffix}`
    +(noPlace?`<br><span class="muted">${noPlace} ohne verortbaren Ort — nur in der Kartei-Leiste</span>`:'');
  chip.style.display='none';
  renderMap(view); renderFlows(view);
}
document.querySelectorAll('.toggle button').forEach(b=>b.addEventListener('click',()=>setLayer(b.dataset.l)));
document.getElementById('wege').addEventListener('change',e=>{ wege=e.target.checked; renderFlows(view); });

/* ---------- Laden + Suche ---------- */
fetch('data/index.json').then(r=>{ if(!r.ok) throw 0; return r.json(); }).then(d=>{
  people=d; view=people;
  noPlace=people.filter(p=>!(p.route||[]).length).length;
  renderStrip(view); setLayer('geb');
}).catch(()=>{
  strip.innerHTML='<div class="empty">Daten konnten nicht geladen werden. Bitte die Seite über einen lokalen Server öffnen (nicht per Doppelklick / <code>file://</code>).</div>';
  cap.textContent='Keine Daten geladen.';
});

let t;
search.addEventListener('input',e=>{
  const q=e.target.value.toLowerCase().trim(); lastQuery=e.target.value.trim();
  clearTimeout(t);
  t=setTimeout(()=>{
    view = q ? people.filter(p=>(`${p.vor||''} ${p.nach||''}`).toLowerCase().includes(q)) : people;
    chip.style.display='none';
    renderStrip(view, emptyMsgFor()); renderMap(view); renderFlows(view);
  },110);
});
