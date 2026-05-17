const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const processState = document.getElementById('processState');
const successState = document.getElementById('successState');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const progressText = document.getElementById('progressText');

// Setup PDF.js Worker
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Setup FFmpeg
const { FFmpeg } = window.FFmpegWASM;
const { fetchFile } = window.FFmpegUtil;
let ffmpeg = null;

// Global Drag Protection
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());

dropzone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleUpload(e.target.files[0]);
});

dropzone.addEventListener('dragenter', (e) => e.preventDefault());
dropzone.addEventListener('dragover', (e) => e.preventDefault());
dropzone.addEventListener('dragleave', () => {});
dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
        fileInput.files = e.dataTransfer.files;
        handleUpload(e.dataTransfer.files[0]);
    }
});

async function loadFFmpeg() {
    if (ffmpeg) return;
    ffmpeg = new FFmpeg();
    
    // Connect actual FFmpeg progress to your UI ring!
    ffmpeg.on('progress', ({ progress }) => {
        // FFmpeg progress goes from 0 to 1
        const percent = Math.round(progress * 100);
        progressText.innerText = `${percent}%`;
    });

    await ffmpeg.load({
        coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
        wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm'
    });
}

async function handleUpload(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
        alert('Please provide a valid PDF document.');
        return;
    }

    dropzone.classList.add('hidden');
    processState.classList.remove('hidden');
    progressText.innerText = '0%';

    try {
        progressText.innerText = 'Loading Engine...';
        await loadFFmpeg();

        progressText.innerText = 'Reading PDF...';
        const fileUrl = URL.createObjectURL(file);
        const pdf = await pdfjsLib.getDocument(fileUrl).promise;
        const totalPages = pdf.numPages;

        // Step 1: Extract PDF Pages and write to FFmpeg virtual memory
        let maxWidth = 0;
        let maxHeight = 0;
        
        // Hidden canvas to draw pages
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        for (let i = 1; i <= totalPages; i++) {
            progressText.innerText = `Extracting ${i}/${totalPages}`;
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 }); // Scale 2.0 for HD quality
            
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            
            // Draw page to canvas
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;
            
            // Convert canvas to image buffer
            const imgData = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
            const buffer = Uint8Array.from(atob(imgData), c => c.charCodeAt(0));
            
            // Write image to FFmpeg memory (e.g., frame_001.jpg)
            const frameName = `frame_${String(i).padStart(3, '0')}.jpg`;
            await ffmpeg.writeFile(frameName, buffer);
        }

        // Step 2: Command FFmpeg to stitch the images into an MP4
        progressText.innerText = 'Stitching MP4...';
        
        // -framerate 1 means 1 second per page
        await ffmpeg.exec([
            '-framerate', '1', 
            '-i', 'frame_%03d.jpg', 
            '-c:v', 'libx264', 
            '-pix_fmt', 'yuv420p', 
            'output.mp4'
        ]);

        // Step 3: Retrieve the final video from virtual memory
        const videoData = await ffmpeg.readFile('output.mp4');
        const videoBlob = new Blob([videoData.buffer], { type: 'video/mp4' });
        const videoUrl = URL.createObjectURL(videoBlob);

        // Cleanup virtual memory so the browser doesn't crash on the next file
        for (let i = 1; i <= totalPages; i++) {
            await ffmpeg.deleteFile(`frame_${String(i).padStart(3, '0')}.jpg`);
        }
        await ffmpeg.deleteFile('output.mp4');

        // Setup Download
        downloadBtn.href = videoUrl;
        downloadBtn.download = file.name.replace('.pdf', '.mp4');

        processState.classList.add('hidden');
        successState.classList.remove('hidden');

    } catch (error) {
        console.error(error);
        alert("Conversion Error: " + error.message);
        resetUI();
    }
}

resetBtn.addEventListener('click', resetUI);

function resetUI() {
    fileInput.value = '';
    successState.classList.add('hidden');
    processState.classList.add('hidden');
    dropzone.classList.remove('hidden');
    progressText.innerText = '0%';
}