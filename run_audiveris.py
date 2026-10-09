#!/opt/venv/bin/python3
"""Use the official bundled runtime with conservative hosted memory settings."""
from pathlib import Path
import os
import sys

def main():
    jars=list(Path('/opt').glob('**/audiveris.jar'))
    if len(jars)!=1:raise SystemExit('Audiveris installation is missing or ambiguous.')
    app=jars[0].parent
    runtimes=list(app.parent.glob('**/bin/java'))+list(app.parent.parent.glob('runtime/bin/java'))
    if not runtimes:raise SystemExit('Bundled Audiveris Java runtime is missing.')
    command=[str(runtimes[0]),'-Xms32m','-Xmx256m','-XX:MaxMetaspaceSize=96m',
             '-XX:+UseSerialGC','-XX:ActiveProcessorCount=1','-Djava.awt.headless=true',
             '--add-exports=java.desktop/sun.awt.image=ALL-UNNAMED',
             '--enable-native-access=ALL-UNNAMED','-cp',str(app/'*'),'Audiveris',*sys.argv[1:]]
    os.execv(command[0],command)

if __name__=='__main__':main()
