'use strict';
(()=>{
 let recent=[];try{recent=JSON.parse(localStorage.getItem('mathmusic-song-names')||'[]');if(!Array.isArray(recent))recent=[];}catch{}
 recent=recent.filter(x=>x&&typeof x.title==='string'&&typeof x.artist==='string').slice(0,30);
 const seed=[{title:'Elaheh Naaz',artist:'Moein'}];
 const remember=()=>{const title=$('songTitle').value.trim(),artist=$('songArtist').value.trim();if(!title)return;recent=[{title,artist},...recent.filter(x=>x.title!==title||x.artist!==artist)].slice(0,30);try{localStorage.setItem('mathmusic-song-names',JSON.stringify(recent));}catch{}};
 $('findSong').addEventListener('click',remember);
 for(const [field,boxId,kind] of [['songTitle','titleSuggestions','song'],['songArtist','artistSuggestions','artist']]){
  const input=$(field),box=$(boxId);let timer,version=0,controller,selected=-1;
  input.setAttribute('aria-controls',boxId);input.setAttribute('aria-expanded','false');input.setAttribute('aria-autocomplete','list');
  const close=()=>{box.hidden=true;input.setAttribute('aria-expanded','false');selected=-1;};
  const draw=items=>{
   box.replaceChildren();const seen=new Set();
   for(const item of items){
    const label=kind==='song'?item.title+' — '+item.artist:item.artist;if(seen.has(label))continue;seen.add(label);
    const button=document.createElement('button');button.type='button';button.textContent=label;
    button.onclick=()=>{if(kind==='song'){$('songTitle').value=item.title;$('songArtist').value=item.artist;}else $('songArtist').value=item.artist;remember();version++;controller?.abort();close();$('suggestHint').textContent='Selected. Click Find song & make graph to search for a MIDI arrangement.';};
    box.append(button);if(box.children.length===8)break;
   }
   selected=-1;box.hidden=!box.children.length;input.setAttribute('aria-expanded',String(!box.hidden));
  };
  const update=()=>{
   clearTimeout(timer);controller?.abort();const ticket=++version,q=input.value.trim().toLocaleLowerCase();
   const local=[...recent,...seed].filter(x=>(kind==='song'?x.title:x.artist).toLocaleLowerCase().includes(q));
   if(q.length<2){close();return;}draw(local);
   if(q.length<3)return;
   timer=setTimeout(async()=>{
    controller=new AbortController();
    try{
     const response=await fetch('/api/suggest?'+new URLSearchParams({q:input.value.trim(),kind,artist:kind==='song'?$('songArtist').value.trim():''}),{signal:controller.signal});
     if(!response.ok)throw Error('Unavailable');const data=await response.json();if(ticket!==version)return;
     draw([...local,...(data.items||[])]);$('suggestHint').textContent=data.message||'Select a suggestion. This identifies a song; it does not guarantee a MIDI exists.';
    }catch(e){if(ticket===version&&e.name!=='AbortError')$('suggestHint').textContent='Online suggestions unavailable. You can still type a name or choose a recent suggestion.';}
   },900);
  };
  input.addEventListener('input',update);input.addEventListener('focus',update);
  input.addEventListener('keydown',e=>{
   if(e.key==='Escape'){version++;controller?.abort();close();return;}
   const buttons=[...box.children];if(box.hidden||!buttons.length)return;
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();selected=(selected+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons.forEach((b,i)=>b.classList.toggle('suggest-selected',i===selected));}
   else if(e.key==='Enter'&&selected>=0){e.preventDefault();buttons[selected].click();}
  });
  document.addEventListener('pointerdown',e=>{if(e.target!==input&&!box.contains(e.target)){version++;clearTimeout(timer);controller?.abort();close();}});
 }
})();
