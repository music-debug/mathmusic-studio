(()=>{
const defaults={theme:'dark',accent:'green',text:'normal',density:'comfortable'},allowed={theme:['dark','light','system'],accent:['green','blue','purple','pink','orange'],text:['normal','large','larger'],density:['comfortable','compact']};
let prefs={...defaults};try{const saved=JSON.parse(localStorage.getItem('mathmusic-ui')||'{}');for(const key in defaults)if(allowed[key].includes(saved[key]))prefs[key]=saved[key];}catch{}
const media=matchMedia('(prefers-color-scheme: light)');
function apply(){const body=document.body;body.dataset.theme=prefs.theme==='system'?(media.matches?'light':'dark'):prefs.theme;body.dataset.text=prefs.text;body.dataset.density=prefs.density;body.dataset.accent=prefs.accent;for(const key in defaults)document.getElementById('ui'+key[0].toUpperCase()+key.slice(1)).value=prefs[key];try{localStorage.setItem('mathmusic-ui',JSON.stringify(prefs));}catch{}}
for(const key in defaults)document.getElementById('ui'+key[0].toUpperCase()+key.slice(1)).onchange=e=>{prefs[key]=e.target.value;apply();};
document.getElementById('resetUi').onclick=()=>{prefs={...defaults};apply();};media.addEventListener?.('change',apply);apply();
})();
