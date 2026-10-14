'use client';

import { AppWindow, Blend, ChevronDown, Mic, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  listInputDevices,
  saveNoiseSuppression,
  savedDeviceId,
  savedNoiseSuppression,
  type InputDevice,
} from '@/lib/audio/devices';
import {
  canCaptureTabAudio,
  saveAudioSource,
  savedAudioSource,
  type AudioSource,
} from '@/lib/audio/sources';
import {
  DEFAULT_VAD_SETTINGS,
  loadVadSettings,
  saveVadSettings,
  VAD_LIMITS,
  type VadSettings,
} from '@/lib/audio/vad-settings';
import { useController } from '../session/controller-context';
import { Button, cx, Dialog, Switch } from '../ui';

const SOURCE_ICON = 'h-5 w-5';
const SOURCES: { id: AudioSource; label: string; hint: string; icon: ReactNode }[] = [
  {
    id: 'mic',
    label: 'Microphone',
    hint: 'People speaking in the room.',
    icon: <Mic className={SOURCE_ICON} aria-hidden />,
  },
  {
    id: 'tab',
    label: 'Tab audio',
    hint: 'A video call or video in another tab. Chrome asks which tab to share.',
    icon: <AppWindow className={SOURCE_ICON} aria-hidden />,
  },
  {
    id: 'mix',
    label: 'Tab + microphone',
    hint: 'Both, e.g. a call where you also speak.',
    icon: <Blend className={SOURCE_ICON} aria-hidden />,
  },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7 first:mt-1">
      <h3 className="mb-3 text-xs font-medium tracking-wide text-ink-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Slider({
  id,
  label,
  hint,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mt-4 first:mt-0">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span className="inline-flex h-6 min-w-12 items-center justify-center rounded-full bg-lavender px-2.5 text-xs font-medium text-accent-ink tabular-nums">
          {display}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range w-full"
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
      />
      <p className="-mt-1 text-sm text-ink-muted">{hint}</p>
    </div>
  );
}

const { speechThreshold: T } = VAD_LIMITS;
/** The sensitivity slider runs the other way from the threshold: right = picks up more. */
const toSensitivity = (threshold: number) => Number((T.min + T.max - threshold).toFixed(2));
const sensitivityLabel = (threshold: number) =>
  threshold <= 0.4 ? 'High' : threshold >= 0.65 ? 'Low' : 'Normal';

