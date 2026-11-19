# KinoFlow Studio — Веб-интерфейс для генерации видео через ComfyUI API

Современное веб-приложение (React + TypeScript + Tailwind CSS) для генерации видео по тексту и референсным фотографиям персонажей (до 3 героев с индивидуальным весом IP-Adapter / FaceID) через локальный сервер **ComfyUI** с поддержкой **Wan 2.2** и **CogVideoX**, а также встроенным улучшением промптов на базе **Gemini API**.

---

## 1. Запуск ComfyUI без ошибок CORS (обязательно)

По умолчанию браузер блокирует прямые HTTP- и WebSocket-запросы с веб-приложения к `http://127.0.0.1:8188` политикой CORS. Чтобы веб-интерфейс мог проверять статус (`/system_stats`), загружать референсные фото (`/upload/image`), ставить задачи в очередь (`/prompt`), отслеживать прогресс (`/ws`) и скачивать готовое видео (`/view`), запускайте ComfyUI с флагами `--listen` и `--enable-cors-header`.

### Windows (PowerShell / `.bat`)

```bat
@echo off
call venv\Scripts\activate.bat

python main.py ^
  --listen 0.0.0.0 ^
  --port 8188 ^
  --enable-cors-header "*" ^
  --reserve-vram 1.5 ^
  --fast fp16_accumulation
```

Если вы хотите разрешить доступ **только** с локального адреса веб-приложения (рекомендуется для безопасности):

```bat
python main.py --listen 127.0.0.1 --port 8188 --enable-cors-header "http://localhost:3000" --reserve-vram 1.5
```

### Linux / macOS / WSL2

```bash
source venv/bin/activate

python main.py \
  --listen 0.0.0.0 \
  --port 8188 \
  --enable-cors-header "*" \
  --reserve-vram 1.5 \
  --fast fp16_accumulation
```

### Пояснение ключевых флагов запуска ComfyUI

| Флаг | Назначение |
| :--- | :--- |
| `--listen 0.0.0.0` (или `127.0.0.1`) | Открывает API-сервер ComfyUI для входящих подключений (локальных или в локальной сети). |
| `--port 8188` | Порт ComfyUI по умолчанию (указывается в панели **Настройки подключения**). |
| `--enable-cors-header "*"` | Добавляет заголовок `Access-Control-Allow-Origin`, устраняя ошибки CORS в браузере при запросах к `/upload/image`, `/prompt`, `/history` и `/view`. |
| `--reserve-vram 1.5` | Резервирует 1.5 ГБ VRAM под активации и декодирование VAE (важно для видеокарт на 12 ГБ, например 2× RTX 4070). |
| `--fast fp16_accumulation` | Ускоряет вычисления диффузионных трансформеров (Wan 2.2) на GPU архитектуры Ada Lovelace (RTX 40xx). |

> **Важно про HTTPS / Mixed Content:** если веб-приложение открыто по `https://`, современные браузеры разрешают запросы к `http://127.0.0.1:8188` и `http://localhost:8188` как к loopback-адресу, но могут блокировать обращение к локальному LAN-IP (например, `http://192.168.1.50:8188`). В таком случае запускайте приложение локально на `http://localhost:3000` или настройте обратный прокси с TLS.

---

## 2. Требуемые кастомные ноды в ComfyUI

Шаблон `workflow_api.json` рассчитан на следующие популярные расширения ComfyUI:

1. **ComfyUI-GGUF** (`city96/ComfyUI-GGUF`) — загрузка квантованных моделей Wan 2.2 (`Q4_K_M`, `Q5_K_M`) и UMT5-XXL.
2. **ComfyUI-VideoHelperSuite** (`Kosinkadink/ComfyUI-VideoHelperSuite`) — нода `VHS_VideoCombine` для сохранения итогового `.mp4`.
3. **ComfyUI_IPAdapter_plus** (`cubiq/ComfyUI_IPAdapter_plus`) или **ComfyUI-WanVideoWrapper** (`kijai/ComfyUI-WanVideoWrapper`) — для узлов передачи референсов персонажей (IP-Adapter / FaceID / Wan Reference).

---

## 3. Структура проекта и настройка `workflow_api.json`

- `workflow_api.json` — базовый API-шаблон графа ComfyUI с комментариями в `_meta.comment`, показывающими, в какие узлы подставляются:
  - **Ноды `1`, `2`**: выбранная видеомодель (High-Noise / Low-Noise для Wan 2.2 MoE или основная модель CogVideoX).
  - **Ноды `5`, `6`**: положительный и негативный промпты.
  - **Ноды `10`, `11`, `12`**: загруженные фото персонажей (`LoadImage` из ответа `/upload/image`).
  - **Ноды `20`, `21`, `22`**: имена персонажей и веса влияния референса (`weight` от `0.0` до `1.0`). Если загружено меньше 3 фото, неиспользуемые слоты автоматически исключаются из графа перед отправкой в `/prompt`.
  - **Нода `30`**: разрешение (`width`, `height`) и длительность в кадрах (`length`).
  - **Ноды `40`, `41`**: `steps`, `noise_seed` (Seed) и точка переключения MoE-экспертов.
  - **Нода `60`**: экспорт `.mp4` (`VHS_VideoCombine`).
- `src/services/comfyService.ts` — модульный сервис для взаимодействия с API ComfyUI (`/system_stats`, `/upload/image`, `/prompt`, `/ws`, `/history`, `/view`, `/interrupt`).
- `server.ts` — серверная часть Express с маршрутом `POST /api/enhance-prompt`, который вызывает Gemini API через переменную окружения `process.env.GEMINI_API_KEY`.

---

## 4. Локальный запуск веб-приложения

1. Установите зависимости:
   ```bash
   npm install
   ```
2. Задайте ключ Gemini API в `.env` (см. `.env.example`):
   ```env
   GEMINI_API_KEY="ваш_ключ_gemini"
   ```
3. Запустите сервер разработки:
   ```bash
   npm run dev
   ```
4. Откройте в браузере `http://localhost:3000`.
