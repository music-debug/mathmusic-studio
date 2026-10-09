(function(root){
'use strict';
function fft(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){[re[i],re[j]]=[re[j],re[i]];}}for(let len=2;len<=n;len*=2){const a=-2*Math.PI/len;for(let k=0;k<n;k+=len){let wr=1,wi=0;for(let j=0;j<len/2;j++){let u=k+j,v=u+len/2,tr=re[v]*wr-im[v]*wi,ti=re[v]*wi+im[v]*wr;re[v]=re[u]-tr;im[v]=im[u]-ti;re[u]+=tr;im[u]+=ti;const next=wr*Math.cos(a)-wi*Math.sin(a);wi=wr*Math.sin(a)+wi*Math.cos(a);wr=next;}}}}
function transcribe(samples,rate,duration){
 // Use time-continuous melody decoding rather than assigning spectral peaks
 // independently: harmonics are not additional musical instruments.
 const sr=11025,hop=220,N=2048,mono=new Float32Array(Math.ceil(duration*sr));
 for(let i=0;i<mono.length;i++){const lo=Math.floor(i*rate/sr),hi=Math.max(lo+1,Math.floor((i+1)*rate/sr));let sum=0;for(let j=lo;j<hi;j++)sum+=samples[j]||0;mono[i]=sum/(hi-lo);}
 const frames=[];let peak=0;
 for(let center=0;center<mono.length;center+=hop){
  const re=new Float64Array(N),im=new Float64Array(N);let power=0;
  for(let j=0;j<N;j++){const v=mono[center+j-N/2]||0;re[j]=v*(.5-.5*Math.cos(2*Math.PI*j/(N-1)));if(Math.abs(j-N/2)<hop)power+=v*v;}
  fft(re,im);const mag=Float64Array.from(re.subarray(0,N/2),(v,k)=>Math.hypot(v,im[k]));
  const at=hz=>{const k=Math.round(hz*N/sr);return Math.max(mag[k-1]||0,mag[k]||0,mag[k+1]||0);};
  const scores=[];
  for(let m=48;m<=88;m++){
   const hz=440*2**((m-69)/12),fund=at(hz);let score=fund;
   for(let h=2;h<=5;h++)score+=at(hz*h)*.5/h;
   // Penalize an overtone when its lower fundamental explains it.
   const lower=at(hz/2);score*=Math.max(.18,1-.85*Math.min(1,lower/(fund+1e-8)));
   score*=Math.min(1,fund/(score*.5+1e-8));scores.push(score);
  }
  const rms=Math.sqrt(power/(2*hop));peak=Math.max(peak,rms);frames.push({scores,rms,time:center/sr});
 }
 const size=41,backs=[],levels=[];let prev=new Float64Array(size);
 for(let t=0;t<frames.length;t++){
  const f=frames[t],max=Math.max(...f.scores,1e-8),next=new Float64Array(size),back=new Int16Array(size);
  for(let m=0;m<size;m++){
   const emission=Math.log(.015+f.scores[m]/max);let best=-Infinity,from=0;
   for(let k=0;k<size;k++){const distance=Math.abs(k-m),transition=distance===0?0:.7+Math.min(distance,12)*.08;const value=prev[k]-transition;if(value>best){best=value;from=k;}}
   next[m]=best+emission;back[m]=from;
  }
  // Normalize to keep scores bounded on long excerpts.
  const high=Math.max(...next);for(let m=0;m<size;m++)next[m]-=high;
  backs.push(back);levels.push(max);prev=next;
 }
 const melody=new Array(frames.length);let note=Array.from(prev).indexOf(Math.max(...prev));
 for(let t=frames.length-1;t>=0;t--){melody[t]=note+48;note=backs[t][note];}
 const makeEvents=track=>{const events=[];for(let i=0;i<track.length;){let j=i+1;while(j<track.length&&track[j].m===track[i].m)j++;if(track[i].m&&j-i>=3){let amp=0;for(let k=i;k<j;k++)amp+=track[k].amp;events.push([track[i].time,Math.min(duration,track[j-1].time+hop/sr),track[i].m,Math.max(.35,Math.min(1,amp/(j-i)))]);}i=j;}return events;};
 const melodyTrack=frames.map((f,i)=>({time:f.time,m:f.rms>Math.max(.0015,peak*.045)?melody[i]:0,amp:f.rms/Math.max(peak,.001)}));
 // A separately low-pass-filtered periodicity tracker is more reliable for bass
 // than treating the lowest residual FFT peak as a bass instrument.
 const analysis=typeof MusicAnalysis!=='undefined'?MusicAnalysis:typeof require==='function'?require('./analysis.js'):null;
 const bass=analysis.analyze(samples,rate,{target:'bass'});
 const bassTrack=bass.frames.map(f=>({time:f.time,m:Number.isFinite(f.hz)&&f.confidence>.82&&f.hz<220?Math.max(33,Math.min(64,Math.round(69+12*Math.log2(f.hz/440)))):0,amp:f.rms/Math.max(bass.peakRms,.001)}));
 for(let i=1;i<bassTrack.length-1;i++)if(bassTrack[i-1].m===bassTrack[i+1].m)bassTrack[i].m=bassTrack[i-1].m;
 return {kind:'notes-v1',voices:[makeEvents(bassTrack),makeEvents(melodyTrack),[],[]],gains:[.5,1,0,0],arrangement:'melody-first'};
}
function detailed(samples,rate,duration){
 const sr=22050,N=4096,hop=441,voices=48,mono=new Float32Array(Math.ceil(duration*sr));
 for(let i=0;i<mono.length;i++){const j=i*rate/sr,k=Math.floor(j),u=j-k;mono[i]=(samples[k]||0)*(1-u)+(samples[k+1]||0)*u;}
 const tracks=Array.from({length:voices},()=>[]),previous=new Float64Array(voices);let total=0;
 for(let center=0;center<mono.length;center+=hop){
  const re=new Float64Array(N),im=new Float64Array(N);
  for(let j=0;j<N;j++)re[j]=(mono[center+j-N/2]||0)*(.5-.5*Math.cos(2*Math.PI*j/(N-1)));
  fft(re,im);const mag=Float64Array.from(re.subarray(0,N/2),(v,k)=>Math.hypot(v,im[k]));
  const peaks=[];let max=0;
  for(let k=8;k<N/2-2;k++)if(mag[k]>mag[k-1]&&mag[k]>=mag[k+1]){
   const l=Math.log(mag[k-1]+1e-12),c=Math.log(mag[k]+1e-12),r=Math.log(mag[k+1]+1e-12),d=Math.max(-.5,Math.min(.5,.5*(l-r)/(l-2*c+r||1)));
   const hz=(k+d)*sr/N,amp=4/N*Math.exp(c-.25*(l-r)*d);if(hz>45&&hz<9000){peaks.push({hz,amp});max=Math.max(max,amp);}
  }
  peaks.sort((a,b)=>b.amp-a.amp);const selected=peaks.filter(p=>p.amp>Math.max(.00006,max*.015)).slice(0,voices),assigned=new Array(voices),used=new Set();
  // Continue the closest existing partial before allocating new oscillators.
  const matches=[];for(let v=0;v<voices;v++)if(previous[v])for(let j=0;j<selected.length;j++){const distance=Math.abs(Math.log2(selected[j].hz/previous[v]));if(distance<.10)matches.push({v,j,distance});}
  matches.sort((a,b)=>a.distance-b.distance);for(const m of matches)if(!assigned[m.v]&&!used.has(m.j)){assigned[m.v]=selected[m.j];used.add(m.j);}
  for(let j=0;j<selected.length;j++)if(!used.has(j)){const v=assigned.findIndex(p=>!p);if(v>=0)assigned[v]=selected[j];}
  for(let v=0;v<voices;v++){const p=assigned[v];tracks[v].push([p?p.hz:previous[v]||220,p?p.amp:0]);if(p){previous[v]=p.hz;total++;}}
 }
 return {kind:'partials-v1',hop:hop/sr,tracks,gains:[1,1,1,1],detected:total};
}
function validate(w,duration){
 if(w?.kind==='partials-v1'){
  const count=Math.ceil(duration/w.hop);if(w.hop!==.02||!Array.isArray(w.tracks)||w.tracks.length!==48||!Array.isArray(w.gains)||w.gains.length!==4||w.gains.some(x=>!Number.isFinite(x)||x<0||x>1))throw Error('Invalid oscillator graphs.');
  for(const track of w.tracks){if(!Array.isArray(track)||track.length!==count)throw Error('Invalid oscillator timing.');for(const p of track)if(!Array.isArray(p)||p.length!==2||p.some(x=>!Number.isFinite(x))||p[0]<20||p[0]>10000||p[1]<0||p[1]>8)throw Error('Invalid oscillator point.');}return;
 }
 if(!w||w.kind!=='notes-v1')throw Error('This older project contains recorded waveforms. Generate new synthesized graphs from Music.');if(!Array.isArray(w.voices)||w.voices.length!==4||!Array.isArray(w.gains)||w.gains.length!==4||w.gains.some(x=>!Number.isFinite(x)||x<0||x>1))throw Error('Invalid note graphs.');for(const voice of w.voices){if(!Array.isArray(voice)||voice.length>3000)throw Error('Invalid notes.');for(const n of voice)if(n.length!==4||n.some(x=>!Number.isFinite(x))||n[0]<0||n[1]<=n[0]||n[1]>duration+.001||n[2]<0||n[2]>127||n[3]<0||n[3]>1)throw Error('Invalid note event.');}
}
function partialGroup(hz){return hz<220?0:hz<880?1:hz<2500?2:3;}
function chipTracks(w){
 const count=w.tracks[0].length,tracks=Array.from({length:64},(_,i)=>Array.from({length:count},()=>[440*2**((i+33-69)/12),0])),frames=[];
 for(let f=0;f<count;f++){
  const notes=new Float64Array(64);
  for(const track of w.tracks){const [hz,amp]=track[f],m=Math.round(69+12*Math.log2(hz/440));if(m>=33&&m<=96)notes[m-33]=Math.max(notes[m-33],amp);}
  const reduced=notes.slice();for(let i=0;i<64;i++)for(const h of [12,19,24,28,31])if(i>=h&&notes[i-h]>notes[i]*.9)reduced[i]*=.35;
  frames.push(reduced);
 }
 function follow(low,high){
  const size=high-low+1,backs=[];let prev=new Float64Array(size);
  for(const frame of frames){const maximum=Math.max(...frame.slice(low,high+1),1e-8),next=new Float64Array(size),back=new Int16Array(size);
   for(let j=0;j<size;j++){let best=-Infinity,from=0;for(let k=0;k<size;k++){const distance=Math.abs(j-k),v=prev[k]-(distance===0?0:1.1+Math.min(distance,12)*.12);if(v>best){best=v;from=k;}}next[j]=best+Math.log(.025+frame[low+j]/maximum);back[j]=from;}
   const max=Math.max(...next);for(let j=0;j<size;j++)next[j]-=max;prev=next;backs.push(back);
  }
  const path=new Array(count);let j=Array.from(prev).indexOf(Math.max(...prev));for(let f=count-1;f>=0;f--){path[f]=low+j;j=backs[f][j];}return path;
 }
 const lead=follow(24,55),bass=follow(0,21); // MIDI 57–88 lead, 33–54 bass.
 for(let f=0;f<count;f++){
  const frame=frames[f],max=Math.max(...frame),l=lead[f],b=bass[f];
  if(frame[l]>Math.max(.0001,max*.12))tracks[l][f][1]=frame[l];
  if(!w.melodyOnly&&frame[b]>Math.max(.0001,max*.18))tracks[b][f][1]=frame[b]*.32;
 }
 for(const track of tracks){const amps=track.map(p=>p[1]);for(let f=1;f<count-1;f++)track[f][1]=[amps[f-1],amps[f],amps[f+1]].sort((a,b)=>a-b)[1];}
 return tracks;
}
function buildPartials(config){
 const w=config.wave,n=Math.round(config.duration*44100),audio=new Float32Array(n),bands=Array.from({length:4},()=>new Float32Array(n)),hop=Math.round(w.hop*44100),renderTracks=chipTracks(w);
 for(const track of renderTracks){let phase=0;const hz=track[0][0],bass=hz<220,group=partialGroup(hz),inc=hz/44100;let amp=0;
  for(let f=0;f<track.length;f++){
   const target=track[f][1]**.65,start=f*hop,finish=Math.min(n,start+hop);
   for(let i=start;i<finish;i++){
    amp+=(target-amp)*.012;phase+=inc;phase-=Math.floor(phase);
    let value;
    if(bass)value=1-4*Math.abs(phase-.5);
    else{value=phase<.5?1:-1;
     // PolyBLEP removes digital aliasing without softening the square's edge.
     const blep=t=>t<inc?(t/inc)*2-(t/inc)**2-1:t>1-inc?((t-1)/inc)**2+2*(t-1)/inc+1:0;
     value+=blep(phase)-blep((phase+.5)%1);
    }
    value*=amp*w.gains[group]*(bass?.55:.9);audio[i]+=value;bands[group][i]+=value;
   }
  }
 }
 let peak=.001;for(const v of audio)peak=Math.max(peak,Math.abs(v));const gain=.88/peak;
 for(let i=0;i<n;i++){const fade=Math.min(1,i/220,(n-1-i)/441);audio[i]*=gain*fade;}
 return {audio,channels:[audio],bands,peaks:[1,1,1,1],renderTracks};
}
function noteTone(kind,phase,t,hz){
 let value=0;
 if(kind==='piano'){for(let h=1;h<=7&&hz*h<18000;h++)value+=Math.sin(h*phase)*Math.exp(-t*(1.5+h*.7))/h**1.7;return value;}
 if(kind==='pluck'){for(let h=1;h<=8&&hz*h<18000;h++)value+=Math.sin(h*phase)*Math.exp(-t*(3+h))/h**1.5;return value;}
 if(kind==='organ'){for(const [h,g] of [[1,.65],[2,.25],[3,.12],[4,.08]])if(hz*h<18000)value+=g*Math.sin(h*phase);return value;}
 if(kind==='bell')return Math.exp(-t*2.5)*(Math.sin(phase)+(hz*2<18000?.35*Math.sin(phase*2)*Math.exp(-t*4):0)+(hz*3<18000?.12*Math.sin(phase*3)*Math.exp(-t*7):0));
 if(kind==='flute')return Math.sin(phase)+(hz*2<18000?.055*Math.sin(phase*2):0);
 if(kind==='gentle-chip'||kind==='synth')return Math.sin(phase)+(hz*3<18000?.16*Math.sin(3*phase):0)+(hz*5<18000?.035*Math.sin(5*phase):0);
 for(let h=1;h<=8&&hz*h<18000;h++)value+=Math.sin(phase*h)/h**1.65;return value;
}
function build(config){validate(config.wave,config.duration);if(config.wave.kind==='partials-v1')return buildPartials(config);const n=Math.round(config.duration*44100),audio=new Float32Array(n),bands=Array.from({length:4},()=>new Float32Array(n));for(let v=0;v<4;v++)for(const [start,end,m,amp] of config.wave.voices[v]){const hz=440*2**((m-69)/12),begin=Math.round(start*44100),finish=Math.min(n,Math.round(end*44100));for(let i=begin;i<finish;i++){let t=(i-begin)/44100,env=Math.min(1,t/.006,(finish-i)/44100/.018),phase=2*Math.PI*hz*t,value=noteTone(config.wave.timbre,phase,t,hz);value*=env*amp*(v===0?.40:.80)*config.wave.gains[v];bands[v][i]+=value;audio[i]+=value;}}
 let peak=.01;for(const a of audio)peak=Math.max(peak,Math.abs(a));for(let i=0;i<n;i++)audio[i]*=.88/Math.max(1,peak);return {audio,channels:[audio],bands,peaks:[1,1,1,1]};}
const api={transcribe,detailed,validate,build,chipTracks};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WaveGraphs=api;
})(globalThis);

