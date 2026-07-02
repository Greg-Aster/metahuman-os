import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedHandler } from '../types.js';
import { systemPaths } from '../../path-builder.js';
import {
  autoExportBestSamples,
  copyToReference,
  deleteReference,
  getAvailableSamples,
  getTrainingReadiness,
  listReferenceSamples,
  validateReferenceAudio,
  type VoiceProvider,
} from '../../audio-manager.js';
import {
  copyToRVC,
  deleteRVCSample,
  deleteVoiceSample,
  exportTrainingDataset,
  getCurrentSoVITSReference,
  getReferenceSamples,
  getRVCTrainingReadiness,
  getRVCTrainingStatus,
  getTrainingProgress,
  getVoiceTrainingStatus,
  listRVCSamples,
  listVoiceSamples,
  purgeVoiceTrainingData,
  setSoVITSReferenceSample,
  setVoiceTrainingEnabled,
  startRVCTraining,
} from '../../voice-training.js';

function normalizeProvider(provider?: string | null): VoiceProvider {
  if (!provider) return 'gpt-sovits';
  if (provider === 'sovits' || provider === 'kokoro' || provider === 'rvc') return 'gpt-sovits';
  return provider as VoiceProvider;
}

export const handleGetVoiceTraining: UnifiedHandler = async (req) => {
  const action = req.query?.action || 'progress';

  try {
    switch (action) {
      case 'progress':
        return { status: 200, data: getTrainingProgress() };

      case 'samples': {
        const limit = parseInt(req.query?.limit || '20', 10);
        return { status: 200, data: { samples: listVoiceSamples(limit) } };
      }

      case 'status':
        return { status: 200, data: getVoiceTrainingStatus() };

      default:
        return { status: 400, data: { error: 'Invalid action' } };
    }
  } catch (error) {
    console.error('[api/voice-training] get error:', error);
    return { status: 500, data: { error: String(error) } };
  }
};

export const handlePostVoiceTraining: UnifiedHandler = async (req) => {
  try {
    const { action, sampleId, enabled } = req.body ?? {};

    switch (action) {
      case 'delete':
        if (!sampleId) {
          return { status: 400, data: { error: 'Sample ID required' } };
        }
        return { status: 200, data: { success: deleteVoiceSample(sampleId) } };

      case 'export':
        return { status: 200, data: { exportPath: exportTrainingDataset() } };

      case 'toggle': {
        const result = setVoiceTrainingEnabled(enabled || false);
        return { status: 200, data: { success: true, enabled: result.enabled } };
      }

      case 'purge': {
        const result = purgeVoiceTrainingData();
        return { status: 200, data: { success: true, deletedCount: result.deletedCount } };
      }

      default:
        return { status: 400, data: { error: 'Invalid action' } };
    }
  } catch (error) {
    console.error('[api/voice-training] post error:', error);
    return { status: 500, data: { error: String(error) } };
  }
};

export const handleGetRvcTraining: UnifiedHandler = async (req) => {
  const action = req.query?.action;
  const speakerId = req.query?.speakerId || 'default';

  try {
    switch (action) {
      case 'training-readiness': {
        const readiness = getRVCTrainingReadiness(speakerId);
        const copiedSamples = listRVCSamples(speakerId);
        return {
          status: 200,
          data: {
            ...readiness,
            copied: {
              count: copiedSamples.length,
              duration: copiedSamples.reduce((sum, sample) => sum + sample.duration, 0),
            },
          },
        };
      }

      case 'list-samples':
        return { status: 200, data: { samples: listRVCSamples(speakerId) } };

      case 'training-status':
        return { status: 200, data: getRVCTrainingStatus(speakerId) };

      case 'training-logs': {
        const logPath = path.join(systemPaths.logs, 'run', `rvc-training-${speakerId}.log`);
        if (!fs.existsSync(logPath)) {
          return { status: 200, data: { logs: [] } };
        }

        try {
          const content = fs.readFileSync(logPath, 'utf-8');
          const lines = content.split('\n').filter((line) => line.trim());
          return { status: 200, data: { logs: lines.slice(-100) } };
        } catch (error) {
          console.error('[api/rvc-training] Error reading training logs:', error);
          return { status: 200, data: { logs: [] } };
        }
      }

      default:
        return { status: 400, data: { error: 'Invalid action' } };
    }
  } catch (error) {
    console.error('[api/rvc-training] get error:', error);
    return { status: 500, data: { error: String(error) } };
  }
};

