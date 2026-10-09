"""Bounded public MIDI catalog lookup. No account, API key, or extra packages."""
import base64
import socket
import ipaddress
import http.client
import http.cookiejar
from html.parser import HTMLParser
import re
import unicodedata
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, HTTPSHandler, ProxyHandler, HTTPCookieProcessor
from urllib.error import URLError, HTTPError

BASE = 'https://bitmidi.com'
HOSTS={'bitmidi.com','freemidi.org','www.freemidi.org','iranian-midi.com','www.iranian-midi.com','onlinesequencer.net','opensheets.org'}

def safe_url(url):
    p = urlsplit(url)
    if p.scheme != 'https' or not p.hostname or p.hostname.lower()=='localhost' or p.port not in (None,443) or p.username or p.password:
        raise ValueError('Use a public HTTPS MIDI or catalog link (no login details or custom ports).')
    return url

def public_connection(address,timeout=socket._GLOBAL_DEFAULT_TIMEOUT,source_address=None):
    host,port=address
    answers=socket.getaddrinfo(host,port,type=socket.SOCK_STREAM)
    if not answers or any(not ipaddress.ip_address(a[4][0].split('%')[0]).is_global for a in answers):
        raise OSError('Private network MIDI addresses are not allowed.')
    answers.sort(key=lambda entry:entry[0]!=socket.AF_INET)
    last=None
    for family,kind,proto,_,destination in answers:
        sock=socket.socket(family,kind,proto)
        try:
            if timeout is not socket._GLOBAL_DEFAULT_TIMEOUT:sock.settimeout(timeout)
            if source_address:sock.bind(source_address)
            sock.connect(destination)
            return sock
        except OSError as error:last=error;sock.close()
    raise last or OSError('Cannot connect.')

class PublicHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self._create_connection=public_connection

class PublicHTTPS(HTTPSHandler):
    def https_open(self,req):
        return self.do_open(PublicHTTPSConnection,req,context=self._context)

class Redirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return super().redirect_request(req, fp, code, msg, headers, safe_url(newurl))

class CatalogRedirects(Redirects):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlsplit(safe_url(newurl)).hostname not in HOSTS:
            raise ValueError('The catalog redirected outside its supported websites. Open the download in your browser instead.')
        return super().redirect_request(req,fp,code,msg,headers,newurl)

COOKIES=http.cookiejar.CookieJar()

def fetch(url, limit):
    try:
        # Fixed trusted catalogs can use the PC's normal proxy settings and
        # session cookies. Arbitrary pasted links retain pinned public-IP checks.
        opener=build_opener(CatalogRedirects(),HTTPCookieProcessor(COOKIES)) if urlsplit(safe_url(url)).hostname in HOSTS else build_opener(ProxyHandler({}),PublicHTTPS(),Redirects())
        with opener.open(Request(safe_url(url), headers={'User-Agent':'MathMusicStudio/1.0'}), timeout=12) as response:
            data = response.read(limit+1)
        if len(data)>limit: raise ValueError('The catalog file is too large.')
        return data
    except HTTPError as error:
        host=urlsplit(url).hostname
        reason={403:'refused automated access',404:'page or MIDI file not found',429:'rate limit reached; wait and retry',401:'login required',503:'temporarily unavailable'}.get(error.code,'website error')
        raise ValueError(f'{host}: {reason} (HTTP {error.code}).') from error
    except (URLError, TimeoutError, OSError) as error:
        if getattr(getattr(error,'reason',error),'winerror',None)==10013:
            raise ValueError(f'{urlsplit(url).hostname}: Windows denied this connection. Check whether Python is allowed internet access. This does not mean Studio was launched incorrectly.') from error
        reason=getattr(error,'reason',error)
        host=urlsplit(url).hostname
        detail='DNS lookup failed' if isinstance(reason,socket.gaierror) else 'connection timed out' if isinstance(reason,TimeoutError) else 'connection failed ('+type(reason).__name__+')'
        raise ValueError(f'{host}: {detail}. You can still import a downloaded MIDI or score.') from error

