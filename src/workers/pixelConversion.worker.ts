import { runBatchPixelConversion, type PixelEngineConfig, type PixelEngineResult } from '../lib/pixelEngine';

interface ConversionRequest {
  config: PixelEngineConfig;
  images: ImageBitmap[];
}

type ConversionReply =
  | { type: 'success'; results: PixelEngineResult[] }
  | { type: 'error'; message: string };

// The worker owns transferred ImageBitmaps. All resampling, color quantization,
// and per-frame palette work run here rather than blocking the UI thread.
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<ConversionRequest>) => void) | null;
  postMessage: (reply: ConversionReply, transfer?: Transferable[]) => void;
};

workerScope.onmessage = ({ data: { config, images } }) => {
  try {
    const results = runBatchPixelConversion(images, config);
    const transfers = results.map((result) => result.imageData.data.buffer as ArrayBuffer);
    workerScope.postMessage({ type: 'success', results }, transfers);
  } catch (err) {
    workerScope.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : '背景批次轉換發生錯誤',
    });
  } finally {
    for (const image of images) image.close();
  }
};
