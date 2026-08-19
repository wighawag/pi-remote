/**
 * How much heap the session-listing CACHE actually RETAINS after a full scan.
 *
 * Usage (needs `pnpm build` first, so it measures the built code without the
 * ~200 MB tsx loader overhead):
 *   node --expose-gc server/test/bench/retained-cache.mjs [sessionsDir]
 */
import os from 'node:os';
import path from 'node:path';
import { scanDiskSessions } from '../../dist/session-pool.js';

const root = process.argv[2] || path.join(os.homedir(), '.pi', 'agent', 'sessions');
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

global.gc();
global.gc();
const before = process.memoryUsage();

let infos = await scanDiskSessions(root, () => true, 'retained-bench');
const count = infos.length;
// Drop the returned array: only the module-level cache should survive.
infos = null;

global.gc();
global.gc();
const after = process.memoryUsage();

console.log(
  JSON.stringify(
    {
      sessions: count,
      heapBefore: mb(before.heapUsed),
      heapAfter: mb(after.heapUsed),
      retained: mb(after.heapUsed - before.heapUsed),
      retainedPerSessionBytes: Math.round((after.heapUsed - before.heapUsed) / count),
      rss: mb(after.rss),
    },
    null,
    2,
  ),
);
