const map = L.map('map',{zoomControl:false,attributionControl:false}).setView([48.5,9],4.3);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{maxZoom:19}).addTo(map);

const tones=["#9a9088","#8a8f93","#9c958b","#888d8a","#94908c","#9a928a","#8d9290","#969088"];
const strip=document.getElementById('strip');
const search=document.getElementById('search');
let people=[];

function tile(p,i){
  const a=document.createElement('a');
  a.href=`person.html?id=${p.name_id}`;
  a.className='face';
  a.title=`${p.vor} ${p.nach} (${p.geb_jahr??'?'}–${p.tod_jahr??'?'})`;
  a.style.background = p.portrait ? `url(${p.portrait})`
      : `linear-gradient(150deg,${tones[i%tones.length]},#5f5f5c)`;
  return a;
}
function render(list){
  strip.innerHTML='';
  list.slice(0,120).forEach((p,i)=>strip.appendChild(tile(p,i)));
}
fetch('data/index.json').then(r=>r.json()).then(d=>{
  people=d; render(people);
});
search.addEventListener('input',e=>{
  const q=e.target.value.toLowerCase().trim();
  render(people.filter(p=>(`${p.vor} ${p.nach}`).toLowerCase().includes(q)));
});
