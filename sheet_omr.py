"""Local, asynchronous Audiveris sheet recognition; uploads never leave Studio."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
import score_import

HOSTED=os.environ.get('MATHMUSIC_HOSTED_OMR')=='1'
LAST_START=0.
LOCK=threading.Lock()
JOBS={}

def command_for(engine,output,source):
    # The Windows GUI launcher can hide stdout/stderr. Use the bundled runtime
    # with the same required VM options so batch failures reach our log.
    install=Path(engine).parent
    java=install/'runtime'/'bin'/'java.exe'
    app=install/'app'
    prefix=[engine]
    if java.is_file() and (app/'audiveris.jar').is_file():
        prefix=[str(java),'--add-exports=java.desktop/sun.awt.image=ALL-UNNAMED','--enable-native-access=ALL-UNNAMED','-Xmx2G','-cp',str(app/'*'),'Audiveris']
    return prefix+['-batch','-transcribe','-export','-output',str(output),'--',str(source)]

def failure(log,code):
    text=log.read_text(encoding='utf-8',errors='replace') if log.exists() else ''
    saved=Path(__file__).resolve().parent/'.sheet-diagnostics'
    try:
        if HOSTED:raise OSError('Hosted diagnostics are not retained.')
        saved.mkdir(exist_ok=True)
        (saved/'latest.log').write_text(text,encoding='utf-8')
        projects=list((log.parent/'recognized').rglob('*.omr'))
        if len(projects)==1:shutil.copy2(projects[0],saved/'latest.omr')
        location=' Details are saved in .sheet-diagnostics/latest.log inside the running Studio folder.'
    except OSError:location=''
    lower=text.lower()
    if 'purgevoices' in lower and 'measure' in lower and 'null' in lower:
        reason='Audiveris crashed while assigning rhythms to a missing measure. OCR and image resolution passed. Try the original PDF or a clean full-page image. The recognition project is saved as .sheet-diagnostics/latest.omr when available; open it in Audiveris to correct the measures, then export MIDI or MusicXML.'
    elif 'too low interline' in lower or 'picture resolution is too low' in lower:
        reason='Audiveris rejected the image because its staff lines are too close together. Try a screenshot taken after zooming into the sheet, or use the original PDF. Studio enlarges small images automatically, but missing detail cannot be recovered.'
        if 'no installed ocr languages' in lower:reason+=' Also open Audiveris and install English OCR once.'
    elif 'no installed ocr languages' in lower or 'tessdata' in lower or 'failed loading language' in lower or 'eng.traineddata' in lower:
        reason='Audiveris could not load its OCR language. Open Audiveris and install English OCR, then retry.'
    elif 'could not get shell folder' in lower or 'accessdenied' in lower or 'access is denied' in lower:
        reason='Windows blocked Audiveris from accessing a required folder. Run Studio normally outside the chat and check the saved log.'
    else:
        lines=[line.strip() for line in text.splitlines() if any(word in line.lower() for word in ('error','exception','failed','invalid','no staff','too small'))]
        reason='Audiveris produced no usable score (exit '+str(code)+').'
        if lines:reason+=' '+lines[-1][:350]
        else:reason+=' Try one clear, cropped page and check it in Audiveris.'
    if HOSTED:
        if code in (-9,137) or 'outofmemoryerror' in lower:return 'The free server ran out of memory. Try a smaller single-page screenshot.'
        reason=reason.split(' The recognition project')[0]
    return reason+location

def executable():
    candidates=[os.environ.get('MATHMUSIC_AUDIVERIS',''),shutil.which('Audiveris') or '']
    for base in (os.environ.get('ProgramFiles',''),os.environ.get('LOCALAPPDATA','')):
        candidates.extend(str(Path(base)/p) for p in ('Audiveris/Audiveris.exe','Programs/Audiveris/Audiveris.exe'))
    return next((p for p in candidates if p and Path(p).is_file()),None)

def file_type(data):
    if data.startswith(b'%PDF-'):return '.pdf'
    if data.startswith(b'\x89PNG\r\n\x1a\n'):return '.png'
    if data.startswith(b'\xff\xd8\xff'):return '.jpg'
    raise ValueError('Choose a PNG, JPG or PDF sheet. For iPhone HEIC photos, save as JPG first.')

def prepare_image(data,source,variant=0):
    if file_type(data)=='.pdf':source.write_bytes(data);return
    try:
        from PIL import Image,ImageOps
        import io
        with Image.open(io.BytesIO(data)) as original:
            if original.width*original.height>(6000000 if HOSTED else 20000000):raise ValueError('Image is too large. Crop it to one page.')
            image=ImageOps.exif_transpose(original).convert('RGBA')
            background=Image.new('RGBA',image.size,'white');background.alpha_composite(image)
            image=background.convert('RGB')
            # Screenshots commonly have only 4–5 pixels between staff lines.
            # Bring small pages closer to scanning resolution before recognition.
            target=(1800,1600,2000)[variant] if HOSTED else (2400,1800,3000)[variant]
            factor=min(5,max(1,target/max(image.size)))
            if factor>1:image=image.resize((round(image.width*factor),round(image.height*factor)),Image.Resampling.LANCZOS)
            if variant:
                gray=ImageOps.grayscale(image)
                if variant==1:gray=ImageOps.autocontrast(gray)
                else:gray=gray.point(lambda pixel:255 if pixel>175 else 0)
                image=ImageOps.expand(gray,border=60,fill='white')
            image.save(source,format='PNG')
    except ImportError as error:raise ValueError('Image preparation needs Pillow. Run Setup Sheet Reader.bat again, then restart Studio.') from error
    except (OSError,Image.DecompressionBombError) as error:raise ValueError('Cannot read this screenshot. Copy it again as PNG or JPG.') from error

def recognize(data,engine):
    suffix=file_type(data)
    if HOSTED and suffix=='.pdf':
        import io
        from pypdf import PdfReader
        try:
            pdf=PdfReader(io.BytesIO(data))
            if pdf.is_encrypted or len(pdf.pages)!=1:raise ValueError('On the free phone host, upload one unencrypted PDF page at a time.')
            box=pdf.pages[0].mediabox
            if float(box.width)>1600 or float(box.height)>1600:raise ValueError('PDF page is too large. Use a normal-size single page.')
        except ValueError:raise
        except Exception as error:raise ValueError('Cannot read this PDF. Try a PNG screenshot.') from error
    with tempfile.TemporaryDirectory(prefix='studio-sheet-') as folder:
        root=Path(folder);files=[];last_error='No usable score.'
        for variant in range(1 if suffix=='.pdf' else 3):
            attempt=root/('attempt-'+str(variant));attempt.mkdir()
            source=attempt/('sheet'+('.pdf' if suffix=='.pdf' else '.png'));prepare_image(data,source,variant)
            output=attempt/'recognized';output.mkdir()
            command=command_for(engine,output,source)
            try:
                with (attempt/'recognition.log').open('wb') as log:
                    process=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,timeout=240 if suffix=='.pdf' else 80,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            except subprocess.TimeoutExpired:
                last_error='Sheet recognition timed out after trying automatic image preparation.'
                continue
            files=sorted(output.rglob('*.mxl'))+sorted(output.rglob('*.musicxml'))
            if not process.returncode and files:break
            last_error=failure(attempt/'recognition.log',process.returncode)
            log_text=(attempt/'recognition.log').read_text(encoding='utf-8',errors='replace').lower()
            if 'no installed ocr languages' in log_text or 'could not get shell folder' in log_text:break
            files=[]
        if not files:raise ValueError(last_error)
        if len(files)!=1:raise ValueError('Multiple separate scores were detected. Upload one score at a time.')
        if files[0].stat().st_size>10*1024*1024:raise ValueError('Recognized score is too large.')
        song=score_import.parse(files[0].read_bytes())
        song.setdefault('warnings',[]).insert(0,'Automatic transcription: check notes, rhythm and tempo by previewing. Ordinary repeats and numbered endings are unfolded automatically; complex navigation still needs an unfolded score.')
        return song

def start(data):
    global LAST_START
    if not 0<len(data)<=10*1024*1024:raise ValueError('Choose a sheet smaller than 10 MB.')
    file_type(data)
    engine=executable()
    if not engine:raise ValueError('The hosted sheet reader is not installed yet. Deploy the Docker phone package to enable it.')
    with LOCK:
        if HOSTED and time.time()-LAST_START<30:raise ValueError('Wait 30 seconds between sheet uploads.')
        for key in list(JOBS):
            if time.time()-JOBS[key]['created']>900 and JOBS[key]['state']!='reading':del JOBS[key]
        if any(j['state']=='reading' for j in JOBS.values()):raise ValueError('Another sheet is being read. Please wait for it to finish.')
        while len(JOBS)>=8:
            oldest=min((k for k in JOBS if JOBS[k]['state']!='reading'),key=lambda k:JOBS[k]['created'],default=None)
            if oldest is None:break
            del JOBS[oldest]
        LAST_START=time.time()
        job=uuid.uuid4().hex;JOBS[job]={'state':'reading','created':time.time()}
    def work():
        try:result={'state':'done','score':recognize(data,engine)}
        except (ValueError,OSError) as error:result={'state':'error','error':str(error)}
        except Exception:result={'state':'error','error':'Sheet recognition failed. Try another image.'}
        with LOCK:JOBS[job].update(result)
    threading.Thread(target=work,daemon=True).start()
    return {'id':job}

def get(job):
    with LOCK:
        if job in JOBS and JOBS[job]['state']!='reading' and time.time()-JOBS[job]['created']>900:del JOBS[job]
        if job not in JOBS:raise ValueError('Sheet task expired. Upload the sheet again.')
        return {k:v for k,v in JOBS[job].items() if k!='created'}
