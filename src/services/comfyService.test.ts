import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_I2V_LOW_MODEL_FILE,
  AUTO_I2V_MODEL_FILE,
  AUTO_T2V_LOW_MODEL_FILE,
  AUTO_T2V_MODEL_FILE,
  DEFAULT_NEGATIVE_PROMPT,
  GenerationParamsValidationError,
  applyShootingStyleToPrompt,
  buildRootUploadFilename,
  buildWorkflowFromTemplate,
  classifyConnectionError,
  computeChainedCharacterWeight,
  computeOutputFps,
  computeUpscaleTargetSize,
  createComfyFetch,
  describeAutoRoutingStatus,
  extractExecutionErrorFromHistory,
  extractVideoOutputFromHistory,
  formatGenerationErrorMessage,
  formatSegmentLabel,
  getViewUrl,
  isHistoryPromptFinished,
  normalizeBaseUrl,
  parseComfyWsEvent,
  planGenerationSegments,
  resolveAutoModelRoute,
  runComfyGeneration,
  secondsToAlignedFrames,
  toWebSocketUrl,
  validateGenerationParams,
} from './comfyService';
import { buildModelResolutionKey } from './preflightService';
import type { GenerationSettings } from '../types/video';

const baseSettings: GenerationSettings = {
  serverUrl: 'http://127.0.0.1:8188',
  comfyDir: 'C:\\ComfyUI_windows_portable\\ComfyUI',
  mode: 't2v',
  modelId: 'wan22-t2v-a14b-q4',
  durationSec: 5,
  fps: 16,
  frames: 81,
  resolutionId: '832x480',
  width: 832,
  height: 480,
  steps: 28,
  seed: 123456,
  seedLocked: true,
  upscale1080p: false,
  rifeEnabled: false,
  rifeTargetFps: 24,
  shootingStyle: 'arri-35mm',
};

test('normalizeBaseUrl strips trailing slashes and ensures http scheme', () => {
  assert.equal(normalizeBaseUrl('http://127.0.0.1:8188///'), 'http://127.0.0.1:8188');
  assert.equal(normalizeBaseUrl('127.0.0.1:8188/'), 'http://127.0.0.1:8188');
  assert.equal(normalizeBaseUrl(''), 'http://127.0.0.1:8188');
});

test('toWebSocketUrl converts http/https to ws/wss with clientId', () => {
  assert.equal(
    toWebSocketUrl('http://127.0.0.1:8188/', 'abc-1'),
    'ws://127.0.0.1:8188/ws?clientId=abc-1',
  );
  assert.equal(
    toWebSocketUrl('https://render.local:8188', 'abc-2'),
    'wss://render.local:8188/ws?clientId=abc-2',
  );
});

test('secondsToAlignedFrames aligns 5s segments at 16fps (81) and 24fps (121) to 4n + 1', () => {
  const f16 = secondsToAlignedFrames(5, 16);
  const f24 = secondsToAlignedFrames(5, 24);
  assert.equal((f16 - 1) % 4, 0);
  assert.equal(f16, 81);
  assert.equal((f24 - 1) % 4, 0);
  assert.equal(f24, 121);
});

test('planGenerationSegments chains 5s segments up to 30s (6 segments) and forces I2V for segments 2..6', () => {
  const plan30T2V = planGenerationSegments(30, 't2v');
  assert.equal(plan30T2V.length, 6);
  assert.equal(plan30T2V[0].mode, 't2v');
  assert.equal(plan30T2V[0].startSec, 0);
  assert.equal(plan30T2V[0].endSec, 5);
  assert.equal(plan30T2V[1].mode, 'i2v');
  assert.equal(plan30T2V[1].startSec, 5);
  assert.equal(plan30T2V[1].endSec, 10);
  assert.equal(plan30T2V[5].mode, 'i2v');
  assert.equal(plan30T2V[5].startSec, 25);
  assert.equal(plan30T2V[5].endSec, 30);

  const plan25I2V = planGenerationSegments(25, 'i2v');
  assert.equal(plan25I2V.length, 5);
  assert.equal(plan25I2V[0].mode, 'i2v');
  assert.equal(plan25I2V[4].endSec, 25);

  assert.equal(
    formatSegmentLabel(4, 6, 15, 20),
    'Рендер сегмента 4 из 6 (15–20 сек)...',
  );
});

