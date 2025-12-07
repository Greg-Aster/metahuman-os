#!/usr/bin/env pnpm tsx
/**
 * Audio Cleanup Script
 *
 * Analyzes voice recordings and identifies unusable files:
 * - Too short (< 1.5 seconds of actual audio)
 * - Garbled (transcript is too short or looks like noise)
 * - Low quality (file size doesn't match expected duration)
 *
 * Usage:
 *   pnpm tsx scripts/audio-cleanup.ts --dry-run    # Preview what would be deleted
 *   pnpm tsx scripts/audio-cleanup.ts --delete     # Actually delete files
 *   pnpm tsx scripts/audio-cleanup.ts --path /media/greggles/STACK/metahuman/out/voice-training/recordings
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

interface AudioFile {
  path: string;
  size: number;
  metaPath?: string;
  meta?: {
    duration?: number;
    quality?: number;
    transcriptPath?: string;
  };
  transcript?: string;
  actualDuration?: number;
  issues: string[];
}

// STRICT thresholds - we have plenty of data, be discerning
const MIN_DURATION_SEC = 2.5;        // Minimum audio duration (need full sentences)
const MIN_TRANSCRIPT_LENGTH = 25;    // Minimum transcript characters
const MIN_TRANSCRIPT_WORDS = 5;      // Minimum words in transcript (full sentences)
const MIN_FILE_SIZE = 30000;         // Minimum file size for webm (~2s compressed)

// Patterns that indicate junk audio
const NOISE_PATTERNS = [
  /^[a-z]{1,3}$/i,                    // Very short single "words"
  /^\.+$/,                             // Just periods
  /^\s*$/,                             // Empty/whitespace
  /^(um|uh|hmm|ah|oh|okay|yes|no)\.?$/i,  // Only filler/single words
  /^[^a-z]*$/i,                        // No letters at all
  /\[Mock Transcription\]/i,           // Whisper wasn't running
  /(\b\w+\b)(\s+\1){3,}/i,            // Repeated words 4+ times (echo/feedback)
  /^(say |tell |can you ).{0,15}$/i,  // Very short commands
  /question mark\.?$/i,                // Ends with "question mark" (dictation artifact)
];

// Patterns for cut-off/incomplete sentences
const INCOMPLETE_PATTERNS = [
  /\b(and|but|or|if|when|because|that|which|who|it's|I'm|you're)\s*$/i,  // Ends mid-thought
  /,\s*$/,                             // Ends with comma
  /\.\.\.\s*$/,                        // Ends with ellipsis (intentional truncation is ok)
];

function parseArgs(): { dryRun: boolean; delete: boolean; targetPath?: string } {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run') || (!args.includes('--delete')),
    delete: args.includes('--delete'),
    targetPath: args.find(a => a.startsWith('--path='))?.split('=')[1] ||
                args[args.indexOf('--path') + 1],
  };
}

function getActualDuration(filePath: string): number | null {
  try {
    const result = execSync(
      `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: 'utf-8', timeout: 5000 }
    );
    return parseFloat(result.trim());
  } catch {
    return null;
  }
}

function analyzeAudio(filePath: string): AudioFile {
  const result: AudioFile = {
    path: filePath,
    size: 0,
    issues: [],
  };

  try {
    const stats = fs.statSync(filePath);
    result.size = stats.size;

    // Check for meta file
    const baseName = path.basename(filePath, path.extname(filePath));
    const dir = path.dirname(filePath);
    const metaPath = path.join(dir, `${baseName}.meta.json`);
    const txtPath = path.join(dir, `${baseName}.txt`);

    if (fs.existsSync(metaPath)) {
      result.metaPath = metaPath;
      try {
        result.meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      } catch {}
    }

    // Read transcript
    if (fs.existsSync(txtPath)) {
      result.transcript = fs.readFileSync(txtPath, 'utf-8').trim();
    } else if (result.meta?.transcriptPath && fs.existsSync(result.meta.transcriptPath)) {
      result.transcript = fs.readFileSync(result.meta.transcriptPath, 'utf-8').trim();
    }

    // Get actual duration from file (more accurate than metadata)
    result.actualDuration = getActualDuration(filePath) ?? result.meta?.duration;

    // Check issues
    if (result.size < MIN_FILE_SIZE) {
      result.issues.push(`too_small (${(result.size / 1024).toFixed(1)}KB)`);
    }

    if (result.actualDuration !== undefined && result.actualDuration < MIN_DURATION_SEC) {
      result.issues.push(`too_short (${result.actualDuration.toFixed(2)}s)`);
    }

    if (result.transcript !== undefined) {
      if (result.transcript.length < MIN_TRANSCRIPT_LENGTH) {
        result.issues.push(`transcript_short (${result.transcript.length} chars)`);
      }

      const wordCount = result.transcript.split(/\s+/).filter(w => w.length > 0).length;
      if (wordCount < MIN_TRANSCRIPT_WORDS) {
        result.issues.push(`few_words (${wordCount})`);
      }

      // Check for noise patterns
      for (const pattern of NOISE_PATTERNS) {
        if (pattern.test(result.transcript)) {
          result.issues.push('noise_pattern');
          break;
        }
      }

      // Check for incomplete/cut-off sentences
      for (const pattern of INCOMPLETE_PATTERNS) {
        if (pattern.test(result.transcript)) {
          result.issues.push('incomplete_sentence');
          break;
        }
      }
    } else {
      result.issues.push('no_transcript');
    }

    // Check for size/duration mismatch (indicates silent/corrupt audio)
    if (result.actualDuration && result.size > 0) {
      // Expected ~44100 samples/sec * 2 bytes * 1 channel = ~88KB/sec for wav
      // Or ~6KB/sec for webm/opus
      const ext = path.extname(filePath).toLowerCase();
      const expectedBytesPerSec = ext === '.wav' ? 44100 : 6000;
      const expectedSize = result.actualDuration * expectedBytesPerSec;
      const ratio = result.size / expectedSize;

      if (ratio < 0.3) {
        result.issues.push(`sparse_audio (${(ratio * 100).toFixed(0)}% of expected)`);
      }
    }

  } catch (error) {
    result.issues.push(`error: ${(error as Error).message}`);
  }

  return result;
}

function findAudioFiles(dir: string): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findAudioFiles(fullPath));
    } else if (entry.isFile() && /\.(wav|webm|mp3|ogg)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function deleteFile(filePath: string, dryRun: boolean): boolean {
  if (dryRun) {
    console.log(`  [DRY-RUN] Would delete: ${filePath}`);
    return true;
  }

  try {
    fs.unlinkSync(filePath);

    // Also delete associated files
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));

    for (const ext of ['.txt', '.meta.json']) {
      const assocPath = path.join(dir, baseName + ext);
      if (fs.existsSync(assocPath)) {
        fs.unlinkSync(assocPath);
        console.log(`  Deleted: ${assocPath}`);
      }
    }

    console.log(`  Deleted: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`  Failed to delete ${filePath}: ${(error as Error).message}`);
    return false;
  }
}

async function main() {
  const { dryRun, delete: doDelete, targetPath } = parseArgs();

  // Default paths to check
  const pathsToCheck = targetPath ? [targetPath] : [
    '/media/greggles/STACK/metahuman/out/voice-training/recordings',
    '/media/greggles/STACK/metahuman/profiles/*/out/voice-training/recordings',
    '/home/greggles/metahuman/out/voice-training/recordings',
    '/home/greggles/metahuman/profiles/*/out/voice-training/recordings',
  ];

  console.log('=== Audio Cleanup Script ===');
  console.log(`Mode: ${dryRun ? 'DRY-RUN (preview)' : 'DELETE'}`);
  console.log('');

  let totalFiles = 0;
  let junkFiles = 0;
  let totalJunkSize = 0;

  for (const pathPattern of pathsToCheck) {
    // Handle glob patterns
    const paths = pathPattern.includes('*')
      ? fs.readdirSync(path.dirname(pathPattern.replace('/*/', '/')))
          .map(d => pathPattern.replace('*', d))
          .filter(p => fs.existsSync(p))
      : [pathPattern];

    for (const dir of paths) {
      if (!fs.existsSync(dir)) continue;

      console.log(`\nScanning: ${dir}`);
      const audioFiles = findAudioFiles(dir);
      console.log(`Found ${audioFiles.length} audio files`);

      totalFiles += audioFiles.length;

      for (const filePath of audioFiles) {
        const analysis = analyzeAudio(filePath);

        if (analysis.issues.length > 0) {
          junkFiles++;
          totalJunkSize += analysis.size;

          console.log(`\n  JUNK: ${path.basename(filePath)}`);
          console.log(`    Issues: ${analysis.issues.join(', ')}`);
          if (analysis.transcript) {
            console.log(`    Transcript: "${analysis.transcript.substring(0, 50)}${analysis.transcript.length > 50 ? '...' : ''}"`);
          }
          if (analysis.actualDuration) {
            console.log(`    Duration: ${analysis.actualDuration.toFixed(2)}s`);
          }

          if (doDelete) {
            deleteFile(filePath, dryRun);
          }
        }
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total files scanned: ${totalFiles}`);
  console.log(`Junk files found: ${junkFiles}`);
  console.log(`Total junk size: ${(totalJunkSize / 1024 / 1024).toFixed(2)} MB`);

  if (dryRun && junkFiles > 0) {
    console.log('\nRun with --delete to actually remove these files');
  }
}

main().catch(console.error);
