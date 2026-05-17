console.log("========================================");
console.log("🚀 PDFVIDEOFY DIAGNOSTIC ENGINE LOADED 🚀");
console.log("========================================");

// Ensure we use the correct namespace for FFmpeg v0.12+
const { FFmpeg } = window.FFmpegWASM;
let ffmpeg = null;

// Configure PDF.js Worker path using your local file
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.js';

// DOM Element Selectors
const fileInput = document.getElementById('file-input') || document.querySelector('input[type="file"]');
const convertBtn = document.getElementById('convert-btn') || document.querySelector('button');
const statusDiv = document.getElementById('status');
const downloadContainer = document.getElementById('download-container');
const downloadLink = document.getElementById('download-link');

console.log("🔍 System Check:");
console.log("- File Input Found:", !!fileInput);
console.log("- Button Found:", !!convertBtn);

function updateStatus(message, isError = false) {
    console.log("🔔 STATUS UPDATE:", message);
    if (!statusDiv) return;
    statusDiv.textContent = message;
    statusDiv.className = isError 
        ? "text-red-400 text-sm mt-2 text-center font-medium" 
        : "text-slate-300 text-sm mt-2 text-center";
}

async function initFFmpeg() {
    console.log("⚙️ Booting WebAssembly Engine...");
    if (ffmpeg) return ffmpeg;
    
    updateStatus("Initializing high-speed video engine...");
    ffmpeg = new FFmpeg();
    
    await ffmpeg.load({
        coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
        wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm'
    });
    console.log("✅ Engine Booted Successfully");
    return ffmpeg;
}

function padZero(num, size = 3) {
    let s = num + "";
    while (s.length < size) s = "0" + s;
    return s;
}

async function convertPdfToVideo() {
    console.log("▶️ Conversion Triggered!");
    const file = fileInput?.files[0];
    if (!file) {
        console.log("❌ No file detected in input!");
        updateStatus("Please choose a valid PDF file first.", true);
        return;
    }
    
    console.log("📄 File selected:", file.name, `(${file.size} bytes)`);

    try {
        convertBtn.disabled = true;
        if (downloadContainer) downloadContainer.classList.add('hidden');
        
        const ffmpegCore = await initFFmpeg();
        
        updateStatus("Reading PDF document streams...");
        const fileReader = new FileReader();
        
        fileReader.onload = async function () {
            console.log("📖 File loaded into memory, parsing PDF...");
            try {
                const typedArray = new Uint8Array(this.result);
                const pdf = await pdfjsLib.getDocument(typedArray).promise;
                console.log(`📑 PDF Parsed! Found ${pdf.numPages} pages.`);
                
                let masterWidth = 0;
                let masterHeight = 0;
                
                const mainCanvas = document.createElement('canvas');
                const ctx = mainCanvas.getContext('2d');
                
                updateStatus("Slicing document frames and stamping markers...");
                
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    console.log(`🖼️ Processing Page ${pageNum}...`);
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
                        console.log(`📏 Master Dimensions Locked: ${masterWidth}x${masterHeight}`);
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
                    
                    for (let i = 0; i < binaryData.length; i++) {
                        imgBuffer[i] = binaryData.charCodeAt(i);
                    }
                    
                    const filename = `frame_${padZero(pageNum)}.jpg`;
                    await ffmpegCore.writeFile(filename, imgBuffer);
                }
                
                updateStatus("Stitching MP4 stream elements... This might take a moment.");
                console.log("🎬 Starting FFmpeg compilation...");
                
                await ffmpegCore.exec([
                    '-framerate', '1',
                    '-i', 'frame_%03d.jpg',
                    '-c:v', 'libx264',
                    '-r', '30',
                    '-pix_fmt', 'yuv420p',
                    'output.mp4'
                ]);
                
                console.log("✅ FFmpeg compilation finished!");
                updateStatus("Conversion complete!");
                
                const videoData = await ffmpegCore.readFile('output.mp4');
                const videoBlob = new Blob([videoData.buffer], { type: 'video/mp4' });
                const videoUrl = URL.createObjectURL(videoBlob);
                
                if (downloadLink && downloadContainer) {
                    downloadLink.href = videoUrl;
                    downloadLink.download = `${file.name.replace(/\.[^/.]+$/, "")}.mp4`;
                    downloadContainer.classList.remove('hidden');
                    console.log("🎉 Video ready for download!");
                }
                
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    try { await ffmpegCore.deleteFile(`frame_${padZero(pageNum)}.jpg`); } catch (e) {}
                }
                try { await ffmpegCore.deleteFile('output.mp4'); } catch (e) {}

            } catch (innerError) {
                console.error("❌ CRITICAL ERROR DURING PROCESSING:", innerError);
                updateStatus(`Processing Error: ${innerError.message}`, true);
            } finally {
                convertBtn.disabled = false;
            }
        };
        
        fileReader.readAsArrayBuffer(file);
        
    } catch (err) {
        console.error("❌ ENGINE INITIALIZATION ERROR:", err);
        updateStatus(`Engine Initialization Failure: ${err.message}`, true);
        convertBtn.disabled = false;
    }
}

// Event Listeners
if (convertBtn) {
    convertBtn.addEventListener('click', () => {
        console.log("🖱️ Button Clicked!");
        convertPdfToVideo();
    });
}

if (fileInput) {
    fileInput.addEventListener('click', (e) => { e.target.value = null; });
    fileInput.addEventListener('change', () => {
        console.log("📂 File Browser Selected File!");
        convertPdfToVideo();
    });
}

window.addEventListener('dragover', (e) => {
    e.preventDefault();
});

window.addEventListener('drop', (e) => {
    e.preventDefault();
    console.log("📥 Drop Event Detected!");
    if (e.dataTransfer.files.length > 0) {
        fileInput.files = e.dataTransfer.files;
        console.log("📂 File attached from drop:", e.dataTransfer.files[0].name);
        convertPdfToVideo();
    }
});