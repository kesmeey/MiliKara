import { useEffect, useState } from 'react';

/** Metadata only; unsupported browser codecs still work, with server-side duration validation. */
export function useMediaDuration(file: File | null): number | undefined {
  const [duration, setDuration] = useState<number>();
  useEffect(() => {
    setDuration(undefined);
    if (!file) return;
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(Math.round(audio.duration * 1000));
    };
    audio.src = url;
    return () => { audio.onloadedmetadata = null; audio.removeAttribute('src'); URL.revokeObjectURL(url); };
  }, [file]);
  return duration;
}
