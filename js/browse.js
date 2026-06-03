const map = L.map('map',{zoomControl:false,attributionControl:false}).setView([48.5,10],4.3);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{maxZoom:19}).addTo(map);
addEventListener('resize',()=>map.invalidateSize());

const strip=document.getElementById('strip');
const search=document.getElementById('search');
const chip=document.getElementById('chip');
const cap=document.getElementById('cap');
const wegehint=document.getElementById('wegehint');
const places=document.getElementById('places');
const langSel=document.getElementById('lang');
const ymin=document.getElementById('ymin'), ymax=document.getElementById('ymax');
const rlo=document.getElementById('rlo'), rhi=document.getElementById('rhi');
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
let lang='';        // aktive Ausgangssprache ('' = alle)
let Y0=0, Y1=0;     // globale Jahres-Grenzen (min/max aller Stations-/Werks-Jahre)

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
    if(!inWindow(n.jahr)) return;            // Zeitraum-Filter (US-C3): nur Stationen im Fenster
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
    if(!inWindow(w.jahr)) return;            // Zeitraum-Filter (US-C3): nur Werke im Fenster
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
function clearPlace(){ chip.style.display='none'; renderStrip(stripList(), emptyMsgFor()); }  // stripList: bei aktivem Zeitfilter konsistent zur Karte
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
  if(verlag && wege){ wege=false; wegeChk.checked=false; }   // evtl. aktive Wege ausschalten
  chip.style.display='none';
  apply();
}
document.querySelectorAll('.toggle button').forEach(b=>b.addEventListener('click',()=>setLayer(b.dataset.l)));
wegeChk.addEventListener('change',e=>{ wege=e.target.checked; renderFlows(view); writeURL(); });
legend.innerHTML=Object.values(ZONE).map(z=>`<span><i style="background:${z.fill}"></i>${esc(z.label)}</span>`).join('');
langSel.addEventListener('change',e=>{ lang=e.target.value; chip.style.display='none'; apply(); });
[ymin,ymax].forEach(s=>s.addEventListener('input',e=>{ clampRange(e); chip.style.display='none'; apply(); }));

