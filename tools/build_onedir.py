"""Zip electron-builder's Windows directory without a self-extracting launcher."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
version = json.loads((ROOT / 'package.json').read_text('utf-8'))['version']
source = ROOT / 'releases' / 'win-unpacked'
if not (source / 'Theater Soundboard.exe').is_file():
    raise SystemExit('Run npm run dist:win:onedir to build the Windows runtime first.')
name = f'Theater-Soundboard_{version}_windows-x64-onedir'
output = ROOT / 'releases' / (name + '.zip')
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file in sorted(source.rglob('*')):
        if file.is_file():
            archive.write(file, Path(name) / file.relative_to(source))
    archive.writestr(name + '/START-HIER.txt',
        'Gesamten ZIP-Inhalt entpacken und Theater Soundboard.exe starten.\n'
        'EXE, DLLs, locales und resources zusammen im Ordner lassen.\n'
        'Keine Selbstentpackung beim Start. Firmenrichtlinien gelten weiterhin.\n')
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None, 'ZIP integrity check failed'
with output.open('rb') as stream:
    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
Path(str(output) + '.sha256').write_text(digest + '  ' + output.name + '\n', 'ascii')
print(f'Built and verified: {output} ({output.stat().st_size / 1024 / 1024:.1f} MiB)')
