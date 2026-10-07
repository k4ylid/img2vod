import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore, shotStartTime } from '../store';
import { FrameRenderer } from '../render/FrameRenderer';
import { evaluateCamera, effectiveMove, projectDuration, sceneAt, viewRect } from '../../shared/engine';
import { RESOLUTION_DIMS } from '../../shared/types';
import type { Shot } from '../../shared/types';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;

export default function Preview(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<FrameRenderer | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const lastWheelRef = useRef(0);
  const [size, setSize] = useState({ w: 16, h: 9 });
  const [overlay, setOverlay] = useState({ zoom: 1, upscaling: false });
  const [showThirds, setShowThirds] = useState(false);
  const [dragging, setDragging] = useState(false);

  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const selection = useStore((s) => s.selection);

  const editMode = !!selection.shotId && !playing;

  const render = useCallback((): void => {
    const r = rendererRef.current;
    if (!r) {
      return;
    }
    const s = useStore.getState();
    r.renderAt(s.project, s.playhead);
    // Overlay: does the current view upscale the image at export size?
    const loc = sceneAt(s.project, s.playhead);
    const img = loc ? s.project.images.find((i) => i.id === loc.scene.imageId) : undefined;
    if (loc && img) {
      const cam = evaluateCamera(loc.scene, loc.localT);
      const dims = RESOLUTION_DIMS[s.project.settings.resolution];
      const vr = viewRect(img, cam, dims.width, dims.height);
      setOverlay((o) => {
        const next = { zoom: cam.zoom, upscaling: vr.effectiveScale > 1 };
        return o.zoom === next.zoom && o.upscaling === next.upscaling ? o : next;
      });
    } else {
      setOverlay((o) => (o.zoom === 1 && !o.upscaling ? o : { zoom: 1, upscaling: false }));
    }
  }, []);

  // Create / destroy the Pixi renderer once.
  useEffect(() => {
    let cancelled = false;
    void FrameRenderer.create({ width: size.w, height: size.h }).then((r) => {
      if (cancelled) {
        r.destroy();
        return;
      }
      rendererRef.current = r;
      const wrap = wrapRef.current;
      if (wrap) {
        wrap.insertBefore(r.canvas, wrap.firstChild);
      }
      void r.loadImages(useStore.getState().project.images).then(render);
    });
    return () => {
      cancelled = true;
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fit the 16:9 stage to the panel, capped at export resolution.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      const dims = RESOLUTION_DIMS[useStore.getState().project.settings.resolution];
      let w = Math.min(rect.width, (rect.height * 16) / 9);
      w = Math.min(w, dims.width);
      const h = (w * 9) / 16;
      const wInt = Math.max(16, Math.floor(w));
      const hInt = Math.max(9, Math.floor(h));
      setSize((s) => (s.w === wInt && s.h === hInt ? s : { w: wInt, h: hInt }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    rendererRef.current?.resize(size.w, size.h);
    render();
  }, [size, render]);

  // Reload textures when the image list changes, then repaint.
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) {
      return;
    }
    void r.loadImages(project.images).then(render);
  }, [project.images, render]);

  // Repaint on project/playhead changes.
  useEffect(() => {
    render();
  }, [project, playhead, render]);

  // Playback loop: advance the playhead by real elapsed time until the end.
  useEffect(() => {
    if (!playing) {
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const s = useStore.getState();
      const dt = (now - last) / 1000;
      last = now;
      const dur = projectDuration(s.project);
      const t = Math.min(s.playhead + dt, dur);
      s.setPlayhead(t);
      if (t >= dur) {
        s.setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const selectedShot = (): { sceneId: string; shot: Shot; imageId: string } | null => {
    const s = useStore.getState();
    const scene = s.project.scenes.find((sc) => sc.id === s.selection.sceneId);
    const shot = scene?.shots.find((sh) => sh.id === s.selection.shotId);
    if (!scene || !shot) {
      return null;
    }
    return { sceneId: scene.id, shot, imageId: scene.imageId };
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    if (!editMode || !selectedShot()) {
      return;
    }
    const s = useStore.getState();
    const sel = selectedShot();
    if (!sel) {
      return;
    }
    // Snap to the end of the shot's move so the preview shows exactly its camera.
    const scene = s.project.scenes.find((sc) => sc.id === sel.sceneId);
    const idx = scene ? scene.shots.findIndex((sh) => sh.id === sel.shot.id) : -1;
    if (scene && idx >= 0) {
      s.setPlayhead(shotStartTime(s.project, sel.sceneId, sel.shot.id) + effectiveMove(scene.shots[idx], idx));
    }
    s.pushUndo();
    dragRef.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const drag = dragRef.current;
    const sel = selectedShot();
    if (!drag || !sel) {
      return;
    }
    const s = useStore.getState();
    const img = s.project.images.find((i) => i.id === sel.imageId);
    if (!img) {
      return;
    }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    const scale = viewRect(img, sel.shot.camera, size.w, size.h).effectiveScale;
    if (scale <= 0) {
      return;
    }
    const cam = sel.shot.camera;
    s.updateShot(
      sel.sceneId,
      sel.shot.id,
      {
        camera: { cx: cam.cx - dx / (scale * img.width), cy: cam.cy - dy / (scale * img.height), zoom: cam.zoom },
      },
      false,
    );
  };

  const endDrag = (): void => {
    dragRef.current = null;
    setDragging(false);
  };

  // Wheel zoom (non-passive so we can preventDefault), one undo per burst.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) {
      return;
    }
    const onWheel = (e: WheelEvent): void => {
      const s = useStore.getState();
      const sel = selectedShot();
      if (!sel || s.playing) {
        return;
      }
      e.preventDefault();
      const now = performance.now();
      if (now - lastWheelRef.current > 400) {
        s.pushUndo();
      }
      lastWheelRef.current = now;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const cam = sel.shot.camera;
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
      s.updateShot(sel.sceneId, sel.shot.id, { camera: { ...cam, zoom } }, false);
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
  }, [editMode]);

  return (
    <div className={`preview${editMode ? ' edit-mode' : ''}${dragging ? ' dragging' : ''}`} ref={containerRef}>
      <div
        className="stage-wrap"
        ref={wrapRef}
        style={{ position: 'relative', width: size.w, height: size.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {showThirds && (
          <div className="thirds">
            <div className="v" style={{ left: '33.33%' }} />
            <div className="v" style={{ left: '66.66%' }} />
            <div className="h" style={{ top: '33.33%' }} />
            <div className="h" style={{ top: '66.66%' }} />
          </div>
        )}
      </div>
      <div className="overlay-label">
        zoom {overlay.zoom.toFixed(2)}×{overlay.upscaling && <span className="warn"> · upscaling</span>}
      </div>
      <button
        className="grid-toggle icon-btn"
        title="Rule of thirds"
        onClick={() => setShowThirds((v) => !v)}
      >
        ▦
      </button>
    </div>
  );
}
