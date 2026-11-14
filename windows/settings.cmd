@rem ModelVault settings. Edit this file in Notepad, save it, then start ModelVault again.
@rem Paths can be local folders (D:\3D Models) or network shares (\\nas\3D Models).

@rem Where your model library lives. ModelVault organises imported models in here.
set "LIBRARY_DIR=%USERPROFILE%\ModelVault\Library"

@rem Drop new downloads (zip, 7z, rar, STL...) here to import them.
set "DOWNLOADS_DIR=%USERPROFILE%\ModelVault\Downloads"

@rem ModelVault's own database and thumbnails. Keep this on a local disk.
set "DATA_DIR=%~dp0data"

@rem More folders to browse and import from: name=path, separated by commas.
@rem Example: set "EXTRA_DIRS=newmodels=%USERPROFILE%\Downloads\Models,archive=D:\Old models"
set "EXTRA_DIRS="

@rem The web address port: http://localhost:8420
set "PORT=8420"

@rem Optional login prompt (useful if other people on your network can reach this PC).
@rem set "APP_USER=admin"
@rem set "APP_PASSWORD=choose-a-password"

@rem Open the browser when ModelVault starts: 1 = yes, 0 = no.
set "OPEN_BROWSER=1"
