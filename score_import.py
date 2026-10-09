"""MusicXML/MXL to timed pitched tracks. Reject unsupported navigation explicitly."""
import io
import math
import zipfile
import xml.etree.ElementTree as ET
import copy

def unfold_measures(measures,warnings=None):
    """Expand simple repeat blocks and numbered voltas in written order."""
    starts={};ends={};active=None;ending=None;voltas={}
    for i,measure in enumerate(measures):
        for repeat in measure.findall('./barline/repeat'):
            if repeat.get('direction')=='forward':
                if active is not None:raise ValueError('Nested repeats need an unfolded score.')
                active=i
            elif repeat.get('direction')=='backward':
                times=int(repeat.get('times','2'))
                if not 2<=times<=8:raise ValueError('Repeat count must be between 2 and 8.')
                starts[i]=active if active is not None else 0;ends[i]=times;active=None
            else:raise ValueError('Unsupported repeat direction.')
        signs=measure.findall('./barline/ending')
        for sign in signs:
            if sign.get('type')=='start':
                import re
                value=sign.get('number','')
                if not re.fullmatch(r'\s*\d+(?:\s*[,\-]\s*\d+)*\s*',value):raise ValueError('Cannot read repeat ending numbers.')
                ending=set()
                for token in value.split(','):
                    parts=[int(x) for x in token.split('-')]
                    ending.update(range(parts[0],parts[-1]+1))
                if not ending or max(ending)>8:raise ValueError('Unsupported repeat ending number.')
        if ending:voltas[i]=ending.copy()
        if any(s.get('type') in ('stop','discontinue') for s in signs):ending=None
    if active is not None and warnings is not None:
        warnings.append('A repeat start had no matching end. That section plays once; no missing repeat was guessed. Check whether the sheet continues on another page.')
    order=[];counts={};i=0;current_pass=1;steps=0
    while i<len(measures):
        steps+=1
        if steps>10000:raise ValueError('Repeated score is too long.')
        # Reset pass at a new forward block, but preserve it on a repeat jump.
        if measures[i].find('./barline/repeat[@direction="forward"]') is not None:
            matching=[end for end,start in starts.items() if start==i]
            current_pass=counts.get(matching[0],0)+1 if matching else 1
        if i not in voltas or current_pass in voltas[i]:order.append(i)
        if i in ends:
            count=counts.get(i,0)+1;counts[i]=count
            if count<ends[i]:current_pass=count+1;i=starts[i];continue
        i+=1
    return order

