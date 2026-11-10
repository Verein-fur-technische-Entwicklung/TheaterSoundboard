"""Build and verify a Debian package without executing Linux tools.

Requires an Electron linux-x64 directory produced by electron-builder --linux --dir.
All Debian archive permissions and owners are written explicitly, also on Windows.
The resulting .deb targets Ubuntu Desktop 24.04+ on amd64, with AppArmor 4 support.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import math
from pathlib import Path, PurePosixPath
import struct
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PACKAGE_NAME = "theater-soundboard"
INSTALL_PATH = "opt/theater-soundboard"
LINUX_FILES = ROOT / "packaging" / "linux"
DEPENDENCIES = [
    "apparmor (>= 4.0)", "libc6 (>= 2.35)", "libgcc-s1", "libstdc++6",
    "libasound2t64 | libasound2", "libatk-bridge2.0-0t64 | libatk-bridge2.0-0",
    "libatk1.0-0t64 | libatk1.0-0", "libatspi2.0-0t64 | libatspi2.0-0",
    "libcairo2", "libcups2t64 | libcups2", "libdbus-1-3", "libdrm2", "libexpat1",
    "libgbm1", "libglib2.0-0t64 | libglib2.0-0", "libgtk-3-0t64 | libgtk-3-0",
    "libnspr4", "libnss3", "libpango-1.0-0", "libudev1", "libx11-6", "libxcb1",
    "libxcomposite1", "libxdamage1", "libxext6", "libxfixes3", "libxkbcommon0",
    "libxrandr2", "libxss1", "libxtst6", "zlib1g", "xdg-utils",
]


def text_bytes(file: Path) -> bytes:
    return file.read_text(encoding="utf-8").replace("\r\n", "\n").encode("utf-8")


def add_bytes(archive: tarfile.TarFile, name: str, data: bytes, mode: int = 0o644):
    info = tarfile.TarInfo("./" + name)
    info.size = len(data)
    info.mode = mode
    info.uid = info.gid = 0
    info.uname = info.gname = "root"
    info.mtime = 0
    archive.addfile(info, io.BytesIO(data))


def ar_member(output, name: str, source: Path | bytes):
    size = len(source) if isinstance(source, bytes) else source.stat().st_size
    header = f"{name + '/':<16}{0:<12}{0:<6}{0:<6}{'100644':<8}{size:<10}`\n"
    if len(header) != 60:
        raise ValueError("Invalid ar header")
    output.write(header.encode("ascii"))
    if isinstance(source, bytes):
        output.write(source)
    else:
        with source.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                output.write(chunk)
    if size % 2:
        output.write(b"\n")


def verify(package: Path):
    members = {}
    with package.open("rb") as stream:
        assert stream.read(8) == b"!<arch>\n", "Invalid Debian ar signature"
        while header := stream.read(60):
            assert len(header) == 60 and header[58:] == b"`\n", "Invalid ar member"
            name = header[:16].decode("ascii").strip().rstrip("/")
            size = int(header[48:58])
            members[name] = stream.read(size)
            if size % 2:
                stream.read(1)
    assert list(members) == ["debian-binary", "control.tar.gz", "data.tar.gz"]
    assert members["debian-binary"] == b"2.0\n"
    with tarfile.open(fileobj=io.BytesIO(members["control.tar.gz"]), mode="r:gz") as archive:
        control = archive.extractfile("./control").read().decode("utf-8")
        assert "Architecture: amd64\n" in control
        assert "Package: theater-soundboard\n" in control
        assert "apparmor (>= 4.0)" in control
        for name in ["./postinst", "./prerm"]:
            assert archive.getmember(name).mode == 0o755
            content = archive.extractfile(name).read()
            assert content.startswith(b"#!/bin/sh\n") and b"\r" not in content
        checksums = dict(line.split("  ", 1)[::-1] for line in archive.extractfile("./md5sums").read().decode().splitlines())
    with tarfile.open(fileobj=io.BytesIO(members["data.tar.gz"]), mode="r:gz") as archive:
        names = archive.getnames()
        for name in names:
            assert name.startswith("./") and ".." not in Path(name).parts
            item = archive.getmember(name)
            assert item.uid == item.gid == 0
            if item.isfile():
                assert hashlib.md5(archive.extractfile(item).read()).hexdigest() == checksums[name[2:]]
        executable = archive.getmember(f"./{INSTALL_PATH}/theater-soundboard")
        assert executable.mode == 0o755
        elf = archive.extractfile(executable).read(64)
        assert elf[:4] == b"\x7fELF" and elf[4] == 2 and struct.unpack_from("<H", elf, 18)[0] == 62
        assert archive.getmember(f"./{INSTALL_PATH}/chrome-sandbox").mode == 0o755
        assert archive.extractfile(f"./{INSTALL_PATH}/resources/app.asar").read(4)
        launcher = archive.extractfile("./usr/bin/theater-soundboard").read()
        assert b"--no-sandbox" not in launcher and b"\r" not in launcher
        profile = archive.extractfile("./etc/apparmor.d/theater-soundboard").read()
        assert b"/opt/theater-soundboard/theater-soundboard" in profile and b"userns," in profile
        desktop = archive.extractfile("./usr/share/applications/theater-soundboard.desktop").read()
        assert b"Exec=/usr/bin/theater-soundboard\n" in desktop
        assert "./usr/share/icons/hicolor/scalable/apps/theater-soundboard.svg" in names
    print(f"PASS: Debian archive, amd64 ELF runtime, file checksums, root ownership, permissions, desktop launcher, icon and AppArmor profile ({len(names)} entries).")


def build():
    metadata = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    source = ROOT / "releases" / "linux-unpacked"
    if not (source / "theater-soundboard").is_file():
        raise SystemExit("First run: npx electron-builder --linux --x64 --dir --publish never")
    version = metadata["version"]
    output = ROOT / "releases" / f"Theater-Soundboard_{version}_ubuntu-amd64.deb"
    checksums = []
    installed_size = 0
    with tempfile.TemporaryDirectory(prefix="ubuntu-build-", dir=ROOT / "releases") as temporary:
        temp = Path(temporary)
        data_file = temp / "data.tar.gz"
        with data_file.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, compresslevel=6) as compressed:
            with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.GNU_FORMAT) as archive:
                directories = set()

                def add(name: str, data: bytes, mode: int = 0o644):
                    nonlocal installed_size
                    for parent in reversed(PurePosixPath(name).parents):
                        directory = parent.as_posix()
                        if directory == "." or directory in directories:
                            continue
                        info = tarfile.TarInfo("./" + directory)
                        info.type = tarfile.DIRTYPE
                        info.mode = 0o755
                        info.uid = info.gid = 0
                        info.uname = info.gname = "root"
                        info.mtime = 0
                        archive.addfile(info)
                        directories.add(directory)
                    add_bytes(archive, name, data, mode)
                    checksums.append(f"{hashlib.md5(data).hexdigest()}  {name}")
                    installed_size += len(data)

                for file in sorted(source.rglob("*")):
                    if not file.is_file():
                        continue
                    relative = file.relative_to(source).as_posix()
                    mode = 0o755 if relative in {"theater-soundboard", "chrome-sandbox", "chrome_crashpad_handler"} else 0o644
                    add(f"{INSTALL_PATH}/{relative}", file.read_bytes(), mode)
                extra = [
                    ("theater-soundboard-launcher", "usr/bin/theater-soundboard", 0o755),
                    ("theater-soundboard.desktop", "usr/share/applications/theater-soundboard.desktop", 0o644),
                    ("theater-soundboard.svg", "usr/share/icons/hicolor/scalable/apps/theater-soundboard.svg", 0o644),
                    ("theater-soundboard.apparmor", "etc/apparmor.d/theater-soundboard", 0o644),
                ]
                for local, target, mode in extra:
                    add(target, text_bytes(LINUX_FILES / local), mode)
                add("usr/share/doc/theater-soundboard/README.md", text_bytes(ROOT / "README.md"))
        control = (
            f"Package: {PACKAGE_NAME}\nVersion: {version}\nSection: sound\nPriority: optional\n"
            "Architecture: amd64\nMaintainer: Theater Soundboard <noreply@example.invalid>\n"
            f"Installed-Size: {math.ceil(installed_size / 1024)}\n"
            f"Depends: {', '.join(DEPENDENCIES)}\n"
            "Description: Soundboard fuer Theaterauffuehrungen\n"
            " Lokales Soundboard mit Audio-Kacheln, Gain, Start/Stopp oder Pause,\n"
            " Projektverwaltung und Tastatursteuerung. Electron ist enthalten.\n"
            " Fuer Ubuntu Desktop 24.04 oder neuer auf Intel/AMD 64-bit.\n"
        ).encode("utf-8")
        control_file = temp / "control.tar.gz"
        with control_file.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.GNU_FORMAT) as archive:
                add_bytes(archive, "control", control)
                add_bytes(archive, "md5sums", ("\n".join(checksums) + "\n").encode())
                add_bytes(archive, "conffiles", b"/etc/apparmor.d/theater-soundboard\n")
                for script in ["postinst", "prerm"]:
                    add_bytes(archive, script, text_bytes(LINUX_FILES / script), 0o755)
        with output.open("wb") as archive:
            archive.write(b"!<arch>\n")
            ar_member(archive, "debian-binary", b"2.0\n")
            ar_member(archive, "control.tar.gz", control_file)
            ar_member(archive, "data.tar.gz", data_file)
    verify(output)
    with output.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    (output.parent / (output.name + ".sha256")).write_text(f"{digest}  {output.name}\n", encoding="ascii")
    print(f"Built: {output} ({output.stat().st_size / 1024 / 1024:.1f} MiB)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", type=Path, help="Verify an existing .deb without installing it")
    args = parser.parse_args()
    verify(args.verify) if args.verify else build()
