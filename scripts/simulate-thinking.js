import { WebSocketServer } from 'ws';

const PORT = 31415;
console.log(`🚀 Starting mock Wherever Server on port ${PORT}...`);
const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  console.log('🔌 Client connected');

  // 1. Send connected event
  ws.send(JSON.stringify({
    type: 'connected',
    clientId: 'mock-client-123'
  }));

  // 2. Send initial state and active session
  ws.send(JSON.stringify({
    type: 'session_active',
    sessionFile: 'mock-session.json',
    cwd: '/mock/project',
    model: 'mock-gpt-4',
    sessionId: 'mock-session-id'
  }));

  // 3. Send initial message list with two scenarios:
  // Scenario A: A user command starting with `!` -> Tool output should ALWAYS show
  // Scenario B: A standard user question -> Tool output should be HIDDEN if hideTools is enabled
  ws.send(JSON.stringify({
    type: 'history',
    messages: [
      {
        id: 'msg-user-1',
        role: 'user',
        content: '!bash ls',
        timestamp: Date.now() - 50000
      },
      {
        id: 'msg-tool-1',
        role: 'tool',
        toolName: 'bash',
        toolArgs: JSON.stringify({ command: 'ls' }),
        toolOutput: 'package.json\nsrc/\ndist/\n',
        content: 'Executing bash command: ls',
        timestamp: Date.now() - 45000
      },
      {
        id: 'msg-user-2',
        role: 'user',
        content: 'Check the project files and write a quick summary',
        timestamp: Date.now() - 30000
      },
      {
        id: 'msg-tool-2',
        role: 'tool',
        toolName: 'read',
        toolArgs: JSON.stringify({ path: 'package.json' }),
        toolOutput: '{\n  "name": "@wherever-dev/pi",\n  "version": "1.0.0"\n}',
        content: 'Reading package.json file content',
        timestamp: Date.now() - 25000
      },
      {
        id: 'msg-assistant-2',
        role: 'assistant',
        content: 'I have read package.json and found it defines a project named @wherever-dev/pi at version 1.0.0.',
        timestamp: Date.now() - 20000
      }
    ]
  }));

  // Wait 1.5s then simulate a live agent cycle
  setTimeout(async () => {
    console.log('🤖 Simulating agent start...');
    ws.send(JSON.stringify({ type: 'agent_start' }));

    // Simulate thinking stream (3 seconds)
    console.log('🧠 Streaming thinking steps...');
    const thinkingSteps = [
      'Analyzing user request...\n',
      'Scanning local directories for context...\n',
      'Formulating response structure and formatting...\n',
      'Refining code suggestions...\n'
    ];

    for (let i = 0; i < thinkingSteps.length; i++) {
      await new Promise(r => setTimeout(r, 600));
      ws.send(JSON.stringify({
        type: 'thinking_update',
        delta: thinkingSteps[i]
      }));
    }

    // Simulate brief transition
    await new Promise(r => setTimeout(r, 500));

    // Simulate final assistant response stream (3 seconds)
    console.log('💬 Streaming assistant response...');
    const responseSteps = [
      'Hello',
      '!',
      ' This is a',
      ' mock response',
      ' designed to',
      ' test the',
      ' new',
      ' hide-thinking-steps',
      ' and',
      ' hide-tools',
      ' UI features.',
      ' Observe how tool calls without ! are hidden!'
    ];

    for (let i = 0; i < responseSteps.length; i++) {
      await new Promise(r => setTimeout(r, 200));
      ws.send(JSON.stringify({
        type: 'message_update',
        delta: responseSteps[i]
      }));
    }

    // Simulate agent cycle end
    console.log('✅ Simulating agent end...');
    ws.send(JSON.stringify({ type: 'agent_end' }));

  }, 1500);

  ws.on('close', () => {
    console.log('❌ Client disconnected');
  });
});
