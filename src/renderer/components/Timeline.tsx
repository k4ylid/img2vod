import { useRef } from 'react';
import { useStore } from '../store';
import { effectiveMove, projectDuration, sceneDuration, shotDuration } from '../../shared/engine';

function fmtTime(t: number, fps: number): string {
  const clamped = Math.max(0, t);
  const m = Math.floor(clamped / 60);
  const s = Math.floor(clamped % 60);
  const f = Math.floor((clamped - Math.floor(clamped)) * fps);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}

export default function Timeline(): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ downX: number; moved: boolean; sceneId?: string; shotId?: string } | null>(null);
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const selection = useStore((s) => s.selection);
  const exporting = useStore((s) => s.exporting);
  const { setPlaying, setPlayhead, selectShot } = useStore.getState();

  const total = Math.max(projectDuration(project), 1e-6);
  const fps = project.settings.fps;

  const timeAt = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) {
      return 0;
    }
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return frac * total;
  };

  /** Scene/shot under global time t (for click-to-select). */
  const shotAt = (t: number): { sceneId: string; shotId: string } | null => {
    let cursor = 0;
    for (const scene of project.scenes) {
      const sd = sceneDuration(scene);
      if (t < cursor + sd) {
        let inner = 0;
        for (const shot of scene.shots) {
          const d = shotDuration(shot);
          if (t < cursor + inner + d) {
            return { sceneId: scene.id, shotId: shot.id };
          }
          inner += d;
        }
        const last = scene.shots[scene.shots.length - 1];
        return last ? { sceneId: scene.id, shotId: last.id } : { sceneId: scene.id, shotId: '' };
      }
      cursor += sd;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    if (exporting) {
      return;
    }
    const hit = shotAt(timeAt(e.clientX));
    dragRef.current = { downX: e.clientX, moved: false, sceneId: hit?.sceneId, shotId: hit?.shotId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setPlaying(false);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    if (Math.abs(e.clientX - drag.downX) > 3) {
      drag.moved = true;
    }
    if (drag.moved) {
      setPlayhead(timeAt(e.clientX));
    }
  };

  const onPointerUp = (e: React.PointerEvent): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) {
      return;
    }
    if (drag.moved) {
      setPlayhead(timeAt(e.clientX));
    } else if (drag.shotId) {
      selectShot(drag.sceneId, drag.shotId);
    }
  };

  return (
    <div className="timeline">
      <div className="transport">
        <button
          className="icon-btn"
          title="Jump to start"
          disabled={exporting}
          onClick={() => {
            setPlaying(false);
            setPlayhead(0);
          }}
        >
          ⏮
        </button>
        <button
          className="icon-btn"
          title="Play / pause (Space)"
          disabled={exporting || project.scenes.length === 0}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button
          className="icon-btn"
          title="Jump to end"
          disabled={exporting}
          onClick={() => {
            setPlaying(false);
            setPlayhead(total);
          }}
        >
          ⏭
        </button>
        <span className="time">
          {fmtTime(playhead, fps)} / {fmtTime(total, fps)}
        </span>
      </div>
      <div
        className="track"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (dragRef.current = null)}
      >
        {project.scenes.map((scene) => {
          const sd = sceneDuration(scene);
          if (sd <= 0) {
            return null;
          }
          return (
            <div className="scene-block" key={scene.id} style={{ width: `${(sd / total) * 100}%` }}>
              {scene.shots.map((shot, i) => {
                const dur = shotDuration(shot);
                if (dur <= 0) {
                  return null;
                }
                const move = effectiveMove(shot, i);
                return (
                  <div
                    key={shot.id}
                    className={`shot-block${selection.shotId === shot.id ? ' selected' : ''}`}
                    style={{ width: `${(dur / sd) * 100}%` }}
                    title={shot.name}
                  >
                    <div className="part-move" style={{ width: `${(move / dur) * 100}%` }} />
                    <div className="part-hold" style={{ flex: 1 }} />
                  </div>
                );
              })}
            </div>
          );
        })}
        <div className="playhead-line" style={{ left: `${(playhead / total) * 100}%` }} />
      </div>
    </div>
  );
}