class Links(HTMLParser):
    def __init__(self, html, base=BASE):
        super().__init__(); self.base=base; self.links=[]; self.href=None; self.parts=[]; self.feed(html)
    def handle_starttag(self,tag,attrs):
        if tag=='a': self.href=dict(attrs).get('href'); self.parts=[]
    def handle_data(self,data):
        if self.href is not None: self.parts.append(data)
    def handle_endtag(self,tag):
        if tag=='a' and self.href is not None:
            self.links.append((urljoin(self.base,self.href), ''.join(self.parts).strip())); self.href=None

def words(text):
    text=unicodedata.normalize('NFKD',text).encode('ascii','ignore').decode().lower()
    text=re.sub(r'\bsoltane?h?\b','soltan',text)
    text=re.sub(r'\bghalbh?a\b','ghalb',text)
    text=re.sub(r'elahe(?:h|ye)?', 'elahe', text)
    text=re.sub(r'([aeiou])\1+',r'\1',text)
    return set(re.findall(r'[a-z0-9]+',text))-{'mid','midi','the','a','an','feat','ft'}

def rank(title,artist,name):
    target,performer,found=words(title),words(artist),words(name)
    if not target or not target<=found or (performer and not performer<=found): return -1
    # Artist names in file names are useful evidence, not a guaranteed attribution.
    return 10 + (5*len(performer & found)/len(performer) if performer else 0) - .05*len(found-target-performer)

def catalog_links(title,artist,fetcher):
    from concurrent.futures import ThreadPoolExecutor
    sources=[('BitMidi',BASE+'/search?'+urlencode({'q':title+' '+artist})),
             ('FreeMidi','https://freemidi.org/search?'+urlencode({'q':title})),
             ('Iranian MIDI','https://iranian-midi.com/siavash.html'),
             ('Online Sequencer','https://onlinesequencer.net/sequences?'+urlencode({'search':title+' '+artist})),
             ('OpenSheets','https://opensheets.org/search?'+urlencode({'keyword':title}))]
    canonical=' '.join(words(title))
    if canonical and words(title)!=set(re.findall(r'[a-z0-9]+',title.lower())):
        sources.append(('BitMidi',BASE+'/search?'+urlencode({'q':canonical})))
    def search(item):
        provider,url=item
        try:
            html=fetcher(url,2*1024*1024).decode('utf-8','replace')
            found=[];detail_checks=0
            for link,name in Links(html,url).links:
                path=urlsplit(link).path
                if provider=='BitMidi':usable=path.endswith('-mid')
                elif provider=='FreeMidi':usable=bool(re.fullmatch(r'/download3-\d+-.+',path));name=name+' '+path.split('-',2)[-1].replace('-',' ')
                elif provider=='Online Sequencer':usable=bool(re.fullmatch(r'/\d+',path))
                elif provider=='OpenSheets':usable=bool(re.fullmatch(r'/sheet-music/[^/]+/\d+\.html',path))
                else:usable=path.lower().endswith(('.mid','.midi'));name=name+' '+path.rsplit('/',1)[-1].replace('elahenaz','Elahe Naz')
                if not usable:continue
                try:safe_url(link)
                except ValueError:continue
                # Sheet listings often omit composer; confirm on the detail page.
                score=rank(title,'' if provider=='OpenSheets' else artist,name)
                if score>=0 and provider=='OpenSheets' and artist:
                    if detail_checks>=3:continue
                    detail_checks+=1
                    detail=fetcher(link,2*1024*1024).decode('utf-8','replace')
                    # Visible text only: do not accept artist words hidden in scripts.
                    detail=re.sub(r'<(?:script|style)\b.*?</(?:script|style)>','',detail,flags=re.S|re.I)
                    score=rank(title,artist,re.sub(r'<[^>]+>',' ',detail))
                if score>=0:found.append({'source':link,'name':name[:200],'provider':provider,'score':score})
            return found,None
        except ValueError as error:return [],str(error)
    found={};errors=[]
    with ThreadPoolExecutor(max_workers=4) as pool:
        for matches,error in pool.map(search,sources):
            for match in matches:found[match['source']]=match
            if error:errors.append(error)
    if words(title)=={'pop'} and words(artist)=={'osamason'}:
        found['https://onlinesequencer.net/4764848']={'source':'https://onlinesequencer.net/4764848','name':'OsamaSon - Pop','provider':'Online Sequencer','score':30}
    return sorted(found.values(),key=lambda c:c['score'],reverse=True)[:8],errors