test('computeChainedCharacterWeight preserves user weight on segment 1 and locks [0.75, 0.85] on chained/continued segments', () => {
  assert.equal(computeChainedCharacterWeight(0.55, 1, false), 0.55);
  assert.equal(computeChainedCharacterWeight(0.95, 1, false), 0.95);
  assert.equal(computeChainedCharacterWeight(0.4, 2, false), 0.75);
  assert.equal(computeChainedCharacterWeight(0.95, 2, false), 0.85);
  assert.equal(computeChainedCharacterWeight(0.8, 3, false), 0.8);
  assert.equal(computeChainedCharacterWeight(0.5, 1, true), 0.75);
  assert.equal(computeChainedCharacterWeight(1.0, 1, true), 0.85);
});

test('computeUpscaleTargetSize preserves orientation for 1080p cinema output', () => {
  assert.deepEqual(computeUpscaleTargetSize(832, 480), { width: 1920, height: 1080 });
  assert.deepEqual(computeUpscaleTargetSize(480, 832), { width: 1080, height: 1920 });
  assert.deepEqual(computeUpscaleTargetSize(768, 768), { width: 1080, height: 1080 });
});

test('DEFAULT_NEGATIVE_PROMPT blocks 3D render, CGI, plastic skin, cartoon, anime, morphing, distorted hands, blurry', () => {
  for (const term of [
    '3D render',
    'CGI',
    'plastic skin',
    'cartoon',
    'anime',
    'oversaturated',
    'morphing',
    'distorted hands',
    'blurry',
  ]) {
    assert.ok(
      DEFAULT_NEGATIVE_PROMPT.includes(term),
      `DEFAULT_NEGATIVE_PROMPT should block "${term}"`,
    );
  }
});

test('buildWorkflowFromTemplate strips post-processing nodes 55-58 when disabled and links VHS_VideoCombine directly to VAEDecodeTiled', () => {
  const graph = buildWorkflowFromTemplate({
    settings: { ...baseSettings, mode: 't2v', fps: 24, frames: 121 },
    positivePrompt: 'A slow dolly shot along a rainy street.',
    negativePrompt: 'blurry, static',
    characters: [],
  });

  assert.equal(graph['7'], undefined);
  assert.equal(graph['10'], undefined);
  assert.equal(graph['15'], undefined);
  assert.equal(graph['20'], undefined);
  assert.equal(graph['55'], undefined);
  assert.equal(graph['56'], undefined);
  assert.equal(graph['57'], undefined);
  assert.equal(graph['58'], undefined);
  assert.equal(graph['101'].class_type, 'ModelSamplingSD3');
  assert.equal(graph['101'].inputs.shift, 5.0);
  assert.deepEqual(graph['40'].inputs.model, ['101', 0]);
  assert.equal(graph['102'].class_type, 'ModelSamplingSD3');
  assert.deepEqual(graph['41'].inputs.model, ['102', 0]);
  assert.equal(graph['5'].inputs.text, 'A slow dolly shot along a rainy street.');
  assert.equal(graph['30'].inputs.length, 121);
  assert.deepEqual(graph['60'].inputs.images, ['50', 0]);
  assert.equal(graph['60'].inputs.frame_rate, 24);
  assert.ok(graph['41'], 'Wan 2.2 MoE should retain Stage 2 Low-Noise sampler');
});

