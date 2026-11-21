import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  archiveVideoClip,
  buildExtractLastFrameArgs,
  buildMergeArgs,
  extractLastFrameWithFfmpeg,
  findFfmpeg,
  isHttpUrl,
  mergeSegments,
} from './filmMerger.js';

function makeSpawn(exitCode: number, calls: Array<{ command: string; args: string[] }> = []) {
  return (command: string, args: string[]) => {
    calls.push({ command, args });
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (exitCode !== 0) child.stderr.emit('data', 'Invalid data found');
      child.emit('close', exitCode);
    });
    return child;
  };
}

test('buildMergeArgs trims the duplicated first frame of every segment except the first', () => {
  const args = buildMergeArgs({ inputs: ['a.mp4', 'b.mp4', 'c.mp4'], output: 'out.mp4' });
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /\[0:v\]setpts=PTS-STARTPTS\[v0\]/);
  assert.match(filter, /\[1:v\]trim=start_frame=1,setpts=PTS-STARTPTS\[v1\]/);
  assert.match(filter, /\[2:v\]trim=start_frame=1,setpts=PTS-STARTPTS\[v2\]/);
  assert.match(filter, /\[v0\]\[v1\]\[v2\]concat=n=3:v=1:a=0\[outv\]/);
  assert.equal(args.filter((a) => a === '-i').length, 3);
  assert.equal(args[args.length - 1], 'out.mp4');
  assert.ok(args.includes('libx264') && args.includes('yuv420p'));

  const noTrim = buildMergeArgs({ inputs: ['a.mp4', 'b.mp4'], output: 'o.mp4', trimDuplicateFirstFrame: false });
  assert.ok(!noTrim[noTrim.indexOf('-filter_complex') + 1].includes('trim='));
  assert.throws(() => buildMergeArgs({ inputs: [], output: 'o.mp4' }), /Нет сегментов/);
});

test('findFfmpeg returns the first candidate that answers -version, otherwise null', async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const spawnImpl = (command: string, args: string[]) => {
    calls.push({ command, args });
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (command === 'missing') child.emit('error', new Error('ENOENT'));
      else child.emit('close', command === 'ffmpeg' ? 0 : 1);
    });
    return child;
  };
  assert.equal(await findFfmpeg({ candidates: ['missing', 'broken', 'ffmpeg'], spawnImpl }), 'ffmpeg');
  assert.deepEqual(calls[0].args, ['-version']);
  assert.equal(await findFfmpeg({ candidates: ['missing'], spawnImpl }), null);
});

test('mergeSegments downloads every segment, runs ffmpeg once and removes the temp folder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-merge-test-'));
  const downloads: string[] = [];
  const calls: Array<{ command: string; args: string[] }> = [];
  let workDir = '';
  const events: string[] = [];
  try {
    const result = await mergeSegments({
      segmentUrls: ['http://127.0.0.1:8188/view?filename=a.mp4', 'http://127.0.0.1:8188/view?filename=b.mp4'],
      outputPath: path.join(root, 'film.mp4'),
      ffmpegPath: 'ffmpeg',
      tempRoot: root,
      spawnImpl: makeSpawn(0, calls),
      downloadImpl: async ({ url, destPath }: { url: string; destPath: string }) => {
        downloads.push(url);
        workDir = path.dirname(destPath);
        fs.writeFileSync(destPath, 'video');
      },
      onProgress: (event) => events.push(`${event.phase}:${event.index}`),
    });
    assert.equal(result.outputPath, path.join(root, 'film.mp4'));
    assert.equal(downloads.length, 2);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'ffmpeg');
    assert.deepEqual(events, ['downloading:1', 'downloading:2', 'encoding:2']);
    assert.equal(fs.existsSync(workDir), false, 'temp folder must be cleaned up');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mergeSegments reports FFMPEG_NOT_FOUND, rejects bad URLs and surfaces ffmpeg failures', async () => {
  await assert.rejects(
    () => mergeSegments({ segmentUrls: ['http://x/a.mp4'], outputPath: 'o.mp4', ffmpegPath: null }),
    (error: Error & { code?: string }) => error.code === 'FFMPEG_NOT_FOUND',
  );
  await assert.rejects(
    () => mergeSegments({ segmentUrls: ['file:///etc/passwd'], outputPath: 'o.mp4', ffmpegPath: 'ffmpeg' }),
    /Некорректный список/,
  );
  assert.equal(isHttpUrl('https://example.com/a.mp4'), true);
  assert.equal(isHttpUrl('C:\\video.mp4'), false);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-merge-test-'));
  try {
    await assert.rejects(
      () =>
        mergeSegments({
          segmentUrls: ['http://x/a.mp4'],
          outputPath: path.join(root, 'o.mp4'),
          ffmpegPath: 'ffmpeg',
          tempRoot: root,
          spawnImpl: makeSpawn(1),
          downloadImpl: async ({ destPath }: { destPath: string }) => fs.writeFileSync(destPath, 'x'),
        }),
      /FFmpeg завершился с кодом 1.*Invalid data/,
    );
    assert.deepEqual(fs.readdirSync(root), [], 'temp folder removed even on failure');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildExtractLastFrameArgs, extractLastFrameWithFfmpeg, and archiveVideoClip work offline with cleanup', async () => {
  const args = buildExtractLastFrameArgs({ inputPath: 'clip.mp4', outputPath: 'last.png' });
  assert.ok(args.includes('-sseof'));
  assert.ok(args.includes('-frames:v'));
  assert.equal(args[args.length - 1], 'last.png');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-frame-test-'));
  try {
    const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const spawnImpl = (_cmd: string, spawnArgs: string[]) => {
      const outPath = spawnArgs[spawnArgs.length - 1];
      fs.writeFileSync(outPath, fakePng);
      const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
      child.stderr = new EventEmitter();
      setImmediate(() => child.emit('close', 0));
      return child;
    };

    const extracted = await extractLastFrameWithFfmpeg({
      videoUrl: 'http://127.0.0.1:8188/view?filename=seg1.mp4',
      ffmpegPath: 'ffmpeg',
      tempRoot: root,
      spawnImpl,
      downloadImpl: async ({ destPath }: { destPath: string }) => {
        fs.writeFileSync(destPath, 'mp4-bytes');
      },
    });
    assert.equal(extracted.pngBase64, fakePng.toString('base64'));
    assert.deepEqual(fs.readdirSync(root), [], 'frame extraction temp dir must be removed');

    const archiveDir = path.join(root, 'archive');
    const archived = await archiveVideoClip({
      videoUrl: 'http://127.0.0.1:8188/view?filename=seg1.mp4',
      archiveDir,
      filename: 'my scene (1).mp4',
      downloadImpl: async ({ destPath }: { destPath: string }) => {
        fs.writeFileSync(destPath, 'archived-mp4');
      },
    });
    assert.equal(path.dirname(archived.localPath), archiveDir);
    assert.match(path.basename(archived.localPath), /^my_scene_1_\.mp4$/);
    assert.equal(fs.readFileSync(archived.localPath, 'utf8'), 'archived-mp4');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

