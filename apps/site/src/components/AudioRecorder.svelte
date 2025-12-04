<script lang="ts">
  import { apiFetch } from '../lib/client/api-config';

  let mediaStream: MediaStream | null = null
  let mediaRecorder: MediaRecorder | null = null
  let recording = false
  let paused = false
  let error = ''
  let uploaded = 0
  let failed = 0
  let chunksQueued = 0
  let startTime = 0
  let elapsed = '00:00'
  let timer: any = null

  const SEGMENT_MS = 30000 // 30s segments

  function formatTime(ms: number): string {
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    const ss = s % 60
    return `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
  }

  function tick() {
    if (!recording) return
    elapsed = formatTime(Date.now() - startTime)
  }

  async function startRecording() {
    try {
      error = ''
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        error = 'Microphone not available in this browser.'
        return
      }

      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm' })
      chunksQueued = 0
      uploaded = 0
      failed = 0

      mediaRecorder.ondataavailable = async (e: BlobEvent) => {
        if (!e.data || e.data.size === 0) return
        chunksQueued++
        const idx = chunksQueued
        const blob = e.data
        const ts = new Date().toISOString().replace(/[-:T.Z]/g,'').slice(0,14)
        const filename = `mic-${ts}-${idx}.webm`
        const form = new FormData()
        form.append('audio', blob, filename)
        try {
          const res = await apiFetch('/api/audio/upload', { method: 'POST', body: form })
          const data = await res.json()
          if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed')
          uploaded++
        } catch (e) {
          failed++
        }
      }

      mediaRecorder.start(SEGMENT_MS)
      recording = true
      paused = false
      startTime = Date.now()
      elapsed = '00:00'
      if (timer) clearInterval(timer)
      timer = setInterval(tick, 1000)
    } catch (e) {
      error = (e as Error).message
      stopRecording()
    }
  }

  function pauseRecording() {
    if (!mediaRecorder) return
    if (!paused) {
      mediaRecorder.pause()
      paused = true
    } else {
      mediaRecorder.resume()
      paused = false
    }
  }

  function stopRecording() {
    try {
      if (mediaRecorder && recording) {
        mediaRecorder.stop()
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop())
      }
    } catch {}
    recording = false
    paused = false
    if (timer) { clearInterval(timer); timer = null }
  }
</script>

<div class="recorder">
  <div class="header">
    <h3>Record from Microphone</h3>
    <div class="status">
      <span class="dot {recording ? (paused ? 'paused' : 'on') : 'off'}"></span>
      <span class="time">{elapsed}</span>
    </div>
  </div>

  <div class="controls">
    {#if !recording}
      <button class="btn primary" on:click={startRecording}>Start</button>
    {:else}
      <button class="btn" on:click={pauseRecording}>{paused ? 'Resume' : 'Pause'}</button>
      <button class="btn danger" on:click={stopRecording}>Stop</button>
    {/if}
  </div>

  <div class="metrics">
    <div>Uploaded: <strong>{uploaded}</strong></div>
    <div>Failed: <strong class="err">{failed}</strong></div>
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}
</div>

<style>
  .recorder { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.75rem; border: 1px solid rgba(0,0,0,0.1); border-radius: 0.5rem; }
  :global(.dark) .recorder { border-color: rgba(255,255,255,0.1); }
  .header { display: flex; justify-content: space-between; align-items: center; }
  .status { display: flex; align-items: center; gap: 0.5rem; font-weight: 600; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #9CA3AF; }
  .dot.on { background: #ef4444; box-shadow: 0 0 0 6px rgba(239,68,68,0.15); }
  .dot.paused { background: #f59e0b; }
  .time { font-variant-numeric: tabular-nums; color: #374151; }
  :global(.dark) .time { color: #e5e7eb; }
  .controls { display: flex; gap: 0.5rem; }
  .btn { padding: 0.4rem 0.8rem; border: 1px solid rgba(0,0,0,0.2); border-radius: 0.375rem; background: transparent; cursor: pointer; }
  :global(.dark) .btn { border-color: rgba(255,255,255,0.2); color: #e5e7eb; }
  .btn.primary { background: rgb(124 58 237); border-color: rgb(124 58 237); color: white; }
  .btn.danger { background: rgb(220 38 38); border-color: rgb(220 38 38); color: white; }
  .metrics { display: flex; gap: 1rem; font-size: 0.9rem; color: #6B7280; }
  .metrics .err { color: #b91c1c; }
  .error { color: #b91c1c; font-size: 0.9rem; }
</style>

