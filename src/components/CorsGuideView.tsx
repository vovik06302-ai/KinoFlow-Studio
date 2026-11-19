import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

const WINDOWS_CMD = `python main.py --listen 0.0.0.0 --port 8188 --enable-cors-header "*" --reserve-vram 1.5 --fast fp16_accumulation`;
const LINUX_CMD = `python main.py --listen 0.0.0.0 --port 8188 --enable-cors-header "*" --reserve-vram 1.5 --fast fp16_accumulation`;
const STRICT_CMD = `python main.py --listen 127.0.0.1 --port 8188 --enable-cors-header "http://localhost:3000" --reserve-vram 1.5`;

export function CorsGuideView() {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyCommand = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-8 border-b border-[#222734] pb-5">
        <h1 className="text-xl font-semibold tracking-tight text-[#F8FAFC]">
          Запуск локального ComfyUI без ошибок CORS
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-[#94A3B8]">
          Чтобы браузер мог напрямую загружать референсы на{' '}
          <span className="font-mono text-[#E2E8F0]">/upload/image</span>, ставить задачи в{' '}
          <span className="font-mono text-[#E2E8F0]">/prompt</span>, читать прогресс по{' '}
          <span className="font-mono text-[#E2E8F0]">/ws</span> и скачивать видео с{' '}
          <span className="font-mono text-[#E2E8F0]">/view</span>, запустите ComfyUI с флагами{' '}
          <span className="font-mono text-[#F6AD55]">--listen</span> и{' '}
          <span className="font-mono text-[#F6AD55]">--enable-cors-header</span>.
        </p>
      </div>

      <div className="space-y-6">
        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-[#F1F5F9]">
              1. Универсальный запуск (Windows / PowerShell / .bat)
            </h2>
            <button
              type="button"
              onClick={() => void copyCommand('win', WINDOWS_CMD)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#2B3242] bg-[#1A1F2B] px-3 py-1.5 text-xs font-medium text-[#E2E8F0] transition-colors hover:bg-[#222838]"
            >
              {copiedId === 'win' ? (
                <Check className="h-3.5 w-3.5 text-[#22C55E]" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>{copiedId === 'win' ? 'Скопировано' : 'Копировать'}</span>
            </button>
          </div>
          <pre className="overflow-x-auto rounded-lg border border-[#222734] bg-[#0F1219] p-4 font-mono text-xs text-[#E2E8F0]">
            <code>{WINDOWS_CMD}</code>
          </pre>
        </section>

        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-[#F1F5F9]">
              2. Строгий режим (доступ только с localhost:3000)
            </h2>
            <button
              type="button"
              onClick={() => void copyCommand('strict', STRICT_CMD)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#2B3242] bg-[#1A1F2B] px-3 py-1.5 text-xs font-medium text-[#E2E8F0] transition-colors hover:bg-[#222838]"
            >
              {copiedId === 'strict' ? (
                <Check className="h-3.5 w-3.5 text-[#22C55E]" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>{copiedId === 'strict' ? 'Скопировано' : 'Копировать'}</span>
            </button>
          </div>
          <pre className="overflow-x-auto rounded-lg border border-[#222734] bg-[#0F1219] p-4 font-mono text-xs text-[#E2E8F0]">
            <code>{STRICT_CMD}</code>
          </pre>
        </section>

        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-[#F1F5F9]">3. Запуск в Linux / WSL2</h2>
            <button
              type="button"
              onClick={() => void copyCommand('linux', LINUX_CMD)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#2B3242] bg-[#1A1F2B] px-3 py-1.5 text-xs font-medium text-[#E2E8F0] transition-colors hover:bg-[#222838]"
            >
              {copiedId === 'linux' ? (
                <Check className="h-3.5 w-3.5 text-[#22C55E]" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>{copiedId === 'linux' ? 'Скопировано' : 'Копировать'}</span>
            </button>
          </div>
          <pre className="overflow-x-auto rounded-lg border border-[#222734] bg-[#0F1219] p-4 font-mono text-xs text-[#E2E8F0]">
            <code>{LINUX_CMD}</code>
          </pre>
        </section>

        <section className="border-t border-[#222734] pt-6">
          <h2 className="mb-3 text-sm font-semibold text-[#F1F5F9]">
            Назначение основных флагов
          </h2>
          <div className="overflow-hidden rounded-lg border border-[#222734]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#222734] bg-[#121620] text-[#94A3B8]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Флаг</th>
                  <th className="px-4 py-2.5 font-medium">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E2330] bg-[#0F1219] text-[#CBD5E1]">
                <tr>
                  <td className="px-4 py-2.5 font-mono text-[#F6AD55]">--listen 0.0.0.0</td>
                  <td className="px-4 py-2.5">
                    Разрешает входящие HTTP/WebSocket-подключения к API ComfyUI.
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 font-mono text-[#F6AD55]">--enable-cors-header &quot;*&quot;</td>
                  <td className="px-4 py-2.5">
                    Передаёт <span className="font-mono">Access-Control-Allow-Origin</span>, снимая
                    блокировку CORS в браузере.
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 font-mono text-[#F6AD55]">--reserve-vram 1.5</td>
                  <td className="px-4 py-2.5">
                    Резервирует 1.5 ГБ видеопамяти под активации и тайловый VAE Decode на 12 ГБ GPU.
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 font-mono text-[#F6AD55]">--fast fp16_accumulation</td>
                  <td className="px-4 py-2.5">
                    Ускоряет DiT-генерацию (Wan 2.2) на картах RTX 40-й серии (Ada Lovelace).
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
