import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { ModelDownloadManager, scanModelsDirectory } from './electron/modelDownloader.js';
import {
  buildEnhancePromptMessages,
  enhancePromptWithRetry,
  formatGeminiEnhanceError,
  type EnhancePromptBody,
} from './serverPromptHelper.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelDownloadManager = new ModelDownloadManager();

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

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

      const ai = createGeminiClient();
      const messages = buildEnhancePromptMessages(body);
      const enhanced = await enhancePromptWithRetry(
        {
          generateText: async ({ model, contents, systemInstruction }) => {
            const response = await ai.models.generateContent({
              model,
              contents,
              config: {
                systemInstruction,
                abortSignal: AbortSignal.timeout(15_000),
                thinkingConfig: {
                  thinkingLevel:
                    model === 'gemini-3.1-flash-lite'
                      ? ThinkingLevel.MINIMAL
                      : ThinkingLevel.LOW,
                },
              },
            });
            return response.text ?? '';
          },
        },
        messages,
      );

      res.json({ enhancedPrompt: enhanced });
    } catch (error) {
      const { status, message } = formatGeminiEnhanceError(error);
      res.status(status).json({ error: message });
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

  const httpServer = http.createServer(app);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';

    if (hmrDisabled) {
      // In Vite 8, middlewareMode still injects /@vite/client which attempts to open an HMR WebSocket
      // even when hmr is disabled. Serving a lightweight no-WS shim preserves CSS injection
      // (updateStyle/removeStyle) while eliminating WebSocket connection errors.
      const NO_WS_VITE_CLIENT = `
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  }
  style.textContent = content;
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (search ? '&' + search.slice(1) : '') + (hash || '');
}
export class ErrorOverlay extends HTMLElement {}
`;
      app.get('/@vite/client', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(NO_WS_VITE_CLIENT);
      });
    }

    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: !hmrDisabled,
        ws: hmrDisabled ? false : { server: httpServer },
        watch: hmrDisabled ? null : undefined,
      },
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

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`KinoFlow Studio server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
