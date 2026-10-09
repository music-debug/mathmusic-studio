'use strict';
let musicBuffer=null,musicURL=null,musicName='',musicLoading=false;
function updateMusicBusy(on){$('musicFile').disabled=on;$('analyzeMusic').disabled=on||!musicBuffer||musicLoading;$('hearExcerpt').disabled=on||!musicBuffer||musicLoading;}
let excerptEnd=null;
$('hearExcerpt').onclick=async()=>{if(busy||!musicBuffer)return;try{const start=+$('musicStart').value,length=+$('musicLength').value;if(!Number.isFinite(start)||start<0||!Number.isFinite(length)||length<5||length>30||start+length>musicBuffer.duration+.001)throw Error('Choose a valid 5â€“30 second excerpt first.');excerptEnd=start+length;$('originalMusic').currentTime=start;await $('originalMusic').play();status('Playing the original excerpt for comparison.');}catch(e){status(e.message,true);}};
$('originalMusic').ontimeupdate=()=>{if(excerptEnd!==null&&$('originalMusic').currentTime>=excerptEnd){$('originalMusic').pause();excerptEnd=null;}};
$('originalMusic').onplay=()=>{if(busy||playing){$('originalMusic').pause();status('Stop the graph preview before playing the original recording.');}};
$('musicFile').onchange=async event=>{
 const file=event.target.files[0];if(!file)return;
 if(busy||playing){status('Stop playback before opening music.',true);return;}
 if(file.size>80*1024*1024){status('Choose an audio file smaller than 80 MB.',true);return;}
 musicLoading=true;$('analyzeMusic').disabled=true;musicBuffer=null;
 try{
  status('Opening your audio locallyâ€¦');const ac=await context();
  const decoded=await ac.decodeAudioData(await file.arrayBuffer());
  if(decoded.duration<5)throw Error('Choose a recording at least five seconds long.');
  musicBuffer=decoded;musicName=file.name;
  if(musicURL)URL.revokeObjectURL(musicURL);musicURL=URL.createObjectURL(file);
  $('originalMusic').src=musicURL;$('originalMusic').hidden=false;
  $('musicStart').value=0;$('musicStart').max=Math.max(0,decoded.duration-5);
  $('musicLength').value=Math.min(10,Math.floor(decoded.duration*10)/10);
  $('musicInfo').textContent=file.name+' Â· '+decoded.duration.toFixed(1)+' seconds Â· choose a 5â€“30 second excerpt.';
  status('Music opened. Choose your excerpt, then generate the graph.');
 }catch(error){status('Could not open audio: '+error.message,true);}finally{musicLoading=false;updateMusicBusy(false);}
};
function analyzeSamples(samples,rate,target){return new Promise((resolve,reject)=>{
 workerReject=reject;const w=new Worker('worker.js');worker=w;
 w.onmessage=e=>{w.terminate();worker=null;workerReject=null;e.data.error?reject(Error(e.data.error)):resolve(e.data.analysis);};
 w.onerror=()=>{w.terminate();worker=null;workerReject=null;reject(Error('Audio analysis failed. Try a shorter excerpt.'));};
 w.postMessage({type:'analyze',samples,rate,options:{target}},[samples.buffer]);
});}
function extractedEquation(result,settings,tolerance,dynamics){
 const runs=[];let run=[];const envelope=[];
 const center=settings.bass*2**(settings.transpose/12);
 for(const f of result.frames){
  const x=f.time;
  if(Number.isFinite(f.hz))run.push([x,Math.log2(f.hz/center)/settings.depth-2.8]);
  else if(run.length){if(run.length>=2)runs.push(run);run=[];}
  envelope.push([x,Math.min(1,f.rms/Math.max(result.peakRms,1e-8))]);
 }
 if(run.length>=2){run.push([result.duration,run[run.length-1][1]]);runs.push(run);}
 if(!runs.length)throw Error('No stable notes found. Try a clearer excerpt or the other tracking mode.');
 const equation=E.drawingEquation(runs,tolerance);
 envelope.push([result.duration,envelope[envelope.length-1][1]]);
 const gainEquation=dynamics?E.drawingEquation([envelope],.02):undefined;
 const maxHeight=Math.max(...runs.flat().map(p=>Math.abs(p[1])));
 return {equation,gainEquation,yrange:maxHeight<=3.5?3.5:maxHeight<=5?5:10};
}
$('analyzeMusic').onclick=async()=>{
 if(busy||musicLoading||!musicBuffer)return;
 cancelled=false;enableBusy(true);$('analyzeMusic').disabled=true;$('musicFile').disabled=true;
 try{
  $('originalMusic').pause();
  const start=+$('musicStart').value,duration=+$('musicLength').value;
  if(!Number.isFinite(start)||start<0||!Number.isFinite(duration)||duration<5||duration>30||start+duration>musicBuffer.duration+.001)throw Error('Choose 5â€“30 seconds entirely inside the recording.');
  if($('musicMode').value==='neural'){await generateNeural(start,duration);return;}
  if(['full','melody'].includes($('musicMode').value)){await generateFullSong(start,duration);return;}
  status('Finding pitch and rhythmâ€¦ This can take a few seconds.');
  const rate=musicBuffer.sampleRate,begin=Math.round(start*rate),count=Math.round(duration*rate),samples=new Float32Array(count);
  for(let ch=0;ch<musicBuffer.numberOfChannels;ch++){const data=musicBuffer.getChannelData(ch);for(let i=0;i<count;i++)samples[i]+=(data[begin+i]||0)/musicBuffer.numberOfChannels;}
  const result=await analyzeSamples(samples,rate,$('musicTarget').value);if(cancelled)return;
  const settings=soundSettings(),fit=extractedEquation(result,settings,+$('musicDetail').value,$('musicDynamics').checked);
  const c={...settings,...fit,xmin:0,xmax:duration,duration,label:'Music Â· '+musicName.slice(0,50),display:'y = piecewise pitch curve from your music\nf(x) = '+settings.bass+' Ã— 2^('+settings.transpose+'/12) Ã— 2^('+settings.depth+'(y + 2.8))\n'+(fit.gainEquation?'g(x) = extracted loudness envelope\n':'')+'Full piecewise equations are saved in your project.'};
  // Match playback clock to excerpt time without the endpoint acceleration.
  c.xmax=duration-1/30;
  enableBusy(false);setCurrent(c);
  const percentage=Math.round(result.coverage*100),confidence=Math.round(result.meanConfidence*100);
  $('analysisReport').textContent=`Tracked notes in ${percentage}% of the excerpt Â· average periodicity ${confidence}%. ${percentage<45?'This excerpt is difficult to track; try another section or tracking mode.':'Preview the graph sound and compare it with the original.'} The original audio is never used in exports.`;
  status('Graph generated. Preview section plays the synthesized version; the music player plays your original.');
 }catch(error){if(!cancelled)status(error.message,true);}finally{enableBusy(false);$('analyzeMusic').disabled=!musicBuffer;$('musicFile').disabled=false;}
};

function musicModeChanged(){
 const full=$('musicMode').value!=='pitch';
 $('neuralControls').hidden=$('musicMode').value!=='neural';
 for(const id of ['musicTarget','musicDetail','musicDynamics'])$(id).disabled=full;
 $('analysisReport').textContent=$('musicMode').value==='neural'?'Neural mode first separates musical parts, then transcribes notes. Requires the one-time model setup; processing stays on this computer.':$('musicMode').value==='full'?'8-bit song mode uses stepped notes, square-wave leads and triangle bass. Original instrument tones are replaced.':full?'Tracks one main melody continuously and analyzes bass separately. Melody only gives the clearest tune; add quiet bass if it helps.':'Single-graph mode estimates one pitch at a time and uses your synthesizer. Clear melodies and bass lines work best.';
}
$('musicMode').onchange=musicModeChanged;
musicModeChanged();
