(function (root) {
  'use strict';
  const functions = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs,
    exp: Math.exp, log: Math.log, sqrt: Math.sqrt, floor: Math.floor,
    ceil: Math.ceil, round: Math.round, min: Math.min, max: Math.max,
    pow: Math.pow, mod: (a,b)=>((a%b)+b)%b,
    tri: (x,c,w)=>Math.max(1-Math.abs(x-c)/w,0),
    join: (...args)=>args.find(Number.isFinite) ?? NaN,
    piece: (x,...p)=> {
      if(p.length<4 || p.length%2 || x<p[0] || x>p[p.length-2]) return NaN;
      let lo=1,hi=p.length/2-1;
      while(lo<hi){const mid=Math.floor((lo+hi)/2);if(x<=p[mid*2])hi=mid;else lo=mid+1;}
      const i=lo*2,t=(x-p[i-2])/(p[i]-p[i-2]);return p[i+1]*t+p[i-1]*(1-t);
    }
  };
  // A small math parser, never JavaScript eval. ^ means exponentiation.
  function compile(source) {
    source=source.replace(/^\s*y\s*=\s*/i,'').replaceAll('π','pi').replaceAll('−','-');
    if(source.length>30000) throw Error('Equation is too long (maximum 30,000 characters).');
    const tokens=[]; let cursor=0;
    const pattern=/\s*(?:(\d*\.\d+(?:e[+-]?\d+)?|\d+(?:\.\d*)?(?:e[+-]?\d+)?)|([A-Za-z_]\w*)|(\*\*|[+\-*/^(),]))/iy;
    while(cursor<source.length) {
      if(!source.slice(cursor).trim()) break;
      pattern.lastIndex=cursor; const m=pattern.exec(source);
      if(!m) throw Error('Unexpected symbol near: '+source.slice(cursor,cursor+16));
      tokens.push(m[1]!==undefined?{n:Number(m[1])}:m[2]||m[3]); cursor=pattern.lastIndex;
    }
    if(tokens.length>14000) throw Error('Equation is too complex.');
    let pos=0,depth=0;
    function primary() {
      if(++depth>100) throw Error('Too many nested parentheses.');
      const t=tokens[pos++];let node;
      if(t && typeof t==='object') node=['n',t.n];
      else if(t==='(') {node=sum();if(tokens[pos++]!==')')throw Error('Missing closing parenthesis.');}
      else if(typeof t==='string' && /^[A-Za-z_]/.test(t)) {
        if(t==='x')node=['x']; else if(t==='pi'||t==='e')node=['n',t==='pi'?Math.PI:Math.E];
        else {
          if(!Object.hasOwn(functions,t))throw Error('Unknown function: '+t);
          if(tokens[pos++]!=='(')throw Error('Use '+t+'(...).');
          const args=[];
          if(tokens[pos]!==')') { do {args.push(sum());}while(tokens[pos]===',' && ++pos); }
          if(tokens[pos++]!==')')throw Error('Missing closing parenthesis in '+t+'.');
          if(!args.length) throw Error(t+' needs arguments.');
          const arity={sin:1,cos:1,tan:1,abs:1,exp:1,log:1,sqrt:1,floor:1,ceil:1,round:1,mod:2,pow:2,tri:3};
          if(arity[t] && args.length!==arity[t])throw Error(t+' needs '+arity[t]+' arguments.');
          if(t==='piece' && (args.length<5 || args.length%2!==1))throw Error('piece needs x, followed by x,y pairs.');
          node=['f',t,args];
        }
      } else throw Error('Expected a number, x, or function. Use * for multiplication.');
      depth--;return node;
    }
    function power(){let n=primary();if(tokens[pos]==='^'||tokens[pos]==='**'){pos++;n=['^',n,unary()];}return n;}
    function unary(){if(tokens[pos]==='+'){pos++;return unary();}if(tokens[pos]==='-'){pos++;return ['neg',unary()];}return power();}
    function product(){let n=unary();while(tokens[pos]==='*'||tokens[pos]==='/'){const o=tokens[pos++];n=[o,n,unary()];}return n;}
    function sum(){let n=product();while(tokens[pos]==='+'||tokens[pos]==='-'){const o=tokens[pos++];n=[o,n,product()];}return n;}
    const ast=sum();if(pos!==tokens.length)throw Error('Unexpected '+String(tokens[pos])+'. Use * for multiplication.');
    function run(n,x){
      switch(n[0]) {
        case 'n':return n[1];case 'x':return x;case 'neg':return -run(n[1],x);
        case '+':return run(n[1],x)+run(n[2],x);case '-':return run(n[1],x)-run(n[2],x);
        case '*':return run(n[1],x)*run(n[2],x);case '/':return run(n[1],x)/run(n[2],x);
        case '^':return run(n[1],x)**run(n[2],x);
        case 'f':return functions[n[1]](...n[2].map(a=>run(a,x)));
      }
    }
    return x=>run(ast,x);
  }
  function rhythm(text,shape='rounded') {
    if(typeof text!=='string'||text.length>4000)throw Error('Keep the rhythm under 4,000 characters.');
    let at=0,events=[];
    const known=['bum','boom','brr','dum','dun','kick','snare','hat','tss','tsk','clap','bang','bap','bop','do','da','ta','ka','pa','ts'];
    const rest=/^(rest|pause|silence|shh|_)$/i;
    function hit(word,when){
      const lower=word.toLowerCase(),strong=word===word.toUpperCase()&&/[a-z]/i.test(word);
      let height=/^(kick|boom|dum|dun|bum)$/.test(lower)?3.5:/^(hat|tss|tsk|ts)$/.test(lower)?5.5:/^(snare|clap|ka|pa|ta)$/.test(lower)?4.4:3.8;
      events.push({at:when,strong,word,height:height+(strong?.6:0)});
    }
    function expand(word){
      if(rest.test(word))return [word];
      // Prefer known syllables in joined phrases; arbitrary words remain one hit.
      const result=[];let offset=0;
      while(offset<word.length){const match=known.find(k=>word.slice(offset,offset+k.length).toLowerCase()===k);if(!match)return [word];result.push(word.slice(offset,offset+match.length));offset+=match.length;}
      return result;
    }
    const tokens=text.match(/\[[^\]]*\](?:\*\d+)?|[^\s.,|/]+|[.,|/]/gu)||[];
    for(const token of tokens){
      if(/^[.,|/]$/.test(token)){at+=token==='.'?1:.5;continue;}
      const repetition=token.match(/^(.*)\*(\d+)$/),count=repetition?Number(repetition[2]):1,base=repetition?repetition[1]:token;
      if(count<1||count>16)throw Error('Use repeats from *1 to *16.');
      const group=base.startsWith('[')&&base.endsWith(']');
      if(/[\[\]]/.test(base)&&!group)throw Error('Close each fast group: [dum ka tss].');
      const duration=base.match(/:(\d+(?:\.\d+)?)$/),beats=duration?Number(duration[1]):1;
      if(beats<.125||beats>8)throw Error('Hit lengths must be between :0.125 and :8 beats.');
      const body=duration?base.slice(0,base.lastIndexOf(':')):base;
      const words=(group?body.slice(1,-1).split(/[\s-]+/):body.split('-')).filter(Boolean).flatMap(expand);
      if(!words.length)throw Error('A fast group needs at least one word.');
      for(const word of words)if(!/^[\p{L}\p{N}_]+$/u.test(word))throw Error('Use words, hyphens, [fast groups], *repeats, :lengths and pauses.');
      for(let repeat=0;repeat<count;repeat++){
        words.forEach((word,i)=>{if(!rest.test(word))hit(word,at+i*beats/words.length);});at+=beats;
      }
      if(events.length>96||at>256)throw Error('Keep a phrase to 96 hits and 256 beats or fewer.');
    }
    if(!events.length)throw Error('Type a rhythm, such as dum ka tss [dum ka ka] rest.');
    const period=Math.max(2,Math.ceil(at));
    const fmt=v=>Number(v.toFixed(4)).toString();
    const terms=events.map(e=>{
      const d=`mod(x-${fmt(e.at)},${period})`,a=e.height;
      if(shape==='triangles')return `${a}*tri(${d},0.20,0.20)`;
      if(shape==='zigzag')return `${a}*max(1-${d}/0.32,0)+1.6*tri(${d},0.48,0.12)`;
      if(shape==='hooks')return `${a}/(1+75*${d}^2)+1.4*tri(${d},0.42,0.11)`;
      return `${a}/(1+75*${d}^2)`;
    });
    return {equation:'-2.8+max('+terms.join(',')+')',period,events};
  }
  function simplify(points,tolerance=.035) {
    if(points.length<=2)return points;
    const a=points[0],b=points[points.length-1];let max=0,index=0;
    for(let i=1;i<points.length-1;i++){
      const t=(points[i][0]-a[0])/(b[0]-a[0]||1);
      const distance=Math.abs(points[i][1]-(a[1]+t*(b[1]-a[1])));
      if(distance>max){max=distance;index=i;}
    }
    if(max<=tolerance)return [a,b];
    return [...simplify(points.slice(0,index+1),tolerance).slice(0,-1),...simplify(points.slice(index),tolerance)];
  }
  function drawingEquation(strokes,tolerance=.035) {
    const parts=strokes.filter(s=>s.length>=2).map(s=>{
      // A graph has one y at each x: later marks replace earlier marks at that x.
      const bins=new Map(s.map(p=>[Math.round(p[0]*1000)/1000,p[1]]));
      const points=simplify([...bins].sort((a,b)=>a[0]-b[0]),tolerance);
      if(points.length<2)return null;
      return 'piece(x,'+points.flat().map(v=>Number(v.toFixed(4))).join(',')+')';
    }).filter(Boolean);
    if(!parts.length)throw Error('Draw at least one stroke from left to right.');
    return parts.length===1?parts[0]:'join('+parts.join(',')+')';
  }
  function sample(config,count=2400) {
    const fn=compile(config.equation),points=[];
    for(let i=0;i<=count;i++){
      const x=config.xmin+(config.xmax-config.xmin)*i/count;
      const y=fn(x);points.push([x,Number.isFinite(y)&&Math.abs(y)<=config.yrange?y:NaN]);
    }
    return points;
  }
  function synthesize(config,rate=44100) {
    const fn=compile(config.equation),gainFn=config.gainEquation?compile(config.gainEquation):null,n=Math.round(config.duration*rate),out=new Float32Array(n);
    let phase=0,level=0,peak=0;const brightness=config.brightness/100;
    const exponent=1.08+(1-brightness)*1.8;
    const weights=Array.from({length:32},(_,i)=>1/((i+1)**exponent));
    const center=config.bass*2**(config.transpose/12);
    for(let i=0;i<n;i++){
      const x=config.xmin+(config.xmax-config.xmin)*Math.min(i/rate/(config.duration-1/30),1);
      const y=fn(x),valid=Number.isFinite(y)&&Math.abs(y)<=config.yrange;
      level+=(Number(valid)-level)*.04;
      const hz=valid?Math.min(5000,Math.max(20,center*2**(config.depth*(y+2.8)))):center;
      phase=(phase+hz/rate)%1;
      let v=0;
      for(let h=1;h<=32;h++){
        const cutoff=Math.min(1,Math.max(0,(rate*.46-h*hz)/(rate*.08)));
        if(cutoff)v+=Math.sin(2*Math.PI*h*phase)*weights[h-1]*cutoff;
      }
      // Fundamental is part of the same oscillator, never an independent bass line.
      const envelope=gainFn?gainFn(x):1;
      v=(v+config.sub/100*Math.sin(2*Math.PI*phase))*level*(Number.isFinite(envelope)?Math.max(0,Math.min(1,envelope)):0);
      v*=Math.min(1,i/(rate*.004),(n-i)/(rate*.01));
      out[i]=v;peak=Math.max(peak,Math.abs(v));
    }
    const gain=.86/Math.max(peak,1e-9);for(let i=0;i<n;i++)out[i]*=gain;
    return out;
  }
  const api={compile,rhythm,simplify,drawingEquation,sample,synthesize};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MathMusic=api;
})(typeof globalThis!=='undefined'?globalThis:this);
