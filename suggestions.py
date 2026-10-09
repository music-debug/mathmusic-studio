"""Song/artist names only from Apple's public search API; no audio previews."""
import json
import threading
import time
from urllib.parse import urlencode
from midi_search import fetch
CACHE={}
LOCK=threading.Lock()
LAST=0.0

def suggest(query,kind='song',artist=''):
    global LAST
    if not isinstance(query,str) or not isinstance(artist,str) or len(query)>200 or len(artist)>200 or kind not in ('song','artist'):
        raise ValueError('Invalid suggestion query.')
    if len(query.strip())<3:return {'items':[]}
    key=(query.strip().casefold(),kind,artist.strip().casefold())
    now=time.monotonic()
    with LOCK:
        cached=CACHE.get(key)
        if cached and now-cached[0]<3600:return {'items':cached[1]}
        if now-LAST<3.2:return {'items':[], 'message':'Keep typing or choose a recent suggestion.'}
        LAST=now
    params={'term':query+(' '+artist if kind=='song' else ''),'media':'music','entity':'song' if kind=='song' else 'musicArtist','limit':12,'country':'US'}
    try:
        result=json.loads(fetch('https://itunes.apple.com/search?'+urlencode(params),1024*1024))
        items=[];seen=set()
        for row in result.get('results',[]):
            title=str(row.get('trackName',''))[:200] if kind=='song' else ''
            singer=str(row.get('artistName',''))[:200]
            pair=(title,singer)
            if not singer or (kind=='song' and not title) or pair in seen:continue
            seen.add(pair);items.append({'title':title,'artist':singer})
        with LOCK:
            if len(CACHE)>300:CACHE.clear()
            CACHE[key]=(now,items)
        return {'items':items}
    except (ValueError,OSError):return {'items':[], 'message':'Online suggestions unavailable. You can still type the full name.'}
