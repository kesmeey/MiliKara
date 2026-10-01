"""Verify saved timelines, API/queue integration and actual FFmpeg switch frames."""

import io
import json
import subprocess
import time

import numpy as np
import pytest
from PIL import Image
from fastapi.testclient import TestClient

from kara_align import pipeline as P, service as S, settings as AS, storage
from kara_align.align.backends.fake import ScriptedBackend
from kara_align.audio.io import ffmpeg_path
from kara_align.audio.video import probe_media
from kara_align.karaoke import background
from kara_align.karaoke.slideshow import validate_starts
from kara_align.project import store
from kara_align.web.server import create_app
from tests.test_background import _aligned, _png, _wav, SCRIPT


@pytest.fixture(autouse=True)
def small_frames(monkeypatch):
    monkeypatch.setattr(background, "LONG_SIDE", 320)
    monkeypatch.setattr(ScriptedBackend, "default_script", SCRIPT)
    AS.update({"hardware_encoding": False})


def add_slides(h, root, starts=(0, 1107, 2601)):
    paths = [_png(root / "a.png", (160, 90), (240, 20, 20)),
             _png(root / "b.png", (90, 90), (20, 240, 20)),
             _png(root / "c.png", (40, 90), (20, 20, 240))]
    S.set_background_slides(h, [{"upload_index": i, "start_ms": t} for i, t in enumerate(starts)],
                            [(p, p.name) for p in paths])
    return paths


@pytest.mark.parametrize("starts", [[], [1], [0, 0], [0, -1], [0, 5000], [0, 1000.5], [False], [0] * 101])
def test_invalid_timeline(starts):
    with pytest.raises(background.BackgroundError):
        validate_starts(starts, 5000)


