/**
 * Shared local model artifact discovery.
 *
 * Indexes the existing Ollama model store and complete Hugging Face cache
 * snapshots. It does not move, delete, or download models.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type LocalModelProvider = 'ollama' | 'vllm' | 'local-models';
export type LocalModelArtifactFormat = 'gguf' | 'safetensors';

export interface LocalModelArtifact {
  id: string;
  name: string;
  tag: string;
  displayName: string;
  source: 'ollama-store' | 'huggingface-cache';
  provider: 'ollama' | 'vllm';
  compatibleProviders: LocalModelProvider[];
  format: LocalModelArtifactFormat;
  /** Model architecture reported by the artifact's native metadata. */
  architecture?: string;
  /** Human-readable parameter scale reported by the artifact metadata. */
  modelType?: string;
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

export function getHuggingFaceHubDir(): string {
  if (process.env.HF_HUB_CACHE) return process.env.HF_HUB_CACHE;
  if (process.env.HF_HOME) return path.join(process.env.HF_HOME, 'hub');
  return path.join(os.homedir(), '.cache', 'huggingface', 'hub');
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

function readOllamaModelMetadata(
  modelsDir: string,
  digest: string | undefined,
): { architecture?: string; modelType?: string; quantization?: string } {
  if (!digest) return {};

  try {
    const config = JSON.parse(fs.readFileSync(blobPathForDigest(modelsDir, digest), 'utf-8')) as {
      model_family?: string;
      model_type?: string;
      file_type?: string;
    };
    return {
      architecture: config.model_family,
      modelType: config.model_type,
      quantization: config.file_type,
    };
  } catch {
    return {};
  }
}

function listOllamaModelArtifacts(modelsDir: string): LocalModelArtifact[] {
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
          config?: { digest?: string };
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
        const metadata = readOllamaModelMetadata(modelsDir, manifest.config?.digest);

        artifacts.push({
          id: `ollama:${displayName}`,
          name,
          tag,
          displayName,
          source: 'ollama-store',
          provider: 'ollama',
          compatibleProviders: isGGUF ? ['ollama', 'vllm', 'local-models'] : ['ollama'],
          format: 'gguf',
          architecture: metadata.architecture,
          modelType: metadata.modelType,
          quantization: metadata.quantization || extractQuantization(displayName),
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

  return artifacts;
}

function listHuggingFaceModelArtifacts(hubDir: string): LocalModelArtifact[] {
  if (!fs.existsSync(hubDir)) return [];

  const artifacts: LocalModelArtifact[] = [];
  let repositories: fs.Dirent[] = [];
  try {
    repositories = fs.readdirSync(hubDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const repository of repositories) {
    if (!repository.isDirectory() || !repository.name.startsWith('models--')) continue;

    const repositoryDir = path.join(hubDir, repository.name);
    const revisionRef = path.join(repositoryDir, 'refs', 'main');
    let snapshot: string;
    try {
      snapshot = fs.readFileSync(revisionRef, 'utf-8').trim();
    } catch {
      continue;
    }
    if (!snapshot) continue;

    const snapshotDir = path.join(repositoryDir, 'snapshots', snapshot);
    const configPath = path.join(snapshotDir, 'config.json');
    if (!fs.existsSync(configPath)) continue;

    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        architectures?: string[];
        model_type?: string;
        quantization_config?: { quant_method?: string };
      };
      const indexPath = path.join(snapshotDir, 'model.safetensors.index.json');
      const singleWeightsPath = path.join(snapshotDir, 'model.safetensors');
      let weightPaths: string[] = [];
      let manifestPath = configPath;

      if (fs.existsSync(indexPath)) {
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as {
          weight_map?: Record<string, string>;
        };
        weightPaths = [...new Set(Object.values(index.weight_map || {}))]
          .map(file => path.join(snapshotDir, file));
        manifestPath = indexPath;
      } else if (fs.existsSync(singleWeightsPath)) {
        weightPaths = [singleWeightsPath];
        manifestPath = singleWeightsPath;
      }

      // Hugging Face creates snapshot links only after each blob is complete.
      // Do not advertise partially downloaded or metadata-only repositories.
      if (weightPaths.length === 0 || weightPaths.some(file => !fs.existsSync(file))) continue;

      const repositoryId = repository.name
        .slice('models--'.length)
        .split('--')
        .join('/');
      const sizeBytes = weightPaths.reduce((total, file) => total + fs.statSync(file).size, 0);

      artifacts.push({
        id: `huggingface:${repositoryId}`,
        name: repositoryId,
        tag: 'main',
        displayName: repositoryId,
        source: 'huggingface-cache',
        provider: 'vllm',
        compatibleProviders: ['vllm'],
        format: 'safetensors',
        architecture: config.architectures?.[0] || config.model_type,
        modelType: config.model_type,
        quantization: config.quantization_config?.quant_method,
        digest: snapshot,
        sizeBytes,
        // Launch discovered installed artifacts from the complete local
        // snapshot. Passing the repository ID can make Transformers perform
        // network lookups for optional processor files even when all required
        // runtime files are already present in this snapshot.
        path: snapshotDir,
        manifestPath,
        installed: true,
      });
    } catch {
      // Ignore malformed or incomplete cache entries.
    }
  }

  return artifacts;
}

export function listLocalModelArtifacts(
  modelsDir?: string,
  huggingFaceHubDir?: string,
): LocalModelArtifact[] {
  const ollamaArtifacts = listOllamaModelArtifacts(modelsDir || getOllamaModelsDir());
  const huggingFaceArtifacts = huggingFaceHubDir
    ? listHuggingFaceModelArtifacts(huggingFaceHubDir)
    : modelsDir === undefined
      ? listHuggingFaceModelArtifacts(getHuggingFaceHubDir())
      : [];

  return [...ollamaArtifacts, ...huggingFaceArtifacts]
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function resolveLocalModelArtifact(
  model: string,
  provider: LocalModelProvider,
  modelsDir?: string,
  huggingFaceHubDir?: string,
): LocalModelArtifactResolution {
  const artifacts = listLocalModelArtifacts(modelsDir, huggingFaceHubDir);
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
      error: `No shared local artifact found for ${model}`,
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
