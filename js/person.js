const id = new URLSearchParams(location.search).get('id');
const map = L.map('map',{zoomControl:false,attributionControl:false}).setView([48,8],4);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{maxZoom:19}).addTo(map);

const esc=s=>(s??'').toString().replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const md=s=>esc(s).replace(/\*([^*]+)\*/g,'<em>$1</em>');
const leer=(field,src,text)=>`<div class="leer"><span class="st">NICHT ERFASST</span>
  <span class="tx">${text} Quelle: <code>${src}</code>.</span></div>`;

Promise.all([
  fetch(`data/persons/${id}.json`).then(r=>r.json()),
  fetch('data/geo.json').then(r=>r.json())
]).then(([p,geo])=>render(p,geo)).catch(()=>{
  document.getElementById('sheet').innerHTML='<p class="lead">Person nicht gefunden.</p>';
});

function render(p,geo){
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
        html += `<section><div class="fl"><span>Einleitung</span><span class="mono">raw-md</span></div>`
          + paras.slice(1).map(t=>`<p style="margin-bottom:14px">${md(t)}</p>`).join('')
          + `</section>`;
      }
    }
  }

  // Stationen
  html+=`<section><div class="fl"><span>Stationen</span><span class="mono">tab_exilstationen</span></div>`;
  if(p.trajectory?.length){
    html+=`<p>${p.trajectory.map(t=>`${esc(t.ort||t.land)}${t.jahr?` (${t.jahr})`:''}`).join(' → ')}</p>`;
  } else html+=leer('trajectory','tab_exilstationen','Hier stünde die Exil-Trajektorie dieser Person.');
  html+=`</section>`;

  // Werke
  html+=`<section><div class="fl"><span>Werke nach 1945</span><span class="mono">DLBT · Sabine</span></div>`;
  const w=(p.werke||[]).filter(x=>!x.jahr||x.jahr>=1945);
  if(w.length){
    html+=w.map(x=>`<div class="work"><span class="yr">${x.jahr??''}</span>
      <span><span class="ti">${esc(x.titel)}</span><br><span class="me">${esc(x.orig_autor||'')}</span></span>
      <span class="pair">${esc(x.orig_sprache||'?')} → ${esc(x.ziel_sprache||'?')}</span></div>`).join('');
  } else html+=leer('werke','DLBT / Sabine','Hier stünden die übersetzten Werke nach 1945.');
  html+=`</section>`;

  // Sprachen
  html+=`<section><div class="fl"><span>Sprachen</span><span class="mono">tab_sprachen</span></div>`;
  if(p.sprachen && (p.sprachen.z?.length||p.sprachen.a?.length)){
    html+=`<p>Zielsprache: ${esc((p.sprachen.z||[]).join(', '))} · Ausgangssprachen: ${esc((p.sprachen.a||[]).join(', '))}</p>`;
  } else html+=leer('sprachen','tab_sprachen','Hier stünden die Sprachpaare (z-/a-Sprache) dieser Person.');
  html+=`</section>`;
  s.innerHTML=html;

  // Karte + Lebenslinie
  drawRoute(p,geo); drawLife(p);
}

function drawRoute(p,geo){
  const pts=(p.trajectory||[]).map(t=>geo[t.ort]||geo[t.land]).filter(Boolean);
  const all=[]; const g=p.geb&&(geo[p.geb.ort]||geo[p.geb.land]); if(g)all.push(g);
  pts.forEach(x=>all.push(x));
  if(all.length>=2){
    L.polyline(all,{color:'#2d4a5a',weight:2,opacity:.8,dashArray:'2,7'}).addTo(map);
    all.forEach(x=>L.circleMarker(x,{radius:5,color:'#2d4a5a',weight:2,fillColor:'#faf5e9',fillOpacity:1}).addTo(map));
    map.fitBounds(L.latLngBounds(all),{padding:[40,40]});
    document.getElementById('tafelcap').textContent=`TAFEL · ${all.length} STATIONEN`;
  } else {
    document.getElementById('tafelcap').textContent='TAFEL · KEINE ROUTE ERFASST';
  }
}

function drawLife(p){
  const a=p.geb?.jahr||1900, b=p.tod?.jahr||1970, span=Math.max(1,b-a);
  const pct=y=>Math.max(0,Math.min(100,(y-a)/span*100));
  const bar=document.getElementById('bar');
  if(b>1945) bar.innerHTML=`<span class="seg45" style="left:${pct(1945)}%"></span>`;
  (p.events||[]).forEach(e=>{
    const m=document.createElement('span');
    m.className='mk'+(e.jahr>=1945?' post':'');
    m.style.left=pct(e.jahr)+'%'; bar.appendChild(m);
  });
  document.getElementById('yrs').innerHTML=`<span>${a}</span><span>1945</span><span>${b}</span>`;
}
