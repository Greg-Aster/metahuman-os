import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './paths.js'

const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

const voiceConfig = JSON.parse(read('etc/voice-servers.json')).servers
const agentServices = JSON.parse(read('etc/services.json')).services
const launcher = read('bin/start-voice-server')
const bootLauncher = read('bin/start-services')
const manager = read('packages/core/src/voice-service-manager.ts')
const voiceSettings = read('packages/core/src/api/handlers/voice-settings.ts')
const voiceSettingsUi = read('apps/site/src/components/VoiceSettings.svelte')
const kokoroServer = read('external/kokoro/kokoro_server.py')
const sovitsManager = read('packages/core/src/tts/server-manager.ts')
const sovitsRoutes = read('packages/core/src/api/handlers/tts-service-routes.ts')
const sovitsCli = read('packages/cli/src/commands/sovits.ts')
const stopLauncher = read('bin/stop-voice-server')

for (const id of ['kokoro', 'whisper']) {
  assert.equal(voiceConfig[id]?.enabled, true, `${id} must be enabled in the voice server configuration`)
  assert.equal(voiceConfig[id]?.startOnSystemBoot, true, `${id} must be enabled for system boot`)
  assert.equal(agentServices[id], undefined, `${id} must never be registered as an Agent Monitor service`)
}

const agentMonitorOwners = [
  'packages/core/src/agent-monitor.ts',
  'packages/core/src/agent-monitor-types.ts',
  'packages/core/src/agent-monitor-descriptors.ts',
  'packages/core/src/agent-monitor-registry.ts',
  'packages/core/src/agent-catalog-definitions.ts',
  'scripts/validate-agent-monitor.ts',
]
const forbiddenVoiceServerKnowledge = /voice[- ]server|server status|kokoro server|whisper server|services\/(?:kokoro|whisper)\.ts/i

for (const file of agentMonitorOwners) {
  assert.doesNotMatch(
    read(file),
    forbiddenVoiceServerKnowledge,
    `${file} must not contain voice server lifecycle or status code`,
  )
}

const voiceServerOwners = [
  'packages/core/src/voice-service-manager.ts',
  'packages/core/src/api/handlers/whisper-server.ts',
  'packages/core/src/api/handlers/tts-service-routes.ts',
  'packages/cli/src/commands/voice-server.ts',
  'apps/site/src/components/ServerStatus.svelte',
  'bin/start-voice-server',
]
const forbiddenAgentMonitorKnowledge = /agent-monitor|startAgentProcess|registerAgent|unregisterAgent|stopAgent|isAgentRunning|readRegistry/i

for (const file of voiceServerOwners) {
  assert.doesNotMatch(
    read(file),
    forbiddenAgentMonitorKnowledge,
    `${file} must not import or control Agent Monitor`,
  )
}

assert.doesNotMatch(manager, /etc\/services\.json/, 'voice server configuration must not use Agent Monitor service config')
assert.match(
  manager,
  /updateVoiceServiceDevice[\s\S]*?writeVoiceServerConfig[\s\S]*?stopVoiceService[\s\S]*?ensureVoiceServiceRunning/,
  'device updates must atomically persist and restart through the voice service lifecycle owner',
)
assert.match(
  voiceSettings,
  /user\.role !== 'owner'[\s\S]*?updateVoiceServiceDevice\('kokoro'[\s\S]*?updateVoiceServiceDevice\('whisper'/,
  'Voice Settings must owner-guard and delegate both device updates to the lifecycle owner',
)
assert.doesNotMatch(
  voiceSettings,
  /kokoroConfig\.device\s*=|config\.stt\.whisper\.device\s*=/,
  'system service devices must not be persisted in a user voice profile',
)
for (const control of [
  'config.outputTarget',
  'config.piper.currentVoice',
  'config.piper.speakingRate',
  'config.sovits.serverUrl',
  'config.rvc.speakerId',
  'config.rvc.device',
  'config.kokoro.voice',
  'config.kokoro.speed',
  'config.kokoro.normalizeCustomVoicepacks',
  'config.stt.language',
  'config.stt.useServer',
  'config.stt.vad.voiceThreshold',
]) {
  assert.match(voiceSettingsUi, new RegExp(control.replaceAll('.', '\\.')), `${control} must remain exposed in Voice Settings`)
}
assert.match(
  voiceSettingsUi,
  /id="kokoro-device"[\s\S]{0,300}canConfigureDevices/,
  'Kokoro CPU/CUDA selection must be editable for the installation owner',
)
assert.match(
  voiceSettingsUi,
  /id="stt-device"[\s\S]{0,300}canConfigureDevices/,
  'Whisper CPU/CUDA selection must be editable for the installation owner',
)
assert.match(kokoroServer, /"device": processing_device/, 'Kokoro health must report its applied processing device')
assert.match(launcher, /voice-server start --all --boot/, 'the voice launcher must use the standalone voice server command')
assert.doesNotMatch(launcher, /default-user\.txt|profile path|mh" agent/, 'the voice launcher must not resolve a user or call Agent Monitor')
assert.match(bootLauncher, /start_task voice-server/, 'system startup must launch the independent voice server owner')
assert.doesNotMatch(
  voiceSettings,
  /Auto-starting Whisper server|Running start-voice-server/,
  'reading user voice settings must not spawn system processes',
)
assert.match(sovitsRoutes, /from '..\/..\/tts\/server-manager\.js'/, 'SoVITS API transport must delegate to the core lifecycle owner')
assert.match(sovitsCli, /getSovitsServerStatus/, 'SoVITS CLI must delegate status to the core lifecycle owner')
assert.doesNotMatch(sovitsCli, /process\.kill|sovits\.pid/, 'SoVITS CLI must not own PID files or signal processes')
assert.doesNotMatch(voiceSettings, /sovits\.pid|process\.kill/, 'voice settings must not own SoVITS processes')
assert.match(stopLauncher, /mh" sovits stop/, 'voice stop launcher must delegate SoVITS shutdown to the CLI')
assert.doesNotMatch(stopLauncher, /sovits\.pid|kill "\$PID"/, 'voice stop launcher must not own SoVITS PID files')
assert.match(sovitsManager, /ownsSovitsProcess/, 'SoVITS lifecycle owner must verify process identity before signaling')

for (const retiredPath of [
  'brain/agents/transcriber',
  'packages/core/src/transcription.ts',
  'packages/core/src/connectors/voice-memo-ingestor.ts',
  'packages/core/src/api/handlers/voice-memo-ingestion.ts',
]) {
  assert.equal(
    fs.existsSync(path.join(ROOT, retiredPath)),
    false,
    `${retiredPath} must remain retired in favor of the canonical STT owner`,
  )
}

const apiRouter = read('packages/core/src/api/router.ts')
const coreExports = read('packages/core/src/index.ts')
assert.doesNotMatch(apiRouter, /\/api\/(?:audio\/upload|voice-memos\/)/, 'retired file-transcription routes must not be registered')
assert.doesNotMatch(coreExports, /\.\/transcription|voice-memo-ingestor/, 'retired file-transcription owners must not be exported')

console.log('voice-service-ownership.spec.ts passed')
