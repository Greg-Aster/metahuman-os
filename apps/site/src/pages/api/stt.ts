import type { APIRoute } from 'astro'
import { transcribeAudio, saveVoiceSample } from '@metahuman/core'

/**
 * POST /api/stt
 * Body: raw binary audio (e.g., audio/webm or audio/wav)
 * Query: ?format=webm|wav|mp3 (default: webm)
 * Returns: { transcript }
 */
export const POST: APIRoute = async ({ request, url }) => {
  try {
    const format = (url.searchParams.get('format') as 'webm' | 'wav' | 'mp3') || 'webm'
    const collect = url.searchParams.get('collect') === '1'
    const durMsParam = url.searchParams.get('dur')
    const buf = Buffer.from(await request.arrayBuffer())
    if (!buf || buf.length === 0) {
      return new Response(JSON.stringify({ error: 'Empty audio body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const transcript = await transcribeAudio(buf, format)

    if (collect && !transcript.startsWith('[Mock Transcription]')) {
      try {
        const durationSec = durMsParam ? Math.max(0.1, parseFloat(durMsParam) / 1000) : Math.max(0.1, (buf.length * 8) / (24 * 1024))
        const quality = Math.min(1.0, (buf.length / 50000) * 0.5 + 0.5)
        saveVoiceSample(Buffer.from(buf), transcript, durationSec, quality, format)
      } catch {}
    }

    return new Response(JSON.stringify({ transcript }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
