/**
 * Adapter Builder Agent
 * Curates high-quality instruction→response pairs from recent memories for LoRA fine-tuning.
 * Filters by quality, consent, groundedness, and voice relevance.
 */
import fs from 'node:fs'
import path from 'node:path'
import { paths, audit, loadPersonaCore } from '../../packages/core/src/index.js'

type Memory = {
  id: string;
  timestamp: string;
  content: string;
  type?: string;
  tags?: string[];
  entities?: string[];
  metadata?: {
    processed?: boolean;
    trainingConsent?: boolean;
    [key: string]: any;
  };
  response?: string;
  links?: Array<{ type: string; target: string }>;
}

type BuilderConfig = {
  days: number;
  max: number;
  requireProcessed: boolean;
  minContentLength: number;
  requireTagsOrEntities: boolean;
  allowedTypes: string[];
  useTimeWeighting: boolean;  // Enable exponential decay for older memories
  decayHalfLife: number;       // Days until a memory's weight is halved (14 = aggressive, 90 = gentle)
}

const OUTPUT_WORD_LIMIT = 160
const INPUT_WORD_LIMIT = 140
const INSTRUCTION_WORD_LIMIT = 48

type InstructionPair = {
  instruction: string;
  input?: string;
  output: string;
  meta: Record<string, any>;
}

