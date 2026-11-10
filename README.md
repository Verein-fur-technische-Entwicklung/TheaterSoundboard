# Theater Soundboard

Lokale Audio-App fuer Windows und Ubuntu. Keine Cloud, keine Anmeldung. Aktuelle Version: **0.3.0**.

## Starten

- **Windows:** EXE aus [GitHub Releases](https://github.com/Verein-fur-technische-Entwicklung/TheaterSoundboard/releases/latest) herunterladen und doppelklicken. Im vollstaendigen lokalen Projektordner startet `Start-Soundboard.cmd` die neueste EXE unter `releases` oder aktiviert das bereits offene Fenster. Node.js ist fuer die fertige App nicht erforderlich.
- **Ubuntu Desktop 24.04+ auf Intel/AMD 64-bit:** DEB aus demselben Release installieren und Theater Soundboard im App-Menue starten. Im Terminal: `sudo apt install ./Theater-Soundboard_0.3.0_ubuntu-amd64.deb`.
- **Browser-Vorschau:** `index.html` oeffnen. Nach Neustart muss der Browser die Dateien erneut erhalten; zum gemeinsamen Laden ZIP-Export entpacken und Projektordner oeffnen verwenden. Die Desktop-App merkt sich Dateipfade.

Die Dateien `*.sha256` enthalten die SHA-256-Pruefsummen der Downloads. Die Windows-App ist nicht digital signiert. Die Linux-App enthaelt Electron und ein eigenes AppArmor-Profil; die Sandbox wird nicht global deaktiviert.

## Bedienung

Audiodateien hinzufuegen, eine Kachel vorwaehlen und mit Leertaste starten/stoppen. Der Klickmodus kann nur vorwaehlen oder sofort ausloesen. Pro Kachel sind Stopp/Neustart oder Pause/Fortsetzen einstellbar. Pfeiltasten wechseln die Auswahl, **Esc stoppt sofort alle Einsaetze**.

Im umrandeten Griff links oben ziehen: Die Kachel bleibt am Anfasspunkt unter dem Mauszeiger. Eine farbige Luecke zeigt den Einrastplatz. Am Rand wird gescrollt. Esc oder Loslassen ausserhalb bricht ab. Der Vorstellungsmodus sperrt die Bearbeitung und zeigt groessere Kacheln; beim Verlassen und Schliessen wird nachgefragt.

Gain, Notizen, Farbe, Ein- und Ausblendzeit werden pro Kachel gespeichert. Die Restzeit zeigt die verbleibende Dauer des aktuellen Durchlaufs. Alles ausblenden beendet laufende Einsaetze mit ihren jeweiligen Ausblendzeiten.

### Endlosschleifen

Unter **Wiedergabe** waehlen:

- Einmal abspielen: normaler Einsatz ohne Wiederholung.
- Endlosschleife ohne Uebergangsblende: direkte Wiederholung der Datei. Enthaltene Stille bleibt erhalten; eine musikalisch nahtlose Datei muss passend vorbereitet sein.
- Endlosschleife mit Aus-/Einblenden: jeder Durchlauf blendet am Ende aus und startet wieder mit Einblendung. Die Zeiten unten gelten fuer jeden Wechsel. Pro Blende wird hoechstens eine halbe Dateidauer verwendet, damit kurze Dateien bei langen Einstellungen abspielbar bleiben.

Die Schleife laeuft bis Stopp oder Pause. Start/Stopp verwendet weiterhin die eingestellten Blenden; **0 Sekunden** bedeutet sofort. Esc und Alles stoppen brechen auch eine laufende Schleifenblende sofort ab und verhindern einen spaeteren Neustart. Der Vorstellungsmodus laesst die gespeicherten Schleifen unveraendert.

### Projekte und Audio

Die Desktop-App sichert den Entwurf automatisch. Dateien am bisherigen Ort lassen. Mit Audio exportieren schreibt ein Projekt samt eigenem Audio-Unterordner; beides gemeinsam auf den anderen Rechner kopieren. Fehlende Dateien verhindern einen vermeintlich vollstaendigen Export. Im Browser entsteht stattdessen eine ZIP-Datei (maximal 2 GB), die nach Entpacken ueber Projektordner oeffnen geladen werden kann.

Vorstellungscheck prueft die Lesbarkeit aller Dateien und bietet Ausgangsauswahl und einen leisen Testton. Die Ausgangsauswahl gilt fuer die aktuelle Sitzung, soweit die Laufzeit sie unterstuetzt; alternativ den Systemstandard einstellen. Den Testton an der tatsaechlichen Anlage hoeren.

Freigegebene Dateiendungen: MP3, WAV, OGG, FLAC, M4A. Der enthaltene Codec muss von der Laufzeit unterstuetzt werden. MP3 und WAV sind funktional getestet.

## Projektstruktur

- Oberflaeche: `index.html`, `style.css`, `app.js`.
- Desktop: `main.cjs`, `preload.cjs`.
- `packaging`: Linux-Launcher, AppArmor-Profil und Installationsskripte.
- `tools`: Paketbau, Windows-Starter und Release-Werkzeuge.
- `tests`: reproduzierbare Funktions- und Maustests sowie aktueller Pruefstand.
- `files`: lokale eigene Audiodateien/Projekte; bleiben aus Git und den App-Paketen heraus.
- `releases`: lokal gebaute EXE, DEB und Pruefsummen; auf GitHub als Release-Assets statt im Quellcode.

## Entwickeln und Bauen

Node.js mit npm und fuer den Ubuntu-Paketbau Python ab 3.11 benoetigt:

```sh
npm ci
npm run setup
npm start
npm run check
npm run test:loop
npm run test:desktop
npm run test:drag
npm run test:files
npm run dist:win
npm run dist:ubuntu
```

`test:files` benoetigt die drei lokal bereitgestellten MP3-Dateien unter files. Die anderen Tests erzeugen ihre Testtoene selbst. Tests verwenden eigene, ignorierte Benutzerdatenordner. Unter Umgebungen mit ELECTRON_RUN_AS_NODE diese Variable vor Electron-Tests entfernen.

Der Windows-Starter und die Windows-App verwenden Softwaregrafik, um den auf diesem Rechner beobachteten Grafikstartfehler zu umgehen. Unter der langsamen Ubuntu-TCG-Testmaschine wurde zusaetzlich `--disable-gpu` verwendet.

Pruefstand und Grenzen: [tests/RESULTS.md](tests/RESULTS.md). Ein Hoer- und Langzeittest an der echten Saalanlage bleibt vor Theaterbetrieb erforderlich.
