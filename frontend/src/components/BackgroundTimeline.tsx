import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@/components/ui';
import { fmtMs } from '@/lib/format';
import { SLIDE_ACCEPT, slideTime, timelineError, type SlideDraft } from '@/lib/backgrounds';

function Thumbnail({ slide }: { slide: SlideDraft }) {
  const [url, setUrl] = useState(slide.url);
  useEffect(() => {
    if (!slide.file) { setUrl(slide.url); return; }
    const local = URL.createObjectURL(slide.file);
    setUrl(local);
    return () => URL.revokeObjectURL(local);
  }, [slide.file, slide.url]);
  return <img src={url} alt={slide.name} className="h-12 w-16 shrink-0 rounded object-cover" />;
}

/** Shared by the task form and the project editor. Only the caller persists changes. */
export function BackgroundTimeline({ slides, onChange, durationMs, disabled = false }: {
  slides: SlideDraft[]; onChange: (slides: SlideDraft[]) => void; durationMs?: number; disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const replacement = useRef<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const error = slides.length ? timelineError(slides, durationMs) : null;
  const choose = (key: string | null) => { replacement.current = key; input.current?.click(); };
  const upload = (files: File[]) => {
    if (!files.length) return;
    if (files.some((f) => !/\.(png|jpe?g|webp|bmp)$/i.test(f.name) || f.size > 30 * 1024 ** 2)) {
      setFileError('请选择 PNG / JPG / WebP / BMP 图片，每张不超过 30 MB'); return;
    }
    setFileError(null);
    const key = replacement.current;
    if (key !== null) {
      onChange(slides.map((s) => s.key === key ? { ...s, file: files[0], name: files[0].name, assetId: undefined, url: undefined } : s));
      return;
    }
    if (slides.length + files.length > 100) { setFileError('最多 100 张背景图片'); return; }
    const last = slides.length ? slideTime(slides[slides.length - 1].start) ?? 0 : 0;
    const remaining = durationMs ? Math.max(1, durationMs - last) : undefined;
    const step = Math.max(1, Math.min(60000, remaining ? Math.floor(remaining / (files.length + (slides.length ? 1 : 0))) : 60000));
    const added = files.map((file, i) => ({ key: crypto.randomUUID(), file, name: file.name,
      start: fmtMs(last + (i + (slides.length ? 1 : 0)) * step) }));
    onChange([...slides, ...added]);
  };
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3 rounded-lg border border-line p-3">
      <legend className="px-1 text-xs font-medium text-fg">背景时间表</legend>
      <p className="text-xs text-subtle">第一张从 00:00 开始，每张显示到下一张开始，最后一张显示到歌曲结束。画幅按第一张，其他图片居中裁切铺满。</p>
      {slides.map((slide, i) => (
        <div key={slide.key} className="flex flex-wrap items-center gap-2 rounded border border-line p-2">
          <Thumbnail slide={slide} />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="truncate text-xs" title={slide.name}>{i + 1}. {slide.name}</div>
            <label className="flex items-center gap-2 text-xs">
              开始
              <Input className="w-28 font-mono text-xs" aria-label={`第 ${i + 1} 张开始时间`} value={slide.start} readOnly={i === 0}
                placeholder="01:00.000" onChange={(e) => onChange(slides.map((s, n) => n === i ? { ...s, start: e.target.value } : s))} />
            </label>
            <div className="text-[11px] text-muted">至 {slides[i + 1]?.start ?? '歌曲结束'}</div>
          </div>
          <div className="flex gap-1">
            <Button size="xs" variant="ghost" onClick={() => choose(slide.key)}>替换</Button>
            <Button size="xs" variant="ghost" aria-label={`删除第 ${i + 1} 张背景`} onClick={() => onChange(
              slides.filter((_, n) => n !== i).map((s, n) => n === 0 ? { ...s, start: fmtMs(0) } : s))}>删除</Button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button size="xs" variant="outline" onClick={() => choose(null)}>添加背景图片…</Button>
        {slides.length > 1 && <>
          <Button size="xs" variant="outline" onClick={() => onChange(slides.map((s, i) => ({ ...s, start: fmtMs(i * 60000) })))}>每张 60 秒</Button>
          {durationMs !== undefined && durationMs > slides.length && <Button size="xs" variant="outline"
            onClick={() => onChange(slides.map((s, i) => ({ ...s, start: fmtMs(Math.floor(i * durationMs / slides.length)) })))}>平均分配</Button>}
        </>}
      </div>
      {(fileError || error) && <p role="alert" className="text-xs text-danger">{fileError || error}</p>}
      <input ref={input} type="file" multiple accept={SLIDE_ACCEPT} className="hidden" aria-label="选择多张背景图片"
        onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; upload(files); }} />
    </fieldset>
  );
}
