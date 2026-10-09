importScripts('engine.js','analysis.js','waveform.js');
onmessage=e=>{
  try {if(e.data.type==='transcribe'){postMessage({notes:e.data.detailed?WaveGraphs.detailed(e.data.samples,e.data.rate,e.data.duration):WaveGraphs.transcribe(e.data.samples,e.data.rate,e.data.duration)});return;}if(e.data.type==='analyze'){postMessage({analysis:MusicAnalysis.analyze(e.data.samples,e.data.rate,e.data.options)});return;}if(e.data.wave){const model=WaveGraphs.build(e.data);postMessage({waveModel:model});return;}const audio=MathMusic.synthesize(e.data);postMessage({audio},[audio.buffer]);}
  catch(error){postMessage({error:error.message});}
};

