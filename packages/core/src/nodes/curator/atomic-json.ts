import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function writeJsonAtomically(filePath: string, value: unknown): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);

  try {
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    fs.writeFileSync(temporary, serialized, 'utf-8');
    JSON.parse(fs.readFileSync(temporary, 'utf-8'));
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }
}
