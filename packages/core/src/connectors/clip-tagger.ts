/**
 * CLIP Image Tagger Connector
 *
 * Provides semantic image tagging using CLIP (Contrastive Language-Image Pre-training).
 * Supports multiple backends:
 * - Transformers.js (local, in-browser/Node.js)
 * - Python backend (local, requires transformers library)
 * - Mock (for testing without model)
 *
 * Part of Phase 3: Massive Greg-Centric Grounding
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { getProfilePaths, systemPaths } from '../paths.js';
import { audit } from '../audit.js';

// ============================================================================
// Types
// ============================================================================

export type ClipBackend = 'transformers.js' | 'python' | 'mock';

export interface ClipConfig {
  backend: ClipBackend;
  modelName?: string;
  pythonPath?: string;
  cacheDir?: string;
}

export interface ImageTag {
  label: string;
  confidence: number;
  category?: string;
}

export interface ImageTaggingResult {
  success: boolean;
  filepath: string;
  tags: ImageTag[];
  description?: string;
  embedding?: number[];
  error?: string;
}

export interface ImageTaggingOptions {
  /** Custom labels to match against */
  customLabels?: string[];
  /** Number of top tags to return */
  topK?: number;
  /** Minimum confidence threshold (0-1) */
  minConfidence?: number;
  /** Generate text description */
  generateDescription?: boolean;
  /** Return embedding vector */
  returnEmbedding?: boolean;
}

// ============================================================================
// Default Labels
// ============================================================================

/**
 * Default semantic labels for image classification.
 * Organized by category for better tagging.
 */
export const DEFAULT_LABELS: Record<string, string[]> = {
  // Scene types
  scene: [
    'indoor', 'outdoor', 'landscape', 'cityscape', 'beach', 'mountain',
    'forest', 'desert', 'ocean', 'lake', 'river', 'park', 'street',
    'building', 'house', 'office', 'restaurant', 'cafe', 'bar',
  ],
  // Activities
  activity: [
    'eating', 'drinking', 'cooking', 'working', 'reading', 'writing',
    'exercising', 'running', 'walking', 'hiking', 'swimming', 'cycling',
    'dancing', 'playing music', 'playing games', 'celebrating', 'traveling',
  ],
  // People
  people: [
    'portrait', 'selfie', 'group photo', 'family', 'friends', 'couple',
    'children', 'baby', 'wedding', 'graduation', 'party',
  ],
  // Objects
  objects: [
    'food', 'drink', 'car', 'bicycle', 'phone', 'computer', 'book',
    'flower', 'plant', 'animal', 'dog', 'cat', 'bird', 'art', 'architecture',
  ],
  // Time/Light
  lighting: [
    'daytime', 'nighttime', 'sunset', 'sunrise', 'golden hour', 'overcast',
    'sunny', 'cloudy', 'rainy', 'snowy',
  ],
  // Mood
  mood: [
    'happy', 'peaceful', 'exciting', 'romantic', 'nostalgic', 'dramatic',
    'professional', 'casual', 'festive', 'artistic',
  ],
};

/**
 * Get all default labels flattened.
 */
export function getAllDefaultLabels(): string[] {
  return Object.values(DEFAULT_LABELS).flat();
}

/**
 * Get labels by category.
 */
export function getLabelsByCategory(category: keyof typeof DEFAULT_LABELS): string[] {
  return DEFAULT_LABELS[category] || [];
}

// ============================================================================
// Backend Detection
// ============================================================================

let cachedBackend: ClipBackend | null = null;

/**
 * Check if Python CLIP is available.
 */
function isPythonClipAvailable(pythonPath?: string): boolean {
  try {
    const python = pythonPath || 'python3';
    const result = spawnSync(python, [
      '-c',
      'import torch; import transformers; from PIL import Image; print("ok")',
    ], { encoding: 'utf-8', timeout: 10000 });
    return result.status === 0 && result.stdout?.includes('ok');
  } catch {
    return false;
  }
}

/**
 * Detect the best available CLIP backend.
 */
export function detectClipBackend(config?: Partial<ClipConfig>): ClipBackend {
  if (cachedBackend && !config) {
    return cachedBackend;
  }

  // Check Python backend
  if (isPythonClipAvailable(config?.pythonPath)) {
    cachedBackend = 'python';
    return 'python';
  }

  // Default to mock
  cachedBackend = 'mock';
  return 'mock';
}

/**
 * Get CLIP backend status.
 */
export function getClipStatus(): {
  available: boolean;
  backend: ClipBackend;
  message: string;
} {
  const backend = detectClipBackend();

  if (backend === 'python') {
    return {
      available: true,
      backend: 'python',
      message: 'CLIP available via Python (transformers + torch)',
    };
  }

  return {
    available: false,
    backend: 'mock',
    message: 'CLIP not available. Install: pip install torch transformers pillow',
  };
}

