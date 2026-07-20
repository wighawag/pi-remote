import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startHarness, type Harness } from './harness.js';

// GET /session/download: HTTP Range support (so <video>/<audio> can seek) +
// correct media Content-Type + inline disposition for media, all WITHOUT
// weakening the existing security posture (deny-by-default path resolution ->
// 404, size cap -> 413, downloads disabled -> 403). Exercised end-to-end against
// the REAL server (ADR 0001 substrate) so the assertions bind the real handler.
//
// Shared-write isolation: every fixture lives in the harness's throwaway
// workspace, and each server runs with HOME pointed at a throwaway dir so
// getWhereverConfig() reads an isolated ~/.wherever we own — no real home or
// system path is read or written by these tests.

let h: Harness | undefined;
let homeDir: string | undefined;

/**
 * A throwaway HOME with a ~/.wherever/config.json.
 *
 * `uploads.type: 'session'` is deliberate: the DEFAULT `'tmp'` upload dir makes
 * ALL of os.tmpdir() an allowed download root (resolveDownloadRoots always adds
 * the upload dir), which would make a sibling /tmp fixture in-root. Pinning the
 * upload dir under the session cwd keeps the workspace the ONLY allowed root, so
 * the out-of-root test can place a fixture genuinely outside it. See
 * work/notes/observations/download-tmp-upload-dir-is-an-allowed-root.md.
 */