def _parse(data):
    if len(data)>10*1024*1024:raise ValueError('Choose a score smaller than 10 MB.')
    if data.startswith(b'PK'):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries=archive.infolist()
            if len(entries)>200 or sum(e.file_size for e in entries)>20*1024*1024:raise ValueError('Compressed score is too large.')
            container=archive.read('META-INF/container.xml')
            if b'<!DOCTYPE' in container.upper() or b'<!ENTITY' in container.upper():raise ValueError('Unsafe score XML.')
            root=ET.fromstring(container)
            names=[e.attrib.get('full-path','') for e in root.iter() if e.tag.split('}')[-1]=='rootfile']
            if not names:raise ValueError('MXL has no score document.')
            data=archive.read(names[0])
    # Standard MusicXML DOCTYPE declarations have no internal subset. External
    # DTDs are never fetched; entities/internal subsets are rejected.
    import re
    if b'<!ENTITY' in data.upper() or re.search(br'<!DOCTYPE[^>]*\[',data,re.I):raise ValueError('Unsafe score XML.')
    root=ET.fromstring(data)
    for e in root.iter():e.tag=e.tag.split('}')[-1]
    if root.tag!='score-partwise':raise ValueError('Use a partwise MusicXML score exported from your notation app.')
    if any(any(k in e.attrib for k in ('dacapo','dalsegno','tocoda')) for e in root.findall('.//sound')):
        raise ValueError('D.C., D.S. and Coda jumps still require an unfolded MusicXML score or MIDI. Ordinary repeats and numbered endings are supported.')
    parts=root.findall('part');reference=None;repeat_warnings=[]
    for part in parts:
        if part.findall('.//repeat'):
            reference=(len(part.findall('measure')),unfold_measures(part.findall('measure'),repeat_warnings));break
    for part in parts:
        measures=part.findall('measure')
        if part.findall('.//repeat'):order=unfold_measures(measures,repeat_warnings)
        elif reference and len(measures)==reference[0]:order=reference[1]
        else:order=list(range(len(measures)))
        for measure in measures:part.remove(measure)
        for index in order:part.append(copy.deepcopy(measures[index]))
    def number(parent,path,default):
        value=parent.findtext(path)
        result=float(value) if value is not None else default
        if not math.isfinite(result):raise ValueError('Non-finite score value.')
        return result
    names={};programs={}
    for part in root.findall('./part-list/score-part'):
        pid=part.attrib.get('id','');names[pid]=part.findtext('part-name') or pid;programs[pid]=max(0,min(127,int(number(part,'midi-instrument/midi-program',1))-1))
    # Share bar boundaries across parts. A missed rest in one recognized staff
    # must not make every later note in that part arrive early.
    spans=[]
    for part in root.findall('part'):
        divisions=1.;nominal=0.
        for index,measure in enumerate(part.findall('measure')):
            cursor=0.;end=0.
            for item in measure:
                if item.tag=='attributes':
                    divisions=number(item,'divisions',divisions)
                    if divisions<=0:raise ValueError('Invalid score divisions.')
                    beat_count=number(item,'time/beats',0);beat_type=number(item,'time/beat-type',0)
                    if beat_count>0 and beat_type>0:nominal=beat_count*4/beat_type
                elif item.tag in ('backup','forward'):
                    cursor+=(-1 if item.tag=='backup' else 1)*number(item,'duration',0)/divisions
                elif item.tag=='note' and item.find('grace') is None and item.find('chord') is None:
                    cursor+=number(item,'duration',0)/divisions
                end=max(end,cursor)
            if measure.get('implicit')!='yes':end=max(end,nominal)
            while len(spans)<=index:spans.append(0.)
            spans[index]=max(spans[index],end)
    tempos=[(0.,120.)];tracks=[];steps={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11};event_count=0
    for part in root.findall('part'):
        pid=part.attrib.get('id','');events=[];ties={};measure_start=0.;divisions=1.;transpose=0.;velocity=.8
        for measure_index,measure in enumerate(part.findall('measure')):
            cursor=measure_start;furthest=cursor;previous=cursor
            for item in measure:
                if item.tag=='attributes':
                    divisions=number(item,'divisions',divisions)
                    if divisions<=0:raise ValueError('Invalid score divisions.')
                    if item.find('transpose') is not None:transpose=number(item,'transpose/chromatic',0)+12*number(item,'transpose/octave-change',0)
                elif item.tag=='direction':
                    at=cursor+number(item,'offset',0)/divisions
                    sound=item.find('sound');metro=item.find('direction-type/metronome')
                    if sound is not None:
                        if 'tempo' in sound.attrib:tempos.append((max(0,at),float(sound.attrib['tempo'])))
                        if 'dynamics' in sound.attrib:velocity=max(.05,min(1,float(sound.attrib['dynamics'])/100))
                    elif metro is not None:
                        unit={'whole':4,'half':2,'quarter':1,'eighth':.5,'16th':.25}.get(metro.findtext('beat-unit'))
                        if unit:
                            dots=len(metro.findall('beat-unit-dot'));factor=sum(.5**i for i in range(dots+1));tempos.append((max(0,at),number(metro,'per-minute',120)*unit*factor))
                elif item.tag in ('backup','forward'):
                    cursor+=(-1 if item.tag=='backup' else 1)*number(item,'duration',0)/divisions
                    if cursor<measure_start-1e-6:raise ValueError('Invalid score timing.')
                    furthest=max(furthest,cursor)
                elif item.tag=='note':
                    if item.find('grace') is not None:continue
                    duration=number(item,'duration',0)/divisions
                    chord=item.find('chord') is not None;start=previous if chord else cursor
                    if not chord:previous=start;cursor+=duration
                    furthest=max(furthest,start+duration)
                    pitch=item.find('pitch')
                    if pitch is None or duration<=0:continue
                    step=pitch.findtext('step');octave=number(pitch,'octave',4);alter=number(pitch,'alter',0)
                    if step not in steps:raise ValueError('Invalid score pitch.')
                    midi=12*(octave+1)+steps[step]+alter+transpose
                    if midi!=int(midi):raise ValueError('Microtonal scores need an exported MIDI arrangement.')
                    if not 0<=midi<=127:raise ValueError('Score pitch outside MIDI range.')
                    key=(item.findtext('voice') or '1',item.findtext('staff') or '1',midi)
                    types={t.attrib.get('type') for t in item.findall('tie')}
                    if 'stop' in types and key in ties:
                        events[ties[key]][1]=start+duration
                        if 'start' not in types:del ties[key]
                    else:
                        events.append([start,start+duration,int(midi),velocity]);event_count+=1
                        if 'start' in types:ties[key]=len(events)-1
                    if event_count>100000:raise ValueError('Score has too many notes.')
            measure_start=max(furthest,measure_start+spans[measure_index])
        if events:tracks.append({'name':names.get(pid,pid)[:100],'channel':len(tracks)%16,'program':programs.get(pid,0),'notes':events})
    if not tracks:raise ValueError('No pitched notes found in the score.')
    tempo_map={beat:bpm for beat,bpm in tempos}
    if any(not 10<=bpm<=1000 for bpm in tempo_map.values()):raise ValueError('Invalid score tempo.')
    changes=sorted(tempo_map.items());changes=[(max(0,b),v) for b,v in changes]
    def seconds(beat):
        total=0.;last=0.;bpm=120.
        for at,value in changes:
            if at>beat:break
            total+=(at-last)*60/bpm;last=at;bpm=value
        return total+(beat-last)*60/bpm
    for track in tracks:
        track['notes']=[[seconds(a),seconds(b),m,v] for a,b,m,v in track['notes']]
        track['notes'].sort(key=lambda n:n[0])
    duration=max(n[1] for track in tracks for n in track['notes'])
    if duration>7200:raise ValueError('Choose a score shorter than two hours.')
    return {'tracks':tracks,'duration':duration,'warnings':list(dict.fromkeys(repeat_warnings))+['Grace notes are omitted. Written durations and tempo markings are used; expressive rubato is not inferred.']}

def parse(data):
    try:return _parse(data)
    except (ET.ParseError,zipfile.BadZipFile,KeyError,OverflowError,RuntimeError) as error:
        raise ValueError('Cannot read this score. Export a valid MusicXML (.musicxml/.xml) or compressed MusicXML (.mxl).') from error
