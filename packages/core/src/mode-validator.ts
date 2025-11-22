/**
 * Mode Validator - Ensure no mode contamination in training data
 *
 * Validates that dual/emulation/agent modes maintain proper separation
 * and that formatting rules are correctly applied.
 */

export type CognitiveMode = 'dual' | 'emulation' | 'agent';

export interface ValidationError {
  sampleId: string;
  mode: CognitiveMode;
  errorType: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface QualityMetrics {
  totalSamples: number;
  byMode: Record<CognitiveMode, number>;
  avgAssistantLength: number;
  shortSamplesPercent: number; // <= 40 words
  longSamplesPercent: number; // > 100 words
  fillerDetectedPercent: number;
  modeDistribution: {
    dual: number;
    emulation: number;
    agent: number;
  };
}

export interface FormattedSample {
  mode: CognitiveMode;
  input: string;
  output: string;
  metadata: {
    original_id: string;
    [key: string]: any;
  };
}

export interface CuratedSample {
  mode: CognitiveMode;
  user_text: string;
  assistant_text: string;
  metadata: {
    original_id: string;
    [key: string]: any;
  };
}

const FILLER_PHRASES = [
  'as an ai',
  'as a language model',
  'certainly',
  'let me think',
  'let me start',
  'i\'m just',
  'i\'m here to',
  'here\'s what',
  'okay, so',
  'alright, so',
];

/**
 * Validate that dual mode samples have correct formatting
 */
function validateDualMode(sample: FormattedSample): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!sample.input.includes('<thought>')) {
    errors.push({
      sampleId: sample.metadata.original_id,
      mode: 'dual',
      errorType: 'missing_tag',
      message: 'Dual mode input missing <thought> tag',
    });
  }

  if (!sample.output.includes('<world>')) {
    errors.push({
      sampleId: sample.metadata.original_id,
      mode: 'dual',
      errorType: 'missing_tag',
      message: 'Dual mode output missing <world> tag',
    });
  }

  // Check for contamination from other modes
  if (sample.input.includes('<user>') || sample.input.includes('<instruction>')) {
    errors.push({
      sampleId: sample.metadata.original_id,
      mode: 'dual',
      errorType: 'mode_contamination',
      message: 'Dual mode contaminated with <user> or <instruction> tags',
    });
  }

  if (sample.output.includes('<assistant>') || sample.output.includes('<action>')) {
    errors.push({
      sampleId: sample.metadata.original_id,
      mode: 'dual',
      errorType: 'mode_contamination',
      message: 'Dual mode contaminated with <assistant> or <action> tags',
    });
  }

  return errors;
}

/**
 * Validate that emulation mode samples have correct formatting
 */
function validateEmulationMode(sample: FormattedSample): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!sample.input.includes('<user>')) {
    errors.push({
      sampleId: sample.metadata.original_id,
      mode: 'emulation',
      errorType: 'missing_tag',
      message: 'Emulation mode input missing <user> tag',
    });
  }

  if (!sample.output.includes('<assistant>')) {
    errors.push({
      sampleId: sample.metadata.original_id,
      mode: 'emulation',
      errorType: 'missing_tag',
      message: 'Emulation mode output missing <assistant> tag',
    });
  }

  // Check for contamination from other modes
  if (sample.input.includes('<thought>') || sample.input.includes('<instruction>')) {
    errors.push({
      sampleId: sample.metadata.original_id,
      mode: 'emulation',
      errorType: 'mode_contamination',
      message: 'Emulation mode contaminated with <thought> or <instruction> tags',
    });
  }

  if (sample.output.includes('<world>') || sample.output.includes('<action>')) {
    errors.push({
      sampleId: sample.metadata.original_id,
      mode: 'emulation',
      errorType: 'mode_contamination',
      message: 'Emulation mode contaminated with <world> or <action> tags',
    });
  }

  return errors;
}

/**
 * Validate that agent mode samples have correct formatting
 */
function validateAgentMode(sample: FormattedSample): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!sample.input.includes('<instruction>')) {
    errors.push({
      sampleId: sample.metadata.original_id,
      mode: 'agent',
      errorType: 'missing_tag',
      message: 'Agent mode input missing <instruction> tag',
    });
  }

  if (!sample.output.includes('<action>')) {
    errors.push({
      sampleId: sample.metadata.original_id,
      mode: 'agent',
      errorType: 'missing_tag',
      message: 'Agent mode output missing <action> tag',
    });
  }

  // Check for contamination from other modes
  if (sample.input.includes('<user>') || sample.input.includes('<thought>')) {
    errors.push({
      sampleId: sample.metadata.original_id,
      mode: 'agent',
      errorType: 'mode_contamination',
      message: 'Agent mode contaminated with <user> or <thought> tags',
    });
  }

  if (sample.output.includes('<assistant>') || sample.output.includes('<world>')) {
    errors.push({
      sampleId: sample.metadata.original_id,
      mode: 'agent',
      errorType: 'mode_contamination',
      message: 'Agent mode contaminated with <assistant> or <world> tags',
    });
  }

  return errors;
}

