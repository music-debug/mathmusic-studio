"""Small WSGI service: static Studio and bounded public MIDI lookup only."""
from pathlib import Path
import json
import mimetypes
import threading
import midi_search
import suggestions
import score_import
from urllib.parse import parse_qs
ROOT=Path(__file__).resolve().parent
ASSETS={name for name in ('index.html','style.css','engine.js','app.js','worker.js','analysis.js','upload.js','waveform.js','waveform-ui.js','neural.js','midi.js','song-search.js','suggestions.js','settings.js')}
SEARCH=threading.BoundedSemaphore(2)
def application(env,start_response):
    def reply(code,body,mime='application/json'):
        if not isinstance(body,bytes):body=json.dumps(body).encode()
        start_response(code,[('Content-Type',mime),('Content-Length',str(len(body))),('Cache-Control','no-store'),('X-Content-Type-Options','nosniff')])
        return [body]
    method,path=env.get('REQUEST_METHOD','GET'),env.get('PATH_INFO','/')
    if method=='GET' and path=='/api/suggest':
        try:
            q=parse_qs(env.get('QUERY_STRING',''))
            return reply('200 OK',suggestions.suggest(q.get('q',[''])[0],q.get('kind',['song'])[0],q.get('artist',[''])[0]))
        except ValueError as error:return reply('400 Bad Request',{'error':str(error)})
    if method=='GET' and path=='/api/status':return reply('200 OK',{'ffmpeg':False,'songModels':False,'cloud':True})
    if method=='POST' and path=='/api/score-import':
        origin=env.get('HTTP_ORIGIN')
        if origin and origin.split('://',1)[-1]!=env.get('HTTP_HOST'):return reply('403 Forbidden',{'error':'Open scores from this Studio website.'})
        try:
            size=int(env.get('CONTENT_LENGTH') or 0)
            if not 0<size<=10*1024*1024:raise ValueError('Choose a score smaller than 10 MB.')
            return reply('200 OK',score_import.parse(env['wsgi.input'].read(size)))
        except ValueError as error:return reply('400 Bad Request',{'error':str(error)})
    if method=='POST' and path=='/api/midi-find':
        origin=env.get('HTTP_ORIGIN')
        if origin and origin.split('://',1)[-1]!=env.get('HTTP_HOST'):return reply('403 Forbidden',{'error':'Open song search from this Studio website.'})
        if not SEARCH.acquire(blocking=False):return reply('429 Too Many Requests',{'error':'Song search is busy. Try again shortly.'})
        try:
            size=int(env.get('CONTENT_LENGTH') or 0)
            if not 0<size<=4096:raise ValueError('Enter a shorter song title.')
            query=json.loads(env['wsgi.input'].read(size))
            return reply('200 OK',midi_search.find(query.get('title',''),query.get('artist',''),source=query.get('source',''),direct_url=query.get('url','')))
        except (ValueError,TypeError,AttributeError) as error:return reply('400 Bad Request',{'error':str(error)})
        finally:SEARCH.release()
    if path.startswith('/api/'):return reply('404 Not Found',{'error':'This feature is unavailable in the free phone version.'})
    name='index.html' if path=='/' else path.lstrip('/')
    if method=='GET' and name in ASSETS:
        mime='application/javascript' if name.endswith('.js') else mimetypes.guess_type(name)[0] or 'application/octet-stream'
        return reply('200 OK',(ROOT/name).read_bytes(),mime)
    return reply('404 Not Found',{'error':'Not found.'})
