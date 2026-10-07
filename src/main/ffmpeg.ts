import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import * as fs from 'node:fs';
import { once } from 'node:events';
import ffmpegStatic from 'ffmpeg-static';

export type EncoderName = 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'libx264';

const HW_ENCODERS: EncoderName[] = ['h264_nvenc', 'h264_qsv', 'h264_amf'];

export function isHardwareEncoder(enc: string): boolean {
  return enc !== 'libx264';
}

function ffmpegBin(): string {
  if (!ffmpegStatic) {
    throw new Error('ffmpeg-static binary not found');
  }
  // When packaged, the binary lives in the unpacked asar directory.
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
}

export function encoderArgs(enc: EncoderName): string[] {
  switch (enc) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '19', '-b:v', '0'];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-global_quality', '20'];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '20'];
    case 'libx264':
    default:
      return ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18'];
  }
}

function runProbe(args: string[], timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let proc: ChildProcess;
    try {
      proc = spawn(ffmpegBin(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve(false);
    }, timeoutMs);
    proc.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

let detectedEncoder: Promise<EncoderName> | null = null;

/** Probes HW encoders once (cached); falls back to libx264. */
export function detectEncoder(): Promise<EncoderName> {
  if (!detectedEncoder) {
    detectedEncoder = (async () => {
      for (const enc of HW_ENCODERS) {
        const ok = await runProbe(
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-f',
            'lavfi',
            '-i',
            'color=c=black:s=256x256:d=0.1',
            '-frames:v',
            '1',
            ...encoderArgs(enc),
            '-f',
            'null',
            '-',
          ],
          15_000,
        );
        if (ok) {
          console.log(`[fvod] encoder detected: ${enc}`);
          return enc;
        }
        console.log(`[fvod] encoder probe failed: ${enc}`);
      }
      console.log('[fvod] encoder detected: libx264 (fallback)');
      return 'libx264';
    })();
  }
  return detectedEncoder;
}

export interface ExportOptions {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  encoder: EncoderName;
  audioPath?: string;
}

export class ExportSession {
  readonly encoder: EncoderName;
  readonly outputPath: string;
  private proc: ChildProcessByStdio<Writable, null, Readable>;
  private stderrChunks: string[] = [];
  private ended = false;

  constructor(opts: ExportOptions) {
    this.encoder = opts.encoder;
    this.outputPath = opts.outputPath;

    const args: string[] = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-s',
      `${opts.width}x${opts.height}`,
      '-r',
      String(opts.fps),
      '-i',
      'pipe:0',
    ];
    if (opts.audioPath) {
      args.push('-i', opts.audioPath, '-map', '0:v:0', '-map', '1:a:0');
    }
    args.push(...encoderArgs(opts.encoder));
    if (opts.audioPath) {
      // apad pads audio shorter than the video with silence; -shortest then
      // trims it at the video end, so the frame count always sets the length.
      args.push('-c:a', 'aac', '-b:a', '192k', '-af', 'apad', '-shortest');
    }
    args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart', opts.outputPath);

    this.proc = spawn(ffmpegBin(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
    this.proc.stderr.on('data', (chunk: Buffer) => {
      this.stderrChunks.push(chunk.toString('utf8'));
      if (this.stderrChunks.length > 60) {
        this.stderrChunks.shift();
      }
    });
    this.proc.on('error', (err) => {
      this.stderrChunks.push(`spawn error: ${String(err)}`);
    });
  }

  stderrTail(): string {
    return this.stderrChunks.join('').trim().split('\n').slice(-12).join('\n');
  }

  /** Writes one RGBA frame, awaiting drain to respect backpressure. */
  async writeFrame(buf: Buffer): Promise<void> {
    if (this.ended) {
      throw new Error('export already ended');
    }
    const canContinue = this.proc.stdin.write(buf);
    if (!canContinue) {
      await once(this.proc.stdin, 'drain');
    }
  }

  /** Closes stdin and waits for ffmpeg to exit. */
  async finish(): Promise<{ code: number | null; stderr: string }> {
    this.ended = true;
    this.proc.stdin.end();
    const [code] = (await once(this.proc, 'close')) as [number | null];
    return { code, stderr: this.stderrTail() };
  }

  /** Kills ffmpeg and removes the partial output file. */
  async cancel(): Promise<void> {
    this.ended = true;
    try {
      this.proc.stdin.destroy();
    } catch {
      /* ignore */
    }
    try {
      this.proc.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    const wait = Promise.race([once(this.proc, 'close'), new Promise((r) => setTimeout(r, 5000))]);
    await wait;
    try {
      fs.rmSync(this.outputPath, { force: true });
    } catch {
      /* ignore */
    }
  }
}
