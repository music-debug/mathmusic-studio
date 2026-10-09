'use strict';
async function generateFullSong(start,duration){
 status('Analyzing musical pitches and loudness…');
 const detailed=$('musicMode').value==='full';
 const rate=musicBuffer.sampleRate,count=Math.round(duration*rate),samples=new Float32Array(count),offset=Math.round(start*rate);
 for(let ch=0;ch<musicBuffer.numberOfChannels;ch++){const data=musicBuffer.getChannelData(ch);for(let i=0;i<count;i++)samples[i]+=(data[offset+i]||0)/musicBuffer.numberOfChannels;}
 const wave=await new Promise((resolve,reject)=>{const w=new Worker('worker.js');worker=w;workerReject=reject;w.onmessage=e=>{w.terminate();worker=null;workerReject=null;e.data.error?reject(Error(e.data.error)):resolve(e.data.notes);};w.onerror=()=>{w.terminate();worker=null;workerReject=null;reject(Error('Note detection failed.'));};w.postMessage({type:'transcribe',samples,rate,duration,detailed},[samples.buffer]);});
 if(cancelled)return;
 const total=wave.kind==='partials-v1'?wave.detected:wave.voices.reduce((s,v)=>s+v.length,0);if(!total)throw Error('No clear notes found. Try an excerpt with a stronger melody.');
 const display=detailed?'fⱼ = 440 × 2^((round(mⱼ) − 69)/12)\ns(t) = Σⱼ Aⱼ(t) square(2π fⱼ t)\nBass uses triangle waves. One continuous lead + quiet bass.\nNo recording samples are stored.':'fᵢ(t) = 440 × 2^((mᵢ(t) − 69)/12)\ns(t) = Σᵢ aᵢ(t) Σₕ sin(2πh fᵢ(t)(t − onset))/h^1.25\nmᵢ(t) is a piecewise constant detected note; aᵢ(t) follows its loudness and attack/release.\nExact note intervals are stored in the project.';
 enableBusy(false);setCurrent({...soundSettings(),wave,equation:'0',xmin:0,xmax:duration,duration,yrange:3.5,label:'Guess the song',display});
 $('analysisReport').textContent=detailed?'8-bit synth: stepped notes, square-wave leads and triangle bass. One steady lead and a quiet bass line; extra voices are removed.':total+' note events. Main melody is emphasized; bass is quieter and extra voices are removed. Try Melody only if bass obscures the hook. Busy vocals can still cause errors; use a clear hook or an instrumental excerpt.';
 status(detailed?'8-bit version ready. Preview the chip sound.':'Melody-focused version ready. Preview or choose Melody only.');
}
// The plotted heights and synthesized pitches share these stored note events.
function activeGraphNotes(wave,voice,t){
 return wave.gains[voice]>0?wave.voices[voice].filter(n=>n[0]<=t&&t<n[1]&&n[3]>0):[];
}
function visibleNoteVoices(wave){
 return wave.voices.map((notes,v)=>v).filter(v=>wave.gains[v]>0&&wave.voices[v].some(n=>n[3]>0));
}
function noteEquationRows(wave,t){
 return wave.voices.map((_,v)=>{
  const notes=activeGraphNotes(wave,v,t),fmt=x=>Number(x.toFixed(3)).toString();
  return {height:'Y'+(v+1)+'(t) = '+(notes.length?'{'+[...new Set(notes.map(n=>n[2]))].join(', ')+'}':'∅  (silence)'),
   intervals:notes.length?notes.map(n=>n[2]+': '+fmt(n[0])+' ≤ t < '+fmt(n[1])).join('   |   '):'No active note interval'};
 });
}
function renderNoteEquations(wave,t){
 ctx.textAlign='left';ctx.fillStyle='#222';ctx.font='25px Georgia';
 ctx.fillText('Actual graph heights at t = '+t.toFixed(3)+' s',100,1460);
 const rows=noteEquationRows(wave,t);
 for(const [slot,v] of visibleNoteVoices(wave).entries()){
  ctx.font='24px Georgia';ctx.fillText(rows[v].height,100,1500+slot*66,880);
  ctx.font='17px Georgia';ctx.fillStyle='#555';ctx.fillText(rows[v].intervals,100,1524+slot*66,880);ctx.fillStyle='#222';
 }
 ctx.font='21px Georgia';ctx.fillText('Yg(t) = { mₙ : aₙ ≤ t < bₙ, note n belongs to graph g }',100,1790,880);
 ctx.fillText('fₙ = 440 × 2^((mₙ − 69)/12) Hz · time intervals in seconds',100,1825,880);
}
function renderWave(p,time=0,progress=null){
 if(p.config.wave.kind==='partials-v1'){renderPartials(p,time,progress);return;}
 const c=p.config,L=100,R=980,allNotes=p.config.wave.voices.flat().map(n=>n[2]),noteLow=Math.min(33,...allNotes)-1,noteHigh=Math.max(88,...allNotes)+1,shown=progress===1?c.duration:Math.max(0,Math.min(time,c.duration));ctx.fillStyle='white';ctx.fillRect(0,0,1080,1920);ctx.fillStyle='#222';ctx.textAlign='center';ctx.font='38px Georgia';ctx.fillText('Can you guess the song?',540,290);
 const visible=visibleNoteVoices(c.wave);
 for(const [slot,v] of visible.entries()){
  const mid=visible.length===1?880:510+slot*735/(visible.length-1);ctx.textAlign='left';ctx.font='25px Georgia';ctx.fillStyle='#444';ctx.fillText(['Bass','Main melody','Chords / strings','Other instruments'][v],L,mid-95);ctx.strokeStyle='#bbb';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(L,mid+70);ctx.lineTo(R,mid+70);ctx.stroke();ctx.beginPath();ctx.moveTo(L,mid-75);ctx.lineTo(L,mid+70);ctx.stroke();
  ctx.strokeStyle=c.wave.gains[v]?'#171717':'#ccc';ctx.lineWidth=4;
  for(const [a,b,m,amp] of c.wave.voices[v]){if(a>=shown)continue;const x=L+a/c.duration*(R-L),end=L+Math.min(b,shown)/c.duration*(R-L),y=mid+65-(m-noteLow)/(noteHigh-noteLow)*140;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(end,y);ctx.stroke();if(shown>=a&&shown<b){ctx.fillStyle='#222';ctx.beginPath();ctx.arc(end,y,7,0,Math.PI*2);ctx.fill();}}
 }
 renderNoteEquations(c.wave,progress===1?0:Math.max(0,Math.min(time,c.duration)));ctx.textAlign='left';
}
$('applyBands').onclick=()=>attempt(()=>{if(busy)throw Error('Stop playback first.');if(!current?.wave)throw Error('Generate song graphs first.');setCurrent({...current,wave:{...current.wave,gains:Array.from({length:4},(_,i)=>$('band'+i).checked?(current.wave.kind==='partials-v1'?1:i===0?.5:1):0)}});status('Synth part mix updated.');});


