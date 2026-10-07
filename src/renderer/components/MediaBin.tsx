import { useState } from 'react';
import { useStore } from '../store';
import { toFvodUrl } from '../render/FrameRenderer';

export default function MediaBin(): React.JSX.Element {
  const images = useStore((s) => s.project.images);
  const exporting = useStore((s) => s.exporting);
  const { addImages, addSceneFromImage } = useStore.getState();
  const [missing, setMissing] = useState<Set<string>>(new Set());

  const pick = async (): Promise<void> => {
    const picked = await window.fvod.pickImages();
    if (picked.length > 0) {
      addImages(picked);
    }
  };

  return (
    <div className="mediabin">
      <div className="section-title">
        <span>Media</span>
        <button className="icon-btn" onClick={() => void pick()} disabled={exporting}>
          + Import
        </button>
      </div>
      <div className="thumbs">
        {images.length === 0 && <div className="empty-hint">Import images to get started.</div>}
        {images.map((img) => (
          <div
            key={img.id}
            className="thumb"
            title="Click to add a scene"
            onClick={() => {
              if (!exporting) {
                addSceneFromImage(img.id);
              }
            }}
          >
            <img
              src={toFvodUrl(img.path)}
              alt={img.name}
              onError={() => setMissing((m) => new Set(m).add(img.id))}
              onLoad={() =>
                setMissing((m) => {
                  if (!m.has(img.id)) {
                    return m;
                  }
                  const next = new Set(m);
                  next.delete(img.id);
                  return next;
                })
              }
            />
            <div className="meta">
              <div className="n">
                {img.name}
                {missing.has(img.id) && <span className="badge-missing">missing</span>}
              </div>
              <div className="d">
                {img.width}×{img.height}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
