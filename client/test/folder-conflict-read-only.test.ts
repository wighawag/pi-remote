import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {get} from 'sveltore';
import {WhereverClient} from '../src/client.js';
import {makeWSFactory} from './harness.js';

// A client attached read-only because of a FOLDER CONFLICT can only escape in
// two ways: click "Continue anyway" (which lives on the conflict banner), or
// have the conflict resolve on its own. Both hinge on the live `folder_conflict`
// update, which now carries the server's authoritative `readOnly`:
//   - while the conflict is active, the banner must stay up (it holds the only
//     escape hatch); dropping it strands the user read-only with no affordance;
//   - once it resolves, read-only must be RELEASED, since the banner that could
//     have lifted it is gone.

describe('folder-conflict read-only lifecycle', () => {
	let ws: ReturnType<typeof makeWSFactory>;
	let client: WhereverClient;

	function attachAsConflictObserver() {
		client.createSession('/tmp/project');
		ws.last().receive({
			type: 'session_created',
			sessionId: 'sid-1',
			sessionFile: '/tmp/project/session.jsonl',
			cwd: '/tmp/project',
			model: 'fake:model',
			readOnly: true,
			folderConflict: true,
		});
	}

	beforeEach(() => {
		vi.useFakeTimers();
		ws = makeWSFactory();
		client = new WhereverClient({
			host: 'localhost',
			port: 1234,
			secure: false,
			WebSocketCtor: ws.ctor,
		});
		client.connect();
		ws.last().open();
	});

	afterEach(() => {
		client.disconnect(true);
		vi.useRealTimers();
	});

	it('keeps the banner (and its escape hatch) while the conflict is active', () => {
		attachAsConflictObserver();
		expect(get(client.stateStore).readOnly).toBe(true);
		expect(get(client.stateStore).folderConflict).toEqual({
			cwd: '/tmp/project',
			active: true,
			continued: false,
		});

		ws.last().receive({
			type: 'folder_conflict',
			cwd: '/tmp/project',
			active: true,
			readOnly: true,
		});

		const s = get(client.stateStore);
		expect(s.folderConflict?.active).toBe(true);
		// Not continued: the "Continue anyway" button must still be offered.
		expect(s.folderConflict?.continued).toBe(false);
		expect(s.readOnly).toBe(true);
	});

	it('releases read-only when the conflict resolves', () => {
		attachAsConflictObserver();

		ws.last().receive({
			type: 'folder_conflict',
			cwd: '/tmp/project',
			active: false,
			readOnly: false,
		});

		const s = get(client.stateStore);
		expect(s.folderConflict).toBeNull();
		expect(s.readOnly).toBe(false);
	});

	it('keeps a hard read-only session locked when the server says so', () => {
		attachAsConflictObserver();

		// A sessions.readOnly folder: the conflict is gone but the server still
		// reports read-only, which is not a dismissible warning.
		ws.last().receive({
			type: 'folder_conflict',
			cwd: '/tmp/project',
			active: false,
			readOnly: true,
		});

		const s = get(client.stateStore);
		expect(s.folderConflict).toBeNull();
		expect(s.readOnly).toBe(true);
	});

	it('converges when a pre-continue broadcast arrives after the optimistic continue', () => {
		attachAsConflictObserver();
		client.continueFolderConflict();
		expect(get(client.stateStore).readOnly).toBe(false);

		// In flight before the server saw the continue: it still carries the old
		// verdict and re-locks the composer, while `continued` has already removed
		// the banner's button. Only the server's answer to the continue settles it,
		// and same-socket ordering guarantees that answer lands last.
		ws.last().receive({
			type: 'folder_conflict',
			cwd: '/tmp/project',
			active: true,
			readOnly: true,
		});
		expect(get(client.stateStore).readOnly).toBe(true);

		ws.last().receive({
			type: 'folder_conflict',
			cwd: '/tmp/project',
			active: true,
			readOnly: false,
		});

		const s = get(client.stateStore);
		expect(s.readOnly).toBe(false);
		expect(s.folderConflict).toEqual({
			cwd: '/tmp/project',
			active: true,
			continued: true,
		});
	});

	it('leaves read-only untouched when the server omits it (older server)', () => {
		attachAsConflictObserver();

		ws.last().receive({type: 'folder_conflict', cwd: '/tmp/project', active: false});

		expect(get(client.stateStore).readOnly).toBe(true);
	});
});