function stripChainOfThought(raw: string | undefined | null): string {
  if (!raw) return ''
  let text = String(raw)

  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  text = text.replace(/```(?:thought|thinking|plan)?[\s\S]*?```/gi, '').trim()

  const markers = [
    '**Final Answer**:',
    '**Final Answer**',
    'Final Answer:',
    'Final answer:',
    'User-facing response:',
    'User-Facing Response:',
    'Answer:',
    'Response:',
  ]
  for (const marker of markers) {
    const idx = text.lastIndexOf(marker)
    if (idx !== -1) {
      text = text.slice(idx + marker.length).trim()
      break
    }
  }

  return text.trim()
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function wordLimit(text: string, limit: number): string {
  const words = text.split(/\s+/)
  if (words.length <= limit) return text
  return `${words.slice(0, limit).join(' ')}…`
}

function ensureSentenceEnding(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (/[.!?…”'»)]$/.test(trimmed)) return trimmed
  return `${trimmed}.`
}

function sanitizeInstruction(text: string): string {
  if (!text) return ''
  const cleaned = ensureSentenceEnding(normalizeWhitespace(text))
  return wordLimit(cleaned, INSTRUCTION_WORD_LIMIT)
}

function sanitizeInput(text: string | undefined): string {
  if (!text) return ''
  const cleaned = normalizeWhitespace(stripChainOfThought(text))
  return wordLimit(cleaned, INPUT_WORD_LIMIT)
}

function sanitizeOutput(text: string): string {
  if (!text) return ''
  let cleaned = stripChainOfThought(text)
  cleaned = cleaned.replace(/^\*\*\s*/g, '').replace(/\s*\*\*$/g, '').trim()
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '').trim()
  cleaned = normalizeWhitespace(cleaned)
  cleaned = ensureSentenceEnding(cleaned)
  return wordLimit(cleaned, OUTPUT_WORD_LIMIT)
}

function finalizePair(pair: InstructionPair | null): InstructionPair | null {
  if (!pair) return null
  const instruction = sanitizeInstruction(pair.instruction)
  const input = sanitizeInput(pair.input)
  const output = sanitizeOutput(pair.output)
  if (!output) return null
  return {
    instruction,
    input,
    output,
    meta: pair.meta,
  }
}

function loadConfig(): BuilderConfig {
  const cfgPath = path.join(paths.etc, 'adapter-builder.json')
  const defaults: BuilderConfig = {
    days: 999999,  // Use ALL memories (no time cutoff)
    max: 500,
    requireProcessed: false,
    minContentLength: 20,
    requireTagsOrEntities: true,
    allowedTypes: ['conversation', 'inner_dialogue', 'reflection', 'reflection_summary', 'chat', 'observation', 'dream', 'audio', 'action', 'journal'],
    useTimeWeighting: true,   // Enable exponential time decay
    decayHalfLife: 30,        // Memories lose half their weight every 30 days
  }
  try {
    if (fs.existsSync(cfgPath)) {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
      return { ...defaults, ...raw }
    }
  } catch {}
  return defaults
}

function extractReflectionTheme(content: string | undefined): string {
  if (!content) return 'recent experiences'

  const paragraphs = content
    .split(/\n+/)
    .map(p => p.trim())
    .filter(Boolean)

  const firstParagraph = paragraphs[0] || content.trim()
  if (!firstParagraph) return 'recent experiences'

  const sentences = firstParagraph
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean)

  let candidate = sentences.find(sentence => sentence.length >= 12) || firstParagraph.trim()
  if (!candidate) return 'recent experiences'

  return candidate.length > 180 ? `${candidate.slice(0, 177).trim()}...` : candidate
}

/**
 * Calculate time weight for a memory using exponential decay
 * Recent memories have weight ~1.0, older memories decay exponentially
 *
 * Formula: weight = 2^(-age_in_days / halfLife)
 *
 * Examples with halfLife=30:
 *   0 days old: weight = 1.0 (100%)
 *  30 days old: weight = 0.5 (50%)
 *  60 days old: weight = 0.25 (25%)
 *  90 days old: weight = 0.125 (12.5%)
 */
function calculateTimeWeight(timestamp: string, halfLife: number): number {
  const ageMs = Date.now() - new Date(timestamp).getTime()
  const ageDays = ageMs / (24 * 3600 * 1000)
  return Math.pow(2, -ageDays / halfLife)
}

/**
 * Read ALL memories with time-weighted sampling
 * Uses exponential decay to favor recent memories while still including old ones
 */
function readRecentMemories(days = 7, max = 200): Memory[] {
  const out: Memory[] = []
  const root = paths.episodic
  if (!fs.existsSync(root)) return out

  const allowMissingTags = new Set(['dream', 'reflection_summary'])
  const cfg = loadConfig()
  const cutoff = cfg.useTimeWeighting ? 0 : Date.now() - days * 24 * 3600 * 1000

  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile() && e.name.endsWith('.json')) {
        try {
          const raw = fs.readFileSync(full, 'utf8')
          const obj = JSON.parse(raw)
          const t = new Date(obj.timestamp).getTime()
          if (!isNaN(t) && t >= cutoff) {
            out.push({
              id: obj.id,
              timestamp: obj.timestamp,
              content: obj.content,
              type: obj.type,
              tags: obj.tags,
              entities: obj.entities,
              metadata: obj.metadata,
              response: obj.response,
              links: obj.links,
            })
          }
        } catch {}
      }
    }
  }

  for (const year of fs.readdirSync(root)) {
    const dir = path.join(root, year)
    if (fs.statSync(dir).isDirectory()) walk(dir)
  }

  out.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))

  // Apply quality filters
  const strictFiltered = out.filter(mem => {
    const type = mem.type || ''
    if (!cfg.allowedTypes.includes(type)) return false
    if (cfg.requireProcessed && !mem.metadata?.processed) return false
    if ((mem.content || '').length < cfg.minContentLength) return false
    if (cfg.requireTagsOrEntities && !allowMissingTags.has(type) && !mem.tags?.length && !mem.entities?.length) return false
    if (mem.metadata?.trainingConsent === false) return false
    return true
  })

  // Relaxed rules for voice-strong types if strict yields too few
  let filtered = strictFiltered
  let relaxed = false
  if (filtered.length === 0) {
    relaxed = true
    filtered = out.filter(mem => {
      const type = mem.type || ''
      const voiceType = ['reflection', 'inner_dialogue', 'chat', 'conversation'].includes(type)
      if (!voiceType) return false
      if ((mem.content || '').length < cfg.minContentLength) return false
      if (mem.metadata?.trainingConsent === false) return false
      return true
    })
  }

  console.log(`[adapter-builder] Found ${out.length} total memories, ${filtered.length} passed filters`)

  // Time-weighted sampling if enabled
  if (cfg.useTimeWeighting && filtered.length > 0) {
    // Calculate weights for each memory
    const weighted = filtered.map(mem => ({
      memory: mem,
      weight: calculateTimeWeight(mem.timestamp, cfg.decayHalfLife)
    }))

    // Sort by weight (highest first) to prioritize recent memories
    weighted.sort((a, b) => b.weight - a.weight)

    // Calculate statistics
    const avgAge = filtered.reduce((sum, m) => {
      const ageDays = (Date.now() - new Date(m.timestamp).getTime()) / (24 * 3600 * 1000)
      return sum + ageDays
    }, 0) / filtered.length

    const avgWeight = weighted.reduce((sum, w) => sum + w.weight, 0) / weighted.length

    console.log(`[adapter-builder] Time-weighted sampling (halfLife=${cfg.decayHalfLife}d):`)
    console.log(`  Average memory age: ${avgAge.toFixed(1)} days`)
    console.log(`  Average weight: ${avgWeight.toFixed(3)}`)
    console.log(`  Oldest memory weight: ${weighted[weighted.length - 1].weight.toFixed(4)}`)
    console.log(`  Newest memory weight: ${weighted[0].weight.toFixed(4)}`)

    // Take top N weighted memories
    const selected = weighted.slice(0, Math.max(1, Math.min(max, cfg.max))).map(w => w.memory)

    const selectedAvgAge = selected.reduce((sum, m) => {
      const ageDays = (Date.now() - new Date(m.timestamp).getTime()) / (24 * 3600 * 1000)
      return sum + ageDays
    }, 0) / selected.length

    console.log(`[adapter-builder] Selected ${selected.length} memories (avg age: ${selectedAvgAge.toFixed(1)}d)`)

    return selected
  }

  // Non-weighted sampling (old behavior)
  console.log(`[adapter-builder] Using top ${Math.min(max, cfg.max)} most recent memories (no time weighting)`)
  return filtered.slice(0, Math.max(1, Math.min(max, cfg.max)))
}

