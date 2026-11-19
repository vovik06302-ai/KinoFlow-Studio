import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  REQUIRED_MODELS,
  evaluateModelFileStatus,
  formatBytes,
  formatEta,
  formatSpeed,
} from './modelCatalog.js';
import { ModelDownloadManager, scanModelsDirectory } from './modelDownloader.js';

test('REQUIRED_MODELS includes official Wan 2.2 T2V/I2V FP8, UMT5-XXL FP8, Wan 2.1 VAE, and CLIP Vision H', () => {
  const filenames = REQUIRED_MODELS.map((m) => m.filename);
  assert.ok(filenames.includes('wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors'));
  assert.ok(filenames.includes('wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors'));
  assert.ok(filenames.includes('wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors'));
  assert.ok(filenames.includes('wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors'));
  assert.ok(filenames.includes('umt5_xxl_fp8_e4m3fn_scaled.safetensors'));
  assert.ok(filenames.includes('wan_2.1_vae.safetensors'));
  assert.ok(filenames.includes('clip_vision_h.safetensors'));

  for (const model of REQUIRED_MODELS) {
    assert.ok(model.downloadUrl.startsWith('https://huggingface.co/Comfy-Org/'));
    assert.ok(model.expectedSizeBytes > 100_000_000);
    assert.ok(model.targetSubfolder.startsWith('models/'));
  }
});

test('evaluateModelFileStatus detects installed, size_mismatch, partial, and missing accurately', () => {
  assert.equal(evaluateModelFileStatus(1000, 1000, 0), 'installed');
  assert.equal(evaluateModelFileStatus(1000, 500, 0), 'size_mismatch');
  assert.equal(evaluateModelFileStatus(1000, null, 250), 'partial');
  assert.equal(evaluateModelFileStatus(1000, null, 0), 'missing');
});

test('formatBytes, formatSpeed, and formatEta format Russian telemetry strings cleanly', () => {
  assert.equal(formatBytes(1024 * 1024 * 1024), '1.00 ГБ');
  assert.equal(formatSpeed(15.5 * 1024 * 1024), '15.5 МБ/с');
  assert.equal(formatEta(125), '2 мин 5 сек');
  assert.equal(formatEta(42), '42 сек');
});

test('ModelDownloadManager supports HTTP Range 206 resume and transitions status to installed', async () => {
  const payload = Buffer.alloc(256 * 1024);
  for (let i = 0; i < payload.length; i += 1) {
    payload[i] = i % 251;
  }

  let receivedRangeHeader: string | undefined;

  const server = http.createServer((req, res) => {
    const range = req.headers.range;
    if (range) {
      receivedRangeHeader = range;
      const match = /^bytes=(\d+)-$/.exec(range);
      const start = match ? Number(match[1]) : 0;
      const slice = payload.subarray(start);
      res.writeHead(206, {
        'Content-Length': String(slice.length),
        'Content-Range': `bytes ${start}-${payload.length - 1}/${payload.length}`,
        'Accept-Ranges': 'bytes',
      });
      res.end(slice);
      return;
    }

    res.writeHead(200, {
      'Content-Length': String(payload.length),
      'Accept-Ranges': 'bytes',
    });
    res.end(payload);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  const tmpComfyDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kinoflow-models-test-'));

  try {
    const testCatalog = [
      {
        id: 'test-vae',
        name: 'Test VAE',
        category: 'VAE',
        description: 'Synthetic test model',
        filename: 'wan_2.1_vae.safetensors',
        targetSubfolder: 'models/vae',
        repoId: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
        downloadUrl: `http://127.0.0.1:${port}/wan_2.1_vae.safetensors`,
        expectedSizeBytes: payload.length,
      },
    ];

    // Pre-seed a .part file containing the first 64 KiB to simulate resuming after a dropped connection
    const vaeDir = path.join(tmpComfyDir, 'models', 'vae');
    await fsp.mkdir(vaeDir, { recursive: true });
    const partPath = path.join(vaeDir, 'wan_2.1_vae.safetensors.part');
    await fsp.writeFile(partPath, payload.subarray(0, 64 * 1024));

    const initialScan = await scanModelsDirectory(tmpComfyDir, testCatalog);
    assert.equal(initialScan.directoryExists, true);
    assert.equal(initialScan.models[0].status, 'partial');
    assert.equal(initialScan.models[0].partialSizeBytes, 64 * 1024);

    const manager = new ModelDownloadManager(testCatalog);
    const events: Array<{ type: string; state?: string; resumedFromBytes?: number }> = [];

    const finishedPromise = new Promise<void>((resolve) => {
      manager.subscribe((evt) => {
        events.push({
          type: evt.type,
          state: evt.state,
          resumedFromBytes: evt.resumedFromBytes,
        });
        if (evt.type === 'queue-finished') {
          resolve();
        }
      });
    });

    const started = await manager.startQueue(tmpComfyDir);
    assert.equal(started.started, true);
    assert.deepEqual(started.queue, ['test-vae']);

    await finishedPromise;

    assert.equal(receivedRangeHeader, `bytes=${64 * 1024}-`);
    assert.ok(events.some((e) => e.state === 'installed'));

    const finalScan = await scanModelsDirectory(tmpComfyDir, testCatalog);
    assert.equal(finalScan.models[0].status, 'installed');
    assert.equal(finalScan.models[0].existingSizeBytes, payload.length);

    const written = await fsp.readFile(path.join(vaeDir, 'wan_2.1_vae.safetensors'));
    assert.equal(Buffer.compare(written, payload), 0);
  } finally {
    server.close();
    await fsp.rm(tmpComfyDir, { recursive: true, force: true });
  }
});
