'use client';

import { useEffect, useState } from 'react';
import {
  listInputDevices,
  saveNoiseSuppression,
  savedDeviceId,
  savedNoiseSuppression,
  type InputDevice,
} from '@/lib/audio/devices';
import { useController } from '../session/controller-context';
import { Button, Dialog } from '../ui';

export function MicSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const controller = useController();
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [deviceId, setDeviceId] = useState(() => savedDeviceId() ?? '');
  const [noise, setNoise] = useState(savedNoiseSuppression);

  useEffect(() => {
    void listInputDevices()
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);

  const save = async () => {
    const noiseChanged = noise !== savedNoiseSuppression();
    saveNoiseSuppression(noise);
    onClose();
    if (deviceId !== (savedDeviceId() ?? '')) await controller.switchDevice(deviceId || undefined);
    else if (noiseChanged) await controller.applyMicSettings();
  };

  const unlabeled = devices.length > 0 && devices.every((d) => d.label.startsWith('Microphone '));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Microphone"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
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

      <label className="mt-5 flex min-h-11 items-center justify-between gap-4">
        <span>
          <span className="block text-sm font-medium">Noise suppression</span>
          <span className="block text-sm text-muted">Turn off if quiet speakers get cut off.</span>
        </span>
        <input
          type="checkbox"
          checked={noise}
          onChange={(e) => setNoise(e.target.checked)}
          className="h-6 w-6 accent-current"
        />
      </label>
    </Dialog>
  );
}
