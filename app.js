'use strict';
const $=id=>document.getElementById(id), E=MathMusic;
const canvas=$('video'),ctx=canvas.getContext('2d'),pad=$('drawPad'),pc=pad.getContext('2d');
let mode='rhythm',current=null,scenes=[],strokes=[],stroke=null,prepared=null,selectedScene=-1;
let playing=false,recording=false,audioContext=null,source=null,recorder=null,raf=0,worker=null;
let cancelled=false,busy=false,conversionAvailable=false,workerReject=null,finishPlayback=null;
const controls=['bass','brightness','sub','depth','transpose','bpm','volume','smoothing'];
const status=(message,error=false)=>{$('status').textContent=message;$('status').style.color=error?'#ffb6a6':'';};
const clone=o=>JSON.parse(JSON.stringify(o));
function labels(){for(const id of controls){const value=$(id).value;$(id+'Value').textContent=id==='bass'?value+' Hz':id==='bpm'?value+' BPM':id==='transpose'?value+' semitones':id==='depth'?value:value+'%';}}
function switchMode(next){mode=next;for(const b of document.querySelectorAll('[data-mode]')){const yes=b.dataset.mode===next;b.classList.toggle('selected',yes);b.setAttribute('aria-selected',yes);}for(const m of ['rhythm','equation','draw','upload','song','settings'])$(m+'Pane').hidden=m!==next;if(next==='draw')drawPad();}
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>switchMode(b.dataset.mode);
function soundSettings(){return {bass:+$('bass').value,brightness:+$('brightness').value,sub:+$('sub').value,depth:+$('depth').value,transpose:+$('transpose').value};}
function checkConfig(c){
 if(!c||typeof c.equation!=='string'||c.equation.length>30000)throw Error('Invalid project equation.');
 const limits={duration:[1,60],xmin:[-10000,10000],xmax:[-10000,10000],yrange:[1,100],bass:[35,110],brightness:[0,100],sub:[0,100],depth:[.2,1],transpose:[-12,12]};
 for(const [k,[lo,hi]] of Object.entries(limits))if(typeof c[k]!=='number'||!Number.isFinite(c[k])||c[k]<lo||c[k]>hi)throw Error('Invalid '+k+' setting.');
 if(c.xmax<=c.xmin)throw Error('TO x must be larger than FROM x.');
 E.compile(c.equation);
 if(c.wave)WaveGraphs.validate(c.wave,c.duration);
 if(c.gainEquation){if(typeof c.gainEquation!=='string'||c.gainEquation.length>30000)throw Error('Invalid loudness equation.');E.compile(c.gainEquation);}
 return {...c,label:String(c.label||'Custom graph').slice(0,120),display:String(c.display||'').slice(0,4000)};
}
function setCurrent(c){
 if(playing||busy)throw Error('Stop playback before changing the graph.');
 c=checkConfig(c);const points=E.sample(c);
 if(!points.some(p=>Number.isFinite(p[1])))throw Error('Nothing is visible. Check the equation, x bounds, and y range.');
 current=c;prepared=c.wave?{config:c,...WaveGraphs.build(c)}:{config:c,points,fn:E.compile(c.equation)};
 $('equation').value=c.wave?c.display:c.equation;$('xmin').value=c.xmin;$('xmax').value=c.xmax;
 $('equationReadout').textContent=c.wave?c.display+'\n\nThe project stores note pitches, intervals and loudness only. No recording samples.':'y = '+c.equation+(c.gainEquation?'\n\nLoudness g(x) = '+c.gainEquation:'');
 for(const id of ['bass','brightness','sub','depth','transpose','soundPreset','duration','yrange','equation','xmin','xmax','applyEquation'])$(id).disabled=!!c.wave;
 $('bandControls').hidden=!c.wave;
 $('soundDescription').textContent=c.wave?'Main melody leads the sound, with quieter bass. Extra voices are removed.':'One oscillator follows the graph height. No separate drums or backing music.';
 if(c.wave)for(let i=0;i<4;i++)$('band'+i).checked=c.wave.gains[i]>0;
 if(c.wave){const detailed=c.wave.kind==='partials-v1';for(let i=0;i<4;i++){$('band'+i).parentElement.hidden=!detailed&&c.wave.method!=='midi-full'&&i>1;$('band'+i).parentElement.lastChild.textContent=' '+(detailed?['Bass frequencies','Low / mid','Upper / mid','High frequencies'][i]:['Bass graph','Main melody','Chords / strings','Other instruments'][i]);}for(const id of ['melodyOnly','melodyBass'])$(id).hidden=false;$('soundDescription').textContent=detailed?'8-bit chip sound: square-wave notes and triangle bass, one steady lead plus quiet bass.':(c.wave.method==='midi'?'Written MIDI notes played through the gentle graph synth.':c.wave.timbre==='gentle-chip'?'Gentle chip melody from separated parts, with quiet bass.':'Main melody leads the sound, with quieter bass.');$('bandControls').querySelector('p').textContent=detailed?'One lead and quiet bass. Try Melody only for the clearest hook.':'Main melody leads the mix. Try Melody only first.';}

 for(const [id,value] of [['duration',c.duration],['yrange',c.yrange]]){if(![...$(id).options].some(o=>+o.value===value)){const o=document.createElement('option');o.value=value;o.textContent=id==='duration'?value+' seconds':'−'+value+' to '+value;$(id).append(o);}$(id).value=value;}
 for(const id of ['bass','brightness','sub','depth','transpose'])$(id).value=c[id];labels();
 render(prepared,c.duration,1);$('timeReadout').textContent='0:00 / '+clock(c.duration);status('Graph ready. Preview it or add it to your video.');
}
function rhythmConfig(text,shape,settings={}){
 const r=E.rhythm(text,shape),duration=+$('duration').value,bpm=+$('bpm').value;
 const form={rounded:'Aᵢ/(1 + 75dᵢ²)',triangles:'Aᵢ max(1 − |dᵢ − 0.20|/0.20, 0)',hooks:'Aᵢ/(1 + 75dᵢ²) + 1.4 max(1 − |dᵢ − 0.42|/0.11, 0)',zigzag:'Aᵢ max(1 − dᵢ/0.32, 0) + 1.6 max(1 − |dᵢ − 0.48|/0.12, 0)'}[shape];
 const list=r.events.map(e=>Number(e.at.toFixed(3))).join(', ');
 return {equation:r.equation,xmin:0,xmax:duration*bpm/60,duration,yrange:+$('yrange').value,...soundSettings(),label:shape==='rounded'?'Rounded bass':shape==='triangles'?'Triangles':shape==='hooks'?'Pointed hooks':'Zigzags',display:`y = −2.8 + maxᵢ(${form})\ndᵢ = mod(x − bᵢ, ${r.period})\nb = (${list})\nAᵢ follows the syllable; CAPS adds emphasis`,...settings};
}
function attempt(fn){try{fn();}catch(e){status(e.message,true);}}
$('generate').onclick=()=>attempt(()=>setCurrent(rhythmConfig($('rhythm').value,$('shape').value)));
$('applyEquation').onclick=()=>attempt(()=>setCurrent({equation:$('equation').value,xmin:+$('xmin').value,xmax:+$('xmax').value,duration:+$('duration').value,yrange:+$('yrange').value,...soundSettings(),label:'My equation',display:''}));
for(const id of controls){$(id).oninput=()=>{labels();if(id==='volume'&&audioContext?.master)audioContext.master.gain.value=+$('volume').value/100;};$(id).onchange=()=>{if(!current||id==='volume'||id==='smoothing')return;if(playing||busy){status('Stop playback before applying sound changes.');return;}if(id==='bpm'&&mode==='rhythm')$('generate').click();else if(id!=='bpm')attempt(()=>setCurrent({...current,...soundSettings()}));};}
for(const id of ['duration','yrange'])$(id).onchange=()=>{if(!current)return;attempt(()=>{if(mode==='rhythm')setCurrent(rhythmConfig($('rhythm').value,$('shape').value));else setCurrent({...current,duration:+$('duration').value,yrange:+$('yrange').value});});};
$('soundPreset').onchange=()=>{
 const values={favourite:[55,100,0,.66,0],deep:[42,85,35,.60,0],bright:[65,100,0,.72,0],soft:[55,20,20,.5,0]}[$('soundPreset').value];
 ['bass','brightness','sub','depth','transpose'].forEach((id,i)=>$(id).value=values[i]);labels();if(current)attempt(()=>setCurrent({...current,...soundSettings()}));
};
function clock(t){return Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');}
function wrap(text,max=64){const lines=[];for(const row of text.split('\n')){let line='';for(const word of row.split(' ')){if((line+' '+word).length>max&&line){lines.push(line);line=word;}else line+=(line?' ':'')+word;}lines.push(line);}return lines;}
function render(p,time=0,progress=null){
 if(p.config.wave){renderWave(p,time,progress);return;}
 const c=p.config,W=1080,H=1920,L=95,R=985,T=610,B=1100;
 const xpx=x=>L+(x-c.xmin)/(c.xmax-c.xmin)*(R-L),ypx=y=>B-(y+c.yrange)/(2*c.yrange)*(B-T);
 ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.lineWidth=1.4;ctx.strokeStyle='#777';
 const zeroX=xpx(Math.min(c.xmax,Math.max(c.xmin,0))),zeroY=ypx(0);
 ctx.beginPath();ctx.moveTo(L-12,zeroY);ctx.lineTo(R+12,zeroY);ctx.moveTo(R+5,zeroY-4);ctx.lineTo(R+12,zeroY);ctx.lineTo(R+5,zeroY+4);ctx.moveTo(zeroX,B+10);ctx.lineTo(zeroX,T-12);ctx.moveTo(zeroX-4,T-5);ctx.lineTo(zeroX,T-12);ctx.lineTo(zeroX+4,T-5);ctx.stroke();
 ctx.fillStyle='#222';ctx.font='italic 30px Georgia';ctx.fillText('x',R+20,zeroY+8);ctx.fillText('y',zeroX-6,T-26);
 const ratio=progress??Math.min(1,Math.max(0,time/(c.duration-1/30)));
 const upto=c.xmin+(c.xmax-c.xmin)*ratio;
 if(time>0||progress===1){
  ctx.save();ctx.beginPath();ctx.rect(L,T,R-L,B-T);ctx.clip();ctx.lineWidth=2.6;ctx.strokeStyle='#202020';ctx.beginPath();let last=null;
  for(const [x,y] of p.points){if(x>upto)break;if(!Number.isFinite(y)){last=null;continue;}if(last&&Math.abs(y-last[1])<c.yrange*.70)ctx.lineTo(xpx(x),ypx(y));else ctx.moveTo(xpx(x),ypx(y));last=[x,y];}ctx.stroke();ctx.restore();
  const y=p.fn(upto);if(Number.isFinite(y)&&Math.abs(y)<=c.yrange){const x=xpx(upto),py=ypx(y);ctx.fillStyle='#ddd';ctx.beginPath();ctx.arc(x,py,14,0,Math.PI*2);ctx.fill();ctx.fillStyle='#333';ctx.beginPath();ctx.arc(x,py,6,0,Math.PI*2);ctx.fill();}
 }
 let display=c.display||'y = '+c.equation;
 if(display.length>1800)display='y = piecewise linear interpolation\nThrough your drawn control points\nFull equation saved in the project';
 const lines=wrap(display,68),size=Math.max(22,Math.min(34,560/Math.max(lines.length,1)));
 ctx.font=size+'px Georgia';ctx.fillStyle='#111';ctx.textAlign='center';
 lines.forEach((line,i)=>ctx.fillText(line,W/2,1200+i*(size+14),940));ctx.textAlign='left';
}
function drawPad(){
 pc.fillStyle='white';pc.fillRect(0,0,pad.width,pad.height);pc.strokeStyle='#ddd';pc.lineWidth=1;
 for(let i=0;i<=8;i++){pc.beginPath();pc.moveTo(i/8*900,0);pc.lineTo(i/8*900,500);pc.stroke();}
 pc.strokeStyle='#999';pc.beginPath();pc.moveTo(0,250);pc.lineTo(900,250);pc.stroke();pc.fillStyle='#888';pc.font='16px Segoe UI';pc.fillText('+3.5',8,20);pc.fillText('−3.5',8,488);pc.fillText('x: 0 → 8',790,20);
 for(const s of strokes){pc.strokeStyle='#151515';pc.lineWidth=3;pc.beginPath();s.forEach((p,i)=>{const x=p[0]/8*900,y=(3.5-p[1])/7*500;i?pc.lineTo(x,y):pc.moveTo(x,y);});pc.stroke();}
}
function padPoint(e){const r=pad.getBoundingClientRect();return [Math.max(0,Math.min(8,(e.clientX-r.left)/r.width*8)),Math.max(-3.5,Math.min(3.5,3.5-(e.clientY-r.top)/r.height*7))];}
pad.onpointerdown=e=>{if(playing||busy)return;pad.setPointerCapture(e.pointerId);stroke=[padPoint(e)];strokes.push(stroke);drawPad();};
pad.onpointermove=e=>{if(stroke){stroke.push(padPoint(e));drawPad();}};
pad.onpointerup=pad.onpointercancel=()=>stroke=null;
$('undoDraw').onclick=()=>{strokes.pop();drawPad();};$('clearDraw').onclick=()=>{strokes=[];drawPad();};
$('useDrawing').onclick=()=>attempt(()=>{
 const equation=E.drawingEquation(strokes,+$('smoothing').value/100);
 setCurrent({equation,xmin:0,xmax:8,duration:+$('duration').value,yrange:3.5,...soundSettings(),label:'My drawing',display:''});switchMode('equation');
});
function updateTimeline(){
 const box=$('timeline');box.replaceChildren();scenes.forEach((c,i)=>{
  const item=document.createElement('div');item.className='scene';
  const select=document.createElement('button');select.className='scene-name';select.textContent=`${i+1}. ${c.label} · ${c.duration}s`;if(i===selectedScene)item.style.borderColor='#c6f38d';select.onclick=()=>attempt(()=>{setCurrent(clone(c));selectedScene=i;switchMode('equation');updateTimeline();});
  const up=document.createElement('button');up.textContent='↑';up.title='Move earlier';up.disabled=i===0;up.onclick=()=>{if(playing||busy)return;[scenes[i-1],scenes[i]]=[scenes[i],scenes[i-1]];selectedScene=-1;updateTimeline();};
  const remove=document.createElement('button');remove.textContent='×';remove.title='Remove section';remove.onclick=()=>{if(playing||busy)return;scenes.splice(i,1);selectedScene=-1;updateTimeline();};item.append(select,up,remove);box.append(item);
 });$('total').textContent=scenes.length?`${scenes.length} sections · ${scenes.reduce((n,c)=>n+c.duration,0)} seconds`:'No sections yet';$('updateScene').disabled=selectedScene<0||busy;
}
$('addScene').onclick=()=>attempt(()=>{if(playing||busy)throw Error('Stop playback first.');if(!current)throw Error('Create a graph first.');if(scenes.length>=20)throw Error('Maximum 20 sections.');if(scenes.reduce((n,c)=>n+c.duration,0)+current.duration>180)throw Error('Maximum video length is three minutes.');scenes.push(clone(current));updateTimeline();status('Section added. Sound settings are saved with each section.');});
$('updateScene').onclick=()=>attempt(()=>{if(busy||selectedScene<0)throw Error('Select a timeline section first.');if(scenes.reduce((n,c)=>n+c.duration,0)-scenes[selectedScene].duration+current.duration>180)throw Error('Maximum video length is three minutes.');scenes[selectedScene]=clone(current);updateTimeline();status('Selected section updated.');});
$('clearTimeline').onclick=()=>{if(playing||busy)return;scenes=[];selectedScene=-1;updateTimeline();};
$('loadExample').onclick=()=>attempt(()=>{
 if(playing||busy)throw Error('Stop playback first.');
 const shapes=['rounded','triangles','hooks','zigzag','rounded','triangles'];
 const rhythms=['bum bum BUMBUMBUM bum bum','bum bum BUM-BUM bum BUMBUMBUM','bum BUMBUMBUM bum bum','BUM bum bum BUMBUMBUM bum','bum bum bum BUMBUMBUM','bum BUM-BUM bum BUMBUMBUM'];
 scenes=shapes.map((s,i)=>rhythmConfig(rhythms[i],s,{duration:5,xmax:7.2,bass:55,brightness:100,sub:0,depth:.66,transpose:0}));selectedScene=-1;setCurrent(clone(scenes[0]));updateTimeline();status('30-second example loaded. Choose a section to edit, then use Update selected section.');
});
function buildAudio(c){return new Promise((resolve,reject)=>{
 let settled=false,w=null;
 const clear=()=>{w?.terminate();if(worker===w){worker=null;workerReject=null;}};
 const fail=error=>{if(settled)return;settled=true;clear();reject(error);};
 const fallback=()=>{
  if(settled)return;clear();
  // These modules are already loaded on the page. A blocked worker should
  // not prevent offline synthesis using exactly the same equations.
  setTimeout(()=>{if(settled)return;try{const audio=c.wave?WaveGraphs.build(c):E.synthesize(c);settled=true;resolve(audio);}catch(error){fail(Error('Could not prepare this sound: '+error.message));}},0);
 };
 try{
  w=new Worker('worker.js');worker=w;workerReject=fail;
  w.onmessage=e=>{if(settled)return;settled=true;clear();e.data.error?reject(Error(e.data.error)):resolve(e.data.waveModel||e.data.audio);};
  w.onerror=e=>{e.preventDefault();fallback();};w.postMessage(c);
 }catch(error){fallback();}
});}
async function context(){if(!audioContext){audioContext=new (window.AudioContext||window.webkitAudioContext)();audioContext.master=audioContext.createGain();audioContext.master.connect(audioContext.destination);}audioContext.master.gain.value=+$('volume').value/100;await audioContext.resume();return audioContext;}
function enableBusy(on){busy=on;for(const id of ['preview','playVideo','exportVideo','exportAudio','addScene','loadExample','openProject'])$(id).disabled=on;$('stop').disabled=!on;$('updateScene').disabled=on||selectedScene<0;if(typeof updateMusicBusy==='function')updateMusicBusy(on);}
function stop(){cancelled=true;try{source?.stop();}catch{}source?.disconnect();source=null;worker?.terminate();worker=null;workerReject?.(Error('Cancelled.'));workerReject=null;cancelAnimationFrame(raf);finishPlayback?.();finishPlayback=null;if(recorder?.state==='recording')recorder.stop();playing=false;recording=false;status('Stopped.');}
$('stop').onclick=stop;
async function prepare(sequence){
 const models=[];for(let i=0;i<sequence.length;i++){if(cancelled)throw Error('Cancelled.');status(`Preparing sound ${i+1} of ${sequence.length}…`);const c=clone(sequence[i]),result=await buildAudio(c);models.push(c.wave?{config:c,...result}:{config:c,points:E.sample(c),fn:E.compile(c.equation),audio:result});}return models;
}
function activeSequence(full){if(!current)throw Error('Create a graph first.');return clone(full&&scenes.length?scenes:[current]);}
async function play(full=false,exporting=false){
 if(busy)return;cancelled=false;enableBusy(true);
 $('originalMusic').pause();
 try{
  const ac=await context(),models=await prepare(activeSequence(full));if(cancelled)return;
  const total=models.reduce((n,m)=>n+m.config.duration,0),n=models.reduce((n,m)=>n+m.audio.length,0);
  const channelCount=Math.max(...models.map(m=>m.channels?.length||1));const audio=ac.createBuffer(channelCount,n,44100);let offset=0;for(const m of models){for(let ch=0;ch<channelCount;ch++)audio.copyToChannel(m.channels?.[ch]||m.audio,ch,offset);offset+=m.audio.length;}
  source=ac.createBufferSource();source.buffer=audio;source.connect(ac.master);
  let chunks=[],mime='',capture,dest,done;
  if(exporting){
   if(!canvas.captureStream||typeof MediaRecorder==='undefined')throw Error('This browser cannot record graph videos. Try an updated Safari version, or download the WAV sound.');
   mime=['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
   if(!mime)throw Error('This browser cannot record video. Try Edge or Chrome.');
   capture=canvas.captureStream(30);dest=ac.createMediaStreamDestination();source.connect(dest);
   const stream=new MediaStream([...capture.getVideoTracks(),...dest.stream.getAudioTracks()]);
   recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:9000000,audioBitsPerSecond:192000});
   recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
   done=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=()=>reject(Error('Browser recording failed.'));});
   render(models[0],0);recorder.start(250);recording=true;
  }
  playing=true;const start=ac.currentTime+.08;source.start(start);
  status(exporting?'Recording your video… Keep this tab visible.':'Playing your graph.');
  await new Promise(resolve=>{finishPlayback=resolve;
   function tick(){if(cancelled){resolve();return;}const elapsed=Math.max(0,ac.currentTime-start);let local=elapsed,index=0;
    while(index<models.length-1&&local>=models[index].config.duration){local-=models[index].config.duration;index++;}
    render(models[index],Math.min(local,models[index].config.duration));$('timeReadout').textContent=clock(elapsed)+' / '+clock(total);$('progress').style.width=Math.min(100,elapsed/total*100)+'%';
    if(elapsed>=total){resolve();return;}raf=requestAnimationFrame(tick);
   }tick();
  });
  finishPlayback=null;source?.disconnect();source=null;playing=false;
  if(exporting){if(recorder.state==='recording')recorder.stop();await done;capture.getTracks().forEach(t=>t.stop());dest.stream.getTracks().forEach(t=>t.stop());recording=false;if(!cancelled)await saveVideo(new Blob(chunks,{type:mime}));}
  else if(!cancelled)status('Preview complete.');
 }catch(e){if(!cancelled)status(e.message,true);}finally{playing=false;recording=false;enableBusy(false);}
}
$('preview').onclick=()=>play(false);$('playVideo').onclick=()=>play(true);$('exportVideo').onclick=()=>play(true,true);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&recording){stop();status('Export cancelled because the tab was hidden. Keep it visible during recording.',true);}});
let lastVideoURL=null;
function download(blob,name){const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=name;link.click();if(blob.type.startsWith('video/')){if(lastVideoURL)URL.revokeObjectURL(lastVideoURL);lastVideoURL=url;$('lastDownload').href=url;$('lastDownload').download=name;$('lastDownload').style.color='#c6f38d';$('exportedPlayer').src=url;$('exportResult').hidden=false;}else setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function saveVideo(blob){
 if(blob.type.startsWith('video/mp4')){download(blob,'mathmusic.mp4');status('MP4 downloaded.');return;}
 if(conversionAvailable){status('Converting to MP4…');try{const seconds=scenes.length?scenes.reduce((n,c)=>n+c.duration,0):current.duration;const res=await fetch('/api/convert',{method:'POST',headers:{'Content-Type':blob.type,'X-Video-Duration':String(seconds)},body:blob});if(!res.ok)throw Error(await res.text());download(await res.blob(),'mathmusic.mp4');status('MP4 downloaded.');return;}catch(e){status('MP4 conversion failed. Downloaded the WebM instead. '+e.message,true);}}
 else status('Video downloaded as WebM. MP4 conversion needs FFmpeg; see the included guide.');
 download(blob,'mathmusic.webm');
}
$('exportAudio').onclick=async()=>{
 if(busy)return;cancelled=false;enableBusy(true);
 try{
  const models=await prepare(activeSequence(true));if(cancelled)return;
  const n=models.reduce((sum,m)=>sum+m.audio.length,0),channels=Math.max(...models.map(m=>m.channels?.length||1));
  const buffer=new ArrayBuffer(44+n*2*channels),v=new DataView(buffer),str=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
  str(0,'RIFF');v.setUint32(4,36+n*2*channels,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,44100,true);v.setUint32(28,88200*channels,true);v.setUint16(32,2*channels,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,n*2*channels,true);
  let pos=44;for(const m of models)for(let i=0;i<m.audio.length;i++)for(let ch=0;ch<channels;ch++){const a=(m.channels?.[ch]||m.audio)[i];v.setInt16(pos,Math.round(Math.max(-1,Math.min(1,a))*32767),true);pos+=2;}
  download(new Blob([buffer],{type:'audio/wav'}),'mathmusic.wav');status('WAV downloaded.');
 }catch(e){status(e.message,true);}finally{enableBusy(false);}
};
$('saveProject').onclick=()=>{if(!current)return;download(new Blob([JSON.stringify({version:1,current,scenes,strokes,rhythm:$('rhythm').value,shape:$('shape').value,bpm:+$('bpm').value},null,2)],{type:'application/json'}),'mathmusic-project.json');status('Project saved.');};
$('openProject').onclick=()=>$('projectFile').click();
$('projectFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>128e6)throw Error('Project file is too large.');const data=JSON.parse(await f.text());if(data.version!==1||!Array.isArray(data.scenes)||data.scenes.length>20)throw Error('Unsupported project file.');const next=data.scenes.map(checkConfig);if(next.reduce((n,c)=>n+c.duration,0)>180)throw Error('Project exceeds three minutes.');const c=checkConfig(data.current);setCurrent(c);scenes=next;strokes=Array.isArray(data.strokes)?data.strokes.filter(s=>Array.isArray(s)&&s.length<=10000&&s.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))):[];$('rhythm').value=String(data.rhythm||'bum bum BUMBUMBUM').slice(0,1000);$('shape').value=['rounded','triangles','hooks','zigzag'].includes(data.shape)?data.shape:'rounded';$('bpm').value=Math.max(60,Math.min(160,Number(data.bpm)||90));labels();updateTimeline();drawPad();switchMode('equation');status('Project opened.');}catch(e){status('Could not open project: '+e.message,true);}finally{e.target.value='';}};
$('copyEquation').onclick=async()=>{try{await navigator.clipboard.writeText(current.wave?current.display:'y = '+current.equation);status('Equation copied.');}catch{status('Select the generated equation text and copy it manually.');}};
async function init(){labels();drawPad();updateTimeline();attempt(()=>setCurrent(rhythmConfig($('rhythm').value,$('shape').value)));try{const r=await fetch('/api/status');const s=await r.json();conversionAvailable=!!s.ffmpeg;const native=typeof MediaRecorder!=='undefined'&&MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E,mp4a.40.2');$('exportHint').textContent='1080 × 1920 · 30 fps · '+(conversionAvailable||native?'MP4 export ready.':'WebM export ready. FFmpeg enables MP4 conversion.')+' Export records in real time; keep this tab visible.';}catch{status('Start Studio.bat enables reliable audio and export.');}}
init();
