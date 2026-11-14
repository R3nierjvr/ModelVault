# ModelVault

**A home for your 3D printing hobby.** ModelVault keeps your downloaded 3D print models organised, alongside your miniature paints, filament, resin and tools. It runs on your own Windows PC or NAS and you use it in your web browser, on a computer, tablet or phone.

Your files stay yours: ModelVault works with ordinary folders on your own drives, and nothing is uploaded anywhere.

## What it does

### Models
- **Drop in anything:** ZIP, 7Z and RAR archives (including split archives), STL, 3MF, OBJ, STEP, pictures, videos and PDFs, or whole folders. Each archive becomes a model; you choose the name, designer, categories, tags and cover before it goes into your library.
- **Keeps archives zipped** to save space, while still letting you look inside them, preview 3D files and open them in your slicer.
- **3D viewer** for STL, 3MF and OBJ with print dimensions, plus picture, video and PDF viewers. Models without a picture get a 3D preview as their cover.
- **Organises folders your way:** a folder name format such as `{type}/{franchise}/{name} - {designer}`, with a sample as you type, applied to new imports or the whole library.
- **Finds doubles:** remembers every archive you've added (by its original name and size), so a download you already have is flagged before you import it again.
- **Paste a cover:** copy a picture from a web page or a chat app and press Ctrl+V.
- **Categories, tags, favourites, search and filters**, tiles, list and folder views, and bulk editing.
- **Watch folders:** new files in a download folder show up as imports, grouped when they arrived together.
- **Opens in your slicer:** OrcaSlicer, Bambu Studio, PrusaSlicer and Lychee open straight from ModelVault; for Chitubox the file's path is copied.
- **Picture optimiser** (NAS version) makes pictures smaller without changing their names or formats.

### Paints
- About **6,000 paints** from Citadel, The Army Painter, Vallejo, Tamiya, AK Interactive, Pro Acryl, Scale 75, Mr. Hobby, AMMO and Reaper, with swatches, filters and search by name, code or colour.
- **Matches across brands**, shade and highlight steps, colour schemes, and a palette from any picture.
- **My paints, shopping list, paint lists and racks**, plus a paint scheme planner for each model.

### Materials
- Your **filament spools and resin bottles**: colour, material, temperatures and how much is left.
- Pick from **6,383 filaments** and **309 resins**, with colour and multi-colour search.
- Every filament and resin is checked against your printers: prints well, with care, or can't print, and why.
- A **material guide** for each kind of filament and resin: temperatures, exposure, washing and curing, and what each needs.

### Tools
- Your **printers, nozzles, airbrushes, brushes, masks** and more. Pick a printer from about 600 and its details fill themselves in.
- **Service reminders** and a history for each tool, and a list of what to replace or buy.

### Looking after your library
- **Backups** with or without model files, and **restoring** onto this or another install, on Windows or a NAS.
- **Import an existing library** from Orynt3D, Manyfold, Thingiverse downloads or any folder.
- **Updates** from Settings > About, with an optional daily check.

## Install

### Windows

Download from the [latest release](../../releases/latest):

| File | What it is |
| --- | --- |
| `ModelVault-<version>-Setup.exe` | **The installer.** Installs for your user, with no administrator prompt. Adds Start menu and desktop shortcuts, and can start ModelVault when you sign in. |
| `ModelVault-<version>-windows-x64.zip` | **Portable.** Unzip it somewhere permanent and double-click `ModelVault.exe`. |

Both include everything they need (Node.js and 7-Zip). ModelVault opens in your browser at `http://localhost:8420`.

ModelVault runs in the background with its **icon next to the clock**: coloured while it runs, grey when it's stopped. Click the icon to open ModelVault; right-click it to start, stop or restart it, view the log, have it start with Windows, see About, or quit. Windows 11 may tuck new icons under the **^** arrow next to the clock: drag the ModelVault icon onto the taskbar to keep it in view.

