// Electron 主进程
const { app, BrowserWindow } = require('electron')
const path = require('path')
const { spawn } = require('child_process')

let backend = null

// 启动后端：开发模式假设已手动跑 node server/index.js；
// 打包后用 Electron 自带 Node 运行 server/index.js
function startBackend() {
  if (!app.isPackaged) return
  const serverPath = path.join(process.resourcesPath, 'server', 'index.js')
  backend = spawn(process.execPath, [serverPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit'
  })
  backend.on('exit', () => { backend = null })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 780,
    autoHideMenuBar: true,
    title: '我的音乐播放器',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })

  if (app.isPackaged) {
    // 生产：加载打包好的静态页面；API 走 http://localhost:3001
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } else {
    // 开发：加载 Vite 开发服务器
    win.loadURL('http://localhost:5173/')
  }
}

app.whenReady().then(() => {
  startBackend()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (backend) { try { backend.kill() } catch {} }
  if (process.platform !== 'darwin') app.quit()
})
