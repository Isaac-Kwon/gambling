// Simulation worker entry. Loaded by client.ts as
//   new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
// Imports shared/rules and shared/rng only through jobs.ts.

import { createHost } from "./jobs";
import { scaleFor, type FromWorker, type ToWorker } from "./protocol";
import { realScheduler } from "./scheduler";

interface WorkerScope {
  navigator?: { hardwareConcurrency?: number };
  postMessage(msg: FromWorker, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
}

const scope = self as unknown as WorkerScope;
const host = createHost((msg, transfer) => scope.postMessage(msg, transfer), {
  scale: scaleFor(scope.navigator?.hardwareConcurrency),
  scheduler: realScheduler(),
});
scope.onmessage = (e) => { void host.onMessage(e.data); };
