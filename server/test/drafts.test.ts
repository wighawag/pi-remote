import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startHarness, type Harness } from './harness.js';
import {
  MAX_DRAFTS,
  MAX_DRAFT_CHARS,
  MAX_DRAFT_META_CHARS,
  parseDrafts,
  removeDraft,
  saveDraft,
  serializeDrafts,
  validateDraftInput,
  type Draft,
} from '../src/drafts.js';

/**
 * Saved drafts (`/drafts`): messages kept instead of sent.
 *
 * The property under test is that the store is SERVER-SIDE. A draft written on a
 * phone has to be there on the laptop, and has to survive the browser losing its
 * storage or the server restarting -- which is precisely what a localStorage
 * implementation cannot give, and why this endpoint exists at all. Each test
 * points the server at its own throwaway WHEREVER_CONFIG_DIR so the developer's
 * real ~/.wherever/drafts.json is never read or written.
 */

let harness: Harness | undefined;
const tmpDirs: string[] = [];

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
  for (const d of tmpDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {}
  }
});

function makeConfigDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wherever-drafts-'));
  tmpDirs.push(dir);
  return dir;
}

async function api(
  port: number,
  pathname: string,
  init?: { method?: string; body?: unknown; token?: string },
): Promise<{ status: number; body: any }> {
  const qs = init?.token ? `?token=${encodeURIComponent(init.token)}` : '';
  const res = await fetch(`http://127.0.0.1:${port}${pathname}${qs}`, {
    method: init?.method ?? 'GET',
    ...(init?.body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }
      : {}),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

describe('/drafts endpoint', () => {
  it('saves a draft server-side and lists it back', async () => {
    const configDir = makeConfigDir();
    harness = await startHarness({ env: { WHEREVER_CONFIG_DIR: configDir } });

    const empty = await api(harness.port, '/drafts');
    expect(empty.status).toBe(200);
    expect(empty.body.drafts).toEqual([]);

    const saved = await api(harness.port, '/drafts', {
      method: 'POST',
      body: { text: '  refactor the session pool  ', cwd: '/home/me/proj', sessionId: 's1' },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.drafts).toHaveLength(1);
    expect(saved.body.drafts[0]).toMatchObject({
      text: 'refactor the session pool',
      cwd: '/home/me/proj',
      sessionId: 's1',
    });

    const listed = await api(harness.port, '/drafts');
    expect(listed.body.drafts).toHaveLength(1);

    // It is a FILE on the server, not browser state: that is the whole feature.
    const onDisk = JSON.parse(fs.readFileSync(path.join(configDir, 'drafts.json'), 'utf8'));
    expect(onDisk.drafts[0].text).toBe('refactor the session pool');
  }, 60_000);

  it('keeps drafts across a server restart (they are not browser state)', async () => {
    const configDir = makeConfigDir();
    harness = await startHarness({ env: { WHEREVER_CONFIG_DIR: configDir } });
    await api(harness.port, '/drafts', { method: 'POST', body: { text: 'survive me' } });
    await harness.cleanup();

    // A DIFFERENT server process, same config dir: stands in for the same machine
    // reached from another device, and for a plain restart.
    harness = await startHarness({ env: { WHEREVER_CONFIG_DIR: configDir } });
    const listed = await api(harness.port, '/drafts');
    expect(listed.body.drafts.map((d: Draft) => d.text)).toEqual(['survive me']);
  }, 90_000);

  it('refuses a blank draft', async () => {
    harness = await startHarness({ env: { WHEREVER_CONFIG_DIR: makeConfigDir() } });
    const res = await api(harness.port, '/drafts', { method: 'POST', body: { text: '   \n ' } });
    expect(res.status).toBe(400);
    const listed = await api(harness.port, '/drafts');
    expect(listed.body.drafts).toEqual([]);
  }, 60_000);

  it('REJECTS an over-long draft rather than silently truncating it', async () => {
    // The composer clears itself once the server has the draft, so storing a
    // prefix would destroy the tail of the message with no error and no undo.
    harness = await startHarness({ env: { WHEREVER_CONFIG_DIR: makeConfigDir() } });
    const res = await api(harness.port, '/drafts', {
      method: 'POST',
      body: { text: 'x'.repeat(MAX_DRAFT_CHARS + 1) },
    });
    expect(res.status).toBe(400);
    expect((await api(harness.port, '/drafts')).body.drafts).toEqual([]);

    const ok = await api(harness.port, '/drafts', {
      method: 'POST',
      body: { text: 'x'.repeat(MAX_DRAFT_CHARS) },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.drafts[0].text).toHaveLength(MAX_DRAFT_CHARS);
  }, 60_000);

  it('bounds the display metadata', async () => {
    // sessionId/cwd are values the client already holds; uncapped, repeated
    // saves of a huge cwd would push the file past its size guard and make the
    // whole list unreadable.
    harness = await startHarness({ env: { WHEREVER_CONFIG_DIR: makeConfigDir() } });
    const res = await api(harness.port, '/drafts', {
      method: 'POST',
      body: { text: 'hi', cwd: 'x'.repeat(MAX_DRAFT_META_CHARS + 1) },
    });
    expect(res.status).toBe(400);
    expect((await api(harness.port, '/drafts')).body.drafts).toEqual([]);
  }, 60_000);

  it('never clobbers an unreadable store: it refuses the write and keeps the file', async () => {
    // A mutation is a read-modify-write, so treating "I could not read it" as
    // "it is empty" would delete every draft on the next save. drafts.json is
    // the only copy of text the user asked to keep.
    const configDir = makeConfigDir();
    harness = await startHarness({ env: { WHEREVER_CONFIG_DIR: configDir } });
    await api(harness.port, '/drafts', { method: 'POST', body: { text: 'precious' } });

    const file = path.join(configDir, 'drafts.json');
    const corrupt = '{"version":1,"drafts":[{"id":"a","text":"prec';
    fs.writeFileSync(file, corrupt, 'utf8');

    // Reading reports the problem instead of answering "you have no drafts".
    const listed = await api(harness.port, '/drafts');
    expect(listed.status).toBe(500);
    expect(String(listed.body.error)).toContain('drafts.json');

    // And the mutation paths refuse rather than overwrite.
    expect(
      (await api(harness.port, '/drafts', { method: 'POST', body: { text: 'new one' } })).status,
    ).toBe(500);
    expect(
      (await api(harness.port, '/drafts/delete', { method: 'POST', body: { id: 'a' } })).status,
    ).toBe(500);
    expect(fs.readFileSync(file, 'utf8')).toBe(corrupt);
  }, 60_000);

  it('answers 400 (not 500) for a malformed body, like the neighbouring routes', async () => {
    harness = await startHarness({ env: { WHEREVER_CONFIG_DIR: makeConfigDir() } });
    const res = await fetch(`http://127.0.0.1:${harness.port}/drafts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  }, 60_000);

  it('touches an identical draft instead of duplicating it', async () => {
    harness = await startHarness({ env: { WHEREVER_CONFIG_DIR: makeConfigDir() } });
    await api(harness.port, '/drafts', { method: 'POST', body: { text: 'same text' } });
    await api(harness.port, '/drafts', { method: 'POST', body: { text: 'other' } });
    const again = await api(harness.port, '/drafts', { method: 'POST', body: { text: 'same text' } });
    expect(again.body.drafts).toHaveLength(2);
    expect(again.body.drafts[0].text).toBe('same text');
  }, 60_000);

  it('deletes a draft by id', async () => {
    harness = await startHarness({ env: { WHEREVER_CONFIG_DIR: makeConfigDir() } });
    const saved = await api(harness.port, '/drafts', { method: 'POST', body: { text: 'delete me' } });
    const id = saved.body.drafts[0].id;

    const missing = await api(harness.port, '/drafts/delete', { method: 'POST', body: {} });
    expect(missing.status).toBe(400);

    const deleted = await api(harness.port, '/drafts/delete', { method: 'POST', body: { id } });
    expect(deleted.status).toBe(200);
    expect(deleted.body.drafts).toEqual([]);
    expect((await api(harness.port, '/drafts')).body.drafts).toEqual([]);
  }, 60_000);

  it('is behind the token gate', async () => {
    // Drafts are the user's unsent words; they must not be readable by anyone who
    // can reach the port. This pins /drafts into the isApiRequest prefix list.
    harness = await startHarness({
      env: { WHEREVER_CONFIG_DIR: makeConfigDir(), PI_REMOTE_TOKEN: 'secret-token' },
    });
    expect((await api(harness.port, '/drafts')).status).toBe(401);
    expect(
      (await api(harness.port, '/drafts', { method: 'POST', body: { text: 'x' } })).status,
    ).toBe(401);
    expect(
      (await api(harness.port, '/drafts/delete', { method: 'POST', body: { id: 'x' } })).status,
    ).toBe(401);
    expect((await api(harness.port, '/drafts', { token: 'secret-token' })).status).toBe(200);
  }, 60_000);
});

// The list transforms are the server's alone (the client never merges or caps a
// list of its own), so they are pinned here rather than in the web package.
describe('drafts list transforms', () => {
  const draft = (over: Partial<Draft> = {}): Draft => ({
    id: 'a',
    text: 'hello',
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  });

  it('round-trips through the file envelope and accepts a bare array', () => {
    const list = [draft({ id: 'a', text: 'one', updatedAt: 2 })];
    expect(parseDrafts(serializeDrafts(list))).toEqual(list);
    expect(parseDrafts(JSON.stringify(list))).toEqual(list);
  });

  it('reports a corrupt file as UNKNOWN (null), never as an empty list', () => {
    // The distinction is what stops a read-modify-write from wiping the file.
    expect(parseDrafts('{"version":1,"draft')).toBe(null);
    expect(parseDrafts('"a string"')).toBe(null);
    expect(parseDrafts(null)).toBe(null);
    // A genuinely empty file IS an empty list.
    expect(parseDrafts('')).toEqual([]);
    expect(parseDrafts('[]')).toEqual([]);
  });

  it('drops malformed members inside an otherwise valid file', () => {
    const raw = JSON.stringify([
      { id: 'ok', text: 'keep me', createdAt: 5, updatedAt: 5 },
      { text: 'no id' },
      { id: 'blank', text: '   ' },
      null,
    ]);
    expect(parseDrafts(raw)?.map((d) => d.id)).toEqual(['ok']);
  });

  it('backfills updatedAt from createdAt and sorts newest first', () => {
    const parsed = parseDrafts(
      JSON.stringify([
        { id: 'old', text: 'old', createdAt: 10 },
        { id: 'new', text: 'new', createdAt: 20 },
      ]),
    )!;
    expect(parsed.map((d) => d.id)).toEqual(['new', 'old']);
    expect(parsed[0].updatedAt).toBe(20);
  });

  it('validates input in one place', () => {
    expect(validateDraftInput({ text: 'fine' })).toBe(null);
    expect(validateDraftInput({ text: '   ' })).toMatch(/empty/);
    expect(validateDraftInput({ text: 42 })).toMatch(/empty/);
    expect(validateDraftInput({ text: 'x'.repeat(MAX_DRAFT_CHARS + 1) })).toMatch(/exceed/);
    expect(validateDraftInput({ text: 'ok', cwd: 'x'.repeat(MAX_DRAFT_META_CHARS + 1) })).toMatch(
      /cwd/,
    );
    expect(validateDraftInput({ text: 'ok', sessionId: 7 })).toMatch(/sessionId/);
  });

  it('caps the list at MAX_DRAFTS, dropping the least recently touched', () => {
    let list: Draft[] = [];
    for (let i = 0; i < MAX_DRAFTS + 5; i++) {
      list = saveDraft(list, { text: `draft ${i}`, id: `id${i}`, now: i });
    }
    expect(list).toHaveLength(MAX_DRAFTS);
    expect(list[0].text).toBe(`draft ${MAX_DRAFTS + 4}`);
    expect(list.some((d) => d.text === 'draft 0')).toBe(false);
  });

  it('keeps createdAt when touching an identical draft', () => {
    const first = saveDraft([], { text: 'same', id: 'a', now: 1 });
    const again = saveDraft(first, { text: 'same', id: 'b', now: 9 });
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ id: 'a', createdAt: 1, updatedAt: 9 });
  });

  it('removes only the requested draft', () => {
    const list = [draft({ id: 'a' }), draft({ id: 'b', text: 'other' })];
    expect(removeDraft(list, 'a').map((d) => d.id)).toEqual(['b']);
    expect(removeDraft(list, 'missing')).toHaveLength(2);
  });
});
