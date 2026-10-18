!macro customInit
  nsExec::Exec 'taskkill /F /IM backend-engine.exe /T'
  nsExec::Exec 'taskkill /F /IM kadr.exe /T'
  nsExec::Exec 'taskkill /F /IM capshorts.exe /T'
!macroend

!macro customInstall
  nsExec::Exec 'taskkill /F /IM backend-engine.exe /T'
!macroend