/**
 * Validate formatted samples for mode contamination
 */
export function validateModeContamination(samples: FormattedSample[]): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  for (const sample of samples) {
    let sampleErrors: ValidationError[] = [];

    switch (sample.mode) {
      case 'dual':
        sampleErrors = validateDualMode(sample);
        break;
      case 'emulation':
        sampleErrors = validateEmulationMode(sample);
        break;
      case 'agent':
        sampleErrors = validateAgentMode(sample);
        break;
      default:
        errors.push({
          sampleId: sample.metadata.original_id,
          mode: sample.mode,
          errorType: 'invalid_mode',
          message: `Invalid mode: ${sample.mode}`,
        });
    }

    errors.push(...sampleErrors);
  }

  // Check mode distribution
  const modeCount: Record<CognitiveMode, number> = { dual: 0, emulation: 0, agent: 0 };
  for (const sample of samples) {
    if (sample.mode in modeCount) {
      modeCount[sample.mode]++;
    }
  }

  const total = samples.length;
  for (const [mode, count] of Object.entries(modeCount)) {
    const percent = (count / total) * 100;
    if (percent < 10 && count > 0) {
      warnings.push(`Mode ${mode} has only ${percent.toFixed(1)}% of samples (${count}/${total}). Consider balancing.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Calculate quality metrics for curated samples
 */
export function calculateQualityMetrics(samples: CuratedSample[]): QualityMetrics {
  const lengths: number[] = [];
  let fillerCount = 0;
  const modeCount: Record<CognitiveMode, number> = { dual: 0, emulation: 0, agent: 0 };

  for (const sample of samples) {
    // Count words in assistant text
    const wordCount = sample.assistant_text.split(/\s+/).length;
    lengths.push(wordCount);

    // Check for filler phrases
    const lowerText = sample.assistant_text.toLowerCase();
    if (FILLER_PHRASES.some(phrase => lowerText.includes(phrase))) {
      fillerCount++;
    }

    // Count mode distribution
    if (sample.mode in modeCount) {
      modeCount[sample.mode]++;
    }
  }

  const avgLength = lengths.length > 0
    ? lengths.reduce((a, b) => a + b, 0) / lengths.length
    : 0;

  const shortSamples = lengths.filter(l => l <= 40).length;
  const longSamples = lengths.filter(l => l > 100).length;

  const total = samples.length || 1; // Avoid division by zero

  return {
    totalSamples: samples.length,
    byMode: modeCount,
    avgAssistantLength: Math.round(avgLength * 10) / 10,
    shortSamplesPercent: Math.round((shortSamples / total) * 1000) / 10,
    longSamplesPercent: Math.round((longSamples / total) * 1000) / 10,
    fillerDetectedPercent: Math.round((fillerCount / total) * 1000) / 10,
    modeDistribution: {
      dual: Math.round((modeCount.dual / total) * 1000) / 10,
      emulation: Math.round((modeCount.emulation / total) * 1000) / 10,
      agent: Math.round((modeCount.agent / total) * 1000) / 10,
    },
  };
}

/**
 * Validate JSON line format
 */
export function validateJSONLine(line: string, lineNumber: number): ValidationError | null {
  try {
    const obj = JSON.parse(line);

    if (!obj.input || !obj.output) {
      return {
        sampleId: `line_${lineNumber}`,
        mode: 'emulation', // Default, actual mode unknown
        errorType: 'invalid_format',
        message: `Line ${lineNumber}: Missing input or output field`,
      };
    }

    return null;
  } catch (error) {
    return {
      sampleId: `line_${lineNumber}`,
      mode: 'emulation',
      errorType: 'invalid_json',
      message: `Line ${lineNumber}: Invalid JSON - ${(error as Error).message}`,
    };
  }
}

/**
 * Validate entire JSONL dataset
 */
export function validateJSONLDataset(content: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];
  const lines = content.split('\n').filter(line => line.trim());

  for (let i = 0; i < lines.length; i++) {
    const error = validateJSONLine(lines[i], i + 1);
    if (error) {
      errors.push(error);
    }
  }

  if (lines.length === 0) {
    errors.push({
      sampleId: 'dataset',
      mode: 'emulation',
      errorType: 'empty_dataset',
      message: 'Dataset is empty',
    });
  }

  if (lines.length < 1000) {
    warnings.push(`Dataset has only ${lines.length} samples. Recommended: 5000+ for full fine-tuning.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
