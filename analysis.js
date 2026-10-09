(function(root){
 'use strict';
 function analyze(input,inputRate,options={}){
  const rate=8000,hop=160,window=1024;
  const n=Math.floor(input.length*rate/inputRate),signal=new Float32Array(n);
  // Average source samples before decimation; no network or external service.
  for(let i=0;i<n;i++){
   const begin=Math.floor(i*inputRate/rate),end=Math.min(input.length,Math.max(begin+1,Math.floor((i+1)*inputRate/rate)));let sum=0;
   for(let j=begin;j<end;j++)sum+=input[j];signal[i]=sum/(end-begin);
  }
  const bass=options.target==='bass';
  if(bass){const alpha=1-Math.exp(-2*Math.PI*450/rate);let a=0,b=0;for(let i=0;i<n;i++){a+=alpha*(signal[i]-a);b+=alpha*(a-b);signal[i]=b;}}
  const minLag=Math.floor(rate/(bass?300:1000)),maxLag=Math.ceil(rate/(bass?35:65));
  const frames=[],diff=new Float64Array(maxLag+1),cmnd=new Float64Array(maxLag+1);
  for(let center=0;center<n;center+=hop){
   const start=center-Math.floor(window/2);let power=0;
   for(let j=0;j<window;j++){const value=signal[Math.max(0,Math.min(n-1,start+j))];power+=value*value;}
   const rms=Math.sqrt(power/window);let hz=NaN,confidence=0;
   if(rms>.0005){
    for(let lag=1;lag<=maxLag;lag++){let sum=0;for(let j=0;j<window;j++){
     const a=signal[Math.max(0,Math.min(n-1,start+j))],b=signal[Math.max(0,Math.min(n-1,start+j+lag))];sum+=(a-b)**2;
    }diff[lag]=sum;}
    let sum=0;cmnd[0]=1;for(let lag=1;lag<=maxLag;lag++){sum+=diff[lag];cmnd[lag]=sum?diff[lag]*lag/sum:1;}
    let selected=-1,best=minLag;
    for(let lag=minLag;lag<maxLag;lag++){
     if(cmnd[lag]<cmnd[best])best=lag;
     if(cmnd[lag]<.17){while(lag+1<=maxLag&&cmnd[lag+1]<cmnd[lag])lag++;selected=lag;break;}
    }
    if(selected<0&&cmnd[best]<.32)selected=best;
    if(selected>0){const left=cmnd[selected-1],mid=cmnd[selected],right=cmnd[Math.min(selected+1,maxLag)];
     const denominator=left-2*mid+right;const correction=denominator?Math.max(-.5,Math.min(.5,.5*(left-right)/denominator)):0;
     hz=rate/(selected+correction);confidence=1-mid;
    }
   }
   frames.push({time:center/rate,hz,rms,confidence});
  }
  const peak=Math.max(...frames.map(f=>f.rms),1e-8);
  for(const f of frames)if(f.rms<Math.max(.001,peak*.045))f.hz=NaN;
  // Median filter one-frame pitch glitches without bridging rests.
  const original=frames.map(f=>f.hz);
  for(let i=1;i<frames.length-1;i++)if([original[i-1],original[i],original[i+1]].every(Number.isFinite))frames[i].hz=[original[i-1],original[i],original[i+1]].sort((a,b)=>a-b)[1];
  const voiced=frames.filter(f=>Number.isFinite(f.hz));
  return {frames,duration:input.length/inputRate,coverage:voiced.length/Math.max(1,frames.length),meanConfidence:voiced.reduce((a,f)=>a+f.confidence,0)/Math.max(1,voiced.length),peakRms:peak};
 }
 const api={analyze};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MusicAnalysis=api;
})(typeof globalThis!=='undefined'?globalThis:this);
