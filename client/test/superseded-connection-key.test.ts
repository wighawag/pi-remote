import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {WhereverClient} from '../src/client.js';
import {makeWSFactory} from './harness.js';

// The clientKey lets the server retire this viewer's own superseded (silently
// dropped) connection instead of counting it as a second viewer. But the web
// client scopes the key per tab via sessionStorage, and "Duplicate tab" CLONES
// sessionStorage: two LIVE tabs can end up sharing one key and evicting each
// other forever, one reconnect apart.
//
// The server therefore tells a connection it is being retired. Receiving that
// proves this client is alive, so it takes a fresh key before the reconnect --
// one eviction, then both tabs are distinct viewers again.

describe('superseded connection', () => {
	let ws: ReturnType<typeof makeWSFactory>;
	let client: WhereverClient;
	let persisted: string[];

	function keyOf(url: string): string | null {
		return new URL(url).searchParams.get('clientKey');
	}

	beforeEach(() => {
		vi.useFakeTimers();
		ws = makeWSFactory();
		persisted = [];
		client = new WhereverClient({
			host: 'localhost',
			port: 1234,
			secure: false,
			WebSocketCtor: ws.ctor,
			clientKey: 'shared-key',
			onClientKeyChange: (k) => persisted.push(k),
		});
		client.connect();
		ws.last().open();
	});

	afterEach(() => {
		client.disconnect(true);
		vi.useRealTimers();
	});

	it('sends the configured key on connect', () => {
		expect(keyOf(ws.last().url)).toBe('shared-key');
	});

	it('takes (and reports) a new key when the server says it was superseded', () => {
		ws.last().receive({type: 'connection_superseded'});

		expect(persisted).toHaveLength(1);
		expect(persisted[0]).not.toBe('shared-key');

		// The server closes right after; the reconnect must carry the NEW key, so
		// the two tabs stop evicting each other.
		ws.last().close();
		vi.advanceTimersByTime(5000);
		const reconnected = ws.last();
		expect(keyOf(reconnected.url)).toBe(persisted[0]);
	});

	it('keeps its key across an ordinary reconnect', () => {
		ws.last().close();
		vi.advanceTimersByTime(5000);

		expect(keyOf(ws.last().url)).toBe('shared-key');
		expect(persisted).toHaveLength(0);
	});
});
