/**
 * imageClient — the main-thread door to the image pipeline. Sends the file to the Worker and
 * resolves with the processed result; if Workers or OffscreenCanvas aren't available, it degrades
 * gracefully to running the SAME pipeline inline (correctness over smoothness — the gates are
 * identical either way, because both paths call processImage).
 */
import { ImageProcessingError, processImage, type ProcessedImage } from './imageProcessing';
import type { WorkerRequest, WorkerResponse } from './image.worker';
import { logger } from '@/core/logging/logger';

const log = logger.scoped('imageClient');

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: ProcessedImage) => void; reject: (e: unknown) => void }>();

function supportsWorkerPipeline(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

function getWorker(): Worker | null {
  if (!supportsWorkerPipeline()) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.ok) {
        entry.resolve({ blob: msg.blob, checksum: msg.checksum, width: msg.width, height: msg.height, originalSize: msg.originalSize });
      } else {
        entry.reject(new ImageProcessingError(msg.message, msg.code));
      }
    };
    worker.onerror = (e) => {
      log.error('worker crashed', e);
      for (const [, entry] of pending) entry.reject(new ImageProcessingError('Couldn’t process that image.', 'media/worker-failed'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch (e) {
    log.warn('worker unavailable, falling back to main thread', { e });
    return null;
  }
}

/**
 * Validate + compress an image to WebP. Runs in a Worker when possible.
 *
 * `maxEdge` rides through to the same gate in both paths — the avatar asks for a smaller cap than
 * an attached image, and it must not matter whether the Worker was available.
 */
export function processImageFile(file: File, maxEdge?: number): Promise<ProcessedImage> {
  const w = getWorker();
  if (!w) return processImage(file, file.size, maxEdge); // inline fallback — same gates

  return new Promise<ProcessedImage>((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    const req: WorkerRequest = { id, file, maxEdge };
    w.postMessage(req);
  });
}
