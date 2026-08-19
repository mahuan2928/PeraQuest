import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
const createWindow=()=>{const window=new BrowserWindow({width:1280,height:820,minWidth:960,minHeight:640,webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});window.webContents.setWindowOpenHandler(({url})=>{if(url.startsWith('https://'))void shell.openExternal(url);return{action:'deny'}});void window.loadFile(join(__dirname,'renderer/index.html'))}
app.whenReady().then(()=>{createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()})});app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()})
