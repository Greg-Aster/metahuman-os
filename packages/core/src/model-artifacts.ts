/**
 * Shared local model artifact discovery.
 *
 * v1 indexes the existing Ollama model store and exposes its GGUF blobs as
 * provider-compatible artifacts. It does not move, delete, or download models.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type LocalModelProvider = 'ollama' | 'vllm' | 'local-models';
export type LocalModelArtifactFormat = 'gguf';

export interface LocalModelArtifact {
  id: string;
  name: string;
  tag: string;
  displayName: string;
  source: 'ollama-store';
  provider: 'ollama';
  compatibleProviders: LocalModelProvider[];
  format: LocalModelArtifactFormat;
  quantization?: string;
  digest: string;
  sizeBytes: number;
  path: string;
  manifestPath: string;
  installed: boolean;
  error?: string;
}
export interface LocalModelArtifactResolution {
  requestedModel: string;
  provider: LocalModelProvider;
  artifact?: LocalModelArtifact;
  error?: string;
}

export function getOllamaModelsDir(): string {
  if (process.env.OLLAMA_MODELS) {
    return process.env.OLLAMA_MODELS;
  }

  const systemStore = '/usr/share/ollama/.ollama/models';
  if (fs.existsSync(systemStore)) {
    return systemStore;
  }

  return path.join(os.homedir(), '.ollama', 'models');
}

function blobPathForDigest(modelsDir: string, digest: string): string {
  return path.join(modelsDir, 'blobs', digest.replace(':', '-'));
}

function getManifestDisplayName(manifestPath: string, manifestsRoot: string): string {
  const relative = path.relative(manifestsRoot, manifestPath);
  const parts = relative.split(path.sep);
  const libraryIndex = parts.indexOf('library');
  const nameParts = libraryIndex >= 0 ? parts.slice(libraryIndex + 1) : parts;
  const tag = nameParts.pop() || 'latest';
  const name = nameParts.join('/');
  return `${name}:${tag}`;
}

function extractQuantization(displayName: string): string | undefined {
  const tag = displayName.split(':').pop();
  if (!tag || tag === 'latest') {
    return undefined;
  }
  return tag;
}

function isGGUFFile(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(4);
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
    return buffer.toString('utf-8') === 'GGUF';
  } catch {
    return false;
  }
}

export function listLocalModelArtifacts(modelsDir = getOllamaModelsDir()): LocalModelArtifact[] {
  const manifestsRoot = path.join(modelsDir, 'manifests');
  if (!fs.existsSync(manifestsRoot)) {
    return [];
  }

  const artifacts: LocalModelArtifact[] = [];
  const stack = [manifestsRoot];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      try {
        const manifest = JSON.parse(fs.readFileSync(entryPath, 'utf-8')) as {
          layers?: Array<{ mediaType?: string; digest?: string; size?: number }>;
        };
        const modelLayer = manifest.layers?.find(layer => layer.mediaType === 'application/vnd.ollama.image.model');
        if (!modelLayer?.digest || !modelLayer.size) {
          continue;
        }

        const artifactPath = blobPathForDigest(modelsDir, modelLayer.digest);
        const installed = fs.existsSync(artifactPath);
        const displayName = getManifestDisplayName(entryPath, manifestsRoot);
        const name = displayName.replace(/:latest$/, '');
        const tag = displayName.includes(':') ? displayName.split(':').pop() || 'latest' : 'latest';
        const isGGUF = installed && isGGUFFile(artifactPath);

        artifacts.push({
          id: `ollama:${displayName}`,
          name,
          tag,
          displayName,
          source: 'ollama-store',
          provider: 'ollama',
          compatibleProviders: isGGUF ? ['ollama', 'vllm', 'local-models'] : ['ollama'],
          format: 'gguf',
          quantization: extractQuantization(displayName),
          digest: modelLayer.digest,
          sizeBytes: modelLayer.size,
          path: artifactPath,
          manifestPath: entryPath,
          installed,
          error: installed ? undefined : `Missing Ollama blob for ${modelLayer.digest}`,
        });
      } catch {
        // Ignore malformed manifests; the status surface reports usable artifacts.
      }
    }
  }

  return artifacts.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function resolveLocalModelArtifact(
  model: string,
  provider: LocalModelProvider,
  modelsDir = getOllamaModelsDir()
): LocalModelArtifactResolution {
  const artifacts = listLocalModelArtifacts(modelsDir);
  const normalized = model.trim();
  const candidates = new Set([
    normalized,
    normalized.replace(/^ollama:/, ''),
    normalized.includes(':') ? normalized : `${normalized}:latest`,
  ]);

  const artifact = artifacts.find(candidate =>
    candidates.has(candidate.displayName) ||
    candidates.has(candidate.name) ||
    candidates.has(candidate.id)
  );

  if (!artifact) {
    return {
      requestedModel: model,
      provider,
      error: `No shared local artifact found for ${model} in ${modelsDir}`,
    };
  }

  if (!artifact.installed) {
    return {
      requestedModel: model,
      provider,
      artifact,
      error: artifact.error || `Artifact ${artifact.displayName} is not installed`,
    };
  }

  if (!artifact.compatibleProviders.includes(provider)) {
    return {
      requestedModel: model,
      provider,
      artifact,
      error: `${artifact.displayName} is not compatible with ${provider}`,
    };
  }

  return { requestedModel: model, provider, artifact };
}
