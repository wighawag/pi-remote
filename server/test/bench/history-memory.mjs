/**
 * Memory + time cost of OPENING a session for viewing (`readSessionMeta`), the
 * path behind every `session_load`. Runs against the built server, so it can be
 * run on either side of a change for a like-for-like comparison.
 *
 * Usage (after `pnpm build`):
 *   node --expose-gc server/test/bench/history-memory.mjs [sessionFile] [repeats]
 *
 * With no argument it picks the LARGEST transcript under the sessions dir, which
 * is the case that matters: the old path loaded and parsed the whole file (twice
 * inside SessionManager.open) and mapped every entry into history objects just to
 * return the last 60 messages.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionPool } from '../../dist/session-pool.js';

const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

function largestTranscript(root) {
  let best = null;
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(root, dir.name);
    let files;
    try {
      files = fs.readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const p = path.join(dirPath, f);
      const size = fs.statSync(p).size;
      if (!best || size > best.size) best = { path: p, size };
    }
  }
  return best;
}

const sessionsRoot = path.join(os.homedir(), '.pi', 'agent', 'sessions');
const target = process.argv[2]
  ? { path: process.argv[2], size: fs.statSync(process.argv[2]).size }
  : largestTranscript(sessionsRoot);
const repeats = Number(process.argv[3] || 3);

const pool = new SessionPool(1000);

let peakRss = 0;
const sampler = setInterval(() => {
  const r = process.memoryUsage().rss;
  if (r > peakRss) peakRss = r;
}, 20);
sampler.unref();

global.gc();
global.gc();
const before = process.memoryUsage();
peakRss = before.rss;

let messages = 0;
let totalCount = 0;
const started = Date.now();
for (let i = 0; i < repeats; i++) {
  const meta = await pool.readSessionMeta(target.path, 60);
  if (meta.error) throw new Error(meta.error);
  messages = meta.history.messages.length;
  totalCount = meta.history.totalCount;
}
const elapsed = Date.now() - started;
clearInterval(sampler);

const during = process.memoryUsage();
global.gc();
global.gc();
const after = process.memoryUsage();

console.log(
  JSON.stringify(
    {
      sessionFile: target.path,
      fileSize: mb(target.size),
      repeats,
      msPerOpen: Math.round(elapsed / repeats),
      messagesReturned: messages,
      totalCount,
      baselineRss: mb(before.rss),
      peakRss: mb(peakRss),
      peakGrowth: mb(peakRss - before.rss),
      endRss: mb(during.rss),
      afterGcRss: mb(after.rss),
      afterGcHeapUsed: mb(after.heapUsed),
    },
    null,
    2,
  ),
);