The installer isn't digitally signed yet, so the first time it runs Windows SmartScreen shows a warning: choose **More info**, then **Run anyway**. Windows Firewall may also ask about Node.js: allow **Private networks** if you want to open ModelVault from a phone or tablet at `http://<your PC's address>:8420`.

Your models go into `ModelVault\Library` in your user folder, and new downloads are picked up from `ModelVault\Downloads`. Change either in **Settings > Import existing library > Folders on this PC**: they can be on this PC, a mapped drive or a shared folder on your NAS.

### Synology NAS (Container Manager)

You need DSM 7.2 or later with **Container Manager** from Package Center.

1. In File Station, create `docker/modelvault` (make the `docker` shared folder first if you don't have one) and a shared folder for your library, for example `3D Models`.
2. Download the source code from the [latest release](../../releases/latest) and copy everything into `docker/modelvault`.
3. Open `docker-compose.yml` in a text editor and change the lines marked `CHANGE`: your time zone, and the left side of the `/library` line, which is the folder your models live in. Paths with spaces are fine; shared folders are under `/volume1/` (or `/volume2/` and so on).
4. In **Container Manager > Project > Create**, name it `modelvault`, set the path to `/docker/modelvault`, choose **Use existing docker-compose.yml** and click through to **Done**. The first build takes a few minutes.
5. Open `http://<your NAS's address>:8420`.

Optional settings in `docker-compose.yml`:
- **Login prompt:** uncomment `APP_USER` and `APP_PASSWORD`.
- **More folders** to browse, watch and import from: add them to `EXTRA_DIRS` as `name=/container/path`, comma separated, and mount each one as a volume.
- **A library on another NAS:** the end of the file shows how to mount it over SMB. You can also connect shared folders later in Settings > Import existing library > Network folders.
- **HTTPS:** in DSM, Control Panel > Login Portal > Advanced > Reverse Proxy, forward to `localhost:8420`.

### Other systems

Any Docker host works with the same `docker-compose.yml` (change the volume paths). Without Docker, you need Node.js 22.13 or newer and `7z` or `bsdtar` on the PATH:

```
npm install
DATA_DIR=./data LIBRARY_DIR=./library DOWNLOADS_DIR=./downloads npm start
```

## Getting started

A new library opens with a short guided tour; you can take it again any time from **Settings > About**.

1. **Add models:** drag files onto the page, use **Add models**, or **Browse downloads**. Check the details in **Imports**, then **Add to library**.
2. **Already have a library?** Open **Settings > Import existing library** and choose where it comes from (see below).
3. **Set up your naming:** **Settings > Library** sets how models and their folders are named, with a sample of each format.
4. **Watch your download folder:** **Settings > Watch folders > Add a folder to watch**.
5. **Paints, Materials and Tools** are the tabs at the top. In Tools, start with **Add your printer**.

## Importing an existing library

**Settings > Import existing library** asks where your library comes from:

- **ModelVault:** a backup from this or another ModelVault install (see Backup and restore).
- **Orynt3D:** names, notes, tags, covers, collections and attributes from Orynt3D's `config.orynt3d` files.
- **Other model managers:** details that other apps keep next to your models, such as Manyfold (`datapackage.json`) and Thingiverse downloads (`README.txt`). Folders from other sites are imported too, named by their folders.
- **Any folder:** each model is named by its folder, and designers are guessed where they can be.

Choose **Preview** to see what will be imported, then **Import**. Your files stay where they are unless you choose to move them into your library. Running an import again later picks up new models and updates existing ones.

## Backup and restore

**Settings > Backup** makes a ZIP file:

- **Without model files:** everything you've set up (models' details, categories, tags and covers, paints, materials, tools and settings). Small; use it when your model files are already safe on a NAS or another drive.
- **With model files:** all of that plus the model folders in your library. Save it to a folder rather than downloading it if it's big.

To restore, open **Settings > Import existing library > ModelVault** and choose the backup. Each model keeps its folder inside the library, and nothing is moved:

- **Without model files, on Windows:** the library folder switches to the backup's library as this PC reaches it, so a NAS backup opens your models straight from the NAS. For a NAS backup, that's the path in the NAS's **Settings > Library > Folder paths on your PC**, so fill that in before you make the backup.
- **Without model files, on a NAS:** models go into the `/library` folder.
- **With model files:** the files are copied into this install's library folder.