export function AudioSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const controller = useController();
  const tabSupported = canCaptureTabAudio();
  const [source, setSource] = useState(savedAudioSource);
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [deviceId, setDeviceId] = useState(() => savedDeviceId() ?? '');
  const [noise, setNoise] = useState(savedNoiseSuppression);
  const [vad, setVad] = useState(loadVadSettings);
  const initialVad = useRef(vad);

  useEffect(() => {
    void listInputDevices()
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);

  // Sliders apply live so their effect can be judged while people talk; Cancel undoes them.
  const updateVad = (patch: Partial<VadSettings>) => {
    const next = { ...vad, ...patch };
    setVad(next);
    controller.applyVadSettings(next);
  };

  const cancel = () => {
    controller.applyVadSettings(initialVad.current);
    onClose();
  };

  const save = async () => {
    saveVadSettings(vad);
    const sourceChanged = source !== savedAudioSource();
    const noiseChanged = noise !== savedNoiseSuppression();
    const deviceChanged = deviceId !== (savedDeviceId() ?? '');
    saveAudioSource(source);
    saveNoiseSuppression(noise);
    onClose();
    if (deviceChanged) await controller.switchDevice(deviceId || undefined);
    else if (sourceChanged || noiseChanged) await controller.applyMicSettings();
  };

  const usesMic = source !== 'tab';
  const unlabeled = devices.length > 0 && devices.every((d) => d.label.startsWith('Microphone '));

  return (
    <Dialog
      open={open}
      onClose={cancel}
      title="Audio"
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      {tabSupported && (
        <Section title="Listen to">
          <div role="radiogroup" aria-label="Audio source" className="flex flex-col gap-2">
            {SOURCES.map((s) => (
              // Selectable card around a native radio (kept for keyboard and screen readers).
              <label
                key={s.id}
                className={cx(
                  'flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border p-3 transition-[background-color,border-color,box-shadow] duration-150 ease-out has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring',
                  source === s.id
                    ? 'border-transparent bg-lavender ring-2 ring-accent'
                    : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2',
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors duration-150',
                    source === s.id ? 'bg-surface text-accent-ink' : 'bg-ink/[0.05] text-ink-muted',
                  )}
                >
                  {s.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{s.label}</span>
                  <span className="block text-sm text-ink-muted">{s.hint}</span>
                </span>
                <input
                  type="radio"
                  name="audio-source"
                  value={s.id}
                  checked={source === s.id}
                  onChange={() => setSource(s.id)}
                  className="h-5 w-5 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-line-strong bg-surface transition-[border-color,box-shadow] duration-150 checked:border-accent checked:shadow-[inset_0_0_0_3.5px_var(--surface),inset_0_0_0_10px_var(--accent)] focus-visible:outline-none"
                />
              </label>
            ))}
          </div>
          {source !== 'mic' && (
            <p className="mt-3 animate-fade-in rounded-2xl bg-surface-2 px-3.5 py-2.5 text-sm text-ink-muted">
              Turn on “Also share tab audio” in Chrome’s share window. Sharing the entire screen
              captures all computer sound on Windows and ChromeOS only.
            </p>
          )}
        </Section>
      )}

      {usesMic && (
        <Section title="Microphone">
          <label className="block text-sm font-medium" htmlFor="mic-device">
            Input
          </label>
          <div className="relative mt-1.5">
            <select
              id="mic-device"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="min-h-11 w-full cursor-pointer appearance-none truncate rounded-xl border border-line bg-surface pr-10 pl-3.5 text-base text-ink shadow-sm transition-[border-color,box-shadow] duration-150 ease-out hover:border-line-strong focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none"
            >
              <option value="">System default</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-ink-muted"
              aria-hidden
            />
          </div>
          {unlabeled && (
            <p className="mt-1.5 text-sm text-ink-muted">
              Start listening once to see microphone names.
            </p>
          )}

          <Switch
            className="mt-4"
            checked={noise}
            onChange={setNoise}
            label="Noise suppression"
            description="Turn off if quiet speakers get cut off."
          />
        </Section>
      )}

      <Section title="Speech detection">
        <Slider
          id="vad-redemption"
          label="Pause before a line ends"
          hint="Raise it if sentences get cut in half; lower it for faster lines."
          value={vad.redemptionMs}
          display={`${(vad.redemptionMs / 1000).toFixed(1)} s`}
          {...VAD_LIMITS.redemptionMs}
          onChange={(redemptionMs) => updateVad({ redemptionMs })}
        />
        <Slider
          id="vad-sensitivity"
          label="Sensitivity"
          hint="Raise it for quiet or distant voices; lower it if background noise becomes lines."
          value={toSensitivity(vad.speechThreshold)}
          display={sensitivityLabel(vad.speechThreshold)}
          min={T.min}
          max={T.max}
          step={T.step}
          onChange={(v) => updateVad({ speechThreshold: toSensitivity(v) })}
        />
        <Slider
          id="vad-min-speech"
          label="Shortest speech"
          hint="Sounds shorter than this are ignored as coughs or clicks."
          value={vad.minSpeechMs}
          display={`${(vad.minSpeechMs / 1000).toFixed(2)} s`}
          {...VAD_LIMITS.minSpeechMs}
          onChange={(minSpeechMs) => updateVad({ minSpeechMs })}
        />
        <Button
          variant="ghost"
          size="sm"
          className="mt-4 -ml-3.5"
          onClick={() => updateVad(DEFAULT_VAD_SETTINGS)}
        >
          <RotateCcw className="h-4 w-4 text-ink-muted" aria-hidden />
          Reset to defaults
        </Button>
      </Section>
    </Dialog>
  );
}
