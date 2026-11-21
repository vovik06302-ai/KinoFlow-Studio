import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  extractNetworkErrorCode,
  performComfyRequest,
  probeLocalComfyUrls,
} from './comfyBridge.js';

function startNoCorsMockComfyServer(): Promise<{ server: http.Server; port: number; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // Intentionally emit ZERO CORS headers to prove Electron bridge works without --enable-cors-header "*"
      if (req.method === 'GET' && req.url === '/system_stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            system: { comfyui_version: '0.3.42' },
            devices: [{ name: 'NVIDIA GeForce RTX 4070', vram_total: 12 * 1024 ** 3 }],
          }),
        );
        return;
      }

      if (req.method === 'POST' && req.url === '/prompt') {
        let raw = '';
        req.on('data', (chunk) => {
          raw += chunk.toString();
        });
        req.on('end', () => {
          const parsed = JSON.parse(raw);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ prompt_id: `mock-${parsed.client_id}`, number: 1 }));
        });
        return;
      }

      if (req.method === 'POST' && req.url === '/upload/image') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const hasFilename = body.includes('filename="hero.png"');
          const hasSubfolder = body.includes('kinoflow_refs');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              name: hasFilename ? 'hero.png' : 'unknown.png',
              subfolder: hasSubfolder ? 'kinoflow_refs' : '',
              type: 'input',
            }),
          );
        });
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/view')) {
        res.writeHead(200, { 'Content-Type': 'video/mp4' });
        res.end(Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]));
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        server,
        port: address.port,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

test('performComfyRequest connects to ComfyUI without CORS headers for GET, POST JSON, and multipart upload', async () => {
  const { server, baseUrl } = await startNoCorsMockComfyServer();
  try {
    const statsRes = await performComfyRequest({
      url: `${baseUrl}/system_stats`,
      method: 'GET',
      timeoutMs: 3000,
    });
    assert.equal(statsRes.ok, true);
    assert.equal(statsRes.status, 200);
    const stats = JSON.parse(statsRes.bodyText);
    assert.equal(stats.devices[0].name, 'NVIDIA GeForce RTX 4070');

    const promptRes = await performComfyRequest({
      url: `${baseUrl}/prompt`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: { '1': { class_type: 'UNETLoader', inputs: {} } }, client_id: 'abc' }),
      timeoutMs: 3000,
    });
    assert.equal(promptRes.ok, true);
    assert.equal(JSON.parse(promptRes.bodyText).prompt_id, 'mock-abc');

    const uploadRes = await performComfyRequest({
      url: `${baseUrl}/upload/image`,
      method: 'POST',
      timeoutMs: 3000,
      multipart: {
        fieldName: 'image',
        fileName: 'hero.png',
        contentType: 'image/png',
        bytesBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
        fields: { type: 'input', subfolder: 'kinoflow_refs', overwrite: 'true' },
      },
    });
    assert.equal(uploadRes.ok, true);
    const uploaded = JSON.parse(uploadRes.bodyText);
    assert.equal(uploaded.name, 'hero.png');
    assert.equal(uploaded.subfolder, 'kinoflow_refs');

    const videoRes = await performComfyRequest({
      url: `${baseUrl}/view?filename=clip.mp4&type=output`,
      method: 'GET',
      responseType: 'base64',
      timeoutMs: 3000,
    });
    assert.equal(videoRes.ok, true);
    assert.equal(videoRes.contentType, 'video/mp4');
    assert.deepEqual(
      Buffer.from(videoRes.bodyBase64 ?? '', 'base64'),
      Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('performComfyRequest returns ECONNREFUSED on closed port and probeLocalComfyUrls discovers live alternate port', async () => {
  const { server, port, baseUrl } = await startNoCorsMockComfyServer();
  try {
    // Pick a closed port by opening and closing a temporary server
    const closedPort = await new Promise<number>((resolve, reject) => {
      const tmp = http.createServer();
      tmp.on('error', reject);
      tmp.listen(0, '127.0.0.1', () => {
        const p = (tmp.address() as AddressInfo).port;
        tmp.close(() => resolve(p));
      });
    });

    const failed = await performComfyRequest({
      url: `http://127.0.0.1:${closedPort}/system_stats`,
      method: 'GET',
      timeoutMs: 2000,
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.networkError, true);
    assert.equal(failed.errorCode, 'ECONNREFUSED');

    const found = await probeLocalComfyUrls(
      `http://127.0.0.1:${closedPort}`,
      [closedPort, port],
      2000,
    );
    assert.ok(found);
    assert.equal(found.baseUrl, baseUrl);
    assert.equal(found.systemStats.system?.comfyui_version, '0.3.42');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('extractNetworkErrorCode normalizes AbortError and cause.code values', () => {
  const abortErr = new DOMException('Aborted', 'AbortError');
  assert.equal(extractNetworkErrorCode(abortErr), 'ABORT_ERR');
  assert.equal(extractNetworkErrorCode({ cause: { code: 'ECONNREFUSED' } }), 'ECONNREFUSED');
  assert.equal(extractNetworkErrorCode({ message: 'connect ETIMEDOUT 127.0.0.1:8188' }), 'ETIMEDOUT');
});
