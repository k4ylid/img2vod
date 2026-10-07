import { create } from 'zustand';
import type { Camera, ImageAsset, Project, ProjectSettings, Scene, Shot } from '../shared/types';
import type { ImportedImage } from '../shared/api';
import {
  EASING_PRESETS,
  effectiveMove,
  evaluateCamera,
  sceneDuration,
  shotDuration,
} from '../shared/engine';

const UNDO_CAP = 100;

export interface Selection {
  sceneId?: string;
  shotId?: string;
}

interface StoreState {
  project: Project;
  selection: Selection;
  playhead: number;
  playing: boolean;
  exporting: boolean;
  projectPath: string | null;
  dirty: boolean;
  past: Project[];
  future: Project[];

  setPlayhead: (t: number) => void;
  setPlaying: (playing: boolean) => void;
  setExporting: (exporting: boolean) => void;
  selectShot: (sceneId: string | undefined, shotId: string | undefined) => void;
  selectScene: (sceneId: string | undefined) => void;
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;

  addImages: (images: ImportedImage[]) => void;
  addSceneFromImage: (imageId: string) => void;
  removeImage: (imageId: string) => void;
  removeScene: (sceneId: string) => void;
  moveScene: (sceneId: string, dir: -1 | 1) => void;
  addShot: (sceneId: string) => void;
  duplicateShot: (sceneId: string, shotId: string) => void;
  removeShot: (sceneId: string, shotId: string) => void;
  moveShot: (sceneId: string, shotId: string, dir: -1 | 1) => void;
  updateShot: (sceneId: string, shotId: string, partial: Partial<Shot>, history?: boolean) => void;
  updateSettings: (partial: Partial<ProjectSettings>) => void;
  setProjectName: (name: string) => void;
  setAudio: (path: string | null) => void;
  setAudioIncluded: (include: boolean) => void;

  confirmDiscardIfDirty: () => Promise<boolean>;
  saveProject: (saveAs?: boolean) => Promise<void>;
  openProject: () => Promise<string | null>;
  newProject: () => void;
  loadProject: (project: Project, path: string | null) => void;
}

export function createDefaultProject(): Project {
  return {
    version: 1,
    name: 'Untitled',
    settings: { resolution: '1080p', fps: 30 },
    images: [],
    scenes: [],
    markers: [],
  };
}

function defaultSceneShot(): Shot {
  return {
    id: crypto.randomUUID(),
    name: 'Shot 1',
    move: 0,
    hold: 3,
    camera: { cx: 0.5, cy: 0.5, zoom: 1 },
    moveKind: 'direct',
    easing: { ...EASING_PRESETS.smooth },
    holdMotion: { type: 'microPush', amount: 0.05 },
    motionBlur: false,
  };
}

function makeScene(image: ImageAsset): Scene {
  return { id: crypto.randomUUID(), imageId: image.id, shots: [defaultSceneShot()] };
}

/** Global start time (seconds) of a shot's move phase. */
export function shotStartTime(project: Project, sceneId: string, shotId: string): number {
  let t = 0;
  for (const scene of project.scenes) {
    if (scene.id !== sceneId) {
      t += sceneDuration(scene);
      continue;
    }
    for (const shot of scene.shots) {
      if (shot.id === shotId) {
        return t;
      }
      t += shotDuration(shot);
    }
    return t;
  }
  return t;
}

function cloneProject(p: Project): Project {
  return structuredClone(p);
}

