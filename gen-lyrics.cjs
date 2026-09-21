// 批量调用 ASR 识别歌词，生成 .lrc 文件
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const MUSIC_DIR = path.join(__dirname, 'public', 'music')
const LYRICS_DIR = path.join(__dirname, 'public', 'lyrics')
fs.mkdirSync(LYRICS_DIR, { recursive: true })

const SONGS = [
  { file: '01.flac', name: '稻香', singer: '周杰伦' },
  { file: '02.flac', name: '给我一首歌的时间', singer: '周杰伦' },
  { file: '03.flac', name: '花海', singer: '周杰伦' },
  { file: '04.flac', name: '兰亭序', singer: '周杰伦' },
  { file: '05.flac', name: '龙战骑士', singer: '周杰伦' },
  { file: '06.flac', name: '魔术先生', singer: '周杰伦' },
  { file: '07.flac', name: '乔克叔叔', singer: '周杰伦' },
  { file: '08.flac', name: '时光机', singer: '周杰伦' },
  { file: '09.flac', name: '说好的幸福呢', singer: '周杰伦' },
  { file: '10.flac', name: '蛇舞', singer: '周杰伦/梁心颐' },
  { file: '11.flac', name: '流浪诗人', singer: '周杰伦/杨瑞代' },
]

function fmtTime(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.floor((sec % 1) * 100)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`
}

function lrcEscape(text) {
  return (text || '').replace(/\r/g, '').trim()
}

for (const song of SONGS) {
  const audioPath = path.join(MUSIC_DIR, song.file)
  const outFile = path.join(LYRICS_DIR, song.file.replace(/\.flac$/, '.lrc'))
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 200) {
    console.log(`跳过（已存在）: ${song.file}`)
    continue
  }
  console.log(`\n=== 识别: ${song.name} ===`)

  // 提交任务
  const submit = execSync(
    `mediakit-cli video asr-subtitles --audio-url "${audioPath}" --content-type singing --language cmn-Hans-CN`,
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  )
  const { task_id } = JSON.parse(submit)
  console.log(`task_id: ${task_id}`)

  // 轮询
  const result = execSync(
    `mediakit-cli shared query-task --task-id "${task_id}" --poll-complete`,
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  )
  const data = JSON.parse(result)

  if (data.status !== 'completed' || !Array.isArray(data.subtitles)) {
    console.error(`识别失败: ${data.status || 'unknown'}`)
    continue
  }

  // 写 lrc
  let lrc = `[ti:${song.name}]\n[ar:${song.singer}]\n`
  for (const sub of data.subtitles) {
    const text = lrcEscape(sub.subtitle_text)
    if (!text) continue
    lrc += `[${fmtTime(sub.start_time)}]${text}\n`
  }
  fs.writeFileSync(outFile, lrc, 'utf8')
  console.log(`已生成: ${outFile} (${data.subtitles.length} 行)`)
}

console.log('\n全部完成！')
