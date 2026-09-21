<template>
  <div class="player-card">
    <h1 class="title">🎵 我的音乐播放器</h1>

    <!-- 歌曲信息 -->
    <div class="now-playing">
      <div class="cover" :class="{ spinning: isPlaying }">
        <img v-if="currentSong.cover" :src="API + currentSong.cover" alt="封面" />
        <span v-else class="cover-inner">{{ (currentSong.name || '?').slice(0, 1) }}</span>
      </div>
      <div class="meta">
        <p class="song-name">{{ currentSong.name }}</p>
        <p class="singer">{{ currentSong.singer }}</p>
      </div>
    </div>

    <!-- 歌词面板 -->
    <div class="lyrics-box" ref="lyricsBox">
      <div v-if="!lyrics.length" class="lyric-empty">♪ 歌词加载中...</div>
      <div v-for="(line, i) in lyrics" :key="i"
           class="lyric-line"
           :class="{ active: i === currentLyric }">
        {{ line.text }}
      </div>
    </div>

    <!-- 进度条 -->
    <div class="progress">
      <input type="range" min="0" :max="duration || 0" step="0.1"
        :value="currentTime" @input="onSeek" />
      <div class="time-text">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</div>
    </div>

    <!-- 控制按钮 -->
    <div class="controls">
      <button class="btn" @click="prevSong" title="上一曲">⏮</button>
      <button class="btn play" @click="togglePlay" title="播放/暂停">
        {{ isPlaying ? '⏸' : '▶' }}
      </button>
      <button class="btn" @click="nextSong" title="下一曲">⏭</button>
    </div>

    <!-- 音量 -->
    <div class="volume-row">
      <span>🔊</span>
      <input type="range" min="0" max="100" v-model.number="volume" @input="setVolume" />
      <span class="vol-num">{{ volume }}%</span>
    </div>

    <!-- 上传面板 -->
    <div class="upload-box">
      <div class="upload-head" @click="showUpload = !showUpload">
        <span>⬆ 上传本地歌曲</span><span>{{ showUpload ? '▾' : '▸' }}</span>
      </div>
      <div v-if="showUpload" class="upload-form">
        <input type="text" v-model="form.name" placeholder="歌名" />
        <input type="text" v-model="form.singer" placeholder="歌手" />
        <label class="file-label">
          选择音频(mp3)
          <input type="file" accept="audio/*" @change="onPickAudio" />
        </label>
        <label class="file-label">
          封面(可选)
          <input type="file" accept="image/*" @change="onPickCover" />
        </label>
        <button class="upload-btn" :disabled="uploading" @click="uploadSong">
          {{ uploading ? '上传中...' : '确认上传' }}
        </button>
        <p v-if="form.audioName" class="chosen">已选: {{ form.audioName }}</p>
      </div>
    </div>

    <!-- 歌曲列表 -->
    <div class="song-list">
      <div v-if="!songList.length" class="empty">还没有歌曲，先上传一首吧～</div>
      <div v-for="(item, idx) in songList" :key="item.id" class="song-item"
        :class="{ active: item.id === currentSong.id }" @click="playSong(item)">
        <span class="idx">{{ idx + 1 }}</span>
        <span class="name">{{ item.name }}</span>
        <span class="singer-name">{{ item.singer }}</span>
        <span class="del" @click.stop="removeSong(item)">✕</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted, onUnmounted } from 'vue'
import { Howl } from 'howler'

const API = import.meta.env.VITE_API_BASE || ''

const songList = ref([])
const currentSong = ref({ name: '等待加载...', singer: '', src: '' })
let sound = null
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(70)

// 歌词
const lyrics = ref([])
const currentLyric = ref(-1)
const lyricsBox = ref(null)

// 解析 LRC
function parseLrc(text) {
  const out = []
  const reg = /\[(\d{2}):(\d{2})(?:[.:](\d{1,3}))?\]/g
  for (const raw of text.split('\n')) {
    let m
    reg.lastIndex = 0
    while ((m = reg.exec(raw)) !== null) {
      const min = +m[1], sec = +m[2], ms = +(m[3] || 0)
      const time = min * 60 + sec + (ms < 100 ? ms * 10 : ms) / 1000
      const txt = raw.replace(reg, '').trim()
      if (txt) out.push({ time, text: txt })
    }
  }
  return out.sort((a, b) => a.time - b.time)
}

function lyricUrlOf(song) {
  if (!song.src) return ''
  const file = song.src.split('/').pop() || ''
  const name = file.replace(/\.[^.]+$/, '')
  return '/lyrics/' + name + '.lrc'
}

