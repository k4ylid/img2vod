import { Application, Sprite, Texture, type WebGLRenderer } from 'pixi.js';
import type { ImageAsset, Project } from '../../shared/types';
import { evaluateCamera, sceneAt, viewRect } from '../../shared/engine';

/** Converts an absolute filesystem path into a fvod-file:// URL (same encoding as fileToFvodUrl in main). */
export function toFvodUrl(filePath: string): string {
  const withSlashes = filePath.replace(/\\/g, '/');
  const prefixed = withSlashes.startsWith('/') ? withSlashes : `/${withSlashes}`;
  return `fvod-file://${encodeURI(prefixed).replace(/[?#]/g, (c) => encodeURIComponent(c))}`;
}

interface CreateOptions {
  width: number;
  height: number;
  canvas?: HTMLCanvasElement;
}

/**
 * The single Pixi renderer shared by preview and export: positions one
 * full-image sprite so that the camera's viewRect fills the frame, over black.
 */
export class FrameRenderer {
  private app: Application;
  private sprite: Sprite;
  private textures = new Map<string, Texture>();
  private failed = new Set<string>();
  private width: number;
  private height: number;

  private constructor(app: Application, width: number, height: number) {
    this.app = app;
    this.width = width;
    this.height = height;
    this.sprite = new Sprite();
    this.sprite.visible = false;
    app.stage.addChild(this.sprite);
    app.stop();
  }

  static async create(opts: CreateOptions): Promise<FrameRenderer> {
    const app = new Application();
    await app.init({
      width: Math.max(1, Math.round(opts.width)),
      height: Math.max(1, Math.round(opts.height)),
      canvas: opts.canvas,
      preference: 'webgl',
      antialias: true,
      autoDensity: false,
      resolution: 1,
      backgroundColor: 0x000000,
      preserveDrawingBuffer: true,
    });
    return new FrameRenderer(app, Math.max(1, Math.round(opts.width)), Math.max(1, Math.round(opts.height)));
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas as HTMLCanvasElement;
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === this.width && h === this.height) {
      return;
    }
    this.width = w;
    this.height = h;
    this.app.renderer.resize(w, h);
  }

  /** Caches a Texture per image id; images that fail to load render as black. */
  async loadImages(images: ImageAsset[]): Promise<void> {
    const keep = new Set(images.map((i) => i.id));
    for (const [id, tex] of this.textures) {
      if (!keep.has(id)) {
        tex.destroy(true);
        this.textures.delete(id);
      }
    }
    this.failed = new Set([...this.failed].filter((id) => keep.has(id)));

    const jobs = images
      .filter((img) => !this.textures.has(img.id) && !this.failed.has(img.id))
      .map(async (img) => {
        try {
          const el = new Image();
          el.crossOrigin = 'anonymous';
          el.src = toFvodUrl(img.path);
          await el.decode();
          const tex = Texture.from(el);
          tex.source.scaleMode = 'linear';
          tex.source.autoGenerateMipmaps = true;
          this.textures.set(img.id, tex);
        } catch {
          this.failed.add(img.id);
        }
      });
    await Promise.all(jobs);
  }

  renderAt(project: Project, t: number): void {
    const loc = sceneAt(project, t);
    const img = loc ? project.images.find((i) => i.id === loc.scene.imageId) : undefined;
    const tex = img ? this.textures.get(img.id) : undefined;
    if (!loc || !img || !tex) {
      this.sprite.visible = false;
      this.app.render();
      return;
    }
    const cam = evaluateCamera(loc.scene, loc.localT);
    const vr = viewRect(img, cam, this.width, this.height);
    this.sprite.texture = tex;
    this.sprite.visible = true;
    this.sprite.scale.set(vr.effectiveScale);
    this.sprite.position.set(-vr.x * vr.effectiveScale, -vr.y * vr.effectiveScale);
    this.app.render();
  }

  /** RGBA, top-down rows, exactly width*height*4 bytes, of the last rendered frame. */
  readPixels(): Uint8Array {
    const gl = (this.app.renderer as WebGLRenderer).gl;
    const w = this.width;
    const h = this.height;
    const row = w * 4;
    const raw = new Uint8Array(row * h);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    // WebGL readPixels returns rows bottom-up; flip to top-down for ffmpeg.
    const out = new Uint8Array(row * h);
    for (let y = 0; y < h; y++) {
      out.set(raw.subarray(y * row, (y + 1) * row), (h - 1 - y) * row);
    }
    return out;
  }

  destroy(): void {
    for (const tex of this.textures.values()) {
      tex.destroy(true);
    }
    this.textures.clear();
    this.failed.clear();
    this.app.destroy({ removeView: true }, { children: true });
  }
}