function makeHome(downloads?: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wherever-dl-home-'));
  fs.mkdirSync(path.join(dir, '.wherever'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.wherever', 'config.json'),
    JSON.stringify(
      {
        gitInitDefault: false,
        remoteRepoRules: [],
        commonFolders: [],
        uploads: { type: 'session' },
        ...(downloads ? { downloads } : {}),
      },
      null,
      2,
    ),
  );
  return dir;
}

afterEach(async () => {
  await h?.cleanup();
  h = undefined;
  if (homeDir) {
    try {
      fs.rmSync(homeDir, { recursive: true, force: true });
    } catch {}
    homeDir = undefined;
  }
});

/** Create a session and return its sessionId + workspace cwd. */
async function newSession(harness: Harness): Promise<{ sessionId: string; cwd: string }> {
  const c = await harness.connect();
  await c.waitForType('connected');
  c.send({ type: 'session_new', cwd: c.workspace });
  const created = await c.waitForType('session_created');
  return { sessionId: created.sessionId as string, cwd: c.workspace };
}

function downloadUrl(port: number, sessionId: string, filePath: string): string {
  return (
    `http://127.0.0.1:${port}/session/download` +
    `?sessionId=${encodeURIComponent(sessionId)}` +
    `&path=${encodeURIComponent(filePath)}`
  );
}

describe('GET /session/download — HTTP Range + media Content-Type', () => {
  beforeEach(() => {
    homeDir = makeHome();
  });

  it('honours a Range request with 206 + Content-Range + Accept-Ranges + sliced body, and full 200 without Range', async () => {
    h = await startHarness({ env: { HOME: homeDir!, USERPROFILE: homeDir! } });
    const { sessionId, cwd } = await newSession(h);

    // A deterministic video fixture (bytes 0..25 = 'A'..'Z') so a slice is
    // byte-exact. The .mp4 extension drives the media Content-Type + inline path.
    const body = Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'ascii');
    const file = path.join(cwd, 'clip.mp4');
    fs.writeFileSync(file, body);

    // Range: bytes=5-9 -> 'FGHIJ'
    const ranged = await fetch(downloadUrl(h.port, sessionId, file), {
      headers: { Range: 'bytes=5-9' },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('accept-ranges')).toBe('bytes');
    expect(ranged.headers.get('content-range')).toBe(`bytes 5-9/${body.length}`);
    expect(ranged.headers.get('content-length')).toBe('5');
    expect(ranged.headers.get('content-type')).toBe('video/mp4');
    const slice = Buffer.from(await ranged.arrayBuffer());
    expect(slice.toString('ascii')).toBe('FGHIJ');

    // A suffix range: last 3 bytes -> 'XYZ'.
    const suffix = await fetch(downloadUrl(h.port, sessionId, file), {
      headers: { Range: 'bytes=-3' },
    });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get('content-range')).toBe(`bytes 23-25/${body.length}`);
    expect(Buffer.from(await suffix.arrayBuffer()).toString('ascii')).toBe('XYZ');

    // No Range header -> full 200 with the whole body and Accept-Ranges advertised.
    const full = await fetch(downloadUrl(h.port, sessionId, file));
    expect(full.status).toBe(200);
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(full.headers.get('content-length')).toBe(String(body.length));
    expect(Buffer.from(await full.arrayBuffer()).toString('ascii')).toBe(body.toString('ascii'));
  }, 60_000);

  it('serves media Content-Type and an inline disposition (not application/octet-stream, not attachment)', async () => {
    h = await startHarness({ env: { HOME: homeDir!, USERPROFILE: homeDir! } });
    const { sessionId, cwd } = await newSession(h);

    const cases: Array<[string, string]> = [
      ['song.mp3', 'audio/mpeg'],
      ['voice.m4a', 'audio/mp4'],
      ['clip.webm', 'video/webm'],
      ['movie.mov', 'video/quicktime'],
    ];
    for (const [name, expectedType] of cases) {
      const file = path.join(cwd, name);
      fs.writeFileSync(file, Buffer.from('0123456789'));
      const res = await fetch(downloadUrl(h.port, sessionId, file));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe(expectedType);
      // Inline (not attachment) so the browser previews the media in-chat, with
      // the RFC 5987 filename still present.
      const cd = res.headers.get('content-disposition') || '';
      expect(cd.startsWith('inline;')).toBe(true);
      expect(cd).toContain(`filename="${name}"`);
      await res.arrayBuffer();
    }

    // A non-media file keeps the attachment disposition (save default).
    const txt = path.join(cwd, 'notes.txt');
    fs.writeFileSync(txt, Buffer.from('hello'));
    const txtRes = await fetch(downloadUrl(h.port, sessionId, txt));
    expect((txtRes.headers.get('content-disposition') || '').startsWith('attachment;')).toBe(true);
    await txtRes.arrayBuffer();

    // SECURITY: an SVG is image/svg+xml but MUST stay `attachment`, never inline.
    // Serving it inline from the server origin would let a tap-to-open navigation
    // execute embedded <script> in the app's origin (stored XSS). It still gets
    // the correct media Content-Type; only the disposition is forced to attachment.
    const svg = path.join(cwd, 'icon.svg');
    fs.writeFileSync(svg, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    const svgRes = await fetch(downloadUrl(h.port, sessionId, svg));
    expect(svgRes.headers.get('content-type')).toBe('image/svg+xml');
    expect((svgRes.headers.get('content-disposition') || '').startsWith('attachment;')).toBe(true);
    await svgRes.arrayBuffer();
  }, 60_000);

  it('replies 416 for an unsatisfiable range (start beyond EOF)', async () => {
    h = await startHarness({ env: { HOME: homeDir!, USERPROFILE: homeDir! } });
    const { sessionId, cwd } = await newSession(h);

    const file = path.join(cwd, 'small.mp4');
    fs.writeFileSync(file, Buffer.from('0123456789')); // 10 bytes
    const res = await fetch(downloadUrl(h.port, sessionId, file), {
      headers: { Range: 'bytes=100-200' },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */10');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    await res.arrayBuffer();
  }, 60_000);

  // --- Security posture preserved ON THE RANGE PATH -----------------------

  it('out-of-root path still returns 404 even with a Range header', async () => {
    h = await startHarness({ env: { HOME: homeDir!, USERPROFILE: homeDir! } });
    const { sessionId } = await newSession(h);

    // A real file OUTSIDE any allowed root (its own temp dir, not the workspace).
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wherever-outside-'));
    const outside = path.join(outsideDir, 'secret.mp4');
    fs.writeFileSync(outside, Buffer.from('0123456789'));
    try {
      const res = await fetch(downloadUrl(h.port, sessionId, outside), {
        headers: { Range: 'bytes=0-4' },
      });
      expect(res.status).toBe(404);
      await res.arrayBuffer();
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('oversized file still returns 413 on the Range path (size cap unchanged)', async () => {
    homeDir = makeHome({ maxBytes: 8 });
    h = await startHarness({ env: { HOME: homeDir!, USERPROFILE: homeDir! } });
    const { sessionId, cwd } = await newSession(h);

    const file = path.join(cwd, 'big.mp4');
    fs.writeFileSync(file, Buffer.from('0123456789')); // 10 bytes > 8 cap
    const res = await fetch(downloadUrl(h.port, sessionId, file), {
      headers: { Range: 'bytes=0-3' },
    });
    expect(res.status).toBe(413);
    await res.arrayBuffer();
  }, 60_000);

  it('downloads disabled still returns 403 on the Range path', async () => {
    homeDir = makeHome({ enabled: false });
    h = await startHarness({ env: { HOME: homeDir!, USERPROFILE: homeDir! } });
    const { sessionId, cwd } = await newSession(h);

    const file = path.join(cwd, 'clip.mp4');
    fs.writeFileSync(file, Buffer.from('0123456789'));
    const res = await fetch(downloadUrl(h.port, sessionId, file), {
      headers: { Range: 'bytes=0-3' },
    });
    expect(res.status).toBe(403);
    await res.arrayBuffer();
  }, 60_000);
});
