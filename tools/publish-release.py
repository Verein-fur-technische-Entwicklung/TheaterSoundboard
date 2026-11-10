"""Publish checked application packages to this repository's GitHub Releases.

Uses the existing Git credential manager in memory; never prints credentials.
Run --check first, then --publish after committing and pushing the source.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

def git(*args, **kwargs):
    return subprocess.run(['git', *args], cwd=ROOT, check=True, capture_output=True, text=True, **kwargs).stdout.strip()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    remote = git('remote', 'get-url', 'origin')
    match = re.fullmatch(r'https://github\.com/([^/]+/[^/]+?)(?:\.git)?', remote)
    if not match:
        raise SystemExit('Expected an HTTPS GitHub origin.')
    repo = match.group(1)
    credential = git('credential', 'fill', input='protocol=https\nhost=github.com\n\n')
    values = dict(line.split('=', 1) for line in credential.splitlines() if '=' in line)
    token = values.get('password')
    if not token:
        raise SystemExit('No GitHub credential available from Git credential manager.')
    base = 'https://api.github.com/repos/' + repo
    def api(method, url, data=None, binary=False):
        payload = data if binary else json.dumps(data).encode() if data is not None else None
        request = urllib.request.Request(url, payload, method=method, headers={
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'TheaterSoundboard-release',
            'Content-Type': 'application/octet-stream' if binary else 'application/json'})
        with urllib.request.urlopen(request, timeout=240) as response:
            return json.load(response)
    info = api('GET', base)
    print('Repository:', repo, '| push permission:', info.get('permissions', {}).get('push'))
    if not args.publish:
        return
    version = json.loads((ROOT / 'package.json').read_text('utf-8'))['version']
    names = [f'Theater Soundboard {version}.exe', f'Theater-Soundboard_{version}_ubuntu-amd64.deb']
    assets = []
    for name in names:
        file = ROOT / 'releases' / name
        checksum = Path(str(file) + '.sha256')
        expected = checksum.read_text('ascii').split()[0]
        if hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            raise SystemExit('Checksum mismatch: ' + name)
        assets.extend([file, checksum])
    commit = git('rev-parse', 'HEAD')
    if git('rev-parse', 'origin/main') != commit:
        raise SystemExit('Push the exact source commit to origin/main first.')
    tag = 'v' + version
    try:
        release = api('GET', base + '/releases/tags/' + tag)
        if release.get('target_commitish') != commit or not release.get('draft'):
            raise SystemExit('Release already exists; refusing to overwrite a published or different release.')
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        release = api('POST', base + '/releases', {
            'tag_name': tag, 'target_commitish': commit, 'name': 'Theater Soundboard ' + version,
            'draft': True, 'body': 'Endlosschleife pro Kachel: direkt oder mit Aus-/Einblenden. Schleifen, Blenden und Bedienung bleiben im Projekt gespeichert. Verbesserter Windows-Start mit Softwaregrafik und Wiederverwendung eines offenen Fensters.\n\nWindows: EXE direkt starten. Ubuntu Desktop 24.04+ amd64: DEB installieren. SHA-256-Pruefsummen sind beigefuegt.\n\nSchleifen- und Desktoptests unter Windows bestanden; Debian-Paketstruktur und Linux-Laufzeit geprueft. Hoertest mit der eigenen Saalanlage bleibt erforderlich.'})
    uploaded = {a['name'] for a in release.get('assets', [])}
    for file in assets:
        if file.name in uploaded:
            continue
        url = release['upload_url'].split('{')[0] + '?name=' + urllib.parse.quote(file.name)
        result = api('POST', url, file.read_bytes(), binary=True)
        print('Uploaded:', result['name'], result['size'])
    result = api('PATCH', base + '/releases/' + str(release['id']), {'draft': False})
    print('Published:', result['html_url'])

if __name__ == '__main__':
    main()