What's in ModelVault before a restore is kept in the data folder under `before-restore`.

## Updating

- **From inside ModelVault:** **Settings > About > Check for updates**, then **Download and install**. ModelVault restarts with the new version in about half a minute. You can also have it check every day, or install updates by itself.
- **Windows:** running a newer installer updates your install and keeps your data and shortcuts.
- **NAS:** the update replaces the program in `docker/modelvault`. If a release says the Dockerfile changed, rebuild the project in Container Manager (**Action > Build**).

## Opening ModelVault on a tablet or phone

ModelVault works in any browser on your network: open `http://<the computer's address>:8420`. To use it away from home too, install [Tailscale](https://tailscale.com) on the computer that runs ModelVault and on your tablet. **Settings > Tailscale** has the steps, suggests this computer's Tailscale address, and shows a QR code to scan with the tablet.

## Network folders

On a NAS, **Settings > Import existing library > Network folders** connects a shared folder on another NAS or PC: paste its path from the File Explorer address bar (for example `\\nas\share\3D Models`), and enter a username and password for it. It reconnects by itself when ModelVault restarts.

This needs these lines in `docker-compose.yml` (already there in the included file):

```yaml
    cap_add:
      - SYS_ADMIN
      - DAC_READ_SEARCH
    security_opt:
      - apparmor:unconfined
```

Passwords are kept in ModelVault's data folder. Use an account that can only open the folders ModelVault needs.

On Windows, ModelVault opens shared folders directly; add them with **Folders on this PC > Add a folder**.

## Settings for advanced setups

| Setting | What it does |
| --- | --- |
| `LIBRARY_DIR` | The library folder (Docker: `/library`). |
| `DOWNLOADS_DIR` | The downloads folder (Docker: `/downloads`). |
| `DATA_DIR` | ModelVault's database and thumbnails (Docker: `/data`). |
| `EXTRA_DIRS` | More folders, as `name=/path,name2=/path2`. |
| `PORT` | The web port (default `8420`). |
| `APP_USER`, `APP_PASSWORD` | A login prompt for everyone who opens ModelVault. |
| `UPDATE_REPO` | The GitHub repository checked for updates. |

On Windows these are in `settings.cmd` (portable) or Start menu > ModelVault settings (installer).

## Data and credits

- Paint colours: [Miniature Painter Pro data](https://github.com/Arcturus5404/miniature-paints) (MIT licence). Swatches are close to the real paints, not exact.
- Filaments: [SpoolmanDB](https://github.com/Donkie/SpoolmanDB) (MIT licence).
- Resins: the [OpenPrintTag database](https://github.com/OpenPrintTag/openprinttag-database) by Prusa Research (MIT licence), plus popular hobby resins with approximate colours.
- Printers: facts from [OrcaSlicer](https://github.com/SoftFever/OrcaSlicer) and [UVtools](https://github.com/sn4k3/UVtools) printer profiles.
- Built with [three.js](https://threejs.org), [Express](https://expressjs.com), [busboy](https://github.com/mscdex/busboy) and [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator). The Windows downloads include [Node.js](https://nodejs.org) and [7-Zip](https://www.7-zip.org).

ModelVault is made by V3sper Studios and all rights are reserved: you're welcome to download and use it, but please don't copy, change or redistribute the code. See [LICENSE](LICENSE). The data and software listed above keep their own licences. See [CHANGELOG.md](CHANGELOG.md) for what's new in each version.

## Support ModelVault

ModelVault is free. If it saves you time, you can help keep it going:

- 🦖 [Buy me a dinosaur on Ko-fi](https://ko-fi.com/v3sperstudios)
- 💚 [Sponsor me on GitHub](https://github.com/sponsors/R3nierjvr)

Thank you!

## Building

- **Windows downloads:** `sh tools/build-windows.sh` (needs npm, zip and NSIS's `makensis`); the files go into `dist/`. GitHub builds them on every push to `main` and publishes them as the release for the version in `server/index.js`.
- **Paint, filament, resin and printer lists:** the scripts in `tools/` rebuild them from their sources (each script says how).