/* ---------- Filter-Pipeline (Name + Sprache) ---------- */
function buildLangs(){
  const c=new Map();
  people.forEach(p=>(p.langs_a||[]).forEach(l=>c.set(l,(c.get(l)||0)+1)));
  [...c.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'de')).forEach(([l,n])=>{
    const o=document.createElement('option'); o.value=l; o.textContent=`${l} (${n})`; langSel.appendChild(o);
  });
}
function yearBounds(){
  let lo=Infinity, hi=-Infinity;
  people.forEach(p=>{
    (p.route||[]).forEach(n=>{ if(n.jahr){ lo=Math.min(lo,n.jahr); hi=Math.max(hi,n.jahr); } });
    (p.pub||[]).forEach(w=>{ if(w.jahr){ lo=Math.min(lo,w.jahr); hi=Math.max(hi,w.jahr); } });
  });
  return [lo===Infinity?1900:lo, hi===-Infinity?2000:hi];
}
function initRange(){
  [Y0,Y1]=yearBounds();
  [ymin,ymax].forEach(s=>{ s.min=Y0; s.max=Y1; });
  ymin.value=Y0; ymax.value=Y1; rlo.textContent=Y0; rhi.textContent=Y1;
}
const inWindow=j=>j!=null && j>=+ymin.value && j<=+ymax.value;
const timeActive=()=>+ymin.value>Y0 || +ymax.value<Y1;
function clampRange(e){
  let lo=+ymin.value, hi=+ymax.value;
  if(lo>hi){ if(e.target===ymin) ymax.value=hi=lo; else ymin.value=lo=hi; }
  rlo.textContent=lo; rhi.textContent=hi;
}
function computeView(){
  const q=lastQuery.toLowerCase();
  view=people.filter(p=>{
    if(q && !(`${p.vor||''} ${p.nach||''}`).toLowerCase().includes(q)) return false;
    if(lang && !(p.langs_a||[]).includes(lang)) return false;
    return true;
  });
}
function personInWindow(p){
  if(layer==='verlag') return (p.pub||[]).some(w=>inWindow(w.jahr));
  const rolle=LAYERS[layer].rolle;
  return (p.route||[]).some(n=>n.rolle===rolle && inWindow(n.jahr));
}
// Karte zeigt Marker im Fenster (via aggregate/inWindow); die Leiste die zugehoerigen Personen.
function stripList(){ return timeActive() ? view.filter(personInWindow) : view; }
function renderAll(){
  updateCap();
  renderMap(view); renderFlows(view); renderPlaceList(view);
  if(chip.style.display==='none') renderStrip(stripList(), emptyMsgFor());
}
function apply(){ computeView(); renderAll(); writeURL(); }
let urlT;
function writeURL(){
  const u=new URLSearchParams();
  if(layer!=='geb') u.set('layer',layer);
  if(lastQuery) u.set('q',lastQuery);
  if(lang) u.set('lang',lang);
  if(+ymin.value>Y0) u.set('von',ymin.value);
  if(+ymax.value<Y1) u.set('bis',ymax.value);
  if(wege) u.set('wege','1');
  const qs=u.toString();
  clearTimeout(urlT);
  urlT=setTimeout(()=>history.replaceState(null,'',qs?`?${qs}`:location.pathname),150);
}
function readURL(){
  const u=new URLSearchParams(location.search);
  if(u.get('q')){ lastQuery=u.get('q'); search.value=lastQuery; }
  if(u.get('lang')){ lang=u.get('lang'); langSel.value=lang; if(langSel.value!==lang) lang=''; }  // unbekannte Sprache -> ignorieren
  if(u.get('von')){ ymin.value=Math.max(Y0,Math.min(Y1,+u.get('von')||Y0)); }   // NaN-fest (hand-editierte URL)
  if(u.get('bis')){ ymax.value=Math.max(Y0,Math.min(Y1,+u.get('bis')||Y1)); }
  rlo.textContent=ymin.value; rhi.textContent=ymax.value;
  if(u.get('wege')==='1'){ wege=true; wegeChk.checked=true; }
  return u.get('layer')||'geb';
}
function undatedInLayer(){
  if(layer==='verlag') return view.reduce((s,p)=>s+(p.pub||[]).filter(w=>!w.jahr).length,0);
  const rolle=LAYERS[layer].rolle;
  return view.reduce((s,p)=>s+(p.route||[]).filter(n=>n.rolle===rolle&&!n.jahr).length,0);
}
function updateCap(){
  if(layer==='verlag'){
    const np=people.filter(p=>(p.pub||[]).length).length;
    const nw=people.reduce((s,p)=>s+(p.pub||[]).length,0);
    cap.innerHTML=`Kreis = <b>Verlagsort</b>, Farbe = Besatzungszone, Größe = Zahl der Übersetzungen.`
      +`<br>${nw} DLBT-Übersetzungen 1945–60 von ${np} von ${people.length} Personen`;
  }else{
    const L0=LAYERS[layer];
    const placed=people.filter(p=>(p.route||[]).some(n=>n.rolle===L0.rolle)).length;
    cap.innerHTML=`Kreis = <b>${L0.noun}</b>, Größe = Anzahl Personen.<br>${placed} von ${people.length} ${L0.suffix}`
      +(noPlace?`<br><span class="muted">${noPlace} ohne verortbaren Ort — nur in der Kartei-Leiste</span>`:'');
  }
  if(timeActive()){
    const u=undatedInLayer();
    cap.innerHTML+=`<br><span class="muted">Zeitraum ${ymin.value}–${ymax.value}`
      +(u?` · ${u} undatierte ausgeblendet`:'')+`</span>`;
  }
}

/* ---------- Laden + Suche ---------- */
fetch('data/index.json').then(r=>{ if(!r.ok) throw 0; return r.json(); }).then(d=>{
  people=d; view=people;
  noPlace=people.filter(p=>!(p.route||[]).length).length;
  buildLangs(); initRange();
  const startLayer=readURL();   // URL VOR initialem Render anwenden
  setLayer(startLayer);
}).catch(()=>{
  strip.innerHTML='<div class="empty">Daten konnten nicht geladen werden. Bitte die Seite über einen lokalen Server öffnen (nicht per Doppelklick / <code>file://</code>).</div>';
  cap.textContent='Keine Daten geladen.';
});

let t;
search.addEventListener('input',e=>{
  lastQuery=e.target.value.trim();
  clearTimeout(t);
  t=setTimeout(()=>{ chip.style.display='none'; apply(); },110);
});

addEventListener('popstate',()=>{
  langSel.value=''; lang=''; lastQuery=''; search.value='';
  ymin.value=Y0; ymax.value=Y1; rlo.textContent=Y0; rhi.textContent=Y1;
  wege=false; wegeChk.checked=false;
  setLayer(readURL());
});
