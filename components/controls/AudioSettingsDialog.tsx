'use client';

import { useEffect, useRef, useState } from 'react';
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
import { Button, cx, Dialog } from '../ui';

const SOURCES: { id: AudioSource; label: string; hint: string }[] = [
  { id: 'mic', label: 'Microphone', hint: 'People speaking in the room.' },
  {
    id: 'tab',
    label: 'Tab audio',
    hint: 'A video call or video in another tab. Chrome asks which tab to share.',
  },
  { id: 'mix', label: 'Tab + microphone', hint: 'Both, e.g. a call where you also speak.' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
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
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span className="text-sm text-muted tabular-nums">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-11 w-full accent-current"
      />
      <p className="text-sm text-muted">{hint}</p>
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
          <div role="radiogroup" aria-label="Audio source" className="flex flex-col gap-1">
            {SOURCES.map((s) => (
              <label
                key={s.id}
                className={cx(
                  'flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-3 py-2',
                  source === s.id && 'bg-subtle',
                )}
              >
                <input
                  type="radio"
                  name="audio-source"
                  value={s.id}
                  checked={source === s.id}
                  onChange={() => setSource(s.id)}
                  className="mt-1 h-5 w-5 accent-current"
                />
                <span>
                  <span className="block text-sm font-medium">{s.label}</span>
                  <span className="block text-sm text-muted">{s.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {source !== 'mic' && (
            <p className="mt-2 text-sm text-muted">
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
          <select
            id="mic-device"
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-line bg-background px-3 text-base"
          >
            <option value="">System default</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
          {unlabeled && (
            <p className="mt-1 text-sm text-muted">Start listening once to see microphone names.</p>
          )}

          <label className="mt-4 flex min-h-11 items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">Noise suppression</span>
              <span className="block text-sm text-muted">
                Turn off if quiet speakers get cut off.
              </span>
            </span>
            <input
              type="checkbox"
              checked={noise}
              onChange={(e) => setNoise(e.target.checked)}
              className="h-6 w-6 accent-current"
            />
          </label>
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
          className="mt-3 -ml-3"
          onClick={() => updateVad(DEFAULT_VAD_SETTINGS)}
        >
          Reset to defaults
        </Button>
      </Section>
    </Dialog>
  );
}
