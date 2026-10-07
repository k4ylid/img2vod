import { useStore } from '../store';
import type { Easing, HoldMotion, MoveKind, Shot } from '../../shared/types';
import { EASING_PRESETS, isPreset, projectDuration, sceneDuration, type EasingPresetName } from '../../shared/engine';

const PRESET_NAMES = Object.keys(EASING_PRESETS) as EasingPresetName[];

function presetNameOf(e: Easing): EasingPresetName | 'custom' {
  for (const name of PRESET_NAMES) {
    if (isPreset(e, name)) {
      return name;
    }
  }
  return 'custom';
}

function num(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function EasingEditor(props: { easing: Easing; onChange: (e: Easing) => void }): React.JSX.Element {
  const { easing, onChange } = props;
  const preset = presetNameOf(easing);
  const setComp = (key: 'x1' | 'y1' | 'x2' | 'y2', raw: string, isX: boolean): void => {
    let v = num(raw, easing[key]);
    if (isX) {
      v = Math.min(1, Math.max(0, v));
    }
    onChange({ ...easing, [key]: v });
  };
  return (
    <div>
      <div className="field">
        <label>Easing</label>
        <select
          value={preset}
          onChange={(e) => {
            const v = e.target.value;
            if (v !== 'custom') {
              onChange({ ...EASING_PRESETS[v as EasingPresetName] });
            }
          }}
        >
          {PRESET_NAMES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </div>
      <svg className="curve-preview" viewBox="0 -110 100 115" width="100%" height="70">
        <line x1="0" y1="0" x2="100" y2="0" stroke="#2a3140" strokeWidth="1" />
        <line x1="0" y1="-100" x2="100" y2="-100" stroke="#2a3140" strokeWidth="1" />
        <path
          d={`M 0 0 C ${easing.x1 * 100} ${-easing.y1 * 100}, ${easing.x2 * 100} ${-easing.y2 * 100}, 100 -100`}
          fill="none"
          stroke="#7aa8ff"
          strokeWidth="2"
        />
      </svg>
      {preset === 'custom' && (
        <div className="field-row">
          {(['x1', 'y1', 'x2', 'y2'] as const).map((k) => (
            <div className="field" key={k}>
              <label style={{ width: 'auto' }}>{k}</label>
              <input
                type="number"
                step={0.05}
                min={k === 'x1' || k === 'x2' ? 0 : undefined}
                max={k === 'x1' || k === 'x2' ? 1 : undefined}
                value={easing[k]}
                onChange={(e) => setComp(k, e.target.value, k === 'x1' || k === 'x2')}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

export default function Inspector(): React.JSX.Element {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const exporting = useStore((s) => s.exporting);
  const { updateShot, setAudio, setAudioIncluded } = useStore.getState();

  const pickAudio = async (): Promise<void> => {
    const path = await window.fvod.pickAudio();
    if (path) {
      setAudio(path);
    }
  };

  const scene = project.scenes.find((s) => s.id === selection.sceneId);
  const shotIdx = scene ? scene.shots.findIndex((s) => s.id === selection.shotId) : -1;
  const shot: Shot | undefined = scene && shotIdx >= 0 ? scene.shots[shotIdx] : undefined;

  if (!scene || !shot) {
    return (
      <div className="inspector">
        <h3>Project</h3>
        <div className="field">
          <label>Resolution</label>
          <span>{project.settings.resolution}</span>
        </div>
        <div className="field">
          <label>FPS</label>
          <span>{project.settings.fps}</span>
        </div>
        <div className="field">
          <label>Scenes</label>
          <span>{project.scenes.length}</span>
        </div>
        <div className="field">
          <label>Duration</label>
          <span>{projectDuration(project).toFixed(1)}s</span>
        </div>
        <h3>Audio</h3>
        <div className="field">
          <label>File</label>
          <span className="audio-name" title={project.audio?.path}>
            {project.audio ? baseName(project.audio.path) : 'None'}
          </span>
        </div>
        <div className="field">
          <button disabled={exporting} onClick={() => void pickAudio()}>
            Choose…
          </button>
          {project.audio && (
            <button disabled={exporting} onClick={() => setAudio(null)}>
              Remove
            </button>
          )}
        </div>
        {project.audio && (
          <div className="field">
            <label style={{ width: 'auto' }}>
              <input
                type="checkbox"
                checked={project.audio.includeInExport}
                disabled={exporting}
                onChange={(e) => setAudioIncluded(e.target.checked)}
              />{' '}
              Include in export
            </label>
          </div>
        )}
        <p className="hint">
          Select a shot in the scene list or on the timeline to edit its camera, move, and hold.
          Drag on the preview to pan; use the mouse wheel to zoom.
        </p>
      </div>
    );
  }

  const sceneIndex = project.scenes.indexOf(scene);
  const sceneStart = project.scenes.slice(0, sceneIndex).reduce((a, s) => a + sceneDuration(s), 0);
  const isFirst = shotIdx === 0;
  const update = (partial: Partial<Shot>): void => updateShot(scene.id, shot.id, partial);
  const hm: HoldMotion = shot.holdMotion;

  return (
    <div className="inspector">
      <h3>
        Shot — Scene {sceneIndex + 1} @ {sceneStart.toFixed(1)}s
      </h3>
      <div className="field">
        <label>Name</label>
        <input
          type="text"
          value={shot.name}
          disabled={exporting}
          onChange={(e) => update({ name: e.target.value })}
        />
      </div>
      <div className="field">
        <label>Move (s)</label>
        <input
          type="number"
          min={0}
          step={0.1}
          value={shot.move}
          disabled={exporting || isFirst}
          onChange={(e) => update({ move: Math.max(0, num(e.target.value, shot.move)) })}
        />
      </div>
      {isFirst && <p className="hint">The first shot of a scene does not travel; its move time is ignored.</p>}
      <div className="field">
        <label>Hold (s)</label>
        <input
          type="number"
          min={0}
          step={0.1}
          value={shot.hold}
          disabled={exporting}
          onChange={(e) => update({ hold: Math.max(0, num(e.target.value, shot.hold)) })}
        />
      </div>
      <div className="field">
        <label>Move kind</label>
        <select
          value={shot.moveKind}
          disabled={exporting}
          onChange={(e) => update({ moveKind: e.target.value as MoveKind })}
        >
          <option value="cut">cut</option>
          <option value="direct">direct</option>
          <option value="arc">arc</option>
        </select>
      </div>
      {shot.moveKind === 'arc' && (
        <div className="field">
          <label>Arc zoom</label>
          <input
            type="number"
            min={0.1}
            step={0.05}
            placeholder="default"
            value={shot.arcZoom ?? ''}
            disabled={exporting}
            onChange={(e) => update({ arcZoom: e.target.value === '' ? undefined : Math.max(0.1, num(e.target.value, 1)) })}
          />
        </div>
      )}
      <EasingEditor easing={shot.easing} onChange={(easing) => update({ easing })} />
      <div className="field">
        <label>Hold motion</label>
        <select
          value={hm.type}
          disabled={exporting}
          onChange={(e) => {
            const t = e.target.value as HoldMotion['type'];
            update({ holdMotion: t === 'none' ? { type: 'none' } : { type: t, amount: t === 'microPush' ? 0.05 : 0.01 } });
          }}
        >
          <option value="none">none</option>
          <option value="microPush">microPush</option>
          <option value="drift">drift</option>
        </select>
        {hm.type !== 'none' && (
          <input
            type="number"
            min={0}
            step={0.01}
            value={hm.amount}
            disabled={exporting}
            onChange={(e) => update({ holdMotion: { type: hm.type, amount: Math.max(0, num(e.target.value, hm.amount)) } })}
          />
        )}
      </div>
      <h3>Camera</h3>
      <div className="field-row">
        <div className="field">
          <label style={{ width: 'auto' }}>cx</label>
          <input
            type="number"
            step={0.01}
            value={shot.camera.cx}
            disabled={exporting}
            onChange={(e) => update({ camera: { ...shot.camera, cx: num(e.target.value, shot.camera.cx) } })}
          />
        </div>
        <div className="field">
          <label style={{ width: 'auto' }}>cy</label>
          <input
            type="number"
            step={0.01}
            value={shot.camera.cy}
            disabled={exporting}
            onChange={(e) => update({ camera: { ...shot.camera, cy: num(e.target.value, shot.camera.cy) } })}
          />
        </div>
        <div className="field">
          <label style={{ width: 'auto' }}>zoom</label>
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={shot.camera.zoom}
            disabled={exporting}
            onChange={(e) => update({ camera: { ...shot.camera, zoom: Math.max(0.1, num(e.target.value, shot.camera.zoom)) } })}
          />
        </div>
      </div>
      <div className="field">
        <button disabled={exporting} onClick={() => update({ camera: { cx: 0.5, cy: 0.5, zoom: 1 } })}>
          Reset to fit
        </button>
      </div>
      <div className="field">
        <label style={{ width: 'auto' }}>
          <input
            type="checkbox"
            checked={shot.motionBlur}
            disabled={exporting}
            onChange={(e) => update({ motionBlur: e.target.checked })}
          />{' '}
          Motion blur <span className="hint">(export only)</span>
        </label>
      </div>
    </div>
  );
}