export const handlePostRvcTraining: UnifiedHandler = async (req) => {
  try {
    const {
      action,
      speakerId = 'default',
      sampleIds,
      minQuality = 0.7,
      sampleId,
    } = req.body ?? {};

    console.log('[api/rvc-training] Action:', action, 'Body:', req.body);

    switch (action) {
      case 'copy-samples': {
        if (!Array.isArray(sampleIds)) {
          return { status: 400, data: { error: 'Sample IDs required' } };
        }
        const copiedCount = copyToRVC(sampleIds, speakerId);
        return {
          status: 200,
          data: {
            success: true,
            message: `Copied ${copiedCount} samples to RVC training directory`,
            copiedCount,
          },
        };
      }

      case 'auto-export': {
        const selectionMethod = req.body?.selectionMethod || 'quality';
        const targetDuration = req.body?.targetDuration;
        const maxSamples = req.body?.maxSamples || 200;
        const samples = getReferenceSamples(minQuality, selectionMethod);

        if (samples.length === 0) {
          return {
            status: 400,
            data: { error: 'No suitable samples found. Need high-quality recordings (quality ≥ 70%)' },
          };
        }

        let selectedSamples = samples;
        if (targetDuration || maxSamples) {
          let totalDuration = 0;
          selectedSamples = [];
          for (const sample of samples) {
            if (maxSamples && selectedSamples.length >= maxSamples) break;
            if (targetDuration && totalDuration >= targetDuration) break;
            selectedSamples.push(sample);
            totalDuration += sample.duration;
          }
        }

        const selectedIds = selectedSamples.map((sample) => sample.id);
        const copiedCount = copyToRVC(selectedIds, speakerId);

        return {
          status: 200,
          data: {
            success: true,
            message: `Auto-exported ${copiedCount} samples to RVC training directory (${selectionMethod} selection)`,
            copiedCount,
            selectionMethod,
            targetDuration,
            maxSamples,
          },
        };
      }

      case 'delete-sample':
        if (!sampleId) {
          return { status: 400, data: { error: 'Sample ID required' } };
        }
        deleteRVCSample(speakerId, sampleId);
        return { status: 200, data: { success: true } };

      case 'start-training': {
        const { totalEpochs, saveEveryEpoch, batchSize, device } = req.body ?? {};
        const result = startRVCTraining(speakerId, {
          totalEpochs,
          saveEveryEpoch,
          batchSize,
          device,
        });

        if (!result.success) {
          return { status: 400, data: { error: result.error } };
        }

        return {
          status: 200,
          data: {
            success: true,
            message: 'RVC training started. This will take 30-60 minutes depending on your hardware.',
          },
        };
      }

      default:
        return { status: 400, data: { error: 'Invalid action' } };
    }
  } catch (error) {
    console.error('[api/rvc-training] post error:', error);
    return { status: 500, data: { error: String(error) } };
  }
};

export const handleGetSovitsTraining: UnifiedHandler = async (req) => {
  try {
    const action = req.query?.action;
    const provider = normalizeProvider(req.query?.provider);
    const speakerId = req.query?.speakerId || 'default';
    const minQuality = parseFloat(req.query?.minQuality || '0.7');
    const limit = parseInt(req.query?.limit || '100', 10);

    if (action === 'available-samples') {
      return { status: 200, data: { samples: getAvailableSamples(provider, minQuality, limit) } };
    }

    if (action === 'current-reference') {
      if (provider !== 'gpt-sovits') {
        return { status: 400, data: { error: 'Current reference is only available for GPT-SoVITS' } };
      }
      return { status: 200, data: getCurrentSoVITSReference(speakerId) };
    }

    if (action === 'reference-samples') {
      return { status: 200, data: { samples: listReferenceSamples(provider, speakerId) } };
    }

    if (action === 'training-readiness') {
      return { status: 200, data: getTrainingReadiness(provider, speakerId) };
    }

    if (action === 'validate-audio') {
      const filePath = req.query?.filePath;
      if (!filePath) {
        return { status: 400, data: { error: 'filePath parameter required' } };
      }
      return { status: 200, data: validateReferenceAudio(filePath, provider) };
    }

    return {
      status: 400,
      data: { error: 'Invalid action. Use: available-samples, reference-samples, training-readiness, validate-audio' },
    };
  } catch (error) {
    console.error('[api/sovits-training] get error:', error);
    return { status: 500, data: { error: String(error) } };
  }
};

