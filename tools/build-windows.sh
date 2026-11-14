#!/bin/sh
# Builds the Windows downloads in dist/:
#   ModelVault-<version>-Windows-Portable-x64.zip   portable: unzip and run ModelVault.exe
#   ModelVault-<version>-Windows-Installer.exe      installer (per user, no admin), made with NSIS's makensis
#   ModelVault-<version>-app.zip           the program only, for updating Docker and Node.js installs
# Usage: sh tools/build-windows.sh [output folder]     (needs npm, zip, makensis, and Mono's mcs for the tray icon)
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$ROOT/dist}
NODE_VERSION=22.23.4
VERSION=$(sed -n "s/^const VERSION = '\(.*\)';/\1/p" "$ROOT/server/index.js")
WORK=$(mktemp -d)
P="$WORK/ModelVault"
mkdir -p "$P/app" "$P/runtime" "$P/bin" "$P/licenses" "$OUT"
OUT=$(cd "$OUT" && pwd)   # the build changes folder, so make the output path absolute
cd "$WORK"
npm pack "node-win-x64@$NODE_VERSION" 7zip-bin@5.2.0 --silent >/dev/null
mkdir n s && tar -xzf node-win-x64-*.tgz -C n && tar -xzf 7zip-bin-*.tgz -C s
cp n/package/bin/node.exe "$P/runtime/node.exe"
cp s/package/win/x64/7za.exe "$P/bin/7z.exe"
cp s/package/LICENSE.txt "$P/licenses/7zip-bin-LICENSE.txt"
cp -r "$ROOT/server" "$ROOT/public" "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/README.md" "$P/app/"
(cd "$P/app" && npm ci --omit=dev --silent --no-audit --no-fund)
cp "$ROOT/windows/Start ModelVault.cmd" "$ROOT/windows/Stop ModelVault.cmd" "$ROOT/windows/Start ModelVault (hidden).vbs" "$ROOT/windows/READ ME FIRST.txt" "$ROOT/windows/modelvault.ico" "$P/"
# ModelVault.exe: the tray icon next to the clock, which starts and stops ModelVault (windows/tray).
cat > "$WORK/Version.cs" <<VERSIONCS
using System.Reflection;
[assembly: AssemblyTitle("ModelVault")]
[assembly: AssemblyProduct("ModelVault")]
[assembly: AssemblyDescription("ModelVault")]
[assembly: AssemblyCompany("V3sper Studios")]
[assembly: AssemblyCopyright("Copyright (c) 2026 V3sper Studios. All rights reserved.")]
[assembly: AssemblyVersion("$VERSION.0.0")]
[assembly: AssemblyFileVersion("$VERSION.0.0")]
VERSIONCS
mcs -nologo -optimize+ -target:winexe -platform:anycpu -sdk:4.5 -out:"$P/ModelVault.exe" \
  -win32icon:"$ROOT/windows/modelvault.ico" -resource:"$ROOT/windows/tray/tray.ico,ModelVault.ico" \
  -r:System.Windows.Forms.dll -r:System.Drawing.dll "$ROOT/windows/tray/ModelVaultTray.cs" "$WORK/Version.cs"
cp "$ROOT/windows/THIRD-PARTY.txt" "$P/licenses/"
cp "$ROOT/LICENSE" "$P/licenses/ModelVault-LICENSE.txt"

# Portable zip: data next to the program, settings.cmd to edit.
cp -r "$P" "$WORK/portable" && mv "$WORK/portable" "$WORK/zip-ModelVault"
cp "$ROOT/windows/settings.cmd" "$ROOT/windows/Start with Windows.cmd" "$WORK/zip-ModelVault/"
(cd "$WORK" && mv zip-ModelVault ModelVault-zip && mkdir zipdir && mv ModelVault-zip zipdir/ModelVault && cd zipdir && rm -f "$OUT/ModelVault-$VERSION-Windows-Portable-x64.zip" && zip -qr -9 "$OUT/ModelVault-$VERSION-Windows-Portable-x64.zip" ModelVault)

# App update for Docker / Node.js installs (used by Settings > About > Download and install): the program only.
mkdir -p "$WORK/appzip/ModelVault-app"
cp -r "$ROOT/server" "$ROOT/public" "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/README.md" "$ROOT/Dockerfile" "$WORK/appzip/ModelVault-app/"
(cd "$WORK/appzip" && rm -f "$OUT/ModelVault-$VERSION-app.zip" && zip -qr -9 "$OUT/ModelVault-$VERSION-app.zip" ModelVault-app)

# Installer: data and your settings in %LOCALAPPDATA%\ModelVault, so updates and uninstalling never touch them.
sed 's/^set "DATA_DIR=.*$/set "DATA_DIR=%LOCALAPPDATA%\\ModelVault\\data"\r/' "$ROOT/windows/settings.cmd" > "$P/settings.cmd"
cp "$ROOT/windows/user-settings.cmd" "$P/"
makensis -V2 -DVERSION="$VERSION" -DSRC="$P" -DOUTFILE="$OUT/ModelVault-$VERSION-Windows-Installer.exe" "$ROOT/windows/installer.nsi"

rm -rf "$WORK"
echo "Built ModelVault $VERSION: Windows-Installer.exe, Windows-Portable-x64.zip and app.zip in $OUT"
