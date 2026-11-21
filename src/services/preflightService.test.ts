import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PreflightError,
  analyzePreflight,
  buildModelResolutionKey,
  extractComboOptions,
  fetchAvailableLoras,
  formatPreflightReport,
  runPreflight,
} from './preflightService';
import { buildPreflightGraphs } from './comfyService';
import type { GenerationSettings } from '../types/video';

const settings: GenerationSettings = {
  serverUrl: 'http://127.0.0.1:8188',
  comfyDir: 'C:\\ComfyUI',
  mode: 't2v',
  modelId: 'auto',
  durationSec: 10,
  fps: 16,
  frames: 81,
  resolutionId: '832x480',
  width: 832,
  height: 480,
  steps: 28,
  seed: 1,
  seedLocked: false,
  upscale1080p: false,
  rifeEnabled: false,
  rifeTargetFps: 24,
  shootingStyle: 'arri-35mm',
};

const combo = (...options: string[]) => [options, {}];

function fullObjectInfo(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    UNETLoader: {
      input: {
        required: {
          unet_name: combo(
            'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
            'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors',
            'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
            'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
          ),
        },
      },
    },
    CLIPLoader: { input: { required: { clip_name: combo('umt5_xxl_fp8_e4m3fn_scaled.safetensors') } } },
    VAELoader: { input: { required: { vae_name: combo('wan_2.1_vae.safetensors') } } },
    ModelSamplingSD3: {},
    CLIPTextEncode: {},
    LoadImage: {},
    WanImageToVideo: {},
    EmptyHunyuanLatentVideo: {},
    KSamplerAdvanced: {},
    VAEDecodeTiled: {},
    VHS_VideoCombine: {},
    ...overrides,
  };
}

test('extractComboOptions understands the old and the new ComfyUI combo formats', () => {
  assert.deepEqual(extractComboOptions([['a', 'b'], {}]), ['a', 'b']);
  assert.deepEqual(extractComboOptions(['COMBO', { options: ['a', 'b'] }]), ['a', 'b']);
  assert.equal(extractComboOptions(['INT', {}]), null);
  assert.equal(extractComboOptions(undefined), null);
});

test('buildPreflightGraphs returns both T2V and I2V graphs for a chained 10 s generation', () => {
  const graphs = buildPreflightGraphs({ settings, hasStartFrame: false, isContinuation: false });
  assert.equal(graphs.length, 2);
  const types = graphs.map((g) => g['30'].class_type).sort();
  assert.deepEqual(types, ['EmptyHunyuanLatentVideo', 'WanImageToVideo']);
  const single = buildPreflightGraphs({
    settings: { ...settings, durationSec: 5 },
    hasStartFrame: false,
    isContinuation: false,
  });
  assert.equal(single.length, 1);
});

test('analyzePreflight passes when every node and model file is installed', () => {
  const graphs = buildPreflightGraphs({ settings, hasStartFrame: false, isContinuation: false });
  const report = analyzePreflight(graphs, fullObjectInfo());
  assert.deepEqual(report, { ok: true, missingNodes: [], missingFiles: [] });
});

test('analyzePreflight lists missing custom nodes with their node pack and missing model files', () => {
  const graphs = buildPreflightGraphs({ settings, hasStartFrame: false, isContinuation: false });
  const info = fullObjectInfo();
  delete info.VHS_VideoCombine;
  info.UNETLoader.input.required.unet_name = combo('wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors');

  const report = analyzePreflight(graphs, info);
  assert.equal(report.ok, false);
  assert.equal(report.missingNodes[0].classType, 'VHS_VideoCombine');
  assert.equal(report.missingNodes[0].pack, 'ComfyUI-VideoHelperSuite');

  const missing = report.missingFiles.map((f) => f.value).sort();
  assert.ok(missing.includes('wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors'));
  assert.ok(missing.includes('wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors'));
  const low = report.missingFiles.find((f) => f.value.includes('t2v_low'))!;
  assert.equal(low.catalogModelId, 'wan22-t2v-low-fp8', 'catalog files can be downloaded in the app');
  assert.equal(low.folder, 'models/diffusion_models');
});