test('buildWorkflowFromTemplate wires 1080p Upscale (#55-#57) and RIFE VFI (#58) into VHS_VideoCombine (#60)', () => {
  const graph = buildWorkflowFromTemplate({
    settings: {
      ...baseSettings,
      mode: 't2v',
      width: 832,
      height: 480,
      fps: 16,
      upscale1080p: true,
      rifeEnabled: true,
      rifeTargetFps: 30,
    },
    positivePrompt: 'Live-action 35mm street scene.',
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    characters: [],
  });

  assert.equal(graph['55'].class_type, 'UpscaleModelLoader');
  assert.equal(graph['56'].class_type, 'ImageUpscaleWithModel');
  assert.deepEqual(graph['56'].inputs.image, ['50', 0]);
  assert.equal(graph['57'].class_type, 'ImageScale');
  assert.equal(graph['57'].inputs.width, 1920);
  assert.equal(graph['57'].inputs.height, 1080);
  assert.equal(graph['58'].class_type, 'RIFE VFI');
  assert.equal(graph['58'].inputs.multiplier, 2);
  assert.deepEqual(graph['58'].inputs.frames, ['57', 0]);
  assert.deepEqual(graph['60'].inputs.images, ['58', 0]);
  assert.equal(graph['60'].inputs.frame_rate, 32, 'RIFE x2 on 16 fps must play at 32 fps, not slow-mo');
});

test('buildWorkflowFromTemplate I2V graph omits CLIPVision/IP-Adapter and every link points to an existing node', () => {
  const graph = buildWorkflowFromTemplate({
    settings: { ...baseSettings, mode: 'i2v', fps: 16 },
    positivePrompt: 'Marina turns toward the harbor lights as rain falls.',
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    startFrameFilename: 'kinoflow_chain_1700000_seg1_last_frame.png',
    segmentIndex: 2,
    characters: [
      { name: 'Марина', weight: 0.45, imageFilename: 'kinoflow_ref_1700000_marina.png' },
      { name: 'Владимир', weight: 0.98, imageFilename: 'kinoflow_ref_1700000_vladimir.png' },
    ],
  });

  assert.equal(graph['1'].class_type, 'UnetLoaderGGUF');
  assert.equal(graph['1'].inputs.unet_name, 'wan2.2_i2v_high_noise_14B_Q4_K_M.gguf');
  assert.equal(graph['2'].inputs.unet_name, 'wan2.2_i2v_low_noise_14B_Q4_K_M.gguf');
  assert.equal(graph['3'].class_type, 'CLIPLoaderGGUF');
  assert.equal(graph['7'].class_type, 'LoadImage');
  assert.equal(graph['7'].inputs.image, 'kinoflow_chain_1700000_seg1_last_frame.png');
  assert.equal(graph['30'].class_type, 'WanImageToVideo');
  assert.deepEqual(graph['30'].inputs.start_image, ['7', 0]);
  assert.equal(graph['30'].inputs.clip_vision_output, undefined);
  for (const id of ['8', '10', '11', '12', '15', '20', '21', '22']) {
    assert.equal(graph[id], undefined, `node ${id} must not exist`);
  }
  assert.equal(graph['101'].class_type, 'ModelSamplingSD3');
  assert.deepEqual(graph['40'].inputs.model, ['101', 0]);
  assert.deepEqual(graph['41'].inputs.model, ['102', 0]);

  for (const [id, node] of Object.entries(graph)) {
    for (const value of Object.values(node.inputs)) {
      if (Array.isArray(value) && typeof value[0] === 'string') {
        assert.ok(graph[value[0]], `node ${id} links to missing node ${value[0]}`);
      }
    }
  }
});

