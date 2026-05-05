const bcrypt = require('bcryptjs');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { execFile, spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ytdl = require('yt-dlp-exec');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Stats
let totalDownloads = 0;
const activityLogs = [];
const jobs = new Map();
const queue = [];
let isProcessing = false;

const downloadDir = path.resolve(__dirname, '..', 'downloads');
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

// Helpers
function addLog(type, message) {
    const now = new Date();
    const formattedTime = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR');
    activityLogs.unshift({ time: formattedTime, type, message });
    if (activityLogs.length > 50) activityLogs.pop();
}

// Worker
async function processQueue() {
    if (isProcessing || queue.length === 0) return;
    isProcessing = true;
    const jobId = queue.shift();
    const job = jobs.get(jobId);
    if (!job) { isProcessing = false; return processQueue(); }

    job.status = 'processing';
    addLog('info', `Iniciando: ${job.title}`);
    const ext = job.formatType === 'mp3' ? 'mp3' : 'mp4';
    const outputPath = path.join(downloadDir, `${jobId}.${ext}`);
    
    const cleanUrl = job.url.split('&list=')[0].split('?list=')[0];
    
    const options = {
        noPlaylist: true,
        ffmpegLocation: ffmpegPath,
        output: path.join(downloadDir, `${jobId}.%(ext)s`),
    };

    if (job.formatType === 'mp3') {
        Object.assign(options, {
            extractAudio: true,
            audioFormat: 'mp3',
            audioQuality: 0,
            addMetadata: true,
            embedThumbnail: true
        });
    } else {
        Object.assign(options, {
            format: `bestvideo[height<=?${job.quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=?${job.quality}][ext=mp4]/best`,
            mergeOutputFormat: 'mp4'
        });
    }

    try {
        const subprocess = ytdl.exec(cleanUrl, options);
        
        subprocess.stdout.on('data', (data) => {
            const output = data.toString();
            const match = output.match(/(\d+(?:\.\d+)?)%/);
            if (match) {
                const progress = parseFloat(match[1]);
                if (progress > job.progress) job.progress = progress;
            }
        });

        await subprocess;
        
        if (fs.existsSync(outputPath)) {
            job.status = 'completed';
            job.progress = 100;
            totalDownloads++;
            addLog('success', `Concluído: ${job.title}`);
        } else {
            throw new Error('Arquivo não encontrado após download');
        }
    } catch (err) {
        console.error('Erro no download:', err);
        job.status = 'failed';
        addLog('error', `Falha: ${job.title}`);
    } finally {
        isProcessing = false;
        processQueue();
    }
}

// --- API ROUTES ---

app.get('/api/health-check', (req, res) => {
    console.log('Health check solicitado');
    res.json({ status: 'ok', message: 'API ONLINE' });
});

app.post('/api/auth/admin-login', async (req, res) => {
    console.log('Tentativa de login admin');
    const { password } = req.body;
    const hash = process.env.ADMIN_PASSWORD_HASH;
    if (!hash) return res.status(500).json({ error: 'Erro no .env' });

    try {
        const match = await bcrypt.compare(password, hash);
        if (match) res.json({ success: true, token: 'admin-access-granted' });
        else res.status(401).json({ success: false, error: 'Senha incorreta' });
    } catch (e) {
        res.status(500).json({ error: 'Erro interno' });
    }
});

app.get('/api/admin/stats', (req, res) => {
    if (req.headers['authorization'] !== 'admin-access-granted') return res.status(403).send('Forbidden');
    res.json({ totalDownloads, queueSize: queue.length, activeProcessing: isProcessing, logs: activityLogs });
});

app.post('/api/info', async (req, res) => {
    const { url } = req.body;
    try {
        const info = await ytdl(url, {
            dumpJson: true,
            noPlaylist: true
        });
        res.json(info);
    } catch (err) {
        console.error('Erro ao buscar info:', err);
        res.status(500).json({ error: 'Erro ao buscar informações do vídeo. Verifique o link.' });
    }
});

app.post('/api/convert', (req, res) => {
    const { url, formatType, quality, title } = req.body;
    const id = uuidv4();
    jobs.set(id, { id, url, formatType, quality, title, status: 'waiting', progress: 0 });
    queue.push(id);
    processQueue();
    res.json({ jobId: id });
});

app.get('/api/status/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ status: 'not_found' });
    res.json({ ...job, queuePosition: queue.indexOf(req.params.id) + 1, downloadUrl: job.status === 'completed' ? `/api/download/${req.params.id}` : null });
});

app.get('/api/download/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).send('Not found');
    const ext = job.formatType === 'mp3' ? 'mp3' : 'mp4';
    res.download(path.join(downloadDir, `${req.params.id}.${ext}`), `${job.title.replace(/[^\w\s-]/gi, '')}.${ext}`);
});

// Static Files
app.use(express.static('public'));

app.listen(PORT, '0.0.0.0', () => {
    console.log('====================================');
    console.log(`SERVIDOR RODANDO EM: http://localhost:${PORT}`);
    console.log('====================================');
});
