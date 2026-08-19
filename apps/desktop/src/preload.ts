import { contextBridge } from 'electron'
contextBridge.exposeInMainWorld('lingoQuestDesktop',{runtime:'desktop',version:process.versions.electron})
