document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const urlInput = document.getElementById('youtube-url');
    const getInfoBtn = document.getElementById('get-info-btn');
    const videoInfoContainer = document.getElementById('video-info-container');
    const videoInfoCard = document.getElementById('video-info-card');
    const videoThumb = document.getElementById('video-thumb');
    const videoTitle = document.getElementById('video-title');
    const videoMeta = document.getElementById('video-meta');
    const convertBtn = document.getElementById('convert-btn');
    const statusContainer = document.getElementById('status-container');
    const statusText = document.getElementById('status-text');
    const progressFill = document.getElementById('progress-fill');
    const downloadContainer = document.getElementById('download-container');
    const downloadLink = document.getElementById('download-link');
    const errorMessage = document.getElementById('error-message');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const qualitySelector = document.getElementById('quality-selector');
    const musicQualityInfo = document.getElementById('music-quality-info');
    const selectSelected = document.querySelector('.select-selected');
    const selectItems = document.querySelector('.select-items');

    // QR Elements
    const showQrBtn = document.getElementById('show-qr-tool');
    const qrModal = document.getElementById('qr-modal');
    const closeQrBtn = document.getElementById('close-qr-modal');
    const generateQrBtn = document.getElementById('generate-qr-btn');
    const qrInput = document.getElementById('qr-input');
    const qrResult = document.getElementById('qr-result');
    const qrCanvas = document.getElementById('qr-canvas');
    const downloadQrLink = document.getElementById('download-qr');

    let currentMode = 'mp3';
    let currentVideoData = null;
    let selectedQualityValue = '1080';
    let pollInterval = null;

    // --- Tab Switching ---
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMode = btn.dataset.type;
            getInfoBtn.innerText = currentMode === 'mp3' ? 'Obter Música' : 'Obter Vídeo';
            
            // Toggle selectors
            qualitySelector.classList.toggle('hidden', currentMode === 'mp3');
            musicQualityInfo.classList.toggle('hidden', currentMode === 'mp4');
            
            resetUI();
        });
    });

    // --- Custom Select ---
    selectSelected.addEventListener('click', (e) => {
        e.stopPropagation();
        selectItems.classList.toggle('select-hide');
    });

    document.querySelectorAll('.select-items div').forEach(item => {
        item.addEventListener('click', () => {
            selectedQualityValue = item.dataset.value;
            selectSelected.innerText = item.innerText;
            selectItems.classList.add('select-hide');
        });
    });

    document.addEventListener('click', () => selectItems.classList.add('select-hide'));

    // --- Core Logic ---
    getInfoBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        if (!url) return;

        try {
            resetUI(); // Limpa tudo antes de começar uma nova busca
            getInfoBtn.disabled = true;
            getInfoBtn.innerText = 'Buscando...';
            errorMessage.classList.add('hidden');

            const res = await fetch('/api/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            const data = await res.json();
            if (data.error) throw new Error(data.error);

            currentVideoData = data;
            showVideoInfo(data);
        } catch (err) {
            showError('Erro ao buscar informações do vídeo.');
        } finally {
            getInfoBtn.disabled = false;
            getInfoBtn.innerText = currentMode === 'mp3' ? 'Obter Música' : 'Obter Vídeo';
        }
    });

    convertBtn.addEventListener('click', async () => {
        if (!currentVideoData) return;
        try {
            convertBtn.disabled = true;
            statusContainer.classList.remove('hidden');
            const res = await fetch('/api/convert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: urlInput.value,
                    formatType: currentMode,
                    quality: selectedQualityValue,
                    title: currentVideoData.title
                })
            });
            const data = await res.json();
            startPolling(data.jobId);
        } catch (err) {
            showError('Erro ao iniciar conversão.');
        }
    });

    function showVideoInfo(data) {
        videoThumb.src = data.thumbnail;
        videoTitle.innerText = data.title;
        const mins = Math.floor(data.duration / 60);
        const secs = (data.duration % 60).toString().padStart(2, '0');
        videoMeta.innerText = `${data.uploader} • ${mins}:${secs}`;
        
        // Show correct selector based on mode
        qualitySelector.classList.toggle('hidden', currentMode === 'mp3');
        musicQualityInfo.classList.toggle('hidden', currentMode === 'mp4');

        videoInfoContainer.classList.remove('hidden');
    }

    function startPolling(jobId) {
        pollInterval = setInterval(async () => {
            try {
                const res = await fetch(`/api/status/${jobId}`);
                const data = await res.json();
                if (data.status === 'completed') {
                    clearInterval(pollInterval);
                    showResult(data.downloadUrl);
                } else if (data.status === 'failed') {
                    clearInterval(pollInterval);
                    showError('Erro no processamento.');
                } else {
                    statusText.innerText = data.status === 'waiting' ? `Na fila (${data.queuePosition})...` : 'Processando...';
                    progressFill.style.width = `${data.progress || 0}%`;
                }
            } catch (e) { clearInterval(pollInterval); }
        }, 2000);
    }

    function showResult(url) {
        statusText.innerText = 'Pronto!';
        progressFill.style.width = '100%';
        downloadContainer.classList.remove('hidden');
        downloadLink.href = url;
    }

    function showError(msg) {
        errorMessage.innerText = msg;
        errorMessage.classList.remove('hidden');
        statusContainer.classList.add('hidden');
    }

    function resetUI() {
        videoInfoContainer.classList.add('hidden');
        statusContainer.classList.add('hidden');
        downloadContainer.classList.add('hidden');
        errorMessage.classList.add('hidden');
        progressFill.style.width = '0%';
        convertBtn.disabled = false;
        if (pollInterval) clearInterval(pollInterval);
    }

    urlInput.addEventListener('input', () => {
        if (urlInput.value.trim() === '') {
            resetUI();
        }
    });

    // --- QR Code ---
    const newQrBtn = document.getElementById('new-qr-btn');

    function resetQR() {
        qrInput.value = '';
        qrResult.classList.add('hidden');
        generateQrBtn.classList.remove('hidden');
    }

    showQrBtn.addEventListener('click', () => qrModal.classList.remove('hidden'));
    
    closeQrBtn.addEventListener('click', () => {
        qrModal.classList.add('hidden');
        resetQR();
    });
    
    newQrBtn.addEventListener('click', resetQR);
    
    generateQrBtn.addEventListener('click', async () => {
        const text = qrInput.value.trim();
        const QR = window.QRCode || window.qrcode;
        if (!QR || !text) return;

        try {
            generateQrBtn.disabled = true;
            // Gera o QR com margem zero para centralização perfeita via CSS
            await QR.toCanvas(qrCanvas, text, { 
                width: 300, 
                margin: 0,
                color: { dark: '#000000', light: '#ffffff' }
            });
            qrResult.classList.remove('hidden');
            generateQrBtn.classList.add('hidden');
            downloadQrLink.href = qrCanvas.toDataURL();
            downloadQrLink.download = `qrcode-${Date.now()}.png`;
        } catch (e) { alert('Erro ao gerar QR'); }
        finally { generateQrBtn.disabled = false; }
    });

    qrInput.addEventListener('input', () => {
        generateQrBtn.classList.remove('hidden');
        qrResult.classList.add('hidden');
    });
});
