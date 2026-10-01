import { useEffect, useState } from 'react';
import { BackgroundTimeline } from '@/components/BackgroundTimeline';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import { projectSlides, timelineError, timelineForm } from '@/lib/backgrounds';
import type { Project, ProjectView } from '@/lib/types';
import { ppath, run, setPV, toast } from '@/store/app';

export function ProjectBackgroundSlides({ project, busy, setBusy, onDirtyChange }: {
  project: Project; busy: boolean; setBusy: (busy: boolean) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [open, setOpen] = useState(!!project.background_slides?.length);
  const [slides, setSlides] = useState(() => projectSlides(project.background_slides?.length ? project.background_slides
    : project.background?.kind === 'image' ? [{ asset: project.background, start_ms: 0 }] : [], ppath('/background/file')));
  const durationMs = project.audio.find((a) => a.role === 'original')?.duration_ms;
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const removingAll = dirty && !slides.length && !!project.background_slides?.length;
  const error = removingAll ? null : timelineError(slides, durationMs);
  const save = () => run(async () => {
    if (error) throw new Error(error);
    setBusy(true);
    try {
      setPV(removingAll ? await api.del<ProjectView>(ppath('/background'))
        : await api.put<ProjectView>(ppath('/background/slides'), timelineForm(slides)));
      setDirty(false);
      toast('ok', removingAll ? '已移除多图背景' : '背景时间表已保存', removingAll ? undefined : '预览和导出都会按时间切换图片');
    } finally { setBusy(false); }
  }, '无法保存背景时间表');
  return (
    <div className="space-y-2">
      <Button size="xs" variant="outline" disabled={busy || !durationMs} onClick={() => setOpen(!open)}>
        {open ? '收起背景时间表' : '多张图片按时间切换…'}
      </Button>
      {!durationMs && <p className="text-xs text-muted">上传原曲后可设置多图背景。</p>}
      {open && <>
        <BackgroundTimeline slides={slides} durationMs={durationMs} disabled={busy} onChange={(next) => { setSlides(next); setDirty(true); }} />
        <div className="flex items-center gap-2">
          <Button size="xs" disabled={!!error || !dirty} loading={busy} onClick={() => void save()}>保存背景时间表</Button>
          {dirty && <span className="text-xs text-warn">尚未保存</span>}
        </div>
      </>}
    </div>
  );
}
