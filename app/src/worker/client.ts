import RenderWorker from "./render?worker";
import type { RenderMessage, RenderRequest, RenderResponse } from "./render";

let worker: Worker | null = null;
let seq = 0;

interface PendingJob {
  resolve: (r: RenderResponse) => void;
  reject: (e: Error) => void;
  onProgress?: (u: ProgressUpdate) => void;
}

const pending = new Map<number, PendingJob>();

export interface ProgressUpdate {
  rowsDone: number;
  totalRows: number;
  width: number;
  height: number;
  pixels: ArrayBuffer;
}

/** Reject everything in flight and drop the worker; next job rebuilds it. */
function failAll(reason: Error): void {
  for (const [, job] of pending) job.reject(reason);
  pending.clear();
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

function getWorker(): Worker {
  if (!worker) {
    worker = new RenderWorker();
    worker.onmessage = (e: MessageEvent<RenderMessage>) => {
      const msg = e.data;
      const job = pending.get(msg.id);
      if (!job) return;
      if (msg.kind === "progress") {
        job.onProgress?.({
          rowsDone: msg.rowsDone,
          totalRows: msg.totalRows,
          width: msg.width,
          height: msg.height,
          pixels: msg.pixels,
        });
        return;
      }
      pending.delete(msg.id);
      job.resolve(msg);
    };
    worker.onerror = (e) => {
      failAll(new Error(`render worker failed: ${e.message}`));
    };
    worker.onmessageerror = () => {
      failAll(new Error("render worker message failed to deserialize"));
    };
  }
  return worker;
}

export function renderImage(
  req: Omit<RenderRequest, "id">,
  transfer: Transferable[],
  onProgress?: (u: ProgressUpdate) => void,
): Promise<RenderResponse> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    try {
      getWorker().postMessage({ ...req, id }, { transfer });
    } catch (err) {
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
