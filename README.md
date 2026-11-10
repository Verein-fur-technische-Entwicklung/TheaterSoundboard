# Theater Soundboard

Ein lokaler, bedienbarer Entwurf für Windows und Linux. Keine Cloud, keine externen Schriftarten, keine Anmeldung.

## Ubuntu: fertige App installieren

Für **Ubuntu Desktop 24.04 oder neuer auf Intel/AMD 64-bit (amd64)** gibt es ein fertiges Installationspaket unter `release/Theater-Soundboard_0.1.0_ubuntu-amd64.deb`.

1. Nur diese `.deb`-Datei auf den Ubuntu-Rechner kopieren. Node.js, npm und der Quellcode werden dort nicht benötigt.
2. Die Datei mit der grafischen Paketinstallation öffnen und **Installieren** wählen. Dafür wird das Administratorkennwort benötigt. Eventuell fehlende Ubuntu-Systembibliotheken lädt die Paketverwaltung nach; dafür kann Internet nötig sein.
3. Im App-Menü **Theater Soundboard** starten. Anschließend arbeitet die App offline.

Falls die Desktopumgebung keine grafische Installation lokaler `.deb`-Dateien anbietet, einmalig im Downloadordner:

```sh
sudo apt install ./Theater-Soundboard_0.1.0_ubuntu-amd64.deb
```

Das Paket enthält Electron, das Programmsymbol, einen App-Menü-Eintrag und ein eigenes AppArmor-Profil für Chromiums Sandbox. Es verändert keine globalen Sandbox-Einstellungen und startet nicht mit `--no-sandbox`. Es ist kein Paket für ARM-Rechner oder Ubuntu 22.04.

Der Debian-Archivaufbau, die enthaltene Linux-amd64-Laufzeit, Dateiprüfsummen, Besitzer, Berechtigungen und Startdateien werden beim Bau überprüft. **Installation und Wiedergabe auf Ubuntu sind bisher nicht praktisch getestet.**

Deinstallation über die Paketverwaltung oder `sudo apt remove theater-soundboard`. Eigene Projektdateien und Benutzereinstellungen bleiben erhalten.

## Vorschau ohne Installation

`index.html` im aktuellen Firefox, Chrome oder Edge öffnen. Die sechs Demo-Kacheln enthalten keine Audiodateien. Eigene MP3-Dateien mit **Audiodateien** hinzufügen oder über **Datei auswählen** einer Kachel zuordnen.

Die Browser-Vorschau kann abspielen und die Anordnung lokal speichern. Nach einem Neuladen müssen Dateien erneut zugeordnet werden, weil der Browser keinen dauerhaften Dateizugriff erhält. Projektdateien können heruntergeladen und wieder geöffnet werden. Der Export mit Audio ist nur in der Desktopversion verfügbar.

## Desktopprogramm starten

Benötigt Node.js mit npm:

```powershell
cd D:\pythonprojects\TheaterSoundboard
npm install
npm run setup
npm start
```

Unter Linux entsprechend in den Projektordner wechseln. Eine grafische Desktopumgebung und ein funktionierender Audioausgang sind erforderlich.

Nach der Installation unter Windows auch per Doppelklick auf `Start-Soundboard.cmd`, unter Linux mit `sh start.sh` starten.

## Bedienung

- Kachel anklicken: vorwählen. In der Einstellung **Vorwählen und auslösen** startet oder stoppt derselbe Klick den Einsatz.
- **Leertaste:** ausgewählte Kachel auslösen. Pro Kachel einstellbar: Stoppen und nächster Start von vorne, oder Pausieren und Fortsetzen.
- **Pfeiltasten:** Kachel vorwählen. **Esc:** alle laufenden und pausierten Einsätze stoppen und zurücksetzen.
- Eingabefelder sind von der Leertastensteuerung ausgenommen. Esc stoppt auch während einer Texteingabe.
- Kacheln am gepunkteten Griff verschieben.
- Gain pro Kachel: −36 bis +12 dB. Positive Werte können übersteuern. Master regelt die gemeinsame Ausgangslautstärke.
- **Aufführung:** sperrt Kachelbearbeitung und Anordnung. Wiedergabesteuerung bleibt aktiv.
- **Speichern:** Projektdatei mit relativen Verweisen auf die vorhandenen Audiodateien.
- **Mit Audio exportieren:** Projektdatei plus danebenliegender Audioordner. Beide zusammen auf den anderen Rechner kopieren.
- Die Desktopversion sichert den letzten Entwurf zusätzlich automatisch im Benutzerprofil und stellt ihn beim nächsten Start wieder her. Diese Sicherung ersetzt keine gespeicherte Projektdatei.

## Installationspakete

Nach Installation der Entwicklungsabhängigkeiten:

```sh
npm run dist:win
npm run dist:linux
```

Pakete jeweils auf dem Zielbetriebssystem erstellen. Ausgabe unter `release/`. Diese erste Version ist nicht signiert.

Das Ubuntu-`.deb` kann zusätzlich unter Windows gebaut werden, ohne eine Linux-Umgebung zu installieren. Dazu wird neben Node.js auch Python ab 3.10 benötigt:

```sh
npm run dist:ubuntu
```

Der Ablauf lädt mit electron-builder die Linux-Laufzeit und verpackt sie mit `tools/build_ubuntu.py` im Debian-Format. Es werden Linux-Dateirechte explizit gesetzt und das fertige Paket direkt überprüft. Eine separate SHA-256-Prüfsumme liegt neben der `.deb`-Datei. Der Python-Paketierer verwendet ausschließlich die Standardbibliothek.

## Stand und Grenzen

Dies ist ein erster Funktionsentwurf, noch keine für Aufführungen freigegebene Version. MP3 ist das primäre Format; weitere angebotene Audioformate hängen von der Laufzeit ab. Dateien werden beim ersten Start in den Speicher geladen; es gibt noch kein vollständiges Vorladen aller Einsätze, keine Ausgangswahl, keine Fades und keine automatische Lautheitsanpassung. Die Wiedergabe läuft über den Standardausgang des Betriebssystems.

Vor einem Bühneneinsatz müssen Startverzögerung, Audioausgang, parallele Wiedergabe und Projektexport auf beiden Zielrechnern getestet werden. Betriebssystem-Ruhezustand und Audio-Gerätewechsel sind noch nicht speziell behandelt.

## Quellcode prüfen

```sh
npm run check
npm run test:desktop
```

Die Oberfläche ist bewusst mit HTML, CSS und JavaScript ohne zusätzliches UI-Framework umgesetzt. Electron stellt Fenster und Dateidialoge bereit. Die Wiedergabe verwendet Audio-Elemente mit Web-Audio-Gain pro Kachel und einem Master-Gain. Der Renderer hat keinen direkten Node.js-Zugriff.

Der Desktoptest öffnet kurz ein echtes Fenster, verwendet einen leisen synthetischen WAV-Testton und eine getrennte Datenablage unter `.smoke-data/`. Er prüft Wiedergabe, Pausenposition, Zurücksetzen, Gain, Klickmodi, Überlagerung, Eingabeschutz, Aufführungsmodus sowie Export und Wiederöffnung einschließlich Audiodatei. Er erzeugt `preview.png`. Das ersetzt keinen Hörtest mit den tatsächlichen MP3-Dateien und dem Bühnensystem.