/**
 * Convert memory to instruction pair
 * Uses different formats based on memory type for better training signal
 */
function toInstructionPair(mem: Memory) {
  const type = mem.type || 'unknown'

  const deriveSourcePath = () => `memory/episodic/${new Date(mem.timestamp).getFullYear()}/${mem.id}.json`

  const normalizeUserUtterance = (content: string | undefined): string => {
    if (!content) return ''
    const trimmed = content.trim()
    const quoted = trimmed.match(/^Me:\s*[\"“](.*)[\"”]\s*$/s)
    if (quoted && quoted[1]) return quoted[1].trim()
    const colonSplit = trimmed.startsWith('Me:') ? trimmed.slice(3).trim() : trimmed
    return colonSplit.replace(/^["“]|["”]$/g, '').trim()
  }

  // Reflections are high-confidence Greg voice
  if (type === 'reflection') {
    const theme = extractReflectionTheme(mem.content)
    return finalizePair({
      instruction: 'Write a reflection in Greg\'s voice on this theme:',
      input: theme,
      output: mem.content || '',
      meta: {
        source: mem.id,
        sourcePath: deriveSourcePath(),
        confidence: 'high',
        type: 'reflection',
        tags: mem.tags || [],
        entities: mem.entities || [],
        theme,
      }
    })
  }
  if (type === 'reflection_summary') {
    let reflectionContent = ''
    let linkedReflectionPath: string | undefined
    const link = mem.links?.find((l) => ['reflection', 'source', 'summary_of'].includes(l.type))
    if (link) {
      const absolutePath = path.isAbsolute(link.target) ? link.target : path.join(paths.root, link.target)
      try {
        const linked = JSON.parse(fs.readFileSync(absolutePath, 'utf-8'))
        if (typeof linked?.content === 'string') {
          reflectionContent = linked.content
          linkedReflectionPath = link.target
        }
      } catch (err) {
        console.warn(`[adapter-builder] Failed to load linked reflection at ${link.target}: ${(err as Error).message}`)
      }
    }
    if (!reflectionContent) return null
    const theme = extractReflectionTheme(reflectionContent)
    const isExtended = mem.tags?.includes('extended')
    const instruction = isExtended
      ? 'Provide a medium-length conclusion drawn from this reflection:'
      : 'Provide a concise takeaway from this reflection:'
    const meta: Record<string, any> = {
      source: mem.id,
      sourcePath: deriveSourcePath(),
      confidence: 'high',
      type: 'reflection_summary',
      tags: mem.tags || [],
      entities: mem.entities || [],
      theme,
    }
    if (linkedReflectionPath) meta.summaryOf = linkedReflectionPath

    return finalizePair({
      instruction,
      input: reflectionContent,
      output: mem.content || '',
      meta,
    })
  }

  // Conversations and inner dialogue
  if (type === 'conversation' || type === 'chat') {
    // Only use conversation memories that include a response field
    if (!mem.response || mem.response.trim().length === 0) return null
    const output = mem.response

    return finalizePair({
      instruction: 'Respond in Greg\'s conversational style:',
      input: normalizeUserUtterance(mem.content),
      output: output,
      meta: {
        source: mem.id,
        sourcePath: deriveSourcePath(),
        confidence: 'medium',
        type: 'conversation',
        tags: mem.tags || [],
        entities: mem.entities || [],
        responseLength: output.length,
      }
    })
  }

  if (type === 'inner_dialogue') {
    return finalizePair({
      instruction: 'Think through this in Greg\'s inner voice:',
      input: mem.content,
      output: mem.response || mem.content || '',
      meta: {
        source: mem.id,
        sourcePath: deriveSourcePath(),
        confidence: 'high',
        type: 'inner_dialogue',
        tags: mem.tags || [],
        entities: mem.entities || [],
      }
    })
  }

  if (type === 'dream') {
    const theme = extractReflectionTheme(mem.content)
    return finalizePair({
      instruction: 'Describe this dream from Greg\'s perspective:',
      input: theme,
      output: mem.content || '',
      meta: {
        source: mem.id,
        sourcePath: deriveSourcePath(),
        confidence: 'medium',
        type: 'dream',
        tags: mem.tags || [],
        entities: mem.entities || [],
        theme,
      }
    })
  }

  if (type === 'audio') {
    const theme = extractReflectionTheme(mem.content)
    return finalizePair({
      instruction: 'Respond in Greg\'s voice to this audio summary:',
      input: theme,
      output: mem.content || '',
      meta: {
        source: mem.id,
        sourcePath: deriveSourcePath(),
        confidence: 'medium',
        type: 'audio',
        tags: mem.tags || [],
        entities: mem.entities || [],
        theme,
      }
    })
  }

  if (type === 'action') {
    const theme = extractReflectionTheme(mem.content)
    return finalizePair({
      instruction: 'Explain this recent action you took:',
      input: theme,
      output: mem.content || '',
      meta: {
        source: mem.id,
        sourcePath: deriveSourcePath(),
        confidence: 'medium',
        type: 'action',
        tags: mem.tags || [],
        entities: mem.entities || [],
        theme,
      }
    })
  }

  if (type === 'observation' || type === 'journal') {
    const theme = extractReflectionTheme(mem.content)
    return finalizePair({
      instruction: 'Share your thoughts on this observation:',
      input: theme,
      output: mem.content || '',
      meta: {
        source: mem.id,
        sourcePath: deriveSourcePath(),
        confidence: 'medium',
        type,
        tags: mem.tags || [],
        entities: mem.entities || [],
        theme,
      }
    })
  }

  // Fallback for other types
  return finalizePair({
    instruction: 'Respond in Greg\'s style:',
    input: mem.content || '',
    output: mem.content || '',
    meta: {
      source: mem.id,
      sourcePath: deriveSourcePath(),
      confidence: 'low',
      type: type,
      tags: mem.tags || [],
      entities: mem.entities || [],
    }
  })
}

/**
 * Read reflections from audit logs (recent days)
 */
function readReflectionsFromAudit(days: number): Memory[] {
  const out: Memory[] = []
  try {
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10)
      const file = path.join(paths.logs, 'audit', `${date}.ndjson`)
      if (!fs.existsSync(file)) continue
      const lines = fs.readFileSync(file, 'utf-8').trim().split('\n')
      for (const line of lines) {
        try {
          const obj = JSON.parse(line)
          // Match reflector insights
          if (
            obj && obj.actor === 'reflector' &&
            (obj.event === 'Reflector generated new insight' || obj.event === 'reflector_insight') &&
            obj.details && (obj.details.reflection || obj.metadata?.reflection)
          ) {
            const content: string = obj.details.reflection || obj.metadata.reflection
            out.push({
              id: `refl-${date}-${out.length}`,
              timestamp: obj.timestamp || new Date().toISOString(),
              content,
              type: 'reflection',
              tags: Array.isArray(obj.details?.tags) ? obj.details.tags : ['reflection'],
              entities: [],
            })
          }
        } catch {}
      }
    }
  } catch {}
  return out
}

