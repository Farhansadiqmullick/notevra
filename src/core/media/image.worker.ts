/**
 * image.worker — runs the upload pipeline OFF the main thread, so decoding/downscaling/encoding a
 * large photo never janks the editor (SCALE_IMPORT_TESTING.md's "offload heavy work to Workers").
 * The heavy lifting lives in imageProcessing.ts; this file is just the message boundary.
 */
import { processImage, ImageProcessingError } from './imageProcessing';

export interface WorkerRequest {
  id: number;
  file: Blob;
  /** longest-edge cap; omitted means the default 2560px every attached image gets */
  maxEdge?: number;
}
export type WorkerResponse =
  | { id: number; ok: true; blob: Blob; checksum: string; width: number; height: number; originalSize: number }
  | { id: number; ok: false; message: string; code: string };

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, file, maxEdge } = e.data;
  try {
    const r = await processImage(file, file.size, maxEdge);
    const res: WorkerResponse = {
      id, ok: true, blob: r.blob, checksum: r.checksum, width: r.width, height: r.height, originalSize: r.originalSize,
    };
    (self as unknown as Worker).postMessage(res);
  } catch (err) {
    const res: WorkerResponse = {
      id,
      ok: false,
      message: err instanceof ImageProcessingError ? err.message : 'Couldn’t process that image.',
      code: err instanceof ImageProcessingError ? err.code : 'media/unknown',
    };
    (self as unknown as Worker).postMessage(res);
  }
};
