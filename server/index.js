// 简易音乐后端：Express + SQLite + 上传
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.join(__dirname, 'uploads')
const DATA_DIR = path.join(__dirname, 'data')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })
fs.mkdirSync(DATA_DIR, { recursive: true })

// ---------- 数据库 ----------
const db = new Database(path.join(DATA_DIR, 'music.db'))
db.exec(`
  CREATE TABLE IF NOT EXISTS songs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    singer     TEXT DEFAULT '',
    filename   TEXT NOT NULL,
    cover      TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  )
`)

// ---------- 上传配置 ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp3'
    const safe = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext
    cb(null, safe)
  }
})
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 单首最多 50MB
})

// ---------- 路由 ----------
const app = express()
app.use(cors())
app.use(express.json())
// 上传的音频/封面通过 /uploads 访问
app.use('/uploads', express.static(UPLOAD_DIR))

// 歌单
app.get('/api/songs', (req, res) => {
  const rows = db.prepare('SELECT * FROM songs ORDER BY id DESC').all()
  const list = rows.map(r => ({
    id: r.id,
    name: r.name,
    singer: r.singer,
    src: '/uploads/' + r.filename,
    cover: r.cover || ''
  }))
  res.json(list)
})

// 上传歌曲：字段 file(音频), name, singer, coverFile(可选封面图)
app.post('/api/songs', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'coverFile', maxCount: 1 }
]), (req, res) => {
  const audio = req.files?.file?.[0]
  if (!audio) return res.status(400).json({ error: '缺少音频文件' })
  const cover = req.files?.coverFile?.[0]
  const info = db.prepare(
    'INSERT INTO songs (name, singer, filename, cover, created_at) VALUES (?,?,?,?,?)'
  ).run(
    req.body.name || path.parse(audio.originalname).name,
    req.body.singer || '未知歌手',
    audio.filename,
    cover ? '/uploads/' + cover.filename : '',
    Date.now()
  )
  res.json({ id: info.lastInsertRowid, ok: true })
})

// 删除歌曲
app.delete('/api/songs/:id', (req, res) => {
  const row = db.prepare('SELECT filename, cover FROM songs WHERE id=?').get(req.params.id)
  if (!row) return res.status(404).json({ error: '歌曲不存在' })
  try { fs.unlinkSync(path.join(UPLOAD_DIR, row.filename)) } catch {}
  if (row.cover) {
    const coverName = path.basename(row.cover)
    try { fs.unlinkSync(path.join(UPLOAD_DIR, coverName)) } catch {}
  }
  db.prepare('DELETE FROM songs WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`✅ 后端已启动: http://localhost:${PORT}`)
})
