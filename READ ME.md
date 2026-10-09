# MathMusic Studio for iPhone

See PHONE-SHEET-SETUP.md for the online sheet-reader update. Deploy this package as a Docker web service. The old Python service remains usable but does not include the reader.

The build installs the official Audiveris 5.11.0 Ubuntu package with a verified checksum, English OCR and screenshot preparation. Uploads: PNG/JPG or a single unencrypted PDF page, at most 6 MB. One sheet task at a time, 30 seconds between submissions. Java heap capped at 256 MB; real recognition on Render's free memory limit remains unverified.

Uploads are processed on this Studio server. Temporary files are deleted after processing. Results are held in memory for 15 minutes, and lost when the server restarts. Save projects on your device. No external transcription service is used. Wrong/missing notes, failed recognition and complex navigation remain possible; preview before exporting.

Equations, drawing, rhythms, song search, MIDI/MusicXML, instrument selection and video tools remain. Synth is the default instrument. Desktop neural song models and FFmpeg conversion are not included; iPhone video export still needs device testing. Ordinary repeats and numbered endings are supported; unmatched repeat starts play once with a warning. D.C./D.S./Coda jumps still require an unfolded score.

Audiveris is an unmodified external program under AGPL-3.0. Corresponding source and license: https://github.com/Audiveris/audiveris/tree/5.11.0 . Its binary is downloaded during the Docker build, not bundled in this ZIP.

Routes, background jobs, limits, errors and score conversion passed local tests. The Docker build and actual recognition on Render still need a live test. Keep the current service until the new service works. Do not choose a paid plan.