test('buildWorkflowFromTemplate configures Wan 2.2 TI2V-5B with Wan22ImageToVideoLatent and single-stage sampler', () => {
  const i2vGraph = buildWorkflowFromTemplate({
    settings: { ...baseSettings, mode: 'i2v', modelId: 'wan22-ti2v-5b-fp8', steps: 24 },
    positivePrompt: 'Ocean waves crashing on dark cliffs',
    negativePrompt: 'blurry',
    startFrameFilename: 'kinoflow_start_1700000_cliff.png',
    characters: [],
  });

  assert.equal(i2vGraph['1'].class_type, 'UNETLoader');
  assert.equal(i2vGraph['1'].inputs.unet_name, 'wan2.2_ti2v_5B_fp8_e4m3fn.safetensors');
  assert.equal(i2vGraph['4'].inputs.vae_name, 'wan2.2_vae.safetensors');
  assert.equal(i2vGraph['2'], undefined);
  assert.equal(i2vGraph['102'], undefined);
  assert.equal(i2vGraph['41'], undefined);
  assert.equal(i2vGraph['30'].class_type, 'Wan22ImageToVideoLatent');
  assert.deepEqual(i2vGraph['30'].inputs.vae, ['4', 0]);
  assert.deepEqual(i2vGraph['30'].inputs.start_image, ['7', 0]);
  assert.deepEqual(i2vGraph['40'].inputs.model, ['101', 0]);
  assert.deepEqual(i2vGraph['40'].inputs.positive, ['5', 0]);
  assert.deepEqual(i2vGraph['40'].inputs.negative, ['6', 0]);
  assert.deepEqual(i2vGraph['40'].inputs.latent_image, ['30', 0]);
  assert.deepEqual(i2vGraph['50'].inputs.samples, ['40', 0]);
  assert.equal(i2vGraph['40'].inputs.end_at_step, 24);

  for (const [id, node] of Object.entries(i2vGraph)) {
    for (const value of Object.values(node.inputs)) {
      if (Array.isArray(value) && typeof value[0] === 'string') {
        assert.ok(i2vGraph[value[0]], `node ${id} links to missing node ${value[0]}`);
      }
    }
  }

  const t2vGraph = buildWorkflowFromTemplate({
    settings: { ...baseSettings, mode: 't2v', modelId: 'wan22-ti2v-5b-fp8', steps: 24 },
    positivePrompt: 'Rain over a quiet neon street',
    negativePrompt: 'blurry',
    characters: [],
  });
  assert.equal(t2vGraph['30'].class_type, 'Wan22ImageToVideoLatent');
  assert.equal(t2vGraph['30'].inputs.start_image, undefined);
});

test('extractVideoOutputFromHistory parses VHS_VideoCombine gifs/mp4 output and builds /view URL', () => {
  const history = {
    'pid-42': {
      outputs: {
        '60': {
          gifs: [
            {
              filename: 'kinoflow_video_00001.mp4',
              subfolder: 'renders',
              type: 'output',
            },
          ],
        },
      },
    },
  };

  const out = extractVideoOutputFromHistory(history, 'pid-42', 'http://127.0.0.1:8188/');
  assert.ok(out);
  assert.equal(out.filename, 'kinoflow_video_00001.mp4');
  assert.equal(
    out.viewUrl,
    getViewUrl('http://127.0.0.1:8188', 'kinoflow_video_00001.mp4', 'renders', 'output'),
  );
});

test('parseComfyWsEvent decodes progress and execution completion events', () => {
  const p = parseComfyWsEvent(
    JSON.stringify({
      type: 'progress',
      data: { prompt_id: 'p1', node: '40', value: 7, max: 28 },
    }),
    'p1',
  );
  assert.equal(p.type, 'progress');
  assert.equal(p.value, 7);
  assert.equal(p.max, 28);

  const done = parseComfyWsEvent(
    JSON.stringify({
      type: 'executing',
      data: { prompt_id: 'p1', node: null },
    }),
    'p1',
  );
  assert.equal(done.type, 'executing');
  assert.equal(done.nodeId, null);
});

test('resolveAutoModelRoute selects T2V FP8 for fresh text-to-video and I2V FP8 for start frame, Extend Scene, and chained segments 2..6', () => {
  const t2vRoute = resolveAutoModelRoute({
    modelId: 'auto',
    mode: 't2v',
    segmentIndex: 1,
    hasStartFrame: false,
    isContinuation: false,
  });
  assert.equal(t2vRoute.workflowFile, 'workflow_t2v.json');
  assert.equal(t2vRoute.highNoiseModelFile, AUTO_T2V_MODEL_FILE);
  assert.equal(t2vRoute.lowNoiseModelFile, AUTO_T2V_LOW_MODEL_FILE);

  const i2vStartRoute = resolveAutoModelRoute({
    modelId: 'auto',
    mode: 'i2v',
    segmentIndex: 1,
    hasStartFrame: true,
    isContinuation: false,
  });
  assert.equal(i2vStartRoute.workflowFile, 'workflow_i2v.json');
  assert.equal(i2vStartRoute.highNoiseModelFile, AUTO_I2V_MODEL_FILE);
  assert.equal(i2vStartRoute.lowNoiseModelFile, AUTO_I2V_LOW_MODEL_FILE);

  const extendRoute = resolveAutoModelRoute({
    modelId: 'auto',
    mode: 't2v',
    segmentIndex: 1,
    hasStartFrame: false,
    isContinuation: true,
  });
  assert.equal(extendRoute.workflowFile, 'workflow_i2v.json');
  assert.equal(extendRoute.highNoiseModelFile, AUTO_I2V_MODEL_FILE);

  const chainedRoute = resolveAutoModelRoute({
    modelId: 'auto',
    mode: 't2v',
    segmentIndex: 2,
    hasStartFrame: true,
    isContinuation: false,
  });
  assert.equal(chainedRoute.workflowFile, 'workflow_i2v.json');
  assert.equal(chainedRoute.highNoiseModelFile, AUTO_I2V_MODEL_FILE);
});