function writeJsonl(pairs: any[], destDir: string): string {
  fs.mkdirSync(destDir, { recursive: true })
  const file = path.join(destDir, 'instructions.jsonl')
  const lines = pairs.map(p => JSON.stringify(p))
  fs.writeFileSync(file, lines.join('\n'))

  // Write metadata file
  const stats = {
    pairCount: pairs.length,
    createdAt: new Date().toISOString(),
    byType: {} as Record<string, number>,
    byConfidence: {} as Record<string, number>,
    avgInputLength: 0,
    avgOutputLength: 0,
  }

  let totalInputLen = 0
  let totalOutputLen = 0

  for (const pair of pairs) {
    const type = pair.meta?.type || 'unknown'
    const confidence = pair.meta?.confidence || 'unknown'

    stats.byType[type] = (stats.byType[type] || 0) + 1
    stats.byConfidence[confidence] = (stats.byConfidence[confidence] || 0) + 1

    totalInputLen += pair.input?.length || 0
    totalOutputLen += pair.output?.length || 0
  }

  // Guard against divide-by-zero when no pairs are generated
  if (pairs.length > 0) {
    stats.avgInputLength = Math.round(totalInputLen / pairs.length)
    stats.avgOutputLength = Math.round(totalOutputLen / pairs.length)
  } else {
    stats.avgInputLength = 0
    stats.avgOutputLength = 0
  }

  fs.writeFileSync(
    path.join(destDir, 'metadata.json'),
    JSON.stringify(stats, null, 2)
  )

  return file
}

