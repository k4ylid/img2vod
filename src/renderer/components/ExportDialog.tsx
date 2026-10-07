import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { exportFrameCount, projectDuration } from '../../shared/engine';
import { RESOLUTION_DIMS } from '../../shared/types';
import { exportVideo } from '../export/exportVideo';

type Phase =
  | { kind: 'choose' }
  | { kind: 'running'; frame: number; total: number; startedAt: number; outputPath: string }
  | { kind: 'done'; encoder: string; frames: number; outputPath: string }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' };

function fmtSecs(t: number): string {
  if (!Number.isFinite(t) || t < 0) {
    return '—';
  }
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function ExportDialog(props: { onClose: () => void }): React.JSX.Element {
  const project = useStore((s) => s.project);
  const { setExporting } = useStore.getState();
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' });
  const abortRef = useRef<AbortController | null>(null);
  const [, forceTick] = useState(0);

  const dims = RESOLUTION_DIMS[project.settings.resolution];
  const fps = project.settings.fps;
  const duration = projectDuration(project);
  const total = exportFrameCount(duration, fps);

  // Ticks once a second while running so elapsed/ETA refresh.
  useEffect(() => {
    if (phase.kind !== 'running') {
      return;
    }
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [phase.kind]);

  const startExport = async (): Promise<void> => {
    const out = await window.fvod.saveMp4(`${project.name}.mp4`);
    if (!out) {
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = Date.now();
    setExporting(true);
    setPhase({ kind: 'running', frame: 0, total, startedAt, outputPath: out });
    try {
      const result = await exportVideo(useStore.getState().project, out, {
        signal: controller.signal,
        onProgress: (frame, t) =>
          setPhase((p) => (p.kind === 'running' ? { ...p, frame, total: t } : p)),
      });
      setPhase({ kind: 'done', encoder: result.encoder, frames: result.frames, outputPath: out });
    } catch (err) {
      if (controller.signal.aborted) {
        setPhase({ kind: 'cancelled' });
      } else {
        setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      setExporting(false);
      abortRef.current = null;
    }
  };

  const running = phase.kind === 'running' ? phase : null;
  const elapsed = running ? (Date.now() - running.startedAt) / 1000 : 0;
  const pct = running ? (running.frame / Math.max(1, running.total)) * 100 : 0;
  const eta = running && running.frame > 0 ? (elapsed / running.frame) * (running.total - running.frame) : NaN;

  return (
    <div className="modal-backdrop">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Export video</h2>
        <div className="row">
          <span>Resolution</span>
          <b>
            {project.settings.resolution} ({dims.width}×{dims.height})
          </b>
        </div>
        <div className="row">
          <span>Frame rate</span>
          <b>{fps} fps</b>
        </div>
        <div className="row">
          <span>Duration</span>
          <b>{duration.toFixed(2)}s</b>
        </div>
        <div className="row">
          <span>Frames</span>
          <b>{total}</b>
        </div>

        {phase.kind === 'running' && (
          <>
            <div className="progress">
              <div className="bar" style={{ width: `${pct}%` }} />
            </div>
            <div className="row">
              <span>
                Frame {phase.frame} / {phase.total} ({pct.toFixed(0)}%)
              </span>
              <span>
                {fmtSecs(elapsed)} elapsed · ETA {fmtSecs(eta)}
              </span>
            </div>
          </>
        )}
        {phase.kind === 'done' && (
          <p>
            Exported {phase.frames} frames with <b>{phase.encoder}</b> to {phase.outputPath}
          </p>
        )}
        {phase.kind === 'error' && <p className="error-text">{phase.message}</p>}
        {phase.kind === 'cancelled' && <p>Export cancelled.</p>}

        <div className="modal-actions">
          {phase.kind === 'choose' && (
            <>
              <button onClick={props.onClose}>Close</button>
              <button className="primary" onClick={() => void startExport()}>
                Choose file…
              </button>
            </>
          )}
          {phase.kind === 'running' && <button onClick={() => abortRef.current?.abort()}>Cancel</button>}
          {phase.kind === 'done' && (
            <>
              <button onClick={() => void window.fvod.revealInFolder(phase.outputPath)}>Show in folder</button>
              <button className="primary" onClick={props.onClose}>
                Close
              </button>
            </>
          )}
          {(phase.kind === 'error' || phase.kind === 'cancelled') && (
            <button onClick={props.onClose}>Close</button>
          )}
        </div>
      </div>
    </div>
  );
}
