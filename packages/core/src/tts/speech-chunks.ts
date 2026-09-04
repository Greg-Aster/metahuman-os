export interface SpeechChunkPolicy {
  preferredChars: number;
  maxChars: number;
  minTailChars: number;
}

export const DEFAULT_SPEECH_CHUNK_POLICY: SpeechChunkPolicy = {
  preferredChars: 140,
  maxChars: 220,
  minTailChars: 48,
};

function splitLongUnit(unit: string, preferredChars: number): string[] {
  const words = unit.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    if (word.length > preferredChars) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let offset = 0; offset < word.length; offset += preferredChars) {
        chunks.push(word.slice(offset, offset + preferredChars));
      }
      continue;
    }

    const combined = current ? `${current} ${word}` : word;
    if (current && combined.length > preferredChars) {
      chunks.push(current);
      current = word;
    } else {
      current = combined;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function sentenceUnits(paragraph: string, policy: SpeechChunkPolicy): string[] {
  const sentences = paragraph
    .match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g)
    ?.map(sentence => sentence.trim())
    .filter(Boolean) ?? [paragraph];
  const units: string[] = [];

  for (const sentence of sentences) {
    if (sentence.length <= policy.maxChars) {
      units.push(sentence);
      continue;
    }

    const clauses = sentence
      .split(/(?<=[,;:])\s+/)
      .map(clause => clause.trim())
      .filter(Boolean);
    for (const clause of clauses) {
      if (clause.length <= policy.maxChars) units.push(clause);
      else units.push(...splitLongUnit(clause, policy.preferredChars));
    }
  }

  return units;
}

function chunkParagraph(paragraph: string, policy: SpeechChunkPolicy): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const unit of sentenceUnits(paragraph, policy)) {
    const combined = current ? `${current} ${unit}` : unit;
    if (
      current
      && (
        combined.length > policy.maxChars
        || (current.length >= policy.minTailChars && combined.length > policy.preferredChars)
      )
    ) {
      chunks.push(current);
      current = unit;
    } else {
      current = combined;
    }

    if (current.length >= policy.preferredChars) {
      chunks.push(current);
      current = '';
    }
  }

  if (current) chunks.push(current);
  if (
    chunks.length > 1
    && chunks.at(-1)!.length < policy.minTailChars
    && chunks.at(-2)!.length + 1 + chunks.at(-1)!.length <= policy.maxChars
  ) {
    const tail = chunks.pop()!;
    chunks[chunks.length - 1] = `${chunks.at(-1)} ${tail}`;
  }
  return chunks;
}

/**
 * Split speakable text into ordered, low-latency phrases. Paragraph boundaries
 * are always respected and long unpunctuated text is bounded by word length.
 */
export function splitSpeechText(
  text: string,
  policy: SpeechChunkPolicy = DEFAULT_SPEECH_CHUNK_POLICY,
): string[] {
  if (
    policy.preferredChars < 1
    || policy.maxChars < policy.preferredChars
    || policy.minTailChars < 1
  ) {
    throw new Error('Invalid speech chunk policy');
  }

  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map(paragraph => paragraph.replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);

  return paragraphs.flatMap(paragraph => chunkParagraph(paragraph, policy));
}