// ============================================================================
// Mock Backend
// ============================================================================

/**
 * Generate mock tags for testing.
 */
function tagImageMock(filepath: string, options: ImageTaggingOptions): ImageTaggingResult {
  const filename = path.basename(filepath).toLowerCase();
  const tags: ImageTag[] = [];

  // Generate some plausible mock tags based on filename
  if (filename.includes('selfie') || filename.includes('portrait')) {
    tags.push({ label: 'portrait', confidence: 0.85, category: 'people' });
    tags.push({ label: 'selfie', confidence: 0.80, category: 'people' });
  }
  if (filename.includes('beach') || filename.includes('ocean')) {
    tags.push({ label: 'beach', confidence: 0.90, category: 'scene' });
    tags.push({ label: 'outdoor', confidence: 0.95, category: 'scene' });
  }
  if (filename.includes('food') || filename.includes('dinner') || filename.includes('lunch')) {
    tags.push({ label: 'food', confidence: 0.88, category: 'objects' });
    tags.push({ label: 'eating', confidence: 0.75, category: 'activity' });
  }

  // Add some generic tags
  tags.push({ label: 'photo', confidence: 0.99, category: 'scene' });
  if (tags.length < 3) {
    tags.push({ label: 'outdoor', confidence: 0.60, category: 'scene' });
    tags.push({ label: 'daytime', confidence: 0.55, category: 'lighting' });
  }

  // Filter by confidence and limit
  const minConf = options.minConfidence ?? 0.3;
  const topK = options.topK ?? 10;
  const filtered = tags
    .filter((t) => t.confidence >= minConf)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, topK);

  return {
    success: true,
    filepath,
    tags: filtered,
    description: options.generateDescription
      ? `[Mock] Image appears to contain: ${filtered.map((t) => t.label).join(', ')}`
      : undefined,
  };
}

// ============================================================================
// Python Backend
// ============================================================================

const PYTHON_CLIP_SCRIPT = `
import sys
import json
import torch
from PIL import Image
from transformers import CLIPProcessor, CLIPModel

def tag_image(image_path, labels, top_k=10, generate_desc=False, return_embedding=False):
    # Load model (cached after first use)
    model_name = "openai/clip-vit-base-patch32"
    model = CLIPModel.from_pretrained(model_name)
    processor = CLIPProcessor.from_pretrained(model_name)

    # Load and process image
    image = Image.open(image_path).convert("RGB")

    # Prepare text labels
    text_inputs = processor(text=labels, return_tensors="pt", padding=True)
    image_inputs = processor(images=image, return_tensors="pt")

    # Get embeddings
    with torch.no_grad():
        image_features = model.get_image_features(**image_inputs)
        text_features = model.get_text_features(**text_inputs)

    # Calculate similarities
    image_features = image_features / image_features.norm(dim=-1, keepdim=True)
    text_features = text_features / text_features.norm(dim=-1, keepdim=True)
    similarities = (image_features @ text_features.T).squeeze(0)

    # Get top-k results
    probs = similarities.softmax(dim=0)
    top_indices = probs.argsort(descending=True)[:top_k]

    results = []
    for idx in top_indices:
        results.append({
            "label": labels[idx],
            "confidence": float(probs[idx])
        })

    output = {
        "success": True,
        "tags": results
    }

    if generate_desc:
        top_labels = [r["label"] for r in results[:5]]
        output["description"] = f"Image contains: {', '.join(top_labels)}"

    if return_embedding:
        output["embedding"] = image_features.squeeze(0).tolist()

    return output

if __name__ == "__main__":
    input_data = json.loads(sys.argv[1])
    result = tag_image(
        input_data["filepath"],
        input_data["labels"],
        input_data.get("topK", 10),
        input_data.get("generateDescription", False),
        input_data.get("returnEmbedding", False)
    )
    print(json.dumps(result))
`;

/**
 * Tag image using Python CLIP backend.
 */
