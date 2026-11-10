# Pruefstand 0.3.0

10.11.2026, Windows auf diesem Rechner.

Bestanden: Endlosschleife mit echtem Durchlaufwechsel, Schleifenwechsel mit Aus-/Einblendung, Pause/Fortsetzen, Alles ausblenden, sofortiger Stopp ohne Wiederanlauf, Begrenzung zu langer Blenden, Speicherung/Wiederoeffnung der Schleifenart und normales Ende ohne Wiederholung. Separate Testdaten und synthetische WAV-Datei.

Ebenfalls bestanden: bisherige Desktop-Funktionen (Gain, Dateicheck, Projekt-/Audioexport, Browser-ZIP und Ordnerimport, Klickmodi, Ueberlagerung, Vorstellungsmodus, Restzeit) und Maustests fuer Anfasspunkt, Einrastplatz, Abbruch und Autoscroll. Die drei vom Benutzer bereitgestellten MP3-Dateien wurden abgespielt und mit bytegleichem Audioexport sowie Entwurfswiederherstellung geprueft.

Debian-Paketbau prueft Archivstruktur, amd64-Laufzeit, Dateipruefsummen, Besitzer, Rechte, Starter, Symbol und AppArmor-Profil. Paketinhalt wird vor Veroeffentlichung mit dem aktuellen Quellstand verglichen.

Die vorherige Version 0.2.0 wurde unter Ubuntu 24.04.5 installiert und mit diesen MP3-Dateien einschliesslich vollstaendigem App-Neustart und Drag/Snap getestet. Die neue Schleifenfunktion 0.3.0 wurde bisher unter Windows, nicht erneut in der Ubuntu-VM ausgefuehrt.

Audio-Grenze der TCG-VM: Der App-Master erzeugte unter 0.2.0 ein nicht stummes Musiksignal (Peak 0.137). Die virtuelle QEMU-Aufnahme blieb dennoch stumm; ein End-to-End-Audionachweis gelang dort nicht. Das ist kein Hoertest am realen Zielrechner. Vor Theaterbetrieb echte Dateien, Ausgang, Interface, Blenden und laengeren Betrieb an der tatsaechlichen Anlage pruefen.

Die fertige portable Windows-EXE 0.3.0 hat zusaetzlich den MP3-Test mit bytegleichem Export, vollstaendigem App-Neustart und anschliessendem Abspielen ohne Dateizuordnung sowie die komplette Schleifentestsuite bestanden. Die App-Pakete enthalten die geprueften Quelldateien bytegleich.

Onedir-Nachtrag: Die Windows-App wurde direkt aus ihrem entpackten Laufzeitordner mit allen drei MP3s und vollstaendigem Prozessneustart erfolgreich getestet. Ein Onedir-ZIP mit allen Laufzeitdateien und SHA-256 wird zusaetzlich angeboten. Firmenrichtlinien wurden nicht veraendert oder umgangen.