test('analyzePreflight matches files installed in sub-folders and reports GGUF files as manual downloads', () => {
  const gguf = { ...settings, modelId: 'wan22-t2v-a14b-q4' as const, durationSec: 5 as const };
  const graphs = buildPreflightGraphs({ settings: gguf, hasStartFrame: false, isContinuation: false });
  const info = fullObjectInfo({
    UnetLoaderGGUF: {
      input: { required: { unet_name: combo('wan/wan2.2_t2v_high_noise_14B_Q4_K_M.gguf') } } },
    CLIPLoaderGGUF: {
      input: { required: { clip_name: combo('umt5-xxl-encoder-Q8_0.gguf') } } },
  });
  const report = analyzePreflight(graphs, info);
  const names = report.missingFiles.map((f) => f.value);
  assert.ok(!names.includes('wan2.2_t2v_high_noise_14B_Q4_K_M.gguf'), 'sub-folder install must match');
  assert.equal(
    report.resolvedModelNames?.[
      buildModelResolutionKey('UnetLoaderGGUF', 'unet_name', 'wan2.2_t2v_high_noise_14B_Q4_K_M.gguf')
    ],
    'wan/wan2.2_t2v_high_noise_14B_Q4_K_M.gguf',
  );
  assert.ok(names.includes('wan2.2_t2v_low_noise_14B_Q4_K_M.gguf'));
  assert.match(formatPreflightReport(report), /GGUF-файл нужно скачать вручную/);
});

test('runPreflight queries /object_info per node class and never blocks when the server is unreachable', async () => {
  const graphs = buildPreflightGraphs({ settings: { ...settings, durationSec: 5 }, hasStartFrame: false, isContinuation: false });
  const info = fullObjectInfo();
  const urls: string[] = [];
  const okFetch = (async (url: string) => {
    urls.push(url);
    const name = decodeURIComponent(url.split('/object_info/')[1]);
    return new Response(JSON.stringify(info[name] ? { [name]: info[name] } : {}), { status: 200 });
  }) as unknown as typeof fetch;

  const report = await runPreflight('http://127.0.0.1:8188/', graphs, okFetch);
  assert.equal(report?.ok, true);
  assert.ok(urls.every((u) => u.startsWith('http://127.0.0.1:8188/object_info/')));

  const downFetch = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  assert.equal(await runPreflight('http://127.0.0.1:8188', graphs, downFetch), null);

  // An unknown node class comes back as {} from ComfyUI -> reported as missing.
  const noVhs = (async (url: string) => {
    const name = decodeURIComponent(url.split('/object_info/')[1]);
    const data = name === 'VHS_VideoCombine' || !info[name] ? {} : { [name]: info[name] };
    return new Response(JSON.stringify(data), { status: 200 });
  }) as unknown as typeof fetch;
  const report2 = await runPreflight('http://127.0.0.1:8188', graphs, noVhs);
  assert.equal(report2?.ok, false);
  assert.throws(() => {
    throw new PreflightError(report2!);
  }, /VHS_VideoCombine/);
});

test('analyzePreflight falls back to built-in CreateVideo + SaveVideo when VHS_VideoCombine is missing', async () => {
  const graphs = buildPreflightGraphs({
    settings: { ...settings, durationSec: 5 },
    hasStartFrame: false,
    isContinuation: false,
  });
  const info = fullObjectInfo({ CreateVideo: {}, SaveVideo: {} });
  delete info.VHS_VideoCombine;

  const report = analyzePreflight(graphs, info);
  assert.equal(report.ok, true);
  assert.deepEqual(report.missingNodes, []);
  assert.equal(report.videoExportBackend, 'core');

  const queried: string[] = [];
  const coreOnlyFetch = (async (url: string) => {
    const name = decodeURIComponent(url.split('/object_info/')[1]);
    queried.push(name);
    const data = info[name] ? { [name]: info[name] } : {};
    return new Response(JSON.stringify(data), { status: 200 });
  }) as unknown as typeof fetch;

  const liveReport = await runPreflight('http://127.0.0.1:8188', graphs, coreOnlyFetch);
  assert.ok(queried.includes('CreateVideo'));
  assert.ok(queried.includes('SaveVideo'));
  assert.equal(liveReport?.ok, true);
  assert.equal(liveReport?.videoExportBackend, 'core');
});