async function tagImagePython(
  filepath: string,
  options: ImageTaggingOptions,
  config: ClipConfig
): Promise<ImageTaggingResult> {
  return new Promise((resolve) => {
    const labels = options.customLabels || getAllDefaultLabels();
    const input = {
      filepath,
      labels,
      topK: options.topK ?? 10,
      generateDescription: options.generateDescription ?? false,
      returnEmbedding: options.returnEmbedding ?? false,
    };

    const python = config.pythonPath || 'python3';
    const proc = spawn(python, ['-c', PYTHON_CLIP_SCRIPT, JSON.stringify(input)], {
      timeout: 60000, // 60 second timeout for model loading
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({
          success: false,
          filepath,
          tags: [],
          error: `Python CLIP failed: ${stderr || 'Unknown error'}`,
        });
        return;
      }

      try {
        const result = JSON.parse(stdout);

        // Add categories to tags
        const tagsWithCategories = result.tags.map((tag: ImageTag) => ({
          ...tag,
          category: findTagCategory(tag.label),
        }));

        // Filter by minimum confidence
        const minConf = options.minConfidence ?? 0.05;
        const filtered = tagsWithCategories.filter((t: ImageTag) => t.confidence >= minConf);

        resolve({
          success: true,
          filepath,
          tags: filtered,
          description: result.description,
          embedding: result.embedding,
        });
      } catch (parseError) {
        resolve({
          success: false,
          filepath,
          tags: [],
          error: `Failed to parse CLIP output: ${(parseError as Error).message}`,
        });
      }
    });

    proc.on('error', (error) => {
      resolve({
        success: false,
        filepath,
        tags: [],
        error: `Failed to run Python CLIP: ${error.message}`,
      });
    });
  });
}

/**
 * Find the category for a tag label.
 */
function findTagCategory(label: string): string | undefined {
  for (const [category, labels] of Object.entries(DEFAULT_LABELS)) {
    if (labels.includes(label.toLowerCase())) {
      return category;
    }
  }
  return undefined;
}

// ============================================================================
// Main Tagging Function
// ============================================================================

/**
 * Tag an image with semantic labels using CLIP.
 */
export async function tagImage(
  filepath: string,
  options: ImageTaggingOptions = {},
  config?: Partial<ClipConfig>
): Promise<ImageTaggingResult> {
  // Check file exists
  if (!fs.existsSync(filepath)) {
    return {
      success: false,
      filepath,
      tags: [],
      error: `File not found: ${filepath}`,
    };
  }

  // Check file is an image
  const ext = path.extname(filepath).toLowerCase();
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
  if (!imageExts.includes(ext)) {
    return {
      success: false,
      filepath,
      tags: [],
      error: `Not an image file: ${ext}`,
    };
  }

  const backend = config?.backend || detectClipBackend(config);
  const fullConfig: ClipConfig = {
    backend,
    modelName: config?.modelName || 'openai/clip-vit-base-patch32',
    pythonPath: config?.pythonPath,
    cacheDir: config?.cacheDir,
  };

  try {
    let result: ImageTaggingResult;

    switch (backend) {
      case 'python':
        result = await tagImagePython(filepath, options, fullConfig);
        break;

      case 'mock':
      default:
        result = tagImageMock(filepath, options);
        break;
    }

    // Log successful tagging
    if (result.success) {
      audit({
        category: 'action',
        level: 'info',
        event: 'image_tagged',
        actor: 'clip-tagger',
        details: {
          filepath,
          backend,
          tagCount: result.tags.length,
          topTags: result.tags.slice(0, 5).map((t) => t.label),
        },
      });
    }

    return result;
  } catch (error) {
    return {
      success: false,
      filepath,
      tags: [],
      error: (error as Error).message,
    };
  }
}

/**
 * Tag multiple images.
 */
export async function tagImages(
  filepaths: string[],
  options: ImageTaggingOptions = {},
  config?: Partial<ClipConfig>
): Promise<ImageTaggingResult[]> {
  const results: ImageTaggingResult[] = [];

  for (const filepath of filepaths) {
    const result = await tagImage(filepath, options, config);
    results.push(result);
  }

  return results;
}

/**
 * Tag all images in a directory.
 */
export async function tagImagesInDirectory(
  directory: string,
  options: ImageTaggingOptions & { recursive?: boolean } = {},
  config?: Partial<ClipConfig>
): Promise<{
  total: number;
  successful: number;
  failed: number;
  results: ImageTaggingResult[];
}> {
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];

  function scanDirectory(dir: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && options.recursive) {
        files.push(...scanDirectory(fullPath));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (imageExts.includes(ext)) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  const imageFiles = scanDirectory(directory);
  const results = await tagImages(imageFiles, options, config);

  return {
    total: results.length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

/**
 * Generate tags for a photo and format them for memory integration.
 */
export async function generatePhotoTags(
  filepath: string,
  options?: ImageTaggingOptions
): Promise<string[]> {
  const result = await tagImage(filepath, {
    topK: 10,
    minConfidence: 0.15,
    ...options,
  });

  if (!result.success) {
    return [];
  }

  // Format tags with optional category prefix
  return result.tags.map((tag) => {
    if (tag.category) {
      return `${tag.category}:${tag.label.replace(/\s+/g, '-')}`;
    }
    return tag.label.replace(/\s+/g, '-');
  });
}

// ============================================================================
// Export
// ============================================================================

export const clipTagger = {
  tagImage,
  tagImages,
  tagImagesInDirectory,
  generatePhotoTags,
  detectClipBackend,
  getClipStatus,
  getAllDefaultLabels,
  getLabelsByCategory,
  DEFAULT_LABELS,
};
