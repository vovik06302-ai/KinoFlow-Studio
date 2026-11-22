import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STARTUP_STALL_MS,
  describeLauncherExit,
  describeStartupStall,
  diagnoseLogLines,
  isStartupStalled,
} from './launcherDiagnostics';

test('diagnoseLogLines recognises a busy port, console flush errors, missing modules and CUDA problems', () => {
  assert.match(
    diagnoseLogLines(['OSError: [WinError 10048] Only one usage of each socket address'], 8188) ?? '',
    /Порт 8188 уже занят/,
  );
  assert.match(diagnoseLogLines(['[Errno 22] Invalid argument [app/logger.py:73 in flush]'], 8188) ?? '', /Errno 22/);
  assert.match(diagnoseLogLines(["ModuleNotFoundError: No module named 'cv2'"], 8188) ?? '', /Python-пакета/);
  assert.match(diagnoseLogLines(['RuntimeError: CUDA error: invalid device ordinal'], 8189) ?? '', /номер видеокарты/);
  assert.equal(diagnoseLogLines(['[INFO] Starting server'], 8188), null);
});

test('describeLauncherExit explains a crash right after start and includes the last log lines', () => {
  const message = describeLauncherExit({
    instanceId: '1',
    port: 8188,
    code: 1,
    uptimeMs: 4200,
    lastLines: ['[INFO] Starting', 'Traceback (most recent call last):', "ModuleNotFoundError: No module named 'x'"],
  });
  assert.match(message, /Экземпляр 1 остановился \(код 1\) через 4 с/);
  assert.match(message, /не смог стартовать/);
  assert.match(message, /Python-пакета/);
  assert.match(message, /Последние строки журнала:[\s\S]*ModuleNotFoundError/);

  const late = describeLauncherExit({ instanceId: '2', port: 8189, code: null, uptimeMs: 600_000, lastLines: [] });
  assert.match(late, /через 10 мин работы/);
  assert.ok(!late.includes('Последние строки'));
});

test('a started instance that stays silent is reported as stalled only after the limit', () => {
  assert.equal(isStartupStalled(null, 999_999), false);
  assert.equal(isStartupStalled(1000, 1000 + STARTUP_STALL_MS - 1), false);
  assert.equal(isStartupStalled(1000, 1000 + STARTUP_STALL_MS), true);
  assert.match(describeStartupStall('1', 8188, ['[INFO] loading']), /не ответил за 3 мин/);
});

test('diagnoseLogLines explains the shared-database conflict between two ComfyUI processes', () => {
  const hint = diagnoseLogLines(
    ['[ERROR] ASSETS_STARTUP_FAILED: in_use', "Another ComfyUI is already using this database: 'C:\\x'"],
    8188,
  );
  assert.match(hint ?? '', /Другой ComfyUI уже работает/);
});
