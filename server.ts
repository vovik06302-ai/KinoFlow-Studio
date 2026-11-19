import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { ModelDownloadManager, scanModelsDirectory } from './electron/modelDownloader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelDownloadManager = new ModelDownloadManager();

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

interface CharacterHint {
  name: string;
  weight: number;
}

interface EnhancePromptBody {
  prompt?: string;
  model?: string;
  characters?: CharacterHint[];
  durationSec?: number;
  resolution?: string;
  shootingStyleLabel?: string;
  shootingStyleCue?: string;
}

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.post('/api/enhance-prompt', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as EnhancePromptBody;
      const rawPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';

      if (!rawPrompt) {
        res.status(400).json({ error: 'Введите описание сцены перед улучшением промпта.' });
        return;
      }

      const characters = Array.isArray(body.characters)
        ? body.characters.filter((c) => c && typeof c.name === 'string' && c.name.trim().length > 0)
        : [];

      const characterSection =
        characters.length > 0
          ? `Active character reference photos (MUST preserve these exact character names verbatim and maintain consistent facial identity/appearance from the reference photos):\n${characters
              .map(
                (c, idx) =>
                  `- Character ${idx + 1}: "${c.name.trim()}" (IP-Adapter / FaceID identity weight: ${Number(c.weight).toFixed(2)})`,
              )
              .join('\n')}`
          : 'No named character reference photos attached.';

      const targetModel = typeof body.model === 'string' ? body.model : 'Wan 2.2';
      const durationInfo =
        typeof body.durationSec === 'number' ? `${body.durationSec}s scene` : '5s scene';
      const resolutionInfo = typeof body.resolution === 'string' ? body.resolution : '832x480';
      const styleLabel =
        typeof body.shootingStyleLabel === 'string' && body.shootingStyleLabel.trim()
          ? body.shootingStyleLabel.trim()
          : 'Кинематографичный реализм (ARRI 35mm)';
      const styleCue =
        typeof body.shootingStyleCue === 'string' && body.shootingStyleCue.trim()
          ? body.shootingStyleCue.trim()
          : 'Shot on ARRI Alexa 35 with 35mm prime cinema lens, natural filmic dynamic range, subtle organic 35mm grain.';

      const systemInstruction = [
        'You are an Oscar-caliber Director of Photography and Diffusion Transformer (Wan 2.2 / CogVideoX) live-action photorealism prompt engineer.',
        'Translate the user scene description (typically in Russian) into a single, richly detailed live-action cinematic English prompt engineered for maximum photorealism.',
        'Strict rules:',
        '1. Output ONLY the final English prompt as one cohesive paragraph (100 to 165 words). No markdown, no quotes, no headings, no explanations.',
        '2. Preserve EVERY character name provided in the user prompt or character reference list verbatim, and describe them as real photographed humans keeping consistent likeness to their reference photographs.',
        '3. Always incorporate authentic live-action optical and physical realism details organically into the scene:',
        '   - Natural human skin texture with fine pores, subtle lines, realistic micro-expressions, and zero plastic or waxy sheen.',
        '   - Realistic physical fabric folds, garment weight, and natural stray hair strands moving naturally with air and body momentum.',
        '   - Physically motivated natural or practical lighting with true shadow falloff, subtle skin subsurface scattering, and natural eye catchlights.',
        '   - Authentic optical depth of field, focus breathing, lens physics, and subtle organic film grain matching the requested shooting style.',
        '4. Structure chronologically: camera framing and movement -> characters and natural expressions -> continuous physical action -> environment and practical lighting -> optical/camera texture.',
        '5. NEVER use artificial buzzwords like "8k, unreal engine, octane render, masterpiece, hyperrealistic CGI". Write strictly as a real film camera capturing a real moment.',
      ].join('\n');

      const userMessage = [
        `Target video model: ${targetModel} (${resolutionInfo}, ${durationInfo})`,
        `Selected shooting style: ${styleLabel}`,
        `Optical style direction: ${styleCue}`,
        characterSection,
        `Original scene description:\n${rawPrompt}`,
      ].join('\n\n');

      const ai = createGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: userMessage,
        config: {
          systemInstruction,
        },
      });

      const enhanced = (response.text ?? '').trim();
      if (!enhanced) {
        res.status(502).json({ error: 'Модель Gemini вернула пустой ответ. Попробуйте повторить запрос.' });
        return;
      }

      res.json({ enhancedPrompt: enhanced });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка Gemini API';
      const status = message.includes('GEMINI_API_KEY') ? 500 : 502;
      res.status(status).json({ error: `Не удалось улучшить промпт: ${message}` });
    }
  });

  // Model Auto-Downloader API (Node.js direct streaming + HTTP Range resume, mirrored in Electron IPC)
  app.post('/api/models/scan', async (req: Request, res: Response) => {
    try {
      const comfyDir = typeof req.body?.comfyDir === 'string' ? req.body.comfyDir : '';
      const result = await scanModelsDirectory(comfyDir);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка сканирования папки ComfyUI.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/models/download', async (req: Request, res: Response) => {
    try {
      const comfyDir = typeof req.body?.comfyDir === 'string' ? req.body.comfyDir : '';
      const modelIds = Array.isArray(req.body?.modelIds)
        ? req.body.modelIds.filter((id: unknown): id is string => typeof id === 'string')
        : undefined;
      const result = await modelDownloadManager.startQueue(comfyDir, modelIds);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось запустить загрузку.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/models/cancel', (req: Request, res: Response) => {
    const modelId = typeof req.body?.modelId === 'string' ? req.body.modelId : undefined;
    res.json(modelDownloadManager.cancel(modelId));
  });

  app.get('/api/models/state', (_req: Request, res: Response) => {
    res.json(modelDownloadManager.getSnapshot());
  });

  app.get('/api/models/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const snapshot = modelDownloadManager.getSnapshot();
    for (const activeEvent of snapshot.active) {
      res.write(`data: ${JSON.stringify(activeEvent)}\n\n`);
    }

    const unsubscribe = modelDownloadManager.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    const keepAlive = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 20000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`KinoFlow Studio server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
