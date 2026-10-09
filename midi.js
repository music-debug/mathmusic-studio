(function(root){
'use strict';
function parse(buffer){
 const v=new DataView(buffer);let pos=0,eventCount=0;const tempos=[{tick:0,us:500000,order:-1}],groups=[];
 const need=n=>{if(pos+n>v.byteLength)throw Error('This MIDI file is truncated.');};
 const u8=()=>{need(1);return v.getUint8(pos++);};
 const u16=()=>{need(2);const n=v.getUint16(pos);pos+=2;return n;};
 const u32=()=>{need(4);const n=v.getUint32(pos);pos+=4;return n;};
 const text=n=>{need(n);let s='';for(let i=0;i<n;i++)s+=String.fromCharCode(u8());return s;};
 const vlq=()=>{let n=0;for(let i=0;i<4;i++){const b=u8();n=n*128+(b&127);if(!(b&128))return n;}throw Error('Invalid MIDI timing.');};
 if(text(4)!=='MThd')throw Error('Choose a standard .mid or .midi file.');
 const header=u32(),headerStart=pos;if(header<6)throw Error('Invalid MIDI header.');
 const format=u16(),tracks=u16(),division=u16();if(format>1)throw Error('Only MIDI formats 0 and 1 are supported.');if(!division||(division&32768))throw Error('SMPTE timing is not supported.');if(tracks>256)throw Error('Too many MIDI tracks.');need(header-6);pos=headerStart+header;
 for(let tr=0;tr<tracks;tr++){
  if(text(4)!=='MTrk')throw Error('Invalid MIDI track.');const length=u32(),end=pos+length;need(length);let tick=0,running=0,name='Track '+(tr+1);const channels=new Map();
  const channel=ch=>{if(!channels.has(ch))channels.set(ch,{name,channel:ch,program:0,notes:[],active:new Map(),held:[],pedal:false});return channels.get(ch);};
  const close=(c,n)=>{if(tick>n.start)c.notes.push([n.start,tick,n.pitch,n.velocity/127]);};
  while(pos<end){
   if(++eventCount>500000)throw Error('Too many MIDI events.');tick+=vlq();let status=u8();if(status<128){if(!running)throw Error('Invalid running status.');pos--;status=running;}else if(status<240)running=status;
   if(status===255){const type=u8(),len=vlq();if(pos+len>end)throw Error('Invalid MIDI metadata.');if(type===3){name=text(len).replace(/[\x00-\x1f]/g,' ').slice(0,100);for(const c of channels.values())c.name=name;}else if(type===81&&len===3){const us=(u8()<<16)|(u8()<<8)|u8();if(us>0)tempos.push({tick,us,order:eventCount});}else pos+=len;if(type===47){pos=end;break;}}
   else if(status===240||status===247){const len=vlq();if(pos+len>end)throw Error('Invalid system event.');pos+=len;running=0;}
   else if(status<240){const kind=status>>4,ch=status&15,a=u8(),b=(kind===12||kind===13)?0:u8();if(a>127||b>127)throw Error('Invalid event data.');const c=channel(ch);
    if(kind===9&&b){const queue=c.active.get(a)||[];queue.push({start:tick,pitch:a,velocity:b});c.active.set(a,queue);}
    else if(kind===8||(kind===9&&!b)){const queue=c.active.get(a);if(queue?.length){const note=queue.shift();c.pedal?c.held.push(note):close(c,note);}}
    else if(kind===12)c.program=a;
    else if(kind===11&&a===64){const down=b>=64;if(c.pedal&&!down){for(const n of c.held)close(c,n);c.held=[];}c.pedal=down;}
    else if(kind===11&&(a===120||a===123)){for(const queue of c.active.values())for(const n of queue)close(c,n);for(const n of c.held)close(c,n);c.active.clear();c.held=[];}
   }else throw Error('Unsupported MIDI system event.');
   if(pos>end)throw Error('Invalid MIDI track length.');
  }
  for(const c of channels.values()){for(const queue of c.active.values())for(const n of queue)close(c,n);for(const n of c.held)close(c,n);if(c.channel!==9&&c.notes.length)groups.push({name:c.name,channel:c.channel,program:c.program,notes:c.notes});}
 }
 tempos.sort((a,b)=>a.tick-b.tick||a.order-b.order);const map=[];let last=0,seconds=0,us=500000;
 for(const t of tempos){seconds+=(t.tick-last)*us/(division*1e6);last=t.tick;us=t.us;map.push({tick:last,seconds,us});}
 function time(tick){let low=0,high=map.length-1;while(low<high){const mid=Math.ceil((low+high)/2);if(map[mid].tick<=tick)low=mid;else high=mid-1;}const t=map[low];return t.seconds+(tick-t.tick)*t.us/(division*1e6);}
 let duration=0;for(const g of groups){g.notes=g.notes.map(n=>[time(n[0]),time(n[1]),n[2],n[3]]).sort((a,b)=>a[0]-b[0]);for(const n of g.notes)duration=Math.max(duration,n[1]);}
 if(!groups.length)throw Error('No pitched notes found. Drum-only MIDI cannot provide a melody.');return {tracks:groups,duration};
}
function excerpt(notes,start,duration,transpose=0){return notes.filter(n=>n[1]>start&&n[0]<start+duration).map(n=>[Math.max(0,n[0]-start),Math.min(duration,n[1]-start),n[2]+transpose,n[3]]).filter(n=>n[2]>=0&&n[2]<=127&&n[1]>n[0]);}
const api={parse,excerpt};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MidiNotes=api;
})(globalThis);