def test_preview_and_export_switch_at_the_first_frame_after_each_start(tmp_path):
    h = _aligned(tmp_path)
    add_slides(h, tmp_path)
    for t, channel in [(0, 0), (1106, 0), (1107, 1), (2600, 1), (2601, 2), (4999, 2)]:
        frame = Image.open(io.BytesIO(S.karaoke_preview(h, t))).convert("RGB")
        assert frame.size == (320, 180)
        assert frame.getpixel((0, 0))[channel] > 220
    out = h.dir / "exports" / S.karaoke_burn(h)["filename"]
    info = probe_media(out)
    assert info["has_audio"] and (info["width"], info["height"]) == (320, 180)
    assert abs(info["duration_ms"] - 5000) < 50
    raw = subprocess.run([ffmpeg_path(), "-v", "error", "-i", str(out), "-vf", "crop=2:2:0:0",
                          "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], check=True, capture_output=True).stdout
    pixels = np.frombuffer(raw, np.uint8).reshape(-1, 2, 2, 3)[:, 0, 0]
    assert len(pixels) == 150
    assert (pixels[:34].argmax(axis=1) == 0).all()  # 1.100 s is still before 1.107 s
    assert (pixels[34:79].argmax(axis=1) == 1).all()  # 2.600 s is still before 2.601 s
    assert (pixels[79:].argmax(axis=1) == 2).all()
    # The same subtitle renderer runs over the entire timeline, and survives both switches.
    full = subprocess.run([ffmpeg_path(), "-v", "error", "-ss", "1.3", "-i", str(out),
                           "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
                          check=True, capture_output=True).stdout
    preview = np.asarray(Image.open(io.BytesIO(S.karaoke_preview(h, 1300))).convert("RGB"), dtype=float)
    actual = np.asarray(Image.open(io.BytesIO(full)).convert("RGB"), dtype=float)
    assert np.abs(actual - preview).mean() < 8


def test_timeline_persists_packages_and_protects_images_from_cleanup(tmp_path):
    h = _aligned(tmp_path)
    add_slides(h, tmp_path)
    original = h.project.model_dump()
    paths = {s.asset.path for s in h.project.background_slides}
    assert paths <= storage.referenced(h.project)
    assert storage.unused_assets(h, now=time.time() + 10000) == []
    assert storage.project_usage(h)["parts"]["background"] == sum((h.dir / p).stat().st_size for p in paths)
    assert store.load_project(h.dir).background_slides == h.project.background_slides
    packed = store.export_package(h.project, h.dir, tmp_path / "song.kara.zip")
    imported = store.import_package(packed, tmp_path / "imported")
    assert imported.background_slides == h.project.background_slides
    assert all((tmp_path / "imported" / p).exists() for p in paths)
    with pytest.raises(S.ServiceError):
        S.set_background_slides(h, [{"asset_id": h.project.background_slides[0].asset.id, "start_ms": 5000}], [])
    assert h.project.model_dump() == original
    # Reusing an image twice retains the file until its last reference is removed.
    aid = h.project.background_slides[0].asset.id
    S.set_background_slides(h, [{"asset_id": aid, "start_ms": 0}, {"asset_id": aid, "start_ms": 2000}], [])
    assert len(storage.referenced(h.project) & paths) == 1
    S.clear_background(h)
    assert not h.project.background_slides and not any((h.dir / p).exists() for p in paths)


def test_single_background_replaces_timeline_and_old_projects_still_load(tmp_path):
    h = _aligned(tmp_path)
    paths = add_slides(h, tmp_path)
    S.set_background(h, paths[0])
    assert h.project.background is not None and not h.project.background_slides
    data = h.project.model_dump()
    del data["background_slides"]
    assert not store.parse_project_json(json.dumps(data)).background_slides
    packed = store.export_package(h.project, h.dir, tmp_path / "single.kara.zip")
    imported = store.import_package(packed, tmp_path / "single")
    assert (tmp_path / "single" / imported.background.path).exists()


def test_slides_http_api_and_missing_image_errors(tmp_path):
    ws = S.Workspace(tmp_path / "projects")
    h = ws.create("test", "plain")
    S.add_media(h, _wav(tmp_path / "song.wav"), "original")
    image = _png(tmp_path / "a.png")
    with TestClient(create_app(ws.root)) as client:
        base = f"/api/projects/{h.project.id}/background"
        response = client.put(base + "/slides", data={"timeline": json.dumps([
            {"upload_index": 0, "start_ms": 0}, {"upload_index": 1, "start_ms": 2000}])},
            files=[("files", ("same.png", image.read_bytes(), "image/png")),
                   ("files", ("same.png", image.read_bytes(), "image/png"))])
        assert response.status_code == 200, response.text
        slides = response.json()["project"]["background_slides"]
        assert len(slides) == 2
        assert client.get(base + "/file", params={"asset_id": slides[1]["asset"]["id"]}).status_code == 200
        assert client.get(base + "/file", params={"asset_id": "missing"}).status_code == 404
        edited = client.put(base + "/slides", data={"timeline": json.dumps([
            {"asset_id": slides[0]["asset"]["id"], "start_ms": 0}])})
        assert edited.status_code == 200
        assert client.put(base + "/slides", data={"timeline": "null"}).status_code == 400
        assert client.put(base + "/slides", data={"timeline": '[{"asset_id":"missing","start_ms":0}]'}).status_code == 400
    restored = S.open_dir(h.dir)
    (h.dir / restored.project.background_slides[0].asset.path).unlink()
    with pytest.raises(S.ServiceError, match="缺失"):
        S._slideshow_files(restored)


def test_queue_restores_multiple_images_with_identical_names(tmp_path, monkeypatch):
    monkeypatch.setattr(P.TaskQueue, "_submit_prep", lambda *args: None)
    q = P.TaskQueue(S.Workspace(tmp_path / "projects"))
    try:
        images = [_png(tmp_path / f"{i}.png", color=color) for i, color in enumerate([(240, 0, 0), (0, 240, 0)])]
        task = q.add(media=_wav(tmp_path / "a.wav"), filename="a.wav", lyrics="きみと", mode="plain",
                     background_slides=[(p, "same.png", i * 2000) for i, p in enumerate(images)])
        tid = task.id
    finally:
        q.shutdown()
    q = P.TaskQueue(S.Workspace(tmp_path / "projects"))
    try:
        task = q.get(tid)
        assert len(task.background_slides) == 2
        P.stage_import(q, task, AS.load(), None, lambda *args: None)
        h = q.ws.get(task.project_id)
        assert [s.start_ms for s in h.project.background_slides] == [0, 2000]
        assert len({s.asset.sha256 for s in h.project.background_slides}) == 2
        assert all((h.dir / s.asset.path).exists() for s in h.project.background_slides)
    finally:
        q.shutdown()


def test_task_api_accepts_slides_and_rejects_out_of_range_times(tmp_path, monkeypatch):
    monkeypatch.setattr(P.TaskQueue, "_submit_prep", lambda *args: None)
    media = _wav(tmp_path / "a.wav").read_bytes()
    image = _png(tmp_path / "a.png").read_bytes()
    with TestClient(create_app(tmp_path / "projects")) as client:
        files = [("file", ("song.wav", media, "audio/wav")),
                 ("background_images", ("a.png", image, "image/png")),
                 ("background_images", ("b.png", image, "image/png"))]
        response = client.post("/api/tasks", data={"lyrics": "きみと", "mode": "plain", "background_starts": "[0,2000]"}, files=files)
        assert response.status_code == 200, response.text
        assert response.json()["background_slides"] == [{"filename": "a.png", "start_ms": 0}, {"filename": "b.png", "start_ms": 2000}]
        for starts in ("[0]", "[0,5000]", "[0,0]", "null"):
            response = client.post("/api/tasks", data={"lyrics": "きみと", "background_starts": starts}, files=files)
            assert response.status_code == 400, response.text
