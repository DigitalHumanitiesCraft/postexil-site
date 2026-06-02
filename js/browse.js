const map = L.map('map',{zoomControl:false,attributionControl:false}).setView([48.5,10],4.3);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{maxZoom:19}).addTo(map);
addEventListener('resize',()=>map.invalidateSize());

const strip=document.getElementById('strip');
const search=document.getElementById('search');
const chip=document.getElementById('chip');
const cap=document.getElementById('cap');
const wegehint=document.getElementById('wegehint');
const places=document.getElementById('places');
const legend=document.getElementById('legend');
const wegeLabel=document.querySelector('.wege');
const wegeChk=document.getElementById('wege');
const flows=L.layerGroup().addTo(map);   // Wege zuerst -> unter den Kreisen
const circles=L.layerGroup().addTo(map);

let people=[];      // alle
let view=[];        // nach Namenssuche
let layer='geb';    // geb | exil | remig | tod | verlag
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
// Verlag/Zone-Ebene (#19): werk-zentriert, Kreis-Farbe = Besatzungszone des Verlagsorts.
// fill-Hex == tokens.css --us/--uk/--fr/--su/--b4 (neutral == --ink2); Legende wird daraus gebaut.
const ZONE={
  US:{fill:'#7d7a3f', label:'US-Zone'},  UK:{fill:'#3f5a7d', label:'UK-Zone'},
  FR:{fill:'#9c5a6b', label:'FR-Zone'},  SU:{fill:'#9a4a3a', label:'SU-Zone'},
  B4:{fill:'#6b5a7d', label:'Berlin/Wien (4 Sektoren)'},
  neutral:{fill:'#6d6453', label:'neutral (Schweiz/Ausland)'},
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
// Verlag/Zone-Ebene: ueber person.pub nach Verlagsort gruppieren. werke = Publikationsakte
// (Reprints mitgezaehlt) -> Kreisgroesse; people = distinkte Uebersetzer:innen am Ort -> Klick-Filter.
function aggregateWerke(list){
  const m=new Map();
  list.forEach(p=>(p.pub||[]).forEach(w=>{
    let g=m.get(w.ort);
    if(!g){g={ort:w.ort,coord:w.coord,zone:w.zone,werke:0,ids:new Set(),people:[]};m.set(w.ort,g);}
    g.werke++;
    if(!g.ids.has(p.name_id)){g.ids.add(p.name_id);g.people.push(p);}
  }));
  return [...m.values()];
}
const STYLE={
  stroke:'#3a332a',                                   // Kreis-Rand + Wege-Linie
  circle:{ rBase:3, rScale:2.3, opacity:.78,          // Radius = rBase + sqrt(n)*rScale
           city:{ weight:1,   dash:null,  fillOpacity:.48 },
           land:{ weight:1.1, dash:'2,3', fillOpacity:.13 } },  // Land-Zentroid: hohl/gestrichelt (ungenauer)
  flow:{ minN:2,                                       // Vollbestand: nur Routen ab minN zeichnen
         wBase:.5, wScale:.8, wMax:6,                  // Linienstaerke = min(wMax, wBase + sqrt(n)*wScale)
         oBase:.12, oScale:.03, oMax:.5 },             // Deckkraft    = min(oMax, oBase + n*oScale)
};
const radius=n=>STYLE.circle.rBase+Math.sqrt(n)*STYLE.circle.rScale;
function renderMap(list){
  circles.clearLayers();
  if(layer==='verlag'){ renderVerlag(list); return; }
  const L0=LAYERS[layer];
  aggregate(list,L0.rolle).sort((a,b)=>b.people.length-a.people.length).forEach(g=>{
    const n=g.people.length, land=g.level==='land';   // Land-Zentroid = ungenauer -> hohl/gestrichelt
    const s=land?STYLE.circle.land:STYLE.circle.city;
    const c=L.circleMarker(g.coord,{radius:radius(n),color:STYLE.stroke,
      weight:s.weight, dashArray:s.dash,
      fillColor:L0.fill, fillOpacity:s.fillOpacity, opacity:STYLE.circle.opacity});
    c.bindTooltip(`${esc(g.ort)}${land?' (nur Land erfasst)':''} · ${n} ${plural(n)} ${L0.verb}`,{direction:'top'});
    c.on('click',e=>{L.DomEvent.stop(e);selectPlace(g,L0.verb);});
    c.addTo(circles);
  });
}
function renderVerlag(list){
  const s=STYLE.circle.city;
  aggregateWerke(list).sort((a,b)=>b.werke-a.werke).forEach(g=>{
    const z=ZONE[g.zone]||ZONE.neutral, w=g.werke;
    const c=L.circleMarker(g.coord,{radius:radius(w),color:STYLE.stroke,
      weight:s.weight, fillColor:z.fill, fillOpacity:s.fillOpacity, opacity:STYLE.circle.opacity});
    c.bindTooltip(`${esc(g.ort)} · ${w} ${w===1?'Übersetzung':'Übersetzungen'} · ${z.label}`,{direction:'top'});
    c.on('click',e=>{L.DomEvent.stop(e);selectVerlag(g);});
    c.addTo(circles);
  });
}

/* ---------- Orts-Liste (tastaturzugaengliche Variante der Kreise, A11y) ---------- */
function renderPlaceList(list){
  if(layer==='verlag'){ renderVerlagList(list); return; }
  const L0=LAYERS[layer];
  const aggs=aggregate(list,L0.rolle).sort((a,b)=>b.people.length-a.people.length);
  if(!aggs.length){ places.innerHTML='<div class="none">Keine Orte in dieser Ebene.</div>'; return; }
  const frag=document.createDocumentFragment();
  aggs.forEach(g=>{
    const n=g.people.length, b=document.createElement('button');
    b.innerHTML=`<span>${esc(g.ort)}${g.level==='land'?' (nur Land)':''}</span><span class="pn">${n}</span>`;
    b.title=`${esc(g.ort)} · ${n} ${plural(n)} ${L0.verb}`;
    b.addEventListener('click',()=>selectPlace(g,L0.verb));
    frag.appendChild(b);
  });
  places.innerHTML=''; places.appendChild(frag);
}
function renderVerlagList(list){
  const aggs=aggregateWerke(list).sort((a,b)=>b.werke-a.werke);
  if(!aggs.length){ places.innerHTML='<div class="none">Keine Verlagsorte.</div>'; return; }
  const frag=document.createDocumentFragment();
  aggs.forEach(g=>{
    const z=ZONE[g.zone]||ZONE.neutral, b=document.createElement('button');
    b.innerHTML=`<span>${esc(g.ort)}</span><span class="pn">${g.werke}</span>`;
    b.title=`${esc(g.ort)} · ${g.werke} Übersetzungen · ${z.label}`;
    b.addEventListener('click',()=>selectVerlag(g));
    frag.appendChild(b);
  });
  places.innerHTML=''; places.appendChild(frag);
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
  const F=STYLE.flow;
  edges(list).filter(e=>!full||e.n>=F.minN).sort((x,y)=>x.n-y.n).forEach(e=>{
    L.polyline([e.a,e.b],{color:STYLE.stroke,weight:Math.min(F.wMax,F.wBase+Math.sqrt(e.n)*F.wScale),
      opacity:Math.min(F.oMax,F.oBase+e.n*F.oScale)}).addTo(flows);
  });
}

/* ---------- Ortsfilter (Klick auf Kreis) ---------- */
function selectPlace(g,verb){
  renderStrip(g.people);
  chip.innerHTML=`<b>${esc(g.ort)}</b> · ${g.people.length} ${plural(g.people.length)} ${verb} <span class="x">alle&nbsp;✕</span>`;
  chip.style.display='inline-flex';
}
function selectVerlag(g){
  renderStrip(g.people);
  const n=g.people.length;
  chip.innerHTML=`<b>${esc(g.ort)}</b> · ${n} ${n===1?'Übersetzer:in':'Übersetzer:innen'} hier verlegt <span class="x">alle&nbsp;✕</span>`;
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
  const verlag=l==='verlag';
  legend.style.display=verlag?'flex':'none';
  wegeLabel.style.display=verlag?'none':'flex';   // Wege sind route-basiert -> fuer Werk-Ebene aus
  if(verlag){
    if(wege){ wege=false; wegeChk.checked=false; }   // evtl. aktive Wege ausschalten
    const np=people.filter(p=>(p.pub||[]).length).length;
    const nw=people.reduce((s,p)=>s+(p.pub||[]).length,0);
    cap.innerHTML=`Kreis = <b>Verlagsort</b>, Farbe = Besatzungszone, Größe = Zahl der Übersetzungen.`
      +`<br>${nw} DLBT-Übersetzungen 1945–60 von ${np} von ${people.length} Personen`;
  }else{
    const L0=LAYERS[l];
    const placed=people.filter(p=>(p.route||[]).some(n=>n.rolle===L0.rolle)).length;
    cap.innerHTML=`Kreis = <b>${L0.noun}</b>, Größe = Anzahl Personen.<br>${placed} von ${people.length} ${L0.suffix}`
      +(noPlace?`<br><span class="muted">${noPlace} ohne verortbaren Ort — nur in der Kartei-Leiste</span>`:'');
  }
  chip.style.display='none';
  renderMap(view); renderFlows(view); renderPlaceList(view);
}
document.querySelectorAll('.toggle button').forEach(b=>b.addEventListener('click',()=>setLayer(b.dataset.l)));
wegeChk.addEventListener('change',e=>{ wege=e.target.checked; renderFlows(view); });
legend.innerHTML=Object.values(ZONE).map(z=>`<span><i style="background:${z.fill}"></i>${esc(z.label)}</span>`).join('');

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
    renderStrip(view, emptyMsgFor()); renderMap(view); renderFlows(view); renderPlaceList(view);
  },110);
});