test('buildWorkflowFromTemplate in auto mode uses the fp8 high/low-noise safetensors from the model catalog with UNETLoader', () => {
  const t2vGraph = buildWorkflowFromTemplate({
    settings: { ...baseSettings, modelId: 'auto', mode: 't2v' },
    positivePrompt: 'A slow camera push through misty woods.',
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    characters: [],
    segmentIndex: 1,
  });
  assert.equal(t2vGraph['1'].class_type, 'UNETLoader');
  assert.equal(t2vGraph['1'].inputs.unet_name, 'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors');
  assert.equal(t2vGraph['2'].inputs.unet_name, 'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors');
  assert.equal(t2vGraph['3'].class_type, 'CLIPLoader');
  assert.equal(t2vGraph['7'], undefined);
  assert.ok(t2vGraph['41'], 'auto (Wan 2.2 MoE) keeps the low-noise sampler');

  const i2vGraph = buildWorkflowFromTemplate({
    settings: { ...baseSettings, modelId: 'auto', mode: 't2v' },
    positivePrompt: 'Continuation segment 2.',
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    startFrameFilename: 'kinoflow_chain/seg1_last_frame.png',
    characters: [],
    segmentIndex: 2,
  });
  assert.equal(i2vGraph['1'].inputs.unet_name, 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors');
  assert.equal(i2vGraph['2'].inputs.unet_name, 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors');
  assert.equal(i2vGraph['7'].inputs.image, 'kinoflow_chain/seg1_last_frame.png');
  assert.equal(i2vGraph['30'].class_type, 'WanImageToVideo');
});

test('describeAutoRoutingStatus reports concise Russian status for T2V, chained T2V+I2V, I2V, and Extend Scene', () => {
  assert.equal(
    describeAutoRoutingStatus({
      modelId: 'auto',
      mode: 't2v',
      durationSec: 15,
      hasStartFrame: false,
      isExtending: false,
    }),
    'Режим: Авто → Старт с нуля (T2V) + продолжение (I2V)',
  );
  assert.equal(
    describeAutoRoutingStatus({
      modelId: 'auto',
      mode: 'i2v',
      durationSec: 5,
      hasStartFrame: true,
      isExtending: false,
    }),
    'Режим: Авто → Оживление фото (I2V)',
  );
  assert.equal(
    describeAutoRoutingStatus({
      modelId: 'auto',
      mode: 'i2v',
      durationSec: 10,
      hasStartFrame: true,
      isExtending: true,
    }),
    'Режим: Авто → Продолжение сцены (I2V)',
  );
});

test('computeOutputFps keeps playback speed: RIFE doubles the frame rate', () => {
  assert.equal(computeOutputFps(16, true), 32);
  assert.equal(computeOutputFps(24, true), 48);
  assert.equal(computeOutputFps(16, false), 16);
  // 81 frames @16fps = 5.06 s; after RIFE x2 (161 frames) @32fps stays 5.03 s
  assert.ok(Math.abs(161 / computeOutputFps(16, true) - 81 / 16) < 0.05);
});

test('classifyConnectionError distinguishes Electron ECONNREFUSED, HTTPS Mixed Content, timeouts, and browser CORS', () => {
  const electronRefused = classifyConnectionError({
    serverUrl: 'http://127.0.0.1:8188',
    isElectron: true,
    errorCode: 'ECONNREFUSED',
  });
  assert.match(electronRefused, /порт закрыт/i);
  assert.match(electronRefused, /8188 \/ 8000/);

  const httpsMixed = classifyConnectionError({
    serverUrl: 'http://127.0.0.1:8188',
    isElectron: false,
    pageProtocol: 'https:',
  });
  assert.match(httpsMixed, /Mixed Content/i);
  assert.match(httpsMixed, /\.exe/);

  const timeoutMsg = classifyConnectionError({
    serverUrl: 'http://127.0.0.1:8188',
    isElectron: false,
    isAbort: true,
  });
  assert.match(timeoutMsg, /Таймаут/);

  const localHttpMsg = classifyConnectionError({
    serverUrl: 'http://127.0.0.1:8188',
    isElectron: false,
    pageProtocol: 'http:',
  });
  assert.match(localHttpMsg, /--enable-cors-header/);
  assert.match(localHttpMsg, /8000/);
});

test('createComfyFetch routes GET requests through the Electron bridge and maps network errors to TypeError', async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  (globalThis as unknown as { window: unknown }).window = {
    kinoflowComfy: {
      request: async (options: { url: string; method?: string }) => {
        calls.push(options);
        if (options.url.includes('broken')) {
          return { ok: false, status: 0, statusText: '', bodyText: '', networkError: true, errorCode: 'ECONNREFUSED' };
        }
        return { ok: true, status: 200, statusText: 'OK', bodyText: '{"a":1}' };
      },
    },
  };
  try {
    const comfyFetch = createComfyFetch();
    const response = await comfyFetch('http://127.0.0.1:8000/object_info/VHS_VideoCombine');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { a: 1 });
    assert.equal(calls[0].method, 'GET');
    await assert.rejects(() => comfyFetch('http://broken:1/object_info/X'), TypeError);
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});

test('buildWorkflowFromTemplate swaps VHS_VideoCombine for built-in CreateVideo + SaveVideo when videoExportBackend is core', () => {
  const graph = buildWorkflowFromTemplate({
    settings: { ...baseSettings, mode: 'i2v', fps: 16, rifeEnabled: true },
    positivePrompt: 'A gentle breeze moves coastal grass.',
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    startFrameFilename: 'kinoflow_start/coast.png',
    characters: [],
    filenamePrefix: 'kinoflow_seg1_i2v',
    videoExportBackend: 'core',
  });

  assert.equal(graph['60'].class_type, 'CreateVideo');
  assert.deepEqual(graph['60'].inputs.images, ['58', 0]);
  assert.equal(graph['60'].inputs.fps, 32);
  assert.equal(graph['61'].class_type, 'SaveVideo');
  assert.deepEqual(graph['61'].inputs.video, ['60', 0]);
  assert.equal(graph['61'].inputs.filename_prefix, 'kinoflow_seg1_i2v');
  assert.equal(graph['61'].inputs.format, 'mp4');
  assert.equal(graph['61'].inputs.codec, 'h264');
});

test('buildRootUploadFilename produces flat LoadImage-safe names without slashes', () => {
  const name = buildRootUploadFilename('C:\\Users\\Фото (1).PNG', 'kinoflow_start', 1700000000);
  assert.ok(!name.includes('/'));
  assert.ok(!name.includes('\\'));
  assert.match(name, /^kinoflow_start_1700000000_[a-zA-Z0-9_-]+\.png$/);

  const unicodeOnly = buildRootUploadFilename('портрет.jpg', 'kinoflow_ref', 1700000001);
  assert.equal(unicodeOnly, 'kinoflow_ref_1700000001_frame.jpg');
});

test('buildWorkflowFromTemplate applies exact subfolder paths from resolvedModelNames', () => {
  const graph = buildWorkflowFromTemplate({
    settings: { ...baseSettings, modelId: 'auto', mode: 't2v' },
    positivePrompt: 'Sunrise over mountains.',
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    characters: [],
    resolvedModelNames: {
      [buildModelResolutionKey(
        'UNETLoader',
        'unet_name',
        'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
      )]: 'wan22\\wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
      [buildModelResolutionKey('VAELoader', 'vae_name', 'wan_2.1_vae.safetensors')]:
        'wan/wan_2.1_vae.safetensors',
    },
  });

  assert.equal(graph['1'].inputs.unet_name, 'wan22\\wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors');
  assert.equal(graph['4'].inputs.vae_name, 'wan/wan_2.1_vae.safetensors');
});

test('extractExecutionErrorFromHistory and parseComfyWsEvent surface ComfyUI node crashes and interrupts', () => {
  const failedHistory = {
    'p-err': {
      status: {
        status_str: 'error',
        completed: false,
        messages: [
          ['execution_start', { prompt_id: 'p-err' }],
          [
            'execution_error',
            {
              prompt_id: 'p-err',
              node_id: '40',
              node_type: 'KSamplerAdvanced',
              exception_message: 'CUDA out of memory',
            },
          ],
        ],
      },
      outputs: {},
    },
  };

  const errMsg = extractExecutionErrorFromHistory(failedHistory, 'p-err');
  assert.ok(errMsg);
  assert.match(errMsg, /Узел #40/);
  assert.match(errMsg, /KSamplerAdvanced/);
  assert.match(errMsg, /CUDA out of memory/);
  assert.equal(isHistoryPromptFinished(failedHistory, 'p-err'), true);

  const wsErr = parseComfyWsEvent(
    JSON.stringify({
      type: 'execution_error',
      data: {
        prompt_id: 'p-err',
        node_id: '7',
        node_type: 'LoadImage',
        exception_message: 'File not found',
      },
    }),
    'p-err',
  );
  assert.equal(wsErr.type, 'execution_error');
  assert.equal(wsErr.nodeId, '7');
  assert.match(wsErr.errorMessage ?? '', /LoadImage/);

  const wsInterrupt = parseComfyWsEvent(
    JSON.stringify({
      type: 'execution_interrupted',
      data: { prompt_id: 'p-err', node_id: '40' },
    }),
    'p-err',
  );
  assert.equal(wsInterrupt.type, 'execution_interrupted');
});

test('applyShootingStyleToPrompt injects style cue on direct generation and skips when already enhanced', () => {
  const styled = applyShootingStyleToPrompt('A cyclist rides in the rain', 'night-neon', false);
  assert.match(styled, /A cyclist rides in the rain\. Low-light night cinematography/);

  const enhanced = applyShootingStyleToPrompt('Already enhanced prompt', 'night-neon', true);
  assert.equal(enhanced, 'Already enhanced prompt');
});

test('formatGenerationErrorMessage preserves ComfyUI errors without bogus CORS suffixes and classifies network errors', () => {
  const nodeCrash = formatGenerationErrorMessage({
    message: 'Ошибка ComfyUI · Узел #40 (KSamplerAdvanced): CUDA out of memory',
    serverUrl: 'http://127.0.0.1:8188',
    isElectron: false,
    pageProtocol: 'http:',
  });
  assert.equal(nodeCrash, 'Ошибка ComfyUI · Узел #40 (KSamplerAdvanced): CUDA out of memory');
  assert.ok(!nodeCrash.includes('--enable-cors-header'));

  const browserNet = formatGenerationErrorMessage({
    message: 'Failed to fetch',
    serverUrl: 'http://127.0.0.1:8188',
    isElectron: false,
    pageProtocol: 'http:',
  });
  assert.match(browserNet, /--enable-cors-header/);

  const electronNet = formatGenerationErrorMessage({
    message: 'connect ECONNREFUSED 127.0.0.1:8188',
    serverUrl: 'http://127.0.0.1:8188',
    isElectron: true,
  });
  assert.match(electronNet, /порт закрыт/i);
  assert.ok(!electronNet.includes('--enable-cors-header'));
});

test('extractExecutionErrorFromHistory and parseComfyWsEvent surface traceback origin and Windows Errno 22 guidance', () => {
  const wsErrno22Tqdm = parseComfyWsEvent(
    JSON.stringify({
      type: 'execution_error',
      data: {
        prompt_id: 'p-22',
        node_id: '40',
        node_type: 'KSamplerAdvanced',
        exception_message: '[Errno 22] Invalid argument',
        traceback: [
          '  File "C:\\ComfyUI\\execution.py", line 327, in execute\n',
          '  File "C:\\ComfyUI\\python_embeded\\Lib\\site-packages\\tqdm\\std.py", line 1181, in __iter__\n    self.fp.flush()\n',
        ],
      },
    }),
    'p-22',
  );
  assert.equal(wsErrno22Tqdm.type, 'execution_error');
  assert.match(wsErrno22Tqdm.errorMessage ?? '', /Узел #40 \(KSamplerAdvanced\): \[Errno 22\] Invalid argument/);
  assert.match(wsErrno22Tqdm.errorMessage ?? '', /tqdm\/std\.py:1181 in __iter__/);
  assert.match(wsErrno22Tqdm.errorMessage ?? '', /консольного вывода прогресса/i);

  const historyErrno22Generic = extractExecutionErrorFromHistory(
    {
      'p-22-h': {
        status: {
          status_str: 'error',
          completed: false,
          messages: [
            [
              'execution_error',
              {
                prompt_id: 'p-22-h',
                node_id: '40',
                node_type: 'KSamplerAdvanced',
                exception_message: '[Errno 22] Invalid argument',
              },
            ],
          ],
        },
      },
    },
    'p-22-h',
  );
  assert.ok(historyErrno22Generic);
  assert.match(historyErrno22Generic, /OneDrive/);
  assert.match(historyErrno22Generic, /перезапустите ComfyUI/i);
});

test('validateGenerationParams accepts valid settings and rejects invalid types and ranges', () => {
  const okResult = validateGenerationParams({
    settings: baseSettings,
    positivePrompt: 'A slow tracking shot through a rainy Tokyo alley.',
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    hasStartFrame: false,
    characters: [{ name: 'Анна', weight: 0.8 }],
  });
  assert.equal(okResult.valid, true);
  assert.deepEqual(okResult.issues, []);

  const badResult = validateGenerationParams({
    settings: {
      ...baseSettings,
      mode: 'i2v',
      steps: 28.5,
      frames: 80, // not 4n + 1
      width: 830, // not divisible by 16
      height: 128, // below minDimension
      seed: -5,
      fps: 30 as unknown as 16,
      durationSec: 7 as unknown as 5,
      serverUrl: 'http://bad host:8188',
      rifeEnabled: true,
      rifeTargetFps: 60 as unknown as 24,
    },
    positivePrompt: '   ',
    negativePrompt: 123 as unknown as string,
    hasStartFrame: false,
    characters: [{ name: 'A', weight: 1.5 }],
  });

  assert.equal(badResult.valid, false);
  const fields = new Set(badResult.issues.map((issue) => issue.field));
  for (const expectedField of [
    'steps',
    'frames',
    'width',
    'height',
    'seed',
    'fps',
    'durationSec',
    'serverUrl',
    'rifeTargetFps',
    'positivePrompt',
    'negativePrompt',
    'startFrame',
    'characters',
  ]) {
    assert.ok(fields.has(expectedField as never), `expected validation issue for "${expectedField}"`);
  }

  const nonNumericSteps = validateGenerationParams({
    settings: {
      ...baseSettings,
      steps: '28' as unknown as number,
      frames: Number.NaN,
    },
  });
  assert.equal(nonNumericSteps.valid, false);
  assert.ok(nonNumericSteps.issues.some((i) => i.field === 'steps'));
  assert.ok(nonNumericSteps.issues.some((i) => i.field === 'frames'));
});

test('runComfyGeneration rejects invalid steps/frames before making any network request', async () => {
  const controller = new AbortController();
  await assert.rejects(
    () =>
      runComfyGeneration({
        settings: { ...baseSettings, steps: 2, frames: 80 },
        positivePrompt: 'Cinema shot',
        negativePrompt: DEFAULT_NEGATIVE_PROMPT,
        characters: [],
        signal: controller.signal,
        onProgress: () => {},
      }),
    (err: unknown) => {
      assert.ok(err instanceof GenerationParamsValidationError);
      assert.ok(err.issues.some((issue) => issue.field === 'steps'));
      assert.ok(err.issues.some((issue) => issue.field === 'frames'));
      return true;
    },
  );
});




