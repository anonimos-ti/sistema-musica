const bcrypt = require('bcryptjs');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { execFile, spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
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
    
    // Limpa o link de parâmetros de rádio/playlist para evitar confusão
    const cleanUrl = job.url.split('&list=')[0].split('?list=')[0];
    
    let args = ['-m', 'yt_dlp', '--no-playlist', '--ffmpeg-location', ffmpegPath, '--newline'];
    if (job.formatType === 'mp3') {
        args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0', '--add-metadata', '--embed-thumbnail');
    } else {
        args.push('-f', `bestvideo[height<=?${job.quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=?${job.quality}][ext=mp4]/best`, '--merge-output-format', 'mp4');
    }
    args.push('-o', path.join(downloadDir, `${jobId}.%(ext)s`), cleanUrl);
    
    const isWin = process.platform === 'win32';
    const commands = isWin ? 
        [['python', ['-m', 'yt_dlp']]] : 
        [['yt-dlp', []], ['python3', ['-m', 'yt_dlp']]];

    let yt = null;
    let cmdFound = false;

    // Tenta encontrar o comando que funciona
    for (const [cmd, baseArgs] of commands) {
        try {
            const finalArgs = [...baseArgs, ...args];
            yt = spawn(cmd, finalArgs);
            cmdFound = true;
            break;
        } catch (e) {
            console.log(`Falha ao spawnar ${cmd}:`, e.message);
        }
    }

    if (!cmdFound) {
        job.status = 'failed';
        addLog('error', `Falha crítica: Motor de busca não encontrado`);
        isProcessing = false;
        return processQueue();
    }

    const handleOutput = (data) => {
        const output = data.toString();
        // Regex mais flexível: pega "10%", "10.5%", " 5.0%" etc.
        const match = output.match(/(\d+(?:\.\d+)?)%/);
        if (match) {
            const progress = parseFloat(match[1]);
            // Apenas atualiza se for maior que o progresso atual
            if (progress > job.progress) {
                job.progress = progress;
            }
        }
    };

    yt.stdout.on('data', handleOutput);
    yt.stderr.on('data', handleOutput);

    yt.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
            job.status = 'completed';
            job.progress = 100;
            totalDownloads++;
            addLog('success', `Concluído: ${job.title}`);
        } else {
            job.status = 'failed';
            addLog('error', `Falha: ${job.title}`);
        }
        isProcessing = false;
        processQueue();
    });
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
    
    // No Render/Linux, tentamos 'yt-dlp' direto ou 'python3 -m yt_dlp'
    // No Windows, tentamos 'python -m yt_dlp'
    const isWin = process.platform === 'win32';
    const commands = isWin ? 
        [['python', ['-m', 'yt_dlp']]] : 
        [['yt-dlp', []], ['python3', ['-m', 'yt_dlp']]];

    let lastError = null;

    async function tryCommand(index) {
        if (index >= commands.length) {
            console.error('Todas as tentativas de busca falharam:', lastError);
            return res.status(500).json({ error: 'Erro ao buscar info. Verifique o link ou tente novamente em instantes.' });
        }

        const [cmd, baseArgs] = commands[index];
        const fullArgs = [...baseArgs, '--dump-json', '--no-playlist', '--quiet', url];

        execFile(cmd, fullArgs, (err, stdout, stderr) => {
            if (err) {
                lastError = stderr || err.message;
                console.log(`Tentativa ${index + 1} (${cmd}) falhou:`, lastError);
                return tryCommand(index + 1);
            }
            try {
                res.json(JSON.parse(stdout));
            } catch (e) {
                res.status(500).json({ error: 'Erro ao processar dados do vídeo.' });
            }
        });
    }

    tryCommand(0);
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