$('melodyOnly').onclick=()=>attempt(()=>{if(busy)throw Error('Stop playback first.');if(!current?.wave)throw Error('Generate music graphs first.');setCurrent({...current,wave:{...current.wave,melodyOnly:true,gains:current.wave.kind==='partials-v1'?[1,1,1,1]:[0,1,0,0]}});status('Main melody only.');});
$('melodyBass').onclick=()=>attempt(()=>{if(busy)throw Error('Stop playback first.');if(!current?.wave)throw Error('Generate music graphs first.');setCurrent({...current,wave:{...current.wave,melodyOnly:false,gains:current.wave.kind==='partials-v1'?[1,1,1,1]:[.5,1,0,0]}});status('Main melody with quiet bass.');});

function renderPartials(p,time=0,progress=null){
 const w=p.config.wave,duration=p.config.duration,shown=progress===1?duration:Math.max(0,Math.min(time,duration)),L=100,R=980;
 ctx.fillStyle='white';ctx.fillRect(0,0,1080,1920);ctx.fillStyle='#222';ctx.textAlign='center';ctx.font='37px Georgia';ctx.fillText('Can you guess the song?',540,280);
 const titles=['Bass pitches','Low / middle pitches','High / middle pitches','High pitches'],bounds=[[45,220],[220,880],[880,2500],[2500,9000]];
 for(let g=0;g<4;g++){
  const mid=500+g*240,lo=bounds[g][0],hi=bounds[g][1];ctx.textAlign='left';ctx.font='25px Georgia';ctx.fillStyle='#444';ctx.fillText(titles[g],L,mid-105);ctx.strokeStyle='#bbb';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(L,mid-80);ctx.lineTo(L,mid+70);ctx.lineTo(R,mid+70);ctx.stroke();
  for(const track of (p.renderTracks||WaveGraphs.chipTracks(w))){let open=false;ctx.beginPath();ctx.lineWidth=2;ctx.strokeStyle=w.gains[g]?'#222':'#ddd';let last=null;
   const end=Math.min(track.length,Math.floor(shown/w.hop)+1);
   for(let j=0;j<end;j++){const [hz,amp]=track[j],x=L+j*w.hop/duration*(R-L),y=mid+65-140*Math.log(hz/lo)/Math.log(hi/lo);if(hz<lo||hz>=hi||amp<.0003){open=false;continue;}if(open)ctx.lineTo(x,y);else ctx.moveTo(x,y);open=true;last=[x,y];}
   ctx.stroke();if(last&&shown<duration&&open){ctx.fillStyle='#222';ctx.beginPath();ctx.arc(last[0],last[1],3,0,Math.PI*2);ctx.fill();}
  }
 }
 ctx.textAlign='center';ctx.fillStyle='#222';ctx.font='29px Georgia';ctx.fillText('s(t) = Σⱼ Aⱼ(t) square(2π fⱼ t)',540,1540);ctx.font='24px Georgia';ctx.fillText('8-bit notes · square leads + triangle bass',540,1600);ctx.fillText('Graph height = frequency · gaps = silence',540,1660);ctx.textAlign='left';
}