export const useStore = create<StoreState>((set, get) => {
  /** Applies fn to a clone of the project; pushes undo unless history === false. */
  const mutate = (fn: (p: Project) => void, history = true): void => {
    const { project, past } = get();
    const next = cloneProject(project);
    fn(next);
    set({
      project: next,
      past: history ? [...past.slice(-(UNDO_CAP - 1)), cloneProject(project)] : past,
      future: history ? [] : get().future,
      dirty: true,
    });
  };

  const sceneIndexOf = (p: Project, sceneId: string): number => p.scenes.findIndex((s) => s.id === sceneId);

  return {
    project: createDefaultProject(),
    selection: {},
    playhead: 0,
    playing: false,
    exporting: false,
    projectPath: null,
    dirty: false,
    past: [],
    future: [],

    setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
    setPlaying: (playing) => set({ playing }),
    setExporting: (exporting) => set({ exporting }),

    selectShot: (sceneId, shotId) => {
      const { project, playing } = get();
      set({ selection: { sceneId, shotId }, playing: false });
      if (sceneId && shotId && !playing) {
        const scene = project.scenes.find((s) => s.id === sceneId);
        const idx = scene ? scene.shots.findIndex((s) => s.id === shotId) : -1;
        if (scene && idx >= 0) {
          const start = shotStartTime(project, sceneId, shotId);
          const move = effectiveMove(scene.shots[idx], idx);
          set({ playhead: start + move });
        }
      }
    },

    selectScene: (sceneId) => set({ selection: { sceneId, shotId: undefined } }),

    pushUndo: () => {
      const { project, past } = get();
      set({ past: [...past.slice(-(UNDO_CAP - 1)), cloneProject(project)], future: [] });
    },

    undo: () => {
      const { project, past, future } = get();
      const prev = past[past.length - 1];
      if (!prev) {
        return;
      }
      const sel = get().selection;
      const stillThere = sel.sceneId && project.scenes.some((s) => s.id === sel.sceneId);
      set({
        project: prev,
        past: past.slice(0, -1),
        future: [cloneProject(project), ...future],
        dirty: true,
        selection: stillThere ? sel : {},
      });
    },

    redo: () => {
      const { project, past, future } = get();
      const next = future[0];
      if (!next) {
        return;
      }
      set({ project: next, past: [...past, cloneProject(project)], future: future.slice(1), dirty: true });
    },

    addImages: (images) => {
      if (images.length === 0) {
        return;
      }
      mutate((p) => {
        for (const img of images) {
          const asset: ImageAsset = {
            id: crypto.randomUUID(),
            path: img.path,
            name: img.name,
            width: img.width,
            height: img.height,
          };
          p.images.push(asset);
          p.scenes.push(makeScene(asset));
        }
      });
    },

    addSceneFromImage: (imageId) => {
      mutate((p) => {
        const img = p.images.find((i) => i.id === imageId);
        if (img) {
          p.scenes.push(makeScene(img));
        }
      });
    },

    removeImage: (imageId) => {
      const sel = get().selection;
      const selectedRemoved =
        sel.sceneId !== undefined &&
        get().project.scenes.some((s) => s.id === sel.sceneId && s.imageId === imageId);
      if (selectedRemoved) {
        set({ selection: {} });
      }
      mutate((p) => {
        p.images = p.images.filter((i) => i.id !== imageId);
        p.scenes = p.scenes.filter((s) => s.imageId !== imageId);
      });
    },

    removeScene: (sceneId) => {
      const sel = get().selection;
      if (sel.sceneId === sceneId) {
        set({ selection: {} });
      }
      mutate((p) => {
        p.scenes = p.scenes.filter((s) => s.id !== sceneId);
      });
    },

    moveScene: (sceneId, dir) => {
      mutate((p) => {
        const i = sceneIndexOf(p, sceneId);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= p.scenes.length) {
          return;
        }
        [p.scenes[i], p.scenes[j]] = [p.scenes[j], p.scenes[i]];
      });
    },

    addShot: (sceneId) => {
      const { project, playhead } = get();
      const scene = project.scenes.find((s) => s.id === sceneId);
      if (!scene) {
        return;
      }
      const start = project.scenes.slice(0, sceneIndexOf(project, sceneId)).reduce((a, s) => a + sceneDuration(s), 0);
      const dur = sceneDuration(scene);
      let camera: Camera;
      if (playhead >= start && playhead < start + dur) {
        camera = { ...evaluateCamera(scene, playhead - start) };
      } else {
        camera = { ...(scene.shots[scene.shots.length - 1]?.camera ?? { cx: 0.5, cy: 0.5, zoom: 1 }) };
      }
      const shot: Shot = {
        id: crypto.randomUUID(),
        name: `Shot ${scene.shots.length + 1}`,
        move: 2,
        hold: 1.5,
        camera,
        moveKind: 'direct',
        easing: { ...EASING_PRESETS.smooth },
        holdMotion: { type: 'none' },
        motionBlur: false,
      };
      mutate((p) => {
        const sc = p.scenes.find((s) => s.id === sceneId);
        if (sc) {
          sc.shots.push(shot);
        }
      });
      get().selectShot(sceneId, shot.id);
    },

    duplicateShot: (sceneId, shotId) => {
      let newId: string | null = null;
      mutate((p) => {
        const sc = p.scenes.find((s) => s.id === sceneId);
        if (!sc) {
          return;
        }
        const i = sc.shots.findIndex((s) => s.id === shotId);
        if (i < 0) {
          return;
        }
        const copy: Shot = { ...structuredClone(sc.shots[i]), id: crypto.randomUUID(), name: `${sc.shots[i].name} copy` };
        sc.shots.splice(i + 1, 0, copy);
        newId = copy.id;
      });
      if (newId) {
        get().selectShot(sceneId, newId);
      }
    },

    removeShot: (sceneId, shotId) => {
      const sel = get().selection;
      if (sel.shotId === shotId) {
        set({ selection: {} });
      }
      mutate((p) => {
        const sc = p.scenes.find((s) => s.id === sceneId);
        if (!sc) {
          return;
        }
        sc.shots = sc.shots.filter((s) => s.id !== shotId);
        // A scene is never left with 0 shots: removing the last shot removes the scene.
        if (sc.shots.length === 0) {
          p.scenes = p.scenes.filter((s) => s.id !== sceneId);
        }
      });
    },

    moveShot: (sceneId, shotId, dir) => {
      mutate((p) => {
        const sc = p.scenes.find((s) => s.id === sceneId);
        if (!sc) {
          return;
        }
        const i = sc.shots.findIndex((s) => s.id === shotId);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= sc.shots.length) {
          return;
        }
        [sc.shots[i], sc.shots[j]] = [sc.shots[j], sc.shots[i]];
      });
    },

    updateShot: (sceneId, shotId, partial, history = true) => {
      mutate((p) => {
        const sc = p.scenes.find((s) => s.id === sceneId);
        const shot = sc?.shots.find((s) => s.id === shotId);
        if (shot) {
          Object.assign(shot, partial);
        }
      }, history);
    },

    updateSettings: (partial) => {
      mutate((p) => {
        Object.assign(p.settings, partial);
      });
    },

    setProjectName: (name) => {
      mutate((p) => {
        p.name = name;
      });
    },

    setAudio: (path) => {
      mutate((p) => {
        if (path === null) {
          delete p.audio;
        } else {
          p.audio = { path, includeInExport: true };
        }
      });
    },

    setAudioIncluded: (include) => {
      if (!get().project.audio) {
        return;
      }
      mutate((p) => {
        if (p.audio) {
          p.audio.includeInExport = include;
        }
      });
    },

    confirmDiscardIfDirty: async () => {
      if (!get().dirty) {
        return true;
      }
      const choice = await window.fvod.confirmDiscard();
      if (choice === 'cancel') {
        return false;
      }
      if (choice === 'discard') {
        return true;
      }
      await get().saveProject();
      return !get().dirty;
    },

    saveProject: async (saveAs = false) => {
      const { project, projectPath } = get();
      const path = await window.fvod.saveProject(JSON.stringify(project, null, 2), saveAs ? null : projectPath);
      if (path) {
        set({ projectPath: path, dirty: false });
      }
    },

    openProject: async () => {
      const result = await window.fvod.openProject();
      if (!result) {
        return null;
      }
      try {
        const parsed = JSON.parse(result.json) as Project;
        if (parsed.version !== 1 || !Array.isArray(parsed.images) || !Array.isArray(parsed.scenes)) {
          return 'Not a valid FrameVOD project file.';
        }
        get().loadProject(parsed, result.path);
        return null;
      } catch {
        return 'Could not read that file (invalid JSON).';
      }
    },

    newProject: () => {
      set({ project: createDefaultProject(), selection: {}, playhead: 0, playing: false, projectPath: null, dirty: false, past: [], future: [] });
    },

    loadProject: (project, path) => {
      set({ project, projectPath: path, selection: {}, playhead: 0, playing: false, dirty: false, past: [], future: [] });
    },
  };
});
