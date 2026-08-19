/**
 * Dump what the server DERIVES from real session files, so two builds can be
 * diffed against each other. This is the equivalence check for any change to
 * how transcripts are read: run it on the old build, run it on the new one,
 * `diff` the two outputs.
 *
 * Usage (after `pnpm build`):
 *   node server/test/bench/dump-sessions.mjs > /tmp/before.json
 *
 * Covers both read paths: the /sessions listing record for EVERY session, and
 * the opened-session view (`readSessionMeta`: id, cwd, model, history window)
 * for a sample -- the biggest transcripts plus an evenly spread selection, so
 * both the pathological and the ordinary cases are compared.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanDiskSessions, SessionPool } from '../../dist/session-pool.js';

const root = process.argv[2] || path.join(os.homedir(), '.pi', 'agent', 'sessions');
const SAMPLE_BIGGEST = 25;
const SAMPLE_SPREAD = 75;

const infos = await scanDiskSessions(root, () => true, 'dump');
infos.sort((a, b) => a.path.localeCompare(b.path));

const listing = infos.map((s) => ({
  path: s.path,
  id: s.id,
  cwd: s.cwd,
  name: s.name ?? null,
  created: isNaN(s.created.getTime()) ? 'invalid' : s.created.toISOString(),
  modified: isNaN(s.modified.getTime()) ? 'invalid' : s.modified.toISOString(),
  messageCount: s.messageCount,
  firstMessage: s.firstMessage,
  parentSessionPath: s.parentSessionPath ?? null,
}));

const withSize = infos.map((s) => ({ path: s.path, size: fs.statSync(s.path).size }));
const biggest = [...withSize].sort((a, b) => b.size - a.size).slice(0, SAMPLE_BIGGEST);
const step = Math.max(1, Math.floor(withSize.length / SAMPLE_SPREAD));
const spread = withSize.filter((_, i) => i % step === 0).slice(0, SAMPLE_SPREAD);
const sample = [...new Set([...biggest, ...spread].map((s) => s.path))].sort();

const pool = new SessionPool(1000);
const opened = [];
for (const file of sample) {
  const meta = await pool.readSessionMeta(file, 60);
  if (meta.error) {
    opened.push({ path: file, error: meta.error });
    continue;
  }
  opened.push({
    path: file,
    sessionId: meta.sessionId,
    cwd: meta.cwd,
    model: meta.model,
    readOnly: meta.readOnly,
    totalCount: meta.history.totalCount,
    offset: meta.history.offset,
    messageCount: meta.history.messages.length,
    // Hash rather than dump: these windows contain whole tool results.
    messagesSha256: crypto
      .createHash('sha256')
      .update(JSON.stringify(meta.history.messages))
      .digest('hex'),
    roles: meta.history.messages.map((m) => m.role).join(','),
  });
}

console.log(JSON.stringify({ listing, opened }, null, 1));
