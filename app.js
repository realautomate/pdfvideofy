const { FFmpeg } = window.FFmpegWASM;
let ffmpeg = null;

pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.js';

// DOM Elements
const fileInput = document.getElementById('file-input');
const statusDiv = document.getElementById('status');
const downloadLink = document.getElementById('download-link');
const progressText = document.getElementById('progress-text'); // New Percentage Tracker

// UI State Containers
const uiDropzone = document.getElementById('ui-dropzone');
const uiProcessing = document.getElementById('ui-processing');
const uiSuccess = document.getElementById('ui-success');

/**
 * UI State Controller
 */
function switchUI(state) {
    uiDropzone?.classList.add('hidden');
    uiProcessing?.classList.add('hidden');
    uiSuccess?.classList.add('hidden');

    if (state === 'processing') uiProcessing?.classList.remove('hidden');
    else if (state === 'success') uiSuccess?.classList.remove('hidden');
    else uiDropzone?.classList.remove('hidden');
}

function updateStatus(message, isError = false) {
    if (!statusDiv) return;
    statusDiv.textContent = message;
    statusDiv.className = isError ? "font-medium text-red-400 mb-1" : "font-medium text-slate-300 mb-1";
}

function updateProgress(percent) {
    if (progressText) {
        progressText.textContent = `${Math.round(percent)}%`;
    }
}

async function initFFmpeg() {
    if (ffmpeg) return ffmpeg;
    updateStatus("Initializing high-speed video engine...");
    ffmpeg = new FFmpeg();
    
    // Tap into FFmpeg's internal brain to track video rendering progress (Maps from 50% to 100%)
    ffmpeg.on('progress', ({ progress }) => {
        if (progress >= 0 && progress <= 1) {
            const totalProgress = 50 + (progress * 50);
            updateProgress(Math.min(totalProgress, 99)); // Cap at 99% until fully complete
        }
    });

    await ffmpeg.load({
        coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
        wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm'
    });
    return ffmpeg;
}

function padZero(num, size = 3) {
    let s = num + "";
    while (s.length < size) s = "0" + s;
    return s;
}

async function convertPdfToVideo() {
    const file = fileInput?.files[0];
    if (!file) return;

    try {
        switchUI('processing');
        updateProgress(0); // Reset tracker
        
        const ffmpegCore = await initFFmpeg();
        updateStatus("Reading PDF document streams...");
        
        const fileReader = new FileReader();
        fileReader.onload = async function () {
            try {
                const typedArray = new Uint8Array(this.result);
                const pdf = await pdfjsLib.getDocument(typedArray).promise;
                
                let masterWidth = 0;
                let masterHeight = 0;
                const mainCanvas = document.createElement('canvas');
                const ctx = mainCanvas.getContext('2d');
                
                // Process pages and track progress from 0% to 50%
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    updateStatus(`Slicing and stamping page ${pageNum} of ${pdf.numPages}...`);
                    
                    const page = await pdf.getPage(pageNum);
                    const viewport = page.getViewport({ scale: 2.0 });
                    
                    const tempCanvas = document.createElement('canvas');
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCanvas.width = viewport.width;
                    tempCanvas.height = viewport.height;
                    
                    await page.render({ canvasContext: tempCtx, viewport: viewport }).promise;
                    
                    if (pageNum === 1) {
                        masterWidth = tempCanvas.width;
                        masterHeight = tempCanvas.height;
                        if (masterWidth % 2 !== 0) masterWidth--;
                        if (masterHeight % 2 !== 0) masterHeight--;
                    }
                    
                    mainCanvas.width = masterWidth;
                    mainCanvas.height = masterHeight;
                    ctx.fillStyle = '#0f172a'; 
                    ctx.fillRect(0, 0, masterWidth, masterHeight);
                    
                    const scale = Math.min(masterWidth / tempCanvas.width, masterHeight / tempCanvas.height);
                    const xOffset = (masterWidth - tempCanvas.width * scale) / 2;
                    const yOffset = (masterHeight - tempCanvas.height * scale) / 2;
                    ctx.drawImage(tempCanvas, xOffset, yOffset, tempCanvas.width * scale, tempCanvas.height * scale);
                    
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)'; 
                    ctx.font = `bold ${Math.round(masterHeight * 0.025)}px sans-serif`; 
                    ctx.textAlign = 'right';
                    ctx.textBaseline = 'bottom';
                    
                    const paddingX = masterWidth * 0.04;
                    const paddingY = masterHeight * 0.03;
                    ctx.fillText(`Page ${pageNum} of ${pdf.numPages}`, masterWidth - paddingX, masterHeight - paddingY);
                    
                    const dataUrl = mainCanvas.toDataURL('image/jpeg', 0.85);
                    const base64Data = dataUrl.split(',')[1];
                    const binaryData = atob(base64Data);
                    const imgBuffer = new Uint8Array(binaryData.length);
                    for (let i = 0; i < binaryData.length; i++) imgBuffer[i] = binaryData.charCodeAt(i);
                    
                    await ffmpegCore.writeFile(`frame_${padZero(pageNum)}.jpg`, imgBuffer);
                    
                    // Update PDF Parsing Progress (0 to 50%)
                    const pdfProgress = (pageNum / pdf.numPages) * 50;
                    updateProgress(pdfProgress);
                }
                
                updateStatus("Stitching MP4 stream... This might take a moment.");
                
                await ffmpegCore.exec([
                    '-framerate', '1',
                    '-i', 'frame_%03d.jpg',
                    '-c:v', 'libx264',
                    '-r', '30',
                    '-pix_fmt', 'yuv420p',
                    'output.mp4'
                ]);
                
                const videoData = await ffmpegCore.readFile('output.mp4');
                const videoBlob = new Blob([videoData.buffer], { type: 'video/mp4' });
                
                if (downloadLink) {
                    downloadLink.href = URL.createObjectURL(videoBlob);
                    downloadLink.download = `${file.name.replace(/\.[^/.]+$/, "")}.mp4`;
                }
                
                updateProgress(100);
                switchUI('success');
                
                for (let i = 1; i <= pdf.numPages; i++) {
                    try { await ffmpegCore.deleteFile(`frame_${padZero(i)}.jpg`); } catch(e){}
                }
                try { await ffmpegCore.deleteFile('output.mp4'); } catch(e){}

            } catch (err) {
                console.error(err);
                updateStatus(`Error: ${err.message}`, true);
            }
        };
        fileReader.readAsArrayBuffer(file);
        
    } catch (err) {
        console.error(err);
        updateStatus(`Failed to start: ${err.message}`, true);
        switchUI('upload');
    }
}

// Triggers
if (fileInput) {
    fileInput.addEventListener('click', (e) => { e.target.value = null; });
    fileInput.addEventListener('change', convertPdfToVideo);
}

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
        fileInput.files = e.dataTransfer.files;
        convertPdfToVideo();
    }
});