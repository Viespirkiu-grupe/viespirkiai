import config from '../../utils/config.js';

type OcrLiveUpdateMode = 'poll' | 'notify';

const raw = (config as any)?.ocrLatestResultsLiveUpdates ?? {};
const mode = raw.mode === 'notify' ? 'notify' : 'poll';
const intervalMsNumber = Number(raw.intervalMs);

export const ocrLiveUpdates: {
  mode: OcrLiveUpdateMode;
  intervalMs: number;
} = {
  mode,
  intervalMs: Number.isFinite(intervalMsNumber) && intervalMsNumber >= 50 ? Math.round(intervalMsNumber) : 250,
};
