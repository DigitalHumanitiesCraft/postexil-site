// Geteiltes Kopf-Menue (alle Seiten): ☰ oeffnet/schliesst, Klick ausserhalb + Escape schliessen.
const mb=document.getElementById('menubtn'), ml=document.getElementById('menulist');
if(mb&&ml){
  const close=()=>{ ml.classList.remove('open'); mb.setAttribute('aria-expanded','false'); };
  mb.addEventListener('click',e=>{ e.stopPropagation();
    const o=ml.classList.toggle('open'); mb.setAttribute('aria-expanded',o?'true':'false'); });
  document.addEventListener('click',close);
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&ml.classList.contains('open')){ close(); mb.focus(); } });
}