type PairRecord = {
  pair: any;
  order: number;
}

function rebalancePairs(records: PairRecord[]): PairRecord[] {
  const reflections = records.filter(r => r.pair?.meta?.type === 'reflection')
  const others = records.filter(r => r.pair?.meta?.type !== 'reflection')

  if (reflections.length === 0) {
    return records
  }

  const targetRatio = 0.6

  if (others.length === 0) {
    return reflections.slice(0, Math.min(reflections.length, 200)).sort((a, b) => a.order - b.order)
  }

  const baseLimit = Math.ceil((targetRatio * others.length) / (1 - targetRatio))
  const maxReflections = Math.min(reflections.length, Math.max(baseLimit, 40))

  if (reflections.length <= maxReflections) {
    return [...others, ...reflections].sort((a, b) => a.order - b.order)
  }

  const trimmedReflections = reflections.slice(0, maxReflections)
  const combined = [...others, ...trimmedReflections]
  combined.sort((a, b) => a.order - b.order)
  return combined
}

async function main() {
  audit({ level: 'info', category: 'action', event: 'adapter_builder_started', actor: 'adapter-builder' })
  const cfg = loadConfig()
  const mems = readRecentMemories(cfg.days, cfg.max)
  const refl = readReflectionsFromAudit(cfg.days)

  if (mems.length === 0) {
    console.warn('[adapter-builder] No memories passed quality filters.')
    console.warn('[adapter-builder] Ensure you have processed memories (run organizer agent).')
    console.warn('[adapter-builder] Memories must be: processed, dialogue-type, ≥20 chars, with tags/entities.')
    audit({ level: 'warn', category: 'action', event: 'adapter_builder_no_data', details: { reason: 'no_qualified_memories' }, actor: 'adapter-builder' })
    process.exit(1)
  }

  // Build pairs from recent memories + reflections
  const pairRecords: PairRecord[] = []
  mems.forEach((mem, idx) => {
    const pair = toInstructionPair(mem)
    if (pair) pairRecords.push({ pair, order: idx })
  })

  const offset = pairRecords.length
  refl.forEach((mem, idx) => {
    const pair = toInstructionPair(mem)
    if (pair) pairRecords.push({ pair, order: offset + idx })
  })

  // Curated highlights (if present)
  try {
    const curatedRoot = path.join(paths.semantic, 'curated')
    if (fs.existsSync(curatedRoot)) {
      for (const entry of fs.readdirSync(curatedRoot)) {
        if (!entry.endsWith('.highlights.json')) continue
        const base = entry.replace(/\.highlights\.json$/, '')
        const metaPath = path.join(curatedRoot, `${base}.meta.json`)
        const hlPath = path.join(curatedRoot, entry)
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          const highs: string[] = JSON.parse(fs.readFileSync(hlPath, 'utf-8'))
          const title = String(meta?.title || base)
          for (const h of highs.slice(0, 20)) {
            const pair = finalizePair({
              instruction: 'Write in Greg\'s style about this highlight:',
              input: title,
              output: h,
              meta: { source: `curated:${base}`, type: 'curated_highlight', confidence: 'medium', tags: meta?.tags || [] }
            })
            if (pair) {
              pairRecords.push({ pair: pair as any, order: pairRecords.length + 1 })
            }
          }
        } catch {}
      }
    }
  } catch {}

  // Inject a small, high-quality Self Profile slice so core persona is learned by the adapter
  try {
    const persona = loadPersonaCore() as any
    const name: string = persona?.identity?.name || 'Greg'
    const aliases: string[] = Array.isArray(persona?.identity?.aliases) ? persona.identity.aliases : []
    const values: string[] = Array.isArray(persona?.values?.core) ? persona.values.core.map((v: any) => v.value) : []
    const narrativeStyle: string = persona?.personality?.narrativeStyle || ''
    const toneCfg = persona?.personality?.communicationStyle || {}
    const tones = Array.isArray(toneCfg?.tone) ? toneCfg.tone.join(', ') : (toneCfg?.tone || 'clear, friendly')

    const selfPairsRaw = [
      {
        instruction: 'Introduce yourself in your own voice (first person).',
        input: '',
        output: `I am ${name}. I speak in the first person, and I keep my answers aligned with my values: ${values.join(', ')}.`,
        meta: { source: 'self_profile', type: 'self_profile', confidence: 'high' }
      },
      {
        instruction: 'Answer this greet in your signature style: "Hello"',
        input: 'Hello',
        output: `Hi — I’m ${name}. What’s on your mind?`,
        meta: { source: 'self_profile', type: 'self_profile', confidence: 'high' }
      },
      {
        instruction: 'State your name briefly (first person).',
        input: '',
        output: `I’m ${name}.`,
        meta: { source: 'self_profile', type: 'self_profile', confidence: 'high' }
      },
      {
        instruction: 'Respond concisely in your style to: "Say yes in one word"',
        input: 'Say yes in one word',
        output: 'Yes',
        meta: { source: 'self_profile', type: 'self_profile', confidence: 'high' }
      },
      {
        instruction: 'Explain your communication tone and narrative preference in one or two sentences (first person).',
        input: '',
        output: `I keep my tone ${tones}. ${narrativeStyle ? narrativeStyle : ''}`.trim(),
        meta: { source: 'self_profile', type: 'self_profile', confidence: 'high' }
      },
    ]

    const selfPairs = selfPairsRaw
      .map(pair => finalizePair(pair as InstructionPair))
      .filter((pair): pair is InstructionPair => Boolean(pair))

    // Add self-profile pairs WITHOUT duplication
    // These are high-quality anchor examples that teach core personality
    // NO duplication - each example appears exactly once
    selfPairs.reverse().forEach((pair, idx) => {
      pairRecords.unshift({ pair, order: -1 * (idx + 1) })
    })
  } catch (e) {
    console.warn('[adapter-builder] Failed to add self-profile pairs:', (e as Error).message)
  }

  const balanced = rebalancePairs(pairRecords)
  const pairs = balanced.map(record => record.pair)

  const stamp = new Date().toISOString().split('T')[0]
  const outDir = path.join(paths.out, 'adapters', stamp)
  const jsonlPath = writeJsonl(pairs, outDir)
  audit({ level: 'info', category: 'action', event: 'adapter_builder_completed', details: { count: pairs.length, path: jsonlPath }, actor: 'adapter-builder' })
  console.log(`Adapter dataset written: ${jsonlPath} (${pairs.length} pairs)`)
}

main().catch(err => {
  console.error('adapter-builder failed:', err)
  audit({ level: 'error', category: 'action', event: 'adapter_builder_failed', details: { error: String(err) }, actor: 'adapter-builder' })
  process.exit(1)
})
