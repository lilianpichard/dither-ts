import RenderWorker from "./render?worker";
import type { RenderRequest, RenderResponse } from "./render";

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: RenderResponse) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new RenderWorker();
    worker.onmessage = (e: MessageEvent<RenderResponse>) => {
      const resolve = pending.get(e.data.id);
      if (resolve) {
        pending.delete(e.data.id);
        resolve(e.data);
      }
    };
  }
  return worker;
}

export function renderImage(
  req: Omit<RenderRequest, "id">,
  transfer: Transferable[],
): Promise<RenderResponse> {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    getWorker().postMessage({ ...req, id }, { transfer });
  });
}
