import { CAMERA_PRESETS, countStoryboardSegments, resizeStoryboard } from '../services/storyboard';
import type { CameraPresetId, StoryboardShot } from '../services/storyboard';

interface StoryboardPanelProps {
  durationSec: number;
  camera: CameraPresetId;
  storyboardEnabled: boolean;
  shots: StoryboardShot[];
  disabled: boolean;
  onCameraChange: (camera: CameraPresetId) => void;
  onStoryboardEnabledChange: (enabled: boolean) => void;
  onShotsChange: (shots: StoryboardShot[]) => void;
}

const SELECT_CLASS =
  'rounded-md border border-[#262C3A] bg-[#141821] px-2 py-1.5 text-xs text-[#E2E8F0] focus:border-[#E58E26] focus:outline-none disabled:opacity-60';

export function StoryboardPanel({
  durationSec,
  camera,
  storyboardEnabled,
  shots,
  disabled,
  onCameraChange,
  onStoryboardEnabledChange,
  onShotsChange,
}: StoryboardPanelProps) {
  const segmentCount = countStoryboardSegments(durationSec);
  const canStoryboard = durationSec >= 10;
  const visibleShots = resizeStoryboard(shots, segmentCount);

  const updateShot = (index: number, patch: Partial<StoryboardShot>) => {
    onShotsChange(
      visibleShots.map((shot, shotIndex) => (shotIndex === index ? { ...shot, ...patch } : shot)),
    );
  };

  return (
    <section aria-label="Камера и раскадровка" className="mt-6 border-t border-[#1D222E] pt-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-tight text-[#F1F5F9]">Камера и раскадровка</h3>
        <label className="flex items-center gap-2 text-xs text-[#94A3B8]">
          <span>Камера</span>
          <select
            aria-label="Движение камеры"
            value={camera}
            disabled={disabled}
            onChange={(e) => onCameraChange(e.target.value as CameraPresetId)}
            className={SELECT_CLASS}
          >
            {CAMERA_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {canStoryboard ? (
        <>
          <label className="flex cursor-pointer items-start gap-2.5 text-xs text-[#E2E8F0]">
            <input
              type="checkbox"
              checked={storyboardEnabled}
              disabled={disabled}
              onChange={(e) => onStoryboardEnabledChange(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-[#3A4358] bg-[#0D1017] accent-[#E58E26]"
            />
            <span>
              Расписать действие по сегментам
              <span className="mt-0.5 block text-[11px] text-[#64748B]">
                Общее описание сцены сверху задаёт место, героев и стиль. Здесь укажите, что
                происходит в каждые 5 секунд.
              </span>
            </span>
          </label>

          {storyboardEnabled && (
            <ol className="mt-3 space-y-2.5" data-testid="storyboard-list">
              {visibleShots.map((shot, index) => (
                <li
                  key={index}
                  className="rounded-md border border-[#222734] bg-[#11151D] p-2.5"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] tabular-nums text-[#F5B461]">
                      {index * 5}–{(index + 1) * 5} с
                    </span>
                    <select
                      aria-label={`Камера для сегмента ${index + 1}`}
                      value={shot.camera}
                      disabled={disabled}
                      onChange={(e) => updateShot(index, { camera: e.target.value as CameraPresetId })}
                      className={SELECT_CLASS}
                    >
                      {CAMERA_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.id === 'none' ? 'Камера как общая' : preset.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    rows={2}
                    value={shot.text}
                    disabled={disabled}
                    onChange={(e) => updateShot(index, { text: e.target.value })}
                    aria-label={`Действие в сегменте ${index + 1}`}
                    placeholder={
                      index === 0
                        ? 'Например: герой подходит к двери'
                        : index === 1
                          ? 'Например: открывает дверь и выходит под дождь'
                          : 'Что происходит дальше'
                    }
                    className="w-full resize-y rounded-md border border-[#262C3A] bg-[#141821] px-2.5 py-2 text-xs leading-relaxed text-[#F1F5F9] placeholder-[#475569] focus:border-[#E58E26] focus:outline-none disabled:opacity-60"
                  />
                </li>
              ))}
            </ol>
          )}
        </>
      ) : (
        <p className="text-[11px] text-[#64748B]">
          Для раскадровки выберите длительность от 10 секунд: каждые 5 секунд можно описать отдельно.
        </p>
      )}
    </section>
  );
}
