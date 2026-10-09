"""Read bounded Online Sequencer protobuf note data without executing site code."""
import math
import struct

def fields(data):
    pos=0
    def integer():
        nonlocal pos
        value=0
        for shift in range(0,70,7):
            if pos>=len(data):raise ValueError('Truncated sequence data.')
            byte=data[pos];pos+=1;value|=(byte&127)<<shift
            if byte<128:return value
        raise ValueError('Invalid sequence integer.')
    while pos<len(data):
        key=integer();number,kind=key>>3,key&7
        if not number:raise ValueError('Invalid sequence field.')
        if kind==0:value=integer()
        elif kind in (1,2,5):
            size=integer() if kind==2 else 8 if kind==1 else 4
            if pos+size>len(data):raise ValueError('Truncated sequence field.')
            value=data[pos:pos+size];pos+=size
            if kind==5:value=struct.unpack('<f',value)[0]
            elif kind==1:value=struct.unpack('<d',value)[0]
        else:raise ValueError('Unsupported sequence encoding.')
        yield number,value

def parse(data):
    if len(data)>10*1024*1024:raise ValueError('Sequence is too large.')
    root=list(fields(data));setting_fields=list(fields(next((v for k,v in root if k==1),b'')));settings=dict(setting_fields)
    instruments={}
    for key,value in setting_fields:
        if key==3:
            entry=dict(fields(value));instruments[entry.get(1,0)]=dict(fields(entry.get(2,b'')))
    bpm=settings.get(1,120)
    if not isinstance(bpm,(int,float)) or not 10<=bpm<=1000:raise ValueError('Invalid sequence tempo.')
    groups={};markers=[dict(fields(v)) for k,v in root if k==3]
    # Marker semantics vary by site version; avoid silently playing wrong timing.
    if any(3 not in m for m in markers):raise ValueError('This arrangement uses global automation. Choose another arrangement or import its exported MIDI.')
    for key,value in root:
        if key!=2:continue
        note=dict(fields(value));pitch=note.get(1,0);start=note.get(2,0);length=note.get(3,0);instrument=note.get(4,0);volume=note.get(5,1)
        if not all(isinstance(v,(int,float)) and math.isfinite(v) for v in (pitch,start,length,instrument,volume)):raise ValueError('Invalid sequence note.')
        if not 0<=pitch<=127 or start<0 or length<=0 or start+length>480000:raise ValueError('Sequence note is outside supported limits.')
        # These drum-kit IDs are confirmed against the site's own MIDI export.
        if instrument%10000 in (36,60):continue
        detune=instruments.get(instrument,{}).get(9,0)
        if not isinstance(detune,(int,float)) or not math.isfinite(detune):raise ValueError('Invalid detune.')
        pitch+=round(detune/100)
        if not 0<=pitch<=127:continue
        groups.setdefault(instrument,[]).append([start*15/bpm,(start+length)*15/bpm,int(pitch),max(0,min(1,volume))])
        if sum(map(len,groups.values()))>100000:raise ValueError('Too many sequence notes.')
    tracks=[]
    for j,(i,notes) in enumerate(groups.items()):
        name=instruments.get(i,{}).get(15,b'')
        name=name.decode('utf-8','replace')[:100] if isinstance(name,bytes) else ''
        tracks.append({'name':name or 'Sequence instrument '+str(i),'channel':j%16,'program':0,'notes':sorted(notes)})
    if not tracks:raise ValueError('No playable notes in this arrangement.')
    duration=max(n[1] for t in tracks for n in t['notes'])
    if duration>7200:raise ValueError('Choose an arrangement shorter than two hours.')
    return {'tracks':tracks,'duration':duration,'warnings':['Recreated from public arrangement notes using Studio synthesis. Instrument effects and automation are omitted.']}
