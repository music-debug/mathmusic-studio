'use strict';
let midiSong=null;
function trackGroup(track,index,lead){
 if(index===lead)return 1;
 const mean=track.notes.reduce((sum,n)=>sum+n[2],0)/Math.max(1,track.notes.length);
 return /bass/i.test(track.name)||(track.program>=32&&track.program<=39)||mean<52?0:/pad|string|choir|chord/i.test(track.name)||(track.program>=40&&track.program<=55)?2:3;
}
function showMidiMix(){
 const box=$('midiMix');box.replaceChildren();if(!midiSong)return;
 midiSong.tracks.forEach((track,i)=>{
  const row=document.createElement('div'),label=document.createElement('label'),check=document.createElement('input'),volume=document.createElement('input');
  check.type='checkbox';check.id='midiOn'+i;check.checked=true;label.append(check,document.createTextNode(' '+track.name+' · ch '+(track.channel+1)));
  volume.type='range';volume.id='midiGain'+i;volume.min=0;volume.max=100;volume.value=i===+$('midiTrack').value?100:trackGroup(track,i,+$('midiTrack').value)===0?75:40;
  volume.setAttribute('aria-label',track.name+' volume');row.append(label,volume);box.append(row);
 });
}
$('midiTrack').onchange=showMidiMix;

