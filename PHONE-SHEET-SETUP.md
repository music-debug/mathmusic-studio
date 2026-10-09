# Enable online sheet reading

This package adds an experimental Audiveris reader to the free hosted app. It is not deployed yet. The recognition routes and conversion code are tested locally; the Linux Docker build and recognition within Render's free memory limit still need a live deployment test.

1. Extract MathMusic_iPhone.zip. Upload all files inside it to the root of your existing GitHub mathmusic-studio repository, replacing the old files, and commit. Include Dockerfile, run_audiveris.py, sheet_omr.py, cloud.py, requirements.txt and index.html. Do not upload your songs or diagnostic files.
2. Keep the existing service available. In Render choose New → Web Service → the same GitHub repository.
3. Name it mathmusic-studio-sheets. Select Docker as Language. Dockerfile Path is ./Dockerfile. Leave Root Directory and Docker Command blank. Select Free ($0). Deploy.
4. When Live, open the new service URL plus /api/status. It should show "sheetReader":true. If the build fails, copy the error from Render's log; do not choose a paid plan.
5. Open the new site in iPhone Safari. Find a song → Import digital sheet music → choose a screenshot from Photos or a one-page PDF from Files. PNG/JPG/PDF only, at most 6 MB. HEIC is unsupported. Recognition is limited to one task at a time and uploads 30 seconds apart. Temporary uploads are deleted when processing finishes. Job results expire and are lost on server restart.
6. Preview the graph. Wrong or missing notes still require a better source or correction. A free instance may run out of memory; this package cannot guarantee it can read every page.
7. Add the NEW URL to Home Screen after you confirm it works. Keep the old service until then. Both services share Render's free monthly instance-hour quota; after testing, suspend the old service if you no longer need it.

The official Audiveris 5.11.0 Ubuntu package is downloaded and checksum-verified during the build. Source and license: https://github.com/Audiveris/audiveris/tree/5.11.0 (AGPL-3.0). Tesseract English OCR is included. Synth audio still comes from the recognized notes, never from a recording.
