import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listLocalModelArtifacts } from './model-artifacts.js'

const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-model-artifacts-'))
try {
  const manifestDir = path.join(modelsDir, 'manifests', 'registry.ollama.ai', 'library', 'example')
  const blobsDir = path.join(modelsDir, 'blobs')
  fs.mkdirSync(manifestDir, { recursive: true })
  fs.mkdirSync(blobsDir, { recursive: true })

  const modelDigest = 'sha256:model'
  const configDigest = 'sha256:config'
  fs.writeFileSync(path.join(blobsDir, 'sha256-model'), Buffer.from('GGUFtest'))
  fs.writeFileSync(path.join(blobsDir, 'sha256-config'), JSON.stringify({
    model_family: 'example_arch',
    model_type: '9B',
    file_type: 'Q4_K_M',
  }))
  fs.writeFileSync(path.join(manifestDir, 'latest'), JSON.stringify({
    config: { digest: configDigest },
    layers: [{
      mediaType: 'application/vnd.ollama.image.model',
      digest: modelDigest,
      size: 8,
    }],
  }))

  const hubDir = path.join(modelsDir, 'huggingface-hub')
  const repositoryDir = path.join(hubDir, 'models--Example--Vision-9B')
  const snapshot = 'snapshot-hash'
  const snapshotDir = path.join(repositoryDir, 'snapshots', snapshot)
  fs.mkdirSync(path.join(repositoryDir, 'refs'), { recursive: true })
  fs.mkdirSync(snapshotDir, { recursive: true })
  fs.writeFileSync(path.join(repositoryDir, 'refs', 'main'), snapshot)
  fs.writeFileSync(path.join(snapshotDir, 'config.json'), JSON.stringify({
    architectures: ['ExampleForConditionalGeneration'],
    model_type: 'example_vision',
    quantization_config: { quant_method: 'compressed-tensors' },
  }))
  fs.writeFileSync(path.join(snapshotDir, 'model.safetensors'), Buffer.from('weights'))

  const artifacts = listLocalModelArtifacts(modelsDir, hubDir)
  assert.equal(artifacts.length, 2)
  const ollamaArtifact = artifacts.find(artifact => artifact.source === 'ollama-store')
  assert.equal(ollamaArtifact?.architecture, 'example_arch')
  assert.equal(ollamaArtifact?.modelType, '9B')
  assert.equal(ollamaArtifact?.quantization, 'Q4_K_M')
  assert.equal(ollamaArtifact?.compatibleProviders.includes('vllm'), true)

  const huggingFaceArtifact = artifacts.find(artifact => artifact.source === 'huggingface-cache')
  assert.equal(huggingFaceArtifact?.displayName, 'Example/Vision-9B')
  assert.equal(huggingFaceArtifact?.architecture, 'ExampleForConditionalGeneration')
  assert.equal(huggingFaceArtifact?.quantization, 'compressed-tensors')
  assert.equal(huggingFaceArtifact?.format, 'safetensors')
  assert.equal(huggingFaceArtifact?.path, snapshotDir)
} finally {
  fs.rmSync(modelsDir, { recursive: true })
}

console.log('local model artifact metadata checks passed')
