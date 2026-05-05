const { Worker } = require('bullmq');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static');
const { connection } = require('./queue');
require('dotenv').config();

const downloadDir = path.resolve(__dirname, '..', process.env.DOWNLOAD_DIR || 'downloads');

const worker = new Worker('conversion-queue', async (job) => {
  const { url, id } = job.data;
  const outputPath = path.join(downloadDir, `${id}.mp3`);

  console.log(`[Worker] Starting job ${job.id} for: ${url}`);

  return new Promise((resolve, reject) => {
    // Arguments for yt-dlp
    const args = [
      '-m', 'yt_dlp',
      '--no-playlist', // Ensure we only get the specific video
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--no-check-certificate',
      '--ffmpeg-location', ffmpegPath,
      '-o', path.join(downloadDir, `${id}.%(ext)s`),
      url
    ];

    const ytProcess = spawn('python', args);

    ytProcess.stdout.on('data', (data) => {
      const output = data.toString();
      const progressMatch = output.match(/\[download\]\s+(\d+\.\d+)%/);
      if (progressMatch) {
        const progress = parseFloat(progressMatch[1]);
        job.updateProgress(Math.floor(progress * 0.9));
      }
      console.log(`[yt-dlp] ${output.trim()}`);
    });

    ytProcess.stderr.on('data', (data) => {
      const errorMsg = data.toString();
      console.error(`[yt-dlp Log] ${errorMsg.trim()}`);
    });

    ytProcess.on('close', async (code) => {
      if (code === 0) {
        if (fs.existsSync(outputPath)) {
          console.log(`[Worker] Job ${job.id} finished successfully.`);
          await job.updateProgress(100);
          resolve({ filename: `${id}.mp3` });
        } else {
          reject(new Error('MP3 file was not created. Check logs.'));
        }
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });
  });
}, { connection });

worker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed!`);
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job.id} failed: ${err.message}`);
});

console.log('Worker started (Playlist-safe version)...');