function loadMidi(buffer,name,automatic=false){
 loadParsedScore(MidiNotes.parse(buffer),name,automatic);
}
function loadParsedScore(song,name,automatic=false){
 midiSong=song;
 if(!midiSong.tracks.length)throw Error('This MIDI has no pitched melody tracks.');
 const select=$('midiTrack');select.replaceChildren();midiSong.tracks.forEach((track,i)=>{const option=document.createElement('option');option.value=i;option.textContent=track.name+' · channel '+(track.channel+1)+' · '+track.notes.length+' notes';select.append(option);});
 const scored=midiSong.tracks.map((t,i)=>{
  const notes=t.notes, pitches=notes.map(n=>n[2]).sort((a,b)=>a-b),median=pitches[Math.floor(pitches.length/2)]||0;
  let overlap=0,end=-1;for(const n of notes){if(n[0]<end-.03)overlap++;end=Math.max(end,n[1]);}
  const named=/melody|vocal|lead|voice|sing/i.test(t.name)?15:0;
  return {i,score:named+(median>=55&&median<=88?4:0)-8*overlap/Math.max(1,notes.length)-(/bass|drum|chord|pad/i.test(t.name)?12:0)+Math.min(2,notes.length/30)};
 }).sort((a,b)=>b.score-a.score);
 select.value=scored[0].i;showMidiMix();
 const track=midiSong.tracks[scored[0].i],length=Math.min(10,Math.max(5,midiSong.duration));
 let start=track.notes[0][0];
 if(automatic){
  // Prefer a repeating, varied phrase over a sparse intro. This is a heuristic,
  // not recognition of the original recording's chorus.
  let best=-Infinity;
  const limit=Math.min(120,Math.max(0,midiSong.duration-length));
  for(let t=0;t<=limit;t+=2){
   const ns=track.notes.filter(n=>n[0]>=t&&n[0]<t+length);if(ns.length<5)continue;
   const signature=ns.slice(0,5).map((n,i)=>i?n[2]-ns[i-1][2]:0).join(',');
   let repeat=0;for(let k=1;k<track.notes.length-4;k++)if(track.notes.slice(k,k+5).map((n,i)=>i?n[2]-track.notes[k+i-1][2]:0).join(',')===signature)repeat++;
   const score=Math.min(ns.length,30)/5+Math.min(new Set(ns.map(n=>n[2])).size,9)+Math.min(repeat,4)*2-t*.005;
   if(score>best){best=score;start=t;}
  }
 }
 $('midiStart').value=Math.min(start,Math.max(0,midiSong.duration-.1)).toFixed(1);$('midiStart').max=midiSong.duration;
 $('midiLength').value=length;$('midiGenerate').disabled=false;
 $('midiInfo').textContent=name+' · '+midiSong.duration.toFixed(1)+' seconds. Melody and excerpt selected automatically; you can adjust them below.';
}
let findingSong=false;
async function findMidi(extra={}){
 if(findingSong)return;
 if(busy||playing){$('songSearchInfo').textContent='Stop playback first, then find your song.';status('Stop playback first.',true);return;}
 const title=$('songTitle').value.trim(),artist=$('songArtist').value.trim();if(!title&&!extra.url){$('songSearchInfo').textContent='Enter a song title first.';$('songTitle').focus();status('Enter a song title first.',true);return;}
 findingSong=true;$('findSong').disabled=true;$('findSong').textContent='Searching…';$('songSearchInfo').classList.remove('search-error');$('songLinks').hidden=true;
 $('songSearchInfo').textContent='Finding a MIDI arrangement and preparing its melody…';
 try{
  const response=await fetch('/api/midi-find',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,artist,...extra}),signal:AbortSignal.timeout(75000)});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Song search failed.');
  if(busy||playing)throw Error('Song found. Stop playback, then search again to load it.');
  if(result.score)loadParsedScore(result.score,result.name,true);else{const bytes=Uint8Array.from(atob(result.midi),c=>c.charCodeAt(0));loadMidi(bytes.buffer,result.name,true);}
  $('midiGenerate').click();
  if(result.alternatives){
   const select=$('midiMatch');select.replaceChildren();
   for(const match of result.alternatives){const option=document.createElement('option');option.value=match.source;option.textContent=match.provider+' · '+match.name;select.append(option);}
   select.value=result.source;$('midiAlternatives').hidden=result.alternatives.length<2;
  }

  const info=$('songSearchInfo');info.replaceChildren(document.createTextNode('Found '+result.name+'. '+(artist&&!result.artistConfirmed?'The artist is not listed in this file name; check the preview. ':'')+'Preview your graph below. '));
  const link=document.createElement('a');link.href=result.source;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Arrangement source';info.append(link);
 }catch(e){$('songSearchInfo').classList.add('search-error');$('songSearchInfo').textContent=e.name==='TimeoutError'?'Search took too long. Try again, or open a MIDI below.':e.message;status($('songSearchInfo').textContent,true);}
 finally{findingSong=false;$('findSong').disabled=false;$('findSong').textContent='Find song & make graph';}
}
$('findSong').onclick=()=>findMidi();
$('importMidiUrl').onclick=()=>{const url=$('midiUrl').value.trim();if(!url){$('songSearchInfo').textContent='Paste a public HTTPS MIDI or catalog link first.';return;}return findMidi({url});};
$('loadMidiMatch').onclick=()=>findMidi({source:$('midiMatch').value});
$('midiFile').onchange=async event=>{
 const file=event.target.files[0];if(!file)return;if(busy||playing){status('Stop playback first.',true);return;}
 try{
  if(file.size>10*1024*1024)throw Error('Choose a MIDI smaller than 10 MB.');loadMidi(await file.arrayBuffer(),file.name);status('MIDI notes loaded.');
 }catch(e){midiSong=null;$('midiGenerate').disabled=true;status(e.message,true);}
};
$('midiGenerate').onclick=()=>attempt(()=>{
 if(busy||playing)throw Error('Stop playback first.');if(!midiSong)throw Error('Open a MIDI file first.');
 const start=+$('midiStart').value,duration=+$('midiLength').value,transpose=+$('midiTranspose').value,index=+$('midiTrack').value;
 if(!Number.isFinite(start)||start<0||start>=midiSong.duration)throw Error('Start must be 0 or greater and before the end of the song ('+midiSong.duration.toFixed(1)+' seconds).');
 if(!Number.isFinite(duration)||duration<1||duration>30)throw Error('Length must be between 1 and 30 seconds. Start can be 0.');
 if(!Number.isInteger(transpose)||transpose<-24||transpose>24)throw Error('Transpose must be a whole number from -24 to 24. Use 0 for the original pitch.');
 const notes=MidiNotes.excerpt(midiSong.tracks[index].notes,start,duration,transpose);if(!notes.length)throw Error('That excerpt has no notes in this track. Choose another track or start time.');if(notes.length>3000)throw Error('Choose a shorter or simpler MIDI section.');
 const full=$('midiArrangement').value==='full',voices=[[],[],[],[]];
 if(full){
  midiSong.tracks.forEach((track,i)=>{if(!$('midiOn'+i).checked)return;const gain=+$('midiGain'+i).value/100,group=trackGroup(track,i,index);for(const note of MidiNotes.excerpt(track.notes,start,duration,transpose))voices[group].push([note[0],note[1],note[2],note[3]*gain]);});
 }else voices[1]=notes;
 if(voices.some(v=>v.length>3000))throw Error('Too many notes. Shorten the excerpt or mute some tracks.');
 if(!voices.some(v=>v.some(n=>n[3]>0)))throw Error('Turn on at least one track with its volume above zero.');
 voices.forEach(v=>v.sort((a,b)=>a[0]-b[0]));
 const rateValue=Number($('midiSpeed')?.value||100),rate=Number.isFinite(rateValue)&&rateValue>=50&&rateValue<=200?rateValue/100:1;
 for(const voice of voices)for(const note of voice){note[0]/=rate;note[1]/=rate;}
 const selectedTone=$('midiInstrument')?.value;
 const timbre=['synth','piano','pluck','organ','bell','flute'].includes(selectedTone)?selectedTone:'gentle-chip';
 const wave={kind:'notes-v1',voices,gains:full?[1,1,1,1]:[0,1,0,0],timbre,method:full?'midi-full':'midi'},c={...soundSettings(),wave,equation:'0',xmin:0,xmax:duration,duration,yrange:3.5,label:'Guess the song',display:'Yg(t) = { m_n : a_n <= t < b_n, n belongs to graph g, amplitude > 0, graph enabled }\nf_n = 440 * 2^((m_n - 69)/12) Hz\nThe video shows actual active note heights and their exact intervals. Chords have multiple simultaneous heights. Empty set = silence.\nAudio uses these same stored pitches, onsets and ends.'};
 c.duration=duration/rate;c.xmax=c.duration;
 setCurrent(c);$('midiInfo').textContent=voices.reduce((sum,v)=>sum+v.length,0)+' written notes ready. Preview the arrangement. The song title is hidden from the video.';status('MIDI graph ready. Preview or export immediately.');
});

