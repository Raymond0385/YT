; Tauri 2 installer hooks. The background engine (backend-engine.exe) keeps running after the window closes if
; it was not stopped, which locks its file and made the uninstaller leave it behind.

!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /IM backend-engine.exe /T'
  nsExec::Exec 'taskkill /F /IM kadr.exe /T'
  nsExec::Exec 'taskkill /F /IM capshorts.exe /T'
  Sleep 800
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /IM backend-engine.exe /T'
  nsExec::Exec 'taskkill /F /IM kadr.exe /T'
  nsExec::Exec 'taskkill /F /IM capshorts.exe /T'
  Sleep 800
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Whatever is left of the program folder (the engine, fonts, models); user data in %LOCALAPPDATA%\Kadr is kept.
  RMDir /r "$INSTDIR\binaries"
  RMDir "$INSTDIR"
!macroend
