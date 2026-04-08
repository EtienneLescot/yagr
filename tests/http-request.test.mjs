import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { createHttpRequestTool } from '../dist/tools/http-request.js';
import { httpRequestTool } from '../dist/tools/langchain/http-request.js';

function startEchoServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const payload = JSON.stringify({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(payload);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

test('httpRequest GET returns ok=true and parsed JSON', async () => {
  const server = await startEchoServer();
  const { port } = server.address();
  const tool = createHttpRequestTool();

  try {
    const result = await tool.execute({
      method: 'GET',
      url: `http://127.0.0.1:${port}/health`,
      timeoutMs: 5000,
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.json.method, 'GET');
    assert.equal(result.json.url, '/health');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('httpRequest POST sends body and headers', async () => {
  const server = await startEchoServer();
  const { port } = server.address();
  const tool = createHttpRequestTool();

  try {
    const result = await tool.execute({
      method: 'POST',
      url: `http://127.0.0.1:${port}/submit`,
      headers: { 'Content-Type': 'application/json', 'X-Custom': 'yagr' },
      body: JSON.stringify({ hello: 'world' }),
      timeoutMs: 5000,
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.json.method, 'POST');
    assert.equal(result.json.body, '{"hello":"world"}');
    assert.equal(result.json.headers['x-custom'], 'yagr');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('httpRequest returns ok=false on connection refused', async () => {
  const tool = createHttpRequestTool();

  const result = await tool.execute({
    method: 'GET',
    url: 'http://127.0.0.1:1',
    timeoutMs: 2000,
  });

  assert.equal(result.ok, false);
  assert.ok(result.error);
});
