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
const { FFmpeg } = window.FFmpeg;
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

    ffmpeg.on('progress', ({ progress }) => {
        const percent = Math.round(progress * 100);
        progressText.innerText = `Encoding Video: ${percent}%`;
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

        // Step 1: Pre-scan PDF to find the Maximum width and height of all pages
        progressText.innerText = 'Analyzing page dimensions...';
        let maxWidth = 0;
        let maxHeight = 0;
        
        for (let i = 1; i <= totalPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });
            if (viewport.width > maxWidth) maxWidth = viewport.width;
            if (viewport.height > maxHeight) maxHeight = viewport.height;
        }

        // FFmpeg's yuv420p requires strictly EVEN numbers for width/height
        maxWidth = Math.ceil(maxWidth);
        if (maxWidth % 2 !== 0) maxWidth++;
        maxHeight = Math.ceil(maxHeight);
        if (maxHeight % 2 !== 0) maxHeight++;

        // Create Master Canvas (Standardized size for all frames)
        const canvas = document.createElement('canvas');
        canvas.width = maxWidth;
        canvas.height = maxHeight;
        const ctx = canvas.getContext('2d');

        // Create a Temp Canvas (To render individual variable-sized pages)
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');

        // Step 2: Extract pages, pad smaller pages, and add page numbers
        for (let i = 1; i <= totalPages; i++) {
            progressText.innerText = `Extracting Page ${i}/${totalPages}`;
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });
            
            tempCanvas.width = viewport.width;
            tempCanvas.height = viewport.height;
            
            // Draw PDF page to the temp canvas
            await page.render({ canvasContext: tempCtx, viewport: viewport }).promise;
            
            // Fill Master canvas with a white background (removes transparent artifacts)
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, maxWidth, maxHeight);
            
            // Draw the temp canvas onto the Master canvas (Centered)
            const offsetX = (maxWidth - viewport.width) / 2;
            const offsetY = (maxHeight - viewport.height) / 2;
            ctx.drawImage(tempCanvas, offsetX, offsetY);
            
            // --- ADD PAGE NUMBER STAMP ---
            const text = `Page ${i} of ${totalPages}`;
            ctx.font = 'bold 36px Arial'; // Adjust font size here
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            
            // Add a thick white outline to text so it's visible even on dark images
            ctx.lineWidth = 5;
            ctx.strokeStyle = 'white';
            ctx.strokeText(text, maxWidth - 40, maxHeight - 40);
            
            // Draw the black text over the white outline
            ctx.fillStyle = 'black';
            ctx.fillText(text, maxWidth - 40, maxHeight - 40);
            
            // Convert to Buffer
            const imgData = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
            const buffer = Uint8Array.from(atob(imgData), c => c.charCodeAt(0));
            
            // Write image to FFmpeg memory
            const frameName = `frame_${String(i).padStart(3, '0')}.jpg`;
            await ffmpeg.writeFile(frameName, buffer);
        }

        // Step 3: Command FFmpeg to stitch the images into an MP4
        progressText.innerText = 'Stitching MP4...';
        
        await ffmpeg.exec([
            '-framerate', '1', 
            '-i', 'frame_%03d.jpg', 
            '-c:v', 'libx264', 
            '-pix_fmt', 'yuv420p', 
            'output.mp4'
        ]);

        // Retrieve final video
        const videoData = await ffmpeg.readFile('output.mp4');
        const videoBlob = new Blob([videoData.buffer], { type: 'video/mp4' });
        const videoUrl = URL.createObjectURL(videoBlob);

        // Cleanup virtual memory
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