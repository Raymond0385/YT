; Tauri 2 installer hooks. The background engine (backend-engine.exe) keeps running after the window closes if
; it was not stopped, which locks its file and made the uninstaller leave it behind.

; Started by Kadr 1.4.2, the installer sits in the app's job, which Windows ends (killing the installer) as soon
; as the installer closes Kadr (such a job kills its processes when it closes). In that case the installer
; starts itself again through Explorer, outside the job, and this copy quits.
!macro KADR_ESCAPE_APP_JOB
  StrCpy $8 0
  System::Alloc 112
  Pop $9
  ; JobObjectExtendedLimitInformation (9) of the job this process is in (NULL handle = own job);
  ; 112 bytes is the size of that structure in the 32-bit installer
  System::Call 'kernel32::QueryInformationJobObject(p 0, i 9, p r9, i 112, p 0) i .r7'
  ${If} $7 <> 0
    System::Call '*$9(l, l, i .r8)'
  ${EndIf}
  System::Free $9
  IntOp $7 $8 & 0x2000
  ${If} $7 <> 0
    IfFileExists "$TEMP\kadr-installer-relaunched" kadr_job_done 0
      FileOpen $9 "$TEMP\kadr-installer-relaunched" w
      FileClose $9
      Exec '"$WINDIR\explorer.exe" "$EXEPATH"'
      Quit
    kadr_job_done:
  ${EndIf}
  Delete "$TEMP\kadr-installer-relaunched"
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro KADR_ESCAPE_APP_JOB
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
