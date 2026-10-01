"""Still-image timelines shared by preview, export and task validation."""

from pathlib import Path
from typing import Optional

from PIL import Image, ImageOps

from .background import BackgroundError

MAX_SLIDES = 100


def validate_starts(starts: list[int], duration_ms: Optional[int] = None) -> None:
    if not 1 <= len(starts) <= MAX_SLIDES:
        raise BackgroundError(f"请选择 1–{MAX_SLIDES} 张背景图片")
    if any(type(t) is not int or t < 0 for t in starts):
        raise BackgroundError("背景开始时间必须是非负整数毫秒")
    if starts[0] != 0 or any(a >= b for a, b in zip(starts, starts[1:])):
        raise BackgroundError("第一张背景必须从 00:00 开始，后续开始时间必须递增")
    if duration_ms is not None and starts[-1] >= duration_ms:
        raise BackgroundError("背景开始时间必须早于歌曲结束时间")


def normalize_image(src: Path, dst: Path, size: tuple[int, int]) -> None:
    """Use exactly the same centred crop, orientation and alpha handling in both renderers."""
    with Image.open(src) as image:
        rgba = ImageOps.exif_transpose(image).convert("RGBA")
        rgb = Image.new("RGB", rgba.size, "black")
        rgb.paste(rgba, mask=rgba.getchannel("A"))
        ImageOps.fit(rgb, size, method=Image.Resampling.LANCZOS).save(dst, format="PNG")


def concat_input(slides: list[tuple[Path, int]], size: tuple[int, int], duration_ms: int,
                 directory: Path, cancel=None) -> list[str]:
    """One concat input, regardless of slide count; no intermediate video or extra encoding.

    All PNGs have identical dimensions/format. A millisecond input timebase keeps arbitrary
    switch times; the output fps filter rounds switches up to the next video frame.
    Only generated ASCII names enter the concat script, never user-supplied paths.
    """
    validate_starts([t for _, t in slides], duration_ms)
    lines = ["ffconcat version 1.0"]
    for i, (src, start) in enumerate(slides):
        if cancel is not None:
            cancel.check()
        name = f"slide-{i:03d}.png"
        normalize_image(src, directory / name, size)
        end = slides[i + 1][1] if i + 1 < len(slides) else duration_ms
        lines += [f"file '{name}'", "option framerate 1000", f"duration {(end - start) / 1000:.3f}"]
    # The last duplicate supplies the timestamp up to which the last image is held.
    lines += [f"file '{name}'", "option framerate 1000"]
    script = directory / "slides.ffconcat"
    script.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return ["-f", "concat", "-safe", "0", "-i", str(script)]