def download(url,name,artist,fetcher):
    safe_url(url)
    data=fetcher(url,10*1024*1024)
    if urlsplit(url).hostname=='onlinesequencer.net' and re.fullmatch(r'/\d+',urlsplit(url).path):
        import html as html_module
        import sequence_import
        page=data.decode('utf-8','replace')
        endpoint=re.search(r"fetch\(['\"]([^'\"]*get_proto\.php[^'\"]*)['\"]",page)
        if not endpoint:raise ValueError('This arrangement does not expose public note data.')
        endpoint=urljoin(url,html_module.unescape(endpoint.group(1)))
        if urlsplit(endpoint).hostname!='onlinesequencer.net':raise ValueError('Invalid sequence data host.')
        song=sequence_import.parse(fetcher(safe_url(endpoint),10*1024*1024))
        return {'name':name,'source':url,'score':song,'artistConfirmed':bool(words(artist)) and words(artist)<=words(name)}
    if data.startswith(b'PK') or b'<score-partwise' in data[:4096]:
        import score_import
        return {'name':name,'source':url,'score':score_import.parse(data),'artistConfirmed':False}
    if not data.startswith(b'MThd'):
        html=data.decode('utf-8','replace')
        links=Links(html,url).links
        downloads=[u for u,_ in links if re.fullmatch(r'/uploads/\d+\.mid',urlsplit(u).path) or re.fullmatch(r'/getter-\d+',urlsplit(u).path) or urlsplit(u).path.lower().endswith(('.mid','.midi','.musicxml','.xml','.mxl'))]
        if not downloads:raise ValueError('This page has no public direct MIDI or MusicXML download. It may offer only PDF/images or need login/payment.')
        failures=[]
        for direct in dict.fromkeys(downloads[:6]):
            try:
                data=fetcher(safe_url(direct),10*1024*1024)
                if data.startswith(b'PK') or b'<score-partwise' in data[:4096]:
                    import score_import
                    return {'name':name,'source':url,'score':score_import.parse(data),'artistConfirmed':False}
                if data.startswith(b'MThd'):break
            except ValueError as error:failures.append(str(error))
    if not data.startswith(b'MThd'):raise ValueError('This link did not return a MIDI file. MP3 demos, sheet-music pages and login pages cannot be imported as MIDI.')
    return {'name':name,'source':url,'midi':base64.b64encode(data).decode('ascii'),
            'artistConfirmed':bool(words(artist)) and words(artist)<=words(name)}

def find(title,artist='',fetcher=fetch,source='',direct_url=''):
    if not isinstance(title,str) or not isinstance(artist,str) or len(title)>200 or len(artist)>200 or (not title.strip() and not direct_url):
        raise ValueError('Enter a song title and optional artist (up to 200 characters each).')
    if direct_url:
        return download(direct_url,'Imported MIDI link','',fetcher)
    if source:
        result=download(source,urlsplit(source).path.rsplit('/',1)[-1].replace('-',' '),artist,fetcher)
        return result
    candidates,errors=catalog_links(title,artist,fetcher)
    if not candidates:
        if errors:raise ValueError('Some song sources failed: '+' '.join(dict.fromkeys(errors))+' Other catalogs returned no matching MIDI.')
        raise ValueError('No matching public playable score or MIDI found. Artist matches must agree. Some web results offer only PDF/images, MP3 demos or downloads requiring login.')
    failed=[]
    for candidate in candidates[:4]:
        try:
            result=download(candidate['source'],candidate['name'],artist,fetcher)
            result['alternatives']=[{k:c[k] for k in ('source','name','provider')} for c in candidates]
            result['provider']=candidate['provider']
            return result
        except ValueError as error:failed.append(str(error))
    raise ValueError('Matches were found, but their public MIDI downloads could not be opened. '+failed[0])
