import { fmtMs, parseTime } from './format';
import type { BackgroundSlide } from './types';

export const SLIDE_ACCEPT = '.png,.jpg,.jpeg,.webp,.bmp';
export interface SlideDraft {
  key: string;
  name: string;
  start: string;
  file?: File;
  assetId?: string;
  url?: string;
}

export function slideTime(value: string): number | null {
  if (!/^\d+:[0-5]\d(?:\.\d{1,3})?$/.test(value.trim())) return null;
  const time = parseTime(value);
  return time !== null && Number.isSafeInteger(time) ? time : null;
}

export function timelineError(slides: SlideDraft[], durationMs?: number): string | null {
  if (!slides.length) return '请添加背景图片';
  if (slides.length > 100) return '最多 100 张背景图片';
  const times = slides.map((s) => slideTime(s.start));
  if (times.some((t) => t === null)) return '时间格式为 分:秒，例如 01:00 或 01:00.500';
  if (times[0] !== 0) return '第一张必须从 00:00 开始';
  if (times.some((t, i) => i > 0 && t! <= times[i - 1]!)) return '开始时间必须按顺序递增';
  if (durationMs && times[times.length - 1]! >= durationMs) return '背景开始时间必须早于歌曲结束时间';
  return null;
}

export function projectSlides(slides: BackgroundSlide[], fileUrl: string): SlideDraft[] {
  return slides.map((s, i) => ({ key: `${s.asset.id}-${i}`, assetId: s.asset.id, name: s.asset.filename ?? '背景图片',
    start: fmtMs(s.start_ms), url: `${fileUrl}?asset_id=${encodeURIComponent(s.asset.id)}` }));
}

export function timelineForm(slides: SlideDraft[]): FormData {
  const fd = new FormData();
  let index = 0;
  const timeline = slides.map((s) => {
    const start_ms = slideTime(s.start);
    if (s.file) {
      fd.append('files', s.file, s.file.name);
      return { start_ms, upload_index: index++ };
    }
    return { start_ms, asset_id: s.assetId };
  });
  fd.append('timeline', JSON.stringify(timeline));
  return fd;
}
