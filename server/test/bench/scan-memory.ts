/**
 * Memory benchmark for the session-listing scan (the startup warm-up path).
 *
 * Usage:
 *   node --expose-gc --import tsx server/test/bench/scan-memory.ts [sessionsDir]
 *
 * Prints peak RSS / heapUsed sampled during the scan, plus the settled numbers
 * after a forced GC. Run it against a REAL (large) sessions directory: the whole
 * point is what the scan does to memory when the corpus is gigabytes.
 */
import os from 'node:os';
import path from 'node:path';
import { scanDiskSessions } from '../../src/session-pool.js';

const sessionsRoot =
  process.argv[2] || path.join(os.homedir(), '.pi', 'agent', 'sessions');

let peakRss = 0;
let peakHeap = 0;
const sampler = setInterval(() => {
  const m = process.memoryUsage();
  if (m.rss > peakRss) peakRss = m.rss;
  if (m.heapUsed > peakHeap) peakHeap = m.heapUsed;
}, 20);
sampler.unref();

const mb = (n: number) => (n / 1024 / 1024).toFixed(1) + ' MB';

const baseline = process.memoryUsage();
const started = Date.now();
const infos = await scanDiskSessions(sessionsRoot, () => true, 'bench');
const elapsed = Date.now() - started;
clearInterval(sampler);

const during = process.memoryUsage();
if (typeof global.gc === 'function') {
  global.gc();
  global.gc();
}
const after = process.memoryUsage();

console.log(
  JSON.stringify(
    {
      sessionsRoot,
      baselineRss: mb(baseline.rss),
      baselineHeapUsed: mb(baseline.heapUsed),
      sessions: infos.length,
      elapsedMs: elapsed,
      peakRss: mb(peakRss),
      peakHeapUsed: mb(peakHeap),
      endRss: mb(during.rss),
      endHeapUsed: mb(during.heapUsed),
      afterGcRss: mb(after.rss),
      afterGcHeapUsed: mb(after.heapUsed),
      afterGcExternal: mb(after.external),
      afterGcHeapTotal: mb(after.heapTotal),
      afterGcArrayBuffers: mb(after.arrayBuffers),
    },
    null,
    2,
  ),
);
