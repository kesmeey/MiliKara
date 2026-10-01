import { useState } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BackgroundTimeline } from './BackgroundTimeline';
import { ProjectBackgroundSlides } from './karaoke/ProjectBackgroundSlides';
import { timelineError, slideTime, type SlideDraft } from '@/lib/backgrounds';
import { fixturePV, mockApi, renderUI, seedStore } from '@/test/helpers';

describe('background timeline', () => {
  it('validates times, ordering and the song end', () => {
    expect(slideTime('01:00.500')).toBe(60500);
    expect(slideTime('01:60')).toBeNull();
    const slides = ['00:00', '01:00', '02:00'].map((start, i) => ({ key: String(i), name: 'a', start }));
    expect(timelineError(slides, 180000)).toBeNull();
    expect(timelineError(slides, 120000)).toMatch(/早于/);
    expect(timelineError([slides[0], slides[0]])).toMatch(/递增/);
  });

  it('uploads multiple pictures, edits switches, distributes time and resets the first start after deletion', async () => {
    function Form() {
      const [slides, setSlides] = useState<SlideDraft[]>([]);
      return <BackgroundTimeline slides={slides} onChange={setSlides} durationMs={180000} />;
    }
    renderUI(<Form />);
    const files = ['a.png', 'b.png', 'c.png'].map((name) => new File(['png'], name, { type: 'image/png' }));
    await userEvent.upload(screen.getByLabelText('选择多张背景图片'), files);
    expect(screen.getByLabelText('第 2 张开始时间')).toHaveValue('1:00.000');
    fireEvent.change(screen.getByLabelText('第 2 张开始时间'), { target: { value: '03:00' } });
    expect(screen.getByRole('alert')).toHaveTextContent('递增');
    await userEvent.click(screen.getByRole('button', { name: '平均分配' }));
    expect(screen.getByLabelText('第 3 张开始时间')).toHaveValue('2:00.000');
    await userEvent.click(screen.getByLabelText('删除第 1 张背景'));
    expect(screen.getByLabelText('第 1 张开始时间')).toHaveValue('0:00.000');
    expect(screen.getAllByRole('img')[0]).toHaveAttribute('alt', 'b.png');
  });

  it('saves project switches referencing existing images and can remove the last image', async () => {
    const pv = fixturePV();
    const asset = { id: 'bg1', sha256: 'a'.repeat(64), path: 'assets/a.png', filename: 'a.png', kind: 'image' as const,
      width: 160, height: 90, duration_ms: null };
    pv.project.background_slides = [{ asset, start_ms: 0 }, { asset: { ...asset, id: 'bg2' }, start_ms: 2000 }];
    seedStore('karaoke', pv);
    const api = mockApi({ 'PUT /api/projects/': () => pv, 'DELETE /api/projects/': () => pv });
    renderUI(<ProjectBackgroundSlides project={pv.project} busy={false} setBusy={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('第 2 张开始时间'), { target: { value: '0:03.250' } });
    await userEvent.click(screen.getByRole('button', { name: '保存背景时间表' }));
    await waitFor(() => expect(api.find('PUT', '/background/slides')).toHaveLength(1));
    const fd = api.find('PUT', '/background/slides')[0].body as FormData;
    expect(JSON.parse(String(fd.get('timeline')))).toEqual([{ asset_id: 'bg1', start_ms: 0 }, { asset_id: 'bg2', start_ms: 3250 }]);
    expect(fd.getAll('files')).toHaveLength(0);
    await userEvent.click(screen.getByLabelText('删除第 2 张背景'));
    await userEvent.click(screen.getByLabelText('删除第 1 张背景'));
    await userEvent.click(screen.getByRole('button', { name: '保存背景时间表' }));
    await waitFor(() => expect(api.find('DELETE', '/background')).toHaveLength(1));
  });
});
