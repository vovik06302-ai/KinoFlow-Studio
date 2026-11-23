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
  mp4HasAudioTrack,
  saveGeneratedAudioFile,
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

  const withAudio = buildMergeArgs({
    inputs: ['a.mp4', 'b.mp4'],
    output: 'out_audio.mp4',
    audioPath: 'soundtrack.mp3',
    audioVolume: 0.75,
  });
  assert.ok(withAudio.includes('-stream_loop'));
  assert.ok(withAudio.includes('soundtrack.mp3'));
  assert.ok(withAudio.includes('-shortest'));
  assert.ok(withAudio.includes('aac'));
  assert.ok(withAudio.includes('[outa]'));
  const audioFilter = withAudio[withAudio.indexOf('-filter_complex') + 1];
  assert.match(audioFilter, /\[2:a\]volume=0\.75\[outa\]/);
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

test('mergeSegments forwards audioPath and audioVolume (0–2.0) into FFmpeg arguments', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-merge-audio-'));
  const calls: Array<{ command: string; args: string[] }> = [];
  const audioFile = path.join(root, 'rain_ambience.mp3');
  fs.writeFileSync(audioFile, 'fake-mp3');

  try {
    await mergeSegments({
      segmentUrls: ['http://127.0.0.1:8188/view?filename=seg1.mp4', 'http://127.0.0.1:8188/view?filename=seg2.mp4'],
      outputPath: path.join(root, 'film_with_audio.mp4'),
      audioPath: audioFile,
      audioVolume: 1.65,
      ffmpegPath: 'ffmpeg',
      tempRoot: root,
      spawnImpl: makeSpawn(0, calls),
      downloadImpl: async ({ destPath }: { destPath: string }) => {
        fs.writeFileSync(destPath, 'video');
      },
    });

    assert.equal(calls.length, 1);
    const args = calls[0].args;
    assert.ok(args.includes('-stream_loop'));
    assert.ok(args.includes(audioFile));
    assert.ok(args.includes('aac'));
    const filter = args[args.indexOf('-filter_complex') + 1];
    assert.match(filter, /\[2:a\]volume=1\.65\[outa\]/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('saveGeneratedAudioFile writes validated base64 audio into outputDir and sanitizes filenames', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-save-audio-'));
  const audioDir = path.join(root, 'audio');
  const payload = Buffer.from('ID3-audio-bytes').toString('base64');

  try {
    const saved = saveGeneratedAudioFile({
      audioBase64: payload,
      outputDir: audioDir,
      extension: 'wav',
      filename: '../../evil path/storm sound.wav',
    });
    assert.equal(path.dirname(saved.localPath), path.resolve(audioDir));
    assert.equal(saved.name, 'storm_sound.wav');
    assert.equal(fs.readFileSync(saved.localPath, 'utf8'), 'ID3-audio-bytes');

    // Unsupported extension falls back safely to mp3
    const fallbackExt = saveGeneratedAudioFile({
      audioBase64: payload,
      outputDir: audioDir,
      extension: 'exe',
      filename: 'track.exe',
    });
    assert.ok(fallbackExt.name.endsWith('.mp3'));

    assert.throws(
      () => saveGeneratedAudioFile({ audioBase64: '', outputDir: audioDir }),
      /Пустые аудиоданные/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildMergeArgs preserves segment audio tracks with smooth acrossfade joins when preserveSegmentAudio is enabled', () => {
  const args3 = buildMergeArgs({
    inputs: ['s1.mp4', 's2.mp4', 's3.mp4'],
    output: 'out_crossfade.mp4',
    preserveSegmentAudio: true,
    audioCrossfadeSec: 0.25,
  });
  const filter3 = args3[args3.indexOf('-filter_complex') + 1];
  assert.match(filter3, /\[0:a\]asetpts=PTS-STARTPTS\[a0\]/);
  assert.match(filter3, /\[1:a\]asetpts=PTS-STARTPTS\[a1\]/);
  assert.match(filter3, /\[2:a\]asetpts=PTS-STARTPTS\[a2\]/);
  assert.match(filter3, /\[a0\]\[a1\]acrossfade=d=0\.25:c1=tri:c2=tri\[af1\]/);
  assert.match(filter3, /\[af1\]\[a2\]acrossfade=d=0\.25:c1=tri:c2=tri\[outa\]/);
  assert.ok(args3.includes('[outa]'));
  assert.ok(args3.includes('aac'));
  assert.equal(args3.includes('-an'), false);

  const args1 = buildMergeArgs({
    inputs: ['only.mp4'],
    output: 'single.mp4',
    preserveSegmentAudio: true,
  });
  const filter1 = args1[args1.indexOf('-filter_complex') + 1];
  assert.match(filter1, /\[0:a\]asetpts=PTS-STARTPTS\[outa\]/);
  assert.equal(args1.includes('-an'), false);
});

test('mergeSegments auto-detects embedded MP4 audio tracks and applies acrossfade without external audioPath', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-merge-acrossfade-'));
  const calls: Array<{ command: string; args: string[] }> = [];
  const fakeMp4WithAudio = Buffer.concat([
    Buffer.from('\x00\x00\x00\x18ftypmp42'),
    Buffer.from('moovtrakmdiahdlr\x00\x00\x00\x00\x00\x00\x00\x00sounSoundHandler'),
  ]);

  try {
    const samplePath = path.join(root, 'sample.mp4');
    fs.writeFileSync(samplePath, fakeMp4WithAudio);
    assert.equal(mp4HasAudioTrack(samplePath), true);

    await mergeSegments({
      segmentUrls: [
        'http://127.0.0.1:8188/view?filename=seg1.mp4',
        'http://127.0.0.1:8188/view?filename=seg2.mp4',
      ],
      outputPath: path.join(root, 'film_mmaudio.mp4'),
      ffmpegPath: 'ffmpeg',
      tempRoot: root,
      spawnImpl: makeSpawn(0, calls),
      downloadImpl: async ({ destPath }: { destPath: string }) => {
        fs.writeFileSync(destPath, fakeMp4WithAudio);
      },
    });

    assert.equal(calls.length, 1);
    const args = calls[0].args;
    const filter = args[args.indexOf('-filter_complex') + 1];
    assert.match(filter, /\[a0\]\[a1\]acrossfade=d=0\.15:c1=tri:c2=tri\[outa\]/);
    assert.ok(args.includes('aac'));
    assert.equal(args.includes('-an'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
