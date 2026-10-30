// Trace: run with `npm start`, then open http://127.0.0.1:4317
// TRACE_HOST=0.0.0.0 shares it with your team on the local network (members sign in with invite links).
import http from 'node:http';
import { handle } from './api.js';
import { startEngine } from './engine.js';
import { startConnectors } from './connectors/index.js';
import { startAiSync } from './ai.js';

const PORT = +process.env.TRACE_PORT || 4317;
const HOST = process.env.TRACE_HOST || '127.0.0.1';

const server = http.createServer(handle);
server.requestTimeout = 0; // long uploads and the live event stream
server.listen(PORT, HOST, () => {
  console.log(`Trace is running at http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`);
  startEngine();
  startConnectors();
  startAiSync();
});
process.on('unhandledRejection', (e) => console.error('unhandled', e));
process.on('uncaughtException', (e) => console.error('uncaught', e)); // a timer that throws must not take Trace down