export const handlePostSovitsTraining: UnifiedHandler = async (req) => {
  try {
    const {
      action,
      provider: providerRaw = 'gpt-sovits',
      speakerId = 'default',
      sampleIds,
      sampleId,
      minQuality = 0.8,
    } = req.body ?? {};
    const provider = normalizeProvider(providerRaw);

    if (action === 'copy-samples') {
      if (!Array.isArray(sampleIds)) {
        return { status: 400, data: { error: 'sampleIds array required' } };
      }

      const copiedCount = copyToReference(sampleIds, provider, speakerId);
      if (provider === 'gpt-sovits' && copiedCount > 0) {
        try {
          setSoVITSReferenceSample(speakerId, sampleIds[sampleIds.length - 1]);
        } catch (error) {
          console.error('[api/sovits-training] Failed to update reference sample:', error);
        }
      }

      return {
        status: 200,
        data: {
          success: true,
          message: `Copied ${copiedCount} samples to ${provider} reference directory`,
          copiedCount,
        },
      };
    }

    if (action === 'auto-export') {
      const selectionMethod = req.body?.selectionMethod || 'quality';
      const targetDuration = req.body?.targetDuration;
      const maxSamples = req.body?.maxSamples;

      const outputDir = autoExportBestSamples(provider, speakerId, minQuality, {
        selectionMethod,
        targetDuration,
        maxSamples,
        minQuality,
      });

      if (provider === 'gpt-sovits') {
        try {
          setSoVITSReferenceSample(speakerId);
        } catch (error) {
          console.error('[api/sovits-training] Failed to update reference sample after auto-export:', error);
        }
      }

      return {
        status: 200,
        data: {
          success: true,
          message: `Exported best samples to ${provider} directory (${selectionMethod} selection)`,
          outputDir,
          selectionMethod,
          targetDuration,
          maxSamples,
        },
      };
    }

    if (action === 'delete-reference') {
      if (!sampleId) {
        return { status: 400, data: { error: 'sampleId required' } };
      }
      deleteReference(provider, speakerId, sampleId);
      return {
        status: 200,
        data: {
          success: true,
          message: `Deleted reference audio: ${sampleId}`,
        },
      };
    }

    if (action === 'set-reference') {
      if (provider !== 'gpt-sovits') {
        return { status: 400, data: { error: 'Reference management is only supported for GPT-SoVITS' } };
      }
      if (!sampleId) {
        return { status: 400, data: { error: 'sampleId required' } };
      }

      const result = setSoVITSReferenceSample(speakerId, sampleId);
      return {
        status: 200,
        data: {
          success: true,
          message: `Reference audio set to ${sampleId}`,
          referencePath: result.referencePath,
        },
      };
    }

    if (action === 'set-reference-latest') {
      if (provider !== 'gpt-sovits') {
        return { status: 400, data: { error: 'Reference management is only supported for GPT-SoVITS' } };
      }

      const result = setSoVITSReferenceSample(speakerId);
      return {
        status: 200,
        data: {
          success: true,
          message: 'Reference audio updated to latest sample',
          referencePath: result.referencePath,
        },
      };
    }

    return {
      status: 400,
      data: { error: 'Invalid action. Use: copy-samples, auto-export, delete-reference' },
    };
  } catch (error) {
    console.error('[api/sovits-training] post error:', error);
    return { status: 500, data: { error: String(error), success: false } };
  }
};
