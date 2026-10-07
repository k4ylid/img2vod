import { useStore } from '../store';
import { FPS_OPTIONS, RESOLUTION_DIMS, type Fps, type Resolution } from '../../shared/types';
import { projectDuration } from '../../shared/engine';

function fmtDuration(t: number): string {
  return `${t.toFixed(1)}s`;
}

export default function TopBar(props: { onExport: () => void; onOpen: () => void }): React.JSX.Element {
  const name = useStore((s) => s.project.name);
  const settings = useStore((s) => s.project.settings);
  const sceneCount = useStore((s) => s.project.scenes.length);
  const duration = useStore((s) => projectDuration(s.project));
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const exporting = useStore((s) => s.exporting);
  const { setProjectName, updateSettings, undo, redo, newProject, saveProject, confirmDiscardIfDirty } =
    useStore.getState();

  return (
    <div className="topbar">
      <input
        className="name"
        type="text"
        value={name}
        onChange={(e) => setProjectName(e.target.value)}
        disabled={exporting}
      />
      <button
        onClick={() => {
          void confirmDiscardIfDirty().then((ok) => {
            if (ok) {
              newProject();
            }
          });
        }}
        disabled={exporting}
      >
        New
      </button>
      <button onClick={props.onOpen} disabled={exporting}>
        Open
      </button>
      <button onClick={() => void saveProject()} disabled={exporting}>
        Save
      </button>
      <button onClick={() => void saveProject(true)} disabled={exporting}>
        Save As
      </button>
      <button onClick={undo} disabled={!canUndo || exporting} title="Undo (Ctrl+Z)">
        ↺
      </button>
      <button onClick={redo} disabled={!canRedo || exporting} title="Redo (Ctrl+Y)">
        ↻
      </button>
      <span className="spacer" />
      <select
        value={settings.resolution}
        disabled={exporting}
        onChange={(e) => updateSettings({ resolution: e.target.value as Resolution })}
      >
        {(Object.keys(RESOLUTION_DIMS) as Resolution[]).map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <select
        value={settings.fps}
        disabled={exporting}
        onChange={(e) => updateSettings({ fps: Number(e.target.value) as Fps })}
      >
        {FPS_OPTIONS.map((f) => (
          <option key={f} value={f}>
            {f} fps
          </option>
        ))}
      </select>
      <span className="duration">{fmtDuration(duration)}</span>
      <button className="primary" onClick={props.onExport} disabled={exporting || sceneCount === 0}>
        Export
      </button>
    </div>
  );
}
