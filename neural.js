'use strict';
let neuralJob=null;
function excerptWav(start,duration){
 const rate=44100,count=Math.round(duration*rate),buffer=new ArrayBuffer(44+count*4),v=new DataView(buffer);
 const word=(at,text)=>{for(let i=0;i<text.length;i++)v.setUint8(at+i,text.charCodeAt(i));};word(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);word(8,'WAVE');word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,rate,true);v.setUint32(28,rate*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);word(36,'data');v.setUint32(40,count*4,true);
 for(let i=0;i<count;i++)for(let ch=0;ch<2;ch++){
  const data=musicBuffer.getChannelData(Math.min(ch,musicBuffer.numberOfChannels-1)),p=(start+i/rate)*musicBuffer.sampleRate,k=Math.floor(p),u=p-k,value=(data[k]||0)*(1-u)+(data[k+1]||0)*u;
  v.setInt16(44+(i*2+ch)*2,Math.max(-1,Math.min(1,value))*32767,true);
 }
 return buffer;
}
async function songJson(url,options){const response=await fetch(url,options),data=await response.json();if(!response.ok)throw Error(data.error||'Local processing failed.');return data;}
async function generateNeural(start,duration){
 const info=await songJson('/api/status');
 if(!info.songModels)throw Error('One-time setup needed: open Setup Song Models.bat in your Studio folder, let it finish, then restart Studio. Models run locally; your song is not uploaded.');
 status('Preparing your excerpt for local model processing…');
 const job=await songJson('/api/song-start',{method:'POST',headers:{'Content-Type':'audio/wav','X-Song-Target':$('neuralTarget').value},body:excerptWav(start,duration)});neuralJob=job.id;
 try{
  while(true){
   if(cancelled){await songJson('/api/song-cancel',{method:'POST',body:JSON.stringify({id:job.id})});return;}
   const result=await songJson('/api/song-job?id='+encodeURIComponent(job.id));
   if(result.state==='failed')throw Error(result.error);
   if(result.state==='cancelled')return;
   if(result.state==='done'){
    if(cancelled)return;enableBusy(false);
    const wave=result.wave,c={...soundSettings(),wave,equation:'0',xmin:0,xmax:duration,duration,yrange:3.5,label:'Guess the song',display:'f(t) = 440 × 2^((m(t) − 69)/12)\ns(t) = A(t)[sin(2πft) + 0.16sin(6πft) + 0.035sin(10πft)]\nNotes transcribed from separated musical parts. Quiet bass optional.'};
    setCurrent(c);$('analysisReport').textContent='Separated '+(wave.target==='vocals'?'vocal melody':'instrumental part')+' transcribed by the local note model. Gentle chip synth; one lead and quiet bass. Compare with the original. Model transcription can still miss notes.';status('Neural transcription ready. Preview the melody; use Melody only to remove bass.');return;
   }
   status(result.stage+'…');await new Promise(resolve=>setTimeout(resolve,1000));
  }
 }finally{neuralJob=null;}
}
const previousStop=$('stop').onclick;
$('stop').onclick=()=>{previousStop();if(neuralJob)fetch('/api/song-cancel',{method:'POST',body:JSON.stringify({id:neuralJob})}).catch(()=>{});};
fetch('/api/status').then(r=>r.json()).then(info=>{$('neuralStatus').textContent=info.songModels?'Local song models are ready. CPU processing may take several minutes.':'One-time setup required: run Setup Song Models.bat in the Studio folder, then restart Studio. No music is uploaded. The existing modes work without setup.';}).catch(()=>{$('neuralStatus').textContent='Start Studio.bat to enable local processing.';});

$('neuralControls').hidden=true;
