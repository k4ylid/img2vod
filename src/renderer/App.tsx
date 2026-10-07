import { useEffect, useState } from 'react';
import { useStore } from './store';
import TopBar from './components/TopBar';
import MediaBin from './components/MediaBin';
import SceneList from './components/SceneList';
import Preview from './components/Preview';
import Timeline from './components/Timeline';
import Inspector from './components/Inspector';
import ExportDialog from './components/ExportDialog';

export default function App(): React.JSX.Element {
  const projectName = useStore((s) => s.project.name);
  const dirty = useStore((s) => s.dirty);
  const [showExport, setShowExport] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${projectName}${dirty ? ' *' : ''} - FrameVOD`;
  }, [projectName, dirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement;
      if (el.closest('input, select, textarea') || el.isContentEditable) {
        return;
      }
      const s = useStore.getState();
      if (s.exporting) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        s.setPlaying(!s.playing);
      } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        s.undo();
      } else if ((e.ctrlKey && e.key.toLowerCase() === 'y') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        s.redo();
      } else if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void s.saveProject();
      } else if (e.key === 'Delete' && s.selection.shotId && s.selection.sceneId) {
        s.removeShot(s.selection.sceneId, s.selection.shotId);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const step = 1 / s.project.settings.fps;
        s.setPlaying(false);
        s.setPlayhead(s.playhead + (e.key === 'ArrowRight' ? step : -step));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openProject = async (): Promise<void> => {
    const err = await useStore.getState().openProject();
    setOpenError(err);
  };

  return (
    <div className="app">
      <TopBar onExport={() => setShowExport(true)} onOpen={() => void openProject()} />
      <div className="app-body">
        <aside className="panel left">
          <MediaBin />
          <SceneList />
        </aside>
        <main className="center">
          <Preview />
          <Timeline />
        </main>
        <aside className="panel right">
          <Inspector />
        </aside>
      </div>
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
      {openError && (
        <div className="modal-backdrop" onClick={() => setOpenError(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Open project</h2>
            <p>{openError}</p>
            <div className="modal-actions">
              <button onClick={() => setOpenError(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