test('runPreflight tolerates HTTP 400 on unknown VHS_VideoCombine and extracts SaveVideo format/codec options', async () => {
  const graphs = buildPreflightGraphs({
    settings: { ...settings, durationSec: 5 },
    hasStartFrame: false,
    isContinuation: false,
  });
  const info = fullObjectInfo({
    CreateVideo: {},
    SaveVideo: {
      input: {
        required: {
          format: combo('auto', 'mp4'),
          codec: combo('auto'),
        },
      },
    },
  });
  delete info.VHS_VideoCombine;

  const mixedStatusFetch = (async (url: string) => {
    const name = decodeURIComponent(url.split('/object_info/')[1]);
    if (name === 'VHS_VideoCombine') {
      return new Response('Unknown node', { status: 400 });
    }
    return new Response(JSON.stringify(info[name] ? { [name]: info[name] } : {}), { status: 200 });
  }) as unknown as typeof fetch;

  const report = await runPreflight('http://127.0.0.1:8188', graphs, mixedStatusFetch);
  assert.equal(report?.ok, true);
  assert.equal(report?.videoExportBackend, 'core');
  assert.equal(report?.coreVideoFormat, 'mp4');
  assert.equal(report?.coreVideoCodec, 'auto');
});

test('analyzePreflight checks RIFE VFI ckpt_name when frame interpolation is enabled', () => {
  const rifeSettings: GenerationSettings = {
    ...settings,
    durationSec: 5,
    rifeEnabled: true,
  };
  const graphs = buildPreflightGraphs({
    settings: rifeSettings,
    hasStartFrame: false,
    isContinuation: false,
  });

  const missingRifeCkpt = analyzePreflight(
    graphs,
    fullObjectInfo({
      'RIFE VFI': {
        input: {
          required: {
            ckpt_name: combo('rife47.pth'),
          },
        },
      },
    }),
  );
  assert.equal(missingRifeCkpt.ok, false);
  assert.ok(missingRifeCkpt.missingFiles.some((f) => f.value === 'rife49.pth'));

  const okRife = analyzePreflight(
    graphs,
    fullObjectInfo({
      'RIFE VFI': {
        input: {
          required: {
            ckpt_name: combo('rife49.pth'),
          },
        },
      },
    }),
  );
  assert.equal(okRife.ok, true);
});

test('analyzePreflight validates LoraLoaderModelOnly files and fetchAvailableLoras parses options', async () => {
  const turboSettings: GenerationSettings = {
    ...settings,
    durationSec: 5,
    fastLightX2V: true,
    steps: 6,
  };
  const graphs = buildPreflightGraphs({
    settings: turboSettings,
    hasStartFrame: false,
    isContinuation: false,
  });

  const missingReport = analyzePreflight(
    graphs,
    fullObjectInfo({
      LoraLoaderModelOnly: {
        input: { required: { lora_name: combo('other.safetensors') } },
      },
    }),
  );
  assert.equal(missingReport.ok, false);
  assert.ok(
    missingReport.missingFiles.some(
      (f) => f.folder === 'models/loras' && f.catalogModelId === 'wan22-t2v-lightx2v-high',
    ),
  );

  const mockFetch = (async () =>
    new Response(
      JSON.stringify({
        LoraLoaderModelOnly: {
          input: { required: { lora_name: combo('style_a.safetensors', 'style_b.safetensors') } },
        },
      }),
      { status: 200 },
    )) as unknown as typeof fetch;

  const loras = await fetchAvailableLoras('http://127.0.0.1:8188', mockFetch);
  assert.deepEqual(loras, ['style_a.safetensors', 'style_b.safetensors']);
});




