// Headless end-to-end export check. Run after `npm run build`:
// spawns the built app with --smoke-export per case and verifies the MP4s with ffprobe.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'smoke-out');
mkdirSync(outDir, { recursive: true });

// 2.0s tone — shorter than the 4.0s smoke project, exercising apad/-shortest.
const tonePath = path.join(outDir, 'smoke-tone.wav');
const tone = spawnSync(
  ffmpegStatic,
  ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', tonePath],
  { cwd: root, encoding: 'utf8' },
);
if (tone.status !== 0) {
  console.error(`[smoke] tone generation failed: ${tone.stderr || tone.error}`);
  process.exit(1);
}

// Smoke project is exactly 4.0s (see src/renderer/smoke.ts).
const CASES = [
  { out: path.join(outDir, 'smoke-1080p30.mp4'), res: '1080p', fps: 30, frames: 120, w: 1920, h: 1080 },
  { out: path.join(outDir, 'smoke-720p25.mp4'), res: '720p', fps: 25, frames: 100, w: 1280, h: 720 },
  {
    out: path.join(outDir, 'smoke-720p25-audio.mp4'),
    res: '720p',
    fps: 25,
    frames: 100,
    w: 1280,
    h: 720,
    audio: tonePath,
    audioDur: 4.0,
  },
];

const results = [];

for (const c of CASES) {
  const label = `${c.res}@${c.fps}${c.audio ? '+audio' : ''}`;
  const args = ['.', '--smoke-export', c.out, '--smoke-res', c.res, '--smoke-fps', String(c.fps)];
  if (c.audio) {
    args.push('--smoke-audio', c.audio);
  }
  const proc = spawnSync(electronPath, args, { cwd: root, stdio: 'inherit' });
  if (proc.status !== 0) {
    results.push({ label, ok: false, detail: `electron exited with ${proc.status ?? proc.signal}` });
    continue;
  }

  const probe = spawnSync(
    ffprobeStatic.path,
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-count_frames',
      '-show_entries',
      'stream=codec_name,width,height,r_frame_rate,nb_read_frames,pix_fmt',
      '-of',
      'json',
      c.out,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (probe.status !== 0) {
    results.push({ label, ok: false, detail: `ffprobe failed: ${probe.stderr || probe.error}` });
    continue;
  }

  let stream;
  try {
    stream = JSON.parse(probe.stdout).streams?.[0] ?? {};
  } catch (err) {
    results.push({ label, ok: false, detail: `ffprobe JSON parse failed: ${String(err)}` });
    continue;
  }

  const fails = [];
  if (stream.codec_name !== 'h264') {
    fails.push(`codec_name=${stream.codec_name}`);
  }
  if (stream.width !== c.w || stream.height !== c.h) {
    fails.push(`size=${stream.width}x${stream.height}`);
  }
  if (stream.r_frame_rate !== `${c.fps}/1`) {
    fails.push(`r_frame_rate=${stream.r_frame_rate}`);
  }
  if (stream.pix_fmt !== 'yuv420p') {
    fails.push(`pix_fmt=${stream.pix_fmt}`);
  }
  if (Number(stream.nb_read_frames) !== c.frames) {
    fails.push(`nb_read_frames=${stream.nb_read_frames}`);
  }

  if (c.audio) {
    const aprobe = spawnSync(
      ffprobeStatic.path,
      [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=codec_name,duration',
        '-of',
        'json',
        c.out,
      ],
      { cwd: root, encoding: 'utf8' },
    );
    let astream = {};
    if (aprobe.status === 0) {
      try {
        astream = JSON.parse(aprobe.stdout).streams?.[0] ?? {};
      } catch {
        astream = {};
      }
    }
    if (astream.codec_name !== 'aac') {
      fails.push(`audio codec_name=${astream.codec_name}`);
    }
    const adur = Number(astream.duration);
    if (!Number.isFinite(adur) || Math.abs(adur - c.audioDur) > 0.15) {
      fails.push(`audio duration=${astream.duration}`);
    }
  }

  results.push(
    fails.length === 0
      ? { label, ok: true, detail: `h264 ${c.w}x${c.h} ${c.fps}fps ${c.frames}f` }
      : { label, ok: false, detail: fails.join(', ') },
  );
}

let failed = false;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.label} — ${r.detail}`);
  if (!r.ok) {
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