async function loadLyrics(song) {
  lyrics.value = []
  currentLyric.value = -1
  try {
    const res = await fetch(lyricUrlOf(song))
    if (!res.ok) return
    lyrics.value = parseLrc(await res.text())
  } catch (e) {}
}

function updateLyric(t) {
  if (!lyrics.value.length) return
  let idx = -1
  for (let i = 0; i < lyrics.value.length; i++) {
    if (t >= lyrics.value[i].time) idx = i
    else break
  }
  if (idx !== currentLyric.value) {
    currentLyric.value = idx
    nextTick(() => {
      const el = lyricsBox.value?.querySelector('.lyric-line.active')
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }
}

// 上传表单
const showUpload = ref(false)
const uploading = ref(false)
const form = ref({ name: '', singer: '', audio: null, audioName: '', cover: null })

const formatTime = (sec) => {
  if (!sec || isNaN(sec)) return '00:00'
  const m = Math.floor(sec / 60); const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ---------- 从后端加载歌单 ----------
async function loadList() {
  // 1) 优先试后端（本地/Electron 有数据库时）
  try {
    const res = await fetch(API + '/api/songs')
    if (res.ok) {
      const list = await res.json()
      if (list.length) {
        songList.value = list
        if (!currentSong.value.id || !list.find(s => s.id === currentSong.value.id)) {
          currentSong.value = list[0]
          loadSong(list[0])
        }
        return
      }
    }
    throw new Error('no backend')
  } catch (e) {
    // 2) 后端不可用（线上静态站），读 public/songs.json
    try {
      const res = await fetch('/songs.json')
      songList.value = await res.json()
      if (songList.value.length) {
        currentSong.value = songList.value[0]
        loadSong(songList.value[0])
      }
    } catch (e2) {
      console.error('加载歌单失败', e2)
    }
  }
}

const loadSong = (song) => {
  if (sound) sound.unload()
  currentTime.value = 0; duration.value = 0
  loadLyrics(song)
  sound = new Howl({
    src: [API + song.src], volume: volume.value / 100, html5: true,
    onload: () => { duration.value = sound.duration() },
    onplay: () => { isPlaying.value = true; duration.value = sound.duration(); tick() },
    onpause: () => { isPlaying.value = false },
    onend: () => nextSong(),
    onloaderror: () => alert('音频加载失败: ' + song.src)
  })
}

const tick = () => {
  if (!sound || !isPlaying.value) return
  currentTime.value = sound.seek()
  updateLyric(currentTime.value)
  requestAnimationFrame(tick)
}

const playSong = (song) => {
  currentSong.value = song
  loadSong(song)
  sound.play()
}

const togglePlay = () => {
  if (!sound) loadSong(currentSong.value)
  isPlaying.value ? sound.pause() : sound.play()
}

const onSeek = (e) => {
  if (!sound) return
  const val = Number(e.target.value)
  sound.seek(val); currentTime.value = val
  updateLyric(val)
}

const setVolume = () => { if (sound) sound.volume(volume.value / 100) }

const findIdx = () => songList.value.findIndex(s => s.id === currentSong.value.id)
const prevSong = () => {
  if (!songList.value.length) return
  let i = findIdx(); i = i <= 0 ? songList.value.length - 1 : i - 1
  playSong(songList.value[i])
}
const nextSong = () => {
  if (!songList.value.length) return
  let i = findIdx(); i = i >= songList.value.length - 1 ? 0 : i + 1
  playSong(songList.value[i])
}

// ---------- 上传 ----------
const onPickAudio = (e) => {
  const f = e.target.files[0]
  if (f) { form.value.audio = f; form.value.audioName = f.name }
}
const onPickCover = (e) => {
  const f = e.target.files[0]
  if (f) form.value.cover = f
}

async function uploadSong() {
  if (!form.value.audio) return alert('请先选择音频文件')
  uploading.value = true
  const fd = new FormData()
  fd.append('file', form.value.audio)
  fd.append('name', form.value.name || form.value.audioName.replace(/\.[^.]+$/, ''))
  fd.append('singer', form.value.singer || '未知歌手')
  if (form.value.cover) fd.append('coverFile', form.value.cover)
  try {
    await fetch(API + '/api/songs', { method: 'POST', body: fd })
    form.value = { name: '', singer: '', audio: null, audioName: '', cover: null }
    await loadList()
  } catch (e) {
    alert('上传失败: ' + e.message)
  } finally {
    uploading.value = false
  }
}

async function removeSong(item) {
  if (!confirm(`确定删除《${item.name}》？`)) return
  await fetch(API + '/api/songs/' + item.id, { method: 'DELETE' })
  await loadList()
}

onMounted(loadList)
onUnmounted(() => { if (sound) sound.unload() })
</script>

<style scoped>
.player-card {
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 20px;
  padding: 24px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}
.title { margin: 0 0 20px; font-size: 22px; text-align: center; color: #fff; }
.now-playing { display: flex; align-items: center; gap: 18px; margin-bottom: 22px; }
.cover {
  width: 96px; height: 96px; border-radius: 50%; overflow: hidden;
  background: linear-gradient(135deg, #f472b6, #8b5cf6);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  border: 4px solid rgba(255, 255, 255, 0.2);
}
.cover.spinning { animation: spin 8s linear infinite; }
.cover img { width: 100%; height: 100%; object-fit: cover; }
.cover-inner { font-size: 36px; color: #fff; font-weight: bold; }
@keyframes spin { to { transform: rotate(360deg); } }
.meta { min-width: 0; }
.song-name { font-size: 20px; font-weight: 600; color: #fff; margin: 0 0 6px; }
.singer { font-size: 14px; color: #c4b5fd; margin: 0; }

/* 歌词面板 */
.lyrics-box {
  height: 160px; overflow-y: auto; padding: 10px 6px; margin-bottom: 18px;
  border-radius: 12px; background: rgba(0,0,0,0.25);
  scroll-behavior: smooth;
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 20%, #000 80%, transparent);
          mask-image: linear-gradient(to bottom, transparent, #000 20%, #000 80%, transparent);
}
.lyrics-box::-webkit-scrollbar { width: 0; }
.lyric-empty { text-align: center; color: #6b7280; font-size: 13px; line-height: 140px; }
.lyric-line {
  text-align: center; font-size: 13px; color: #9ca3af;
  padding: 6px 8px; transition: all .3s ease; opacity: .7;
}
.lyric-line.active {
  color: #f472b6; font-size: 17px; font-weight: 600; opacity: 1;
  transform: scale(1.1); text-shadow: 0 0 12px rgba(244,114,182,.5);
}

.progress { margin-bottom: 18px; }
.progress input { width: 100%; accent-color: #a78bfa; }
.time-text { font-size: 12px; color: #a5b4fc; text-align: right; margin-top: 4px; }
.controls { display: flex; justify-content: center; gap: 20px; margin-bottom: 18px; }
.btn {
  width: 52px; height: 52px; border-radius: 50%; border: none;
  background: rgba(255,255,255,0.12); color: #fff; font-size: 20px; cursor: pointer; transition: all .2s;
}
.btn:hover { background: rgba(255,255,255,0.25); transform: scale(1.05); }
.btn.play { width: 68px; height: 68px; background: linear-gradient(135deg, #8b5cf6, #ec4899); font-size: 24px; }
.volume-row { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
.volume-row input { flex: 1; accent-color: #a78bfa; }
.vol-num { font-size: 12px; color: #c4b5fd; width: 40px; text-align: right; }

.upload-box {
  background: rgba(255,255,255,0.06); border-radius: 12px; padding: 12px 14px; margin-bottom: 20px;
}
.upload-head { display: flex; justify-content: space-between; cursor: pointer; font-size: 14px; color: #c4b5fd; }
.upload-form { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.upload-form input[type=text] {
  background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.15);
  color: #fff; padding: 8px 10px; border-radius: 8px; font-size: 14px;
}
.file-label {
  font-size: 13px; color: #e5e7eb; background: rgba(255,255,255,0.1);
  padding: 8px 10px; border-radius: 8px; cursor: pointer; position: relative; overflow: hidden;
}
.file-label input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.upload-btn {
  padding: 10px; border: none; border-radius: 8px; cursor: pointer;
  background: linear-gradient(135deg, #8b5cf6, #ec4899); color: #fff; font-size: 14px;
}
.upload-btn:disabled { opacity: .6; }
.chosen { font-size: 12px; color: #94a3b8; margin: 0; }

.song-list { border-top: 1px solid rgba(255,255,255,0.1); }
.empty { padding: 24px; text-align: center; color: #94a3b8; font-size: 14px; }
.song-item {
  display: flex; align-items: center; gap: 12px; padding: 12px 10px;
  border-radius: 10px; cursor: pointer; transition: background .15s;
}
.song-item:hover { background: rgba(255,255,255,0.08); }
.song-item.active { background: rgba(139,92,246,0.25); color: #fff; }
.song-item .idx { width: 24px; text-align: center; font-size: 13px; color: #94a3b8; }
.song-item .name { flex: 1; font-size: 14px; }
.song-item .singer-name { font-size: 12px; color: #94a3b8; }
.song-item .del { color: #f87171; font-size: 14px; padding: 0 4px; }
.song-item .del:hover { color: #ef4444; }
</style>