async function importScoreFile(file){
 if(!file)return;
 if(busy||playing){status('Stop playback first.',true);return;}
 try{
  if(file.size>10*1024*1024)throw Error('Choose a score smaller than 10 MB.');
  if(/\.(png|jpe?g|pdf)$/i.test(file.name)){
   $('scoreInfo').textContent='Reading sheet image… This can take up to four minutes.';
   const response=await fetch('/api/sheet-start',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
   const started=await response.json();if(!response.ok)throw Error(started.error||'Sheet reader unavailable.');
   const began=Date.now();let result;
   while(Date.now()-began<270000){
    await new Promise(resolve=>setTimeout(resolve,2000));
    const reply=await fetch('/api/sheet-job?id='+encodeURIComponent(started.id));result=await reply.json();
    if(!reply.ok||result.state==='error')throw Error(result.error||'Sheet reading failed.');
    if(result.state==='done')break;
    $('scoreInfo').textContent='Reading notes and rhythm… '+Math.floor((Date.now()-began)/1000)+' seconds. Keep this page open.';
   }
   if(!result||result.state!=='done')throw Error('Sheet reading timed out. Try one clear page.');
   if(busy||playing)throw Error('Stop playback, then upload the sheet again.');
   loadParsedScore(result.score,file.name,true);$('midiGenerate').click();
   $('scoreInfo').textContent='Transcription ready. Use Preview to check it before exporting. '+(result.score.warnings||[]).join(' ');
   return;
  }
  $('scoreInfo').textContent='Reading written notes…';
  const response=await fetch('/api/score-import',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
  const score=await response.json();if(!response.ok)throw Error(score.error||'Score import failed.');
  if(busy||playing)throw Error('Stop playback, then choose the score again.');
  loadParsedScore(score,file.name,true);$('midiGenerate').click();
  $('scoreInfo').textContent='Score imported: '+score.tracks.length+' parts. '+(score.warnings||[]).join(' ');
 }catch(error){$('scoreInfo').textContent=error.message;status(error.message,true);}
}
$('scoreFile').onchange=async event=>{
 await importScoreFile(event.target.files[0]);event.target.value='';
};
const sheetPaste=$('sheetPaste');
if(sheetPaste){
 sheetPaste.addEventListener('paste',async event=>{
  const image=Array.from(event.clipboardData?.items||[]).find(item=>item.kind==='file'&&/^image\/(png|jpeg)$/.test(item.type));
  if(!image){$('scoreInfo').textContent='Copy the screenshot image, then paste here. Copied text or a file path is not an image.';return;}
  event.preventDefault();const blob=image.getAsFile();if(!blob)return;
  await importScoreFile(new File([blob],image.type==='image/jpeg'?'pasted-sheet.jpg':'pasted-sheet.png',{type:image.type}));
 });
}
function scoreSearchLinks(){
 const known=$('knownScoreSources');known.replaceChildren();const title=$('songTitle').value.toLowerCase();
 const choices=[];if(/soltan/.test(title))choices.push(['Soltane Ghalbha · Aref MIDI listing','https://midifind.com/files/a/a_other/aref_soltane_ghalbha/591-1-0-65143']);if(/\bpop\b/.test(title)&&/osama/i.test($('songArtist').value))choices.push(['Pop · OsamaSon · Online Sequencer','https://onlinesequencer.net/4764848']);for(const [label,url] of choices){const p=document.createElement('p'),a=document.createElement('a');a.textContent=label;a.href=url;a.target='_blank';a.rel='noopener noreferrer';p.append(a);known.append(p);}
 const query=[$('songTitle').value.trim(),$('songArtist').value.trim()].filter(Boolean).join(' ');
 for(const [id,suffix] of [['scoreGoogle','MusicXML MXL MIDI sheet music'],['scoreMuse','site:musescore.com sheet music'],['scoreOpen','site:opensheets.org sheet music'],['scoreSequence','site:onlinesequencer.net MIDI'],['scoreMidiFind','site:midifind.com MIDI']])$(id).href='https://www.google.com/search?q='+encodeURIComponent(query+' '+suffix);
}
$('songTitle').addEventListener('input',scoreSearchLinks);$('songArtist').addEventListener('input',scoreSearchLinks);$('scoreSources').addEventListener('toggle',scoreSearchLinks);scoreSearchLinks();
