import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { startFakeLlmServer, type FakeLlmServer, type FakeBehavior } from './fake-llm-server.js';

// The deterministic test substrate (ADR 0001): boot the REAL wherever server
// against a FAKE LLM in full isolation, on an ephemeral port. Parallel-safe (each
// harness picks its own free port + throwaway dirs), so N runs never collide.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');
const serverEntry =
  process.env.WHEREVER_SERVER_ENTRY ?? path.resolve(serverDir, 'src/index.ts');

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(p));
    });
  });
}

export interface HarnessOptions {
  initial?: FakeBehavior;
  /** Server idle-eviction timeout in ms (PI_IDLE_TIMEOUT). Default: server default. */
  idleTimeoutMs?: number;
  /** Extra env for the server process. */
  env?: Record<string, string>;
}

export interface Harness {
  port: number;
  fake: FakeLlmServer;
  /** The isolated workspace cwd sessions are created in. */
  workspace: string;
  /** The isolated PI_CODING_AGENT_DIR (sessions land under here). */
  agentDir: string;
  setNext(b: FakeBehavior): void;
  /** Open a WS client and wait for the socket to open. */
  connect(): Promise<TestClient>;
  cleanup(): Promise<void>;
}

/**
 * Boot the REAL wherever server against a FAKE LLM, in full isolation:
 *  - a throwaway PI_CODING_AGENT_DIR with a models.json whose only provider
 *    points at the fake LLM server (api: anthropic-messages);
 *  - a throwaway workspace cwd;
 *  - HTTP (no SSL), ephemeral port, no token.
 * pi runs createAgentSession for real and talks to the fake over real HTTP.
 */
export async function startHarness(opts?: HarnessOptions): Promise<Harness> {
  const fake = await startFakeLlmServer(opts?.initial);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wherever-gate-'));
  const agentDir = path.join(tmpRoot, 'agent');
  const workspace = path.join(tmpRoot, 'workspace');
  // Where the server reads config.json. A test that supplies its own HOME is
  // already isolating the config the normal way (~/.wherever under that HOME),
  // so honour it; otherwise point at a throwaway dir of our own.
  const whereverConfigDir = opts?.env?.HOME
    ? path.join(opts.env.HOME, '.wherever')
    : path.join(tmpRoot, 'wherever-config');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(whereverConfigDir, { recursive: true });

  // Register the fake as the ONLY provider, and make it the default model.
  fs.writeFileSync(
    path.join(agentDir, 'models.json'),
    JSON.stringify(
      {
        providers: {
          fake: {
            baseUrl: fake.url,
            api: 'anthropic-messages',
            apiKey: 'test-key',
            models: [{ id: 'fake-model' }],
          },
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(agentDir, 'auth.json'), JSON.stringify({}));
  fs.writeFileSync(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ defaultProvider: 'fake', defaultModel: 'fake-model' }, null, 2),
  );

  const port = await freePort();

  const child: ChildProcess = spawn(
    'pnpm',
    // `start` is required: bare invocation prints usage and exits (the server is
    // reached only via the explicit `start` verb, see dispatch() in index.ts).
    ['exec', 'tsx', serverEntry, 'start', '--port', String(port), '--host', '127.0.0.1', '--no-ssl'],
    {
      cwd: serverDir,
      env: {
        ...process.env,
        // Isolation: the harness runs the server with NO token/SSL (see the doc
        // comment above). But when these tests are run inside a wherever-managed
        // shell, the ambient environment carries PI_REMOTE_* (a token, host,
        // port, SSL paths) which the server reads at startup (index.ts parseArgs).
        // An inherited PI_REMOTE_TOKEN would make the server enforce auth and
        // reject the token-less TestClient WS upgrade with 401. Neutralize every
        // PI_REMOTE_* here so the harness's intent holds regardless of ambient env.
        PI_REMOTE_TOKEN: '',
        PI_REMOTE_HOST: '',
        PI_REMOTE_PORT: '',
        PI_REMOTE_SSL_KEY: '',
        PI_REMOTE_SSL_CERT: '',
        PI_REMOTE_HTTP: '',
        PI_REMOTE_HTTP_LOCALHOST_FALLBACK: '',
        PI_CODING_AGENT_DIR: agentDir,
        // Isolate the wherever config too. Otherwise the harness server reads the
        // developer's real ~/.wherever/config.json, whose `sessions.ignore` may
        // well cover /tmp/** -- which is exactly where the harness puts its
        // workspace, silently hiding the test's own sessions from /sessions.
        WHEREVER_CONFIG_DIR: whereverConfigDir,
        PI_REMOTE_NO_SSL: 'true',
        ...(opts?.idleTimeoutMs != null ? { PI_IDLE_TIMEOUT: String(opts.idleTimeoutMs) } : {}),
        ...(opts?.env ?? {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout?.on('data', (d) => process.env.GATE_DEBUG && process.stdout.write(`[srv] ${d}`));
  child.stderr?.on('data', (d) => process.env.GATE_DEBUG && process.stderr.write(`[srv!] ${d}`));

  // Wait for /health.
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error('server did not become healthy');
    await new Promise((r) => setTimeout(r, 150));
  }

  const clients: TestClient[] = [];

  return {
    port,
    fake,
    workspace,
    agentDir,
    setNext: (b) => fake.setNext(b),
    async connect() {
      const c = await TestClient.open(port, workspace);
      clients.push(c);
      return c;
    },
    async cleanup() {
      for (const c of clients) c.close();
      child.kill('SIGTERM');
      await fake.close();
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch {}
    },
  };
}

type ServerMsg = { type: string; [k: string]: unknown };

/** A minimal WS client that records every server message for assertions. */
export class TestClient {
  private ws: WebSocket;
  readonly messages: ServerMsg[] = [];
  readonly workspace: string;
  private waiters: Array<{ pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }> = [];

  private constructor(ws: WebSocket, workspace: string) {
    this.ws = ws;
    this.workspace = workspace;
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString()) as ServerMsg;
      this.messages.push(m);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(m)) {
          w.resolve(m);
          return false;
        }
        return true;
      });
    });
  }

  static open(port: number, workspace: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const c = new TestClient(ws, workspace);
      ws.on('open', () => resolve(c));
      ws.on('error', reject);
    });
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Resolve when a server message matching `pred` arrives (or already arrived). */
  waitFor(pred: (m: ServerMsg) => boolean, timeoutMs = 20_000): Promise<ServerMsg> {
    const existing = this.messages.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `timeout waiting for message; saw: ${this.messages.map((m) => m.type).join(', ')}`,
            ),
          ),
        timeoutMs,
      );
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  waitForType(type: string, timeoutMs?: number): Promise<ServerMsg> {
    return this.waitFor((m) => m.type === type, timeoutMs);
  }

  /** Concatenated assistant streaming text seen so far. */
  streamedText(): string {
    return this.messages
      .filter((m) => m.type === 'message_update')
      .map((m) => m.delta as string)
      .join('');
  }

  close(): void {
    try {
      this.ws.close();
    } catch {}
  }
}
