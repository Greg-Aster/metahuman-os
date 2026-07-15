import fs from 'node:fs';
import path from 'node:path';

const AUDIO_FILE_PATTERN = /\.(mp3|wav|m4a|ogg|webm|flac)$/i;

export function findAudioFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...findAudioFiles(entryPath));
    } else if (entry.isFile() && AUDIO_FILE_PATTERN.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

export function audioIdForPath(inboxDir: string, audioPath: string): string {
  const relativePath = path.relative(inboxDir, audioPath);
  const extension = path.extname(relativePath);
  const withoutExtension = extension ? relativePath.slice(0, -extension.length) : relativePath;
  return withoutExtension
    .split(path.sep)
    .join('__')
    .replace(/[^a-zA-Z0-9_-]+/g, '-');
}
