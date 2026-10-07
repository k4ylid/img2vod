import { useStore } from '../store';
import { sceneDuration, shotDuration } from '../../shared/engine';
import { toFvodUrl } from '../render/FrameRenderer';

export default function SceneList(): React.JSX.Element {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const exporting = useStore((s) => s.exporting);
  const { selectScene, selectShot, removeScene, moveScene, addShot, duplicateShot, removeShot, moveShot } =
    useStore.getState();

  const imageOf = (imageId: string) => project.images.find((i) => i.id === imageId);

  return (
    <div className="scenelist">
      <div className="section-title">
        <span>Scenes</span>
      </div>
      {project.scenes.length === 0 && <div className="empty-hint">Click an image in Media to add a scene.</div>}
      {project.scenes.map((scene, si) => {
        const img = imageOf(scene.imageId);
        return (
          <div className="scene" key={scene.id}>
            <div
              className={`scene-head${selection.sceneId === scene.id && !selection.shotId ? ' selected' : ''}`}
              onClick={() => selectScene(scene.id)}
            >
              {img && <img src={toFvodUrl(img.path)} alt="" />}
              <div className="t">
                <div className="n">
                  Scene {si + 1}
                  {img ? ` — ${img.name}` : ' — missing image'}
                </div>
                <div className="d">{sceneDuration(scene).toFixed(1)}s</div>
              </div>
              <button
                className="icon-btn"
                title="Move up"
                disabled={exporting || si === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  moveScene(scene.id, -1);
                }}
              >
                ↑
              </button>
              <button
                className="icon-btn"
                title="Move down"
                disabled={exporting || si === project.scenes.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  moveScene(scene.id, 1);
                }}
              >
                ↓
              </button>
              <button
                className="icon-btn"
                title="Delete scene"
                disabled={exporting}
                onClick={(e) => {
                  e.stopPropagation();
                  removeScene(scene.id);
                }}
              >
                ×
              </button>
            </div>
            <div className="shots">
              {scene.shots.map((shot, i) => (
                <div
                  key={shot.id}
                  className={`shot${selection.shotId === shot.id ? ' selected' : ''}`}
                  onClick={() => selectShot(scene.id, shot.id)}
                >
                  <span className="n">{shot.name}</span>
                  <span className="kind">{shot.moveKind}</span>
                  <span className="d">{shotDuration(shot).toFixed(1)}s</span>
                  <button
                    className="icon-btn"
                    title="Move shot up"
                    disabled={exporting || i === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveShot(scene.id, shot.id, -1);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    className="icon-btn"
                    title="Move shot down"
                    disabled={exporting || i === scene.shots.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveShot(scene.id, shot.id, 1);
                    }}
                  >
                    ↓
                  </button>
                  <button
                    className="icon-btn"
                    title="Duplicate shot"
                    disabled={exporting}
                    onClick={(e) => {
                      e.stopPropagation();
                      duplicateShot(scene.id, shot.id);
                    }}
                  >
                    ⧉
                  </button>
                  <button
                    className="icon-btn"
                    title="Delete shot"
                    disabled={exporting}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeShot(scene.id, shot.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="scene-actions">
              <button className="icon-btn" disabled={exporting} onClick={() => addShot(scene.id)}>
                + Shot
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
