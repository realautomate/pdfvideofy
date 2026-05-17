// Ensure we use the correct namespace for FFmpeg v0.12+
const { FFmpeg } = window.FFmpegWASM || window;
let ffmpeg = null;

// Configure PDF.js Worker path using a reliable public CDN worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// DOM Element Selectors
const fileInput = document.getElementById('file-input') || document.querySelector('input[type="file"]');
const convertBtn = document.getElementById('convert-btn') || document.querySelector('button');
const statusDiv = document.getElementById('status');
const downloadContainer = document.getElementById('download-container');
const downloadLink = document.getElementById('download-link');

/**
 * Update UI Status Messages
 */
function updateStatus(message, isError = false) {
    if (!statusDiv) return;
    statusDiv.textContent = message;
    statusDiv.className = isError 
        ? "text-red-400 text-sm mt-2 text-center font-medium" 
        : "text-slate-300 text-sm mt-2 text-center";
}

/**
 * Initialize FFmpeg WebAssembly Core Engine
 */
async function initFFmpeg() {
    if (ffmpeg) return ffmpeg;
    
    updateStatus("Initializing high-speed video engine...");
    ffmpeg = new FFmpeg();

    // Enable logging to see FFmpeg progress in the browser console
    ffmpeg.on('log', ({ message }) => {
        console.log(`[FFmpeg] ${message}`);
    });
    
    // Use unpkg CDN for reliable v0.12 core/wasm loading
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    
    await ffmpeg.load({
        coreURL: `${baseURL}/ffmpeg-core.js`,
        wasmURL: `${baseURL}/ffmpeg-core.wasm`,
    });
    
    return ffmpeg;
}

/**
 * Helper function to zero-pad image names for sequential FFmpeg ingestion
 */
function padZero(num, size = 3) {
    return num.toString().padStart(size, '0');
}

/**
 * Main Orchestration Loop: Converts PDF pages to frames and compiles MP4
 */
async function convertPdfToVideo() {
    const file = fileInput?.files[0];
    if (!file) {
        updateStatus("Please choose a valid PDF file first.", true);
        return;
    }

    try {
        convertBtn.disabled = true;
        if (downloadContainer) downloadContainer.classList.add('hidden');
        
        // 1. Initialize WebAssembly Assets
        const ffmpegCore = await initFFmpeg();
        
        updateStatus("Reading PDF document streams...");
        const fileReader = new FileReader();
        
        fileReader.onload = async function () {
            try {
                const typedArray = new Uint8Array(this.result);
                const pdf = await pdfjsLib.getDocument(typedArray).promise;
                
                let masterWidth = 0;
                let masterHeight = 0;
                
                // Create an offline dynamic template canvas for rendering
                const mainCanvas = document.createElement('canvas');
                const ctx = mainCanvas.getContext('2d');
                
                updateStatus(`Slicing ${pdf.numPages} document frames and stamping markers...`);
                
                // 2. Loop Through and Normalize Every PDF Page
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    const page = await pdf.getPage(pageNum);
                    
                    // Render page at high definition scale
                    const viewport = page.getViewport({ scale: 2.0 });
                    const tempCanvas = document.createElement('canvas');
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCanvas.width = viewport.width;
                    tempCanvas.height = viewport.height;
                    
                    await page.render({ canvasContext: tempCtx, viewport: viewport }).promise;
                    
                    // Freeze master dimensions using Page 1 as strict configuration baseline
                    if (pageNum === 1) {
                        masterWidth = tempCanvas.width;
                        masterHeight = tempCanvas.height;
                        
                        // H.264 video codec constraints require even width/height pixels
                        if (masterWidth % 2 !== 0) masterWidth--;
                        if (masterHeight % 2 !== 0) masterHeight--;
                    }
                    
                    // Lock the output canvas frame to target constraints
                    mainCanvas.width = masterWidth;
                    mainCanvas.height = masterHeight;
                    
                    // Paint slate theme background canvas clear space
                    ctx.fillStyle = '#0f172a'; 
                    ctx.fillRect(0, 0, masterWidth, masterHeight);
                    
                    // Aspect ratio calculations for letterboxing/pillarboxing odd cover images
                    const scale = Math.min(masterWidth / tempCanvas.width, masterHeight / tempCanvas.height);
                    const xOffset = (masterWidth - tempCanvas.width * scale) / 2;
                    const yOffset = (masterHeight - tempCanvas.height * scale) / 2;
                    
                    ctx.drawImage(tempCanvas, xOffset, yOffset, tempCanvas.width * scale, tempCanvas.height * scale);
                    
                    // 3. Stamp Page Number Watermark
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)'; 
                    ctx.font = `bold ${Math.round(masterHeight * 0.025)}px sans-serif`; 
                    ctx.textAlign = 'right';
                    ctx.textBaseline = 'bottom';
                    
                    const paddingX = masterWidth * 0.04;
                    const paddingY = masterHeight * 0.03;
                    ctx.fillText(`Page ${pageNum} of ${pdf.numPages}`, masterWidth - paddingX, masterHeight - paddingY);
                    
                    // 4. MUCH FASTER: Compress to binary array via native fetch rather than manual JS loop
                    const dataUrl = mainCanvas.toDataURL('image/jpeg', 0.85);
                    const response = await fetch(dataUrl);
                    const imgBuffer = new Uint8Array(await response.arrayBuffer());
                    
                    const filename = `frame_${padZero(pageNum)}.jpg`;
                    await ffmpegCore.writeFile(filename, imgBuffer);
                }
                
                // 5. Invoke Multi-Threaded FFmpeg Command to Process Slideshow Output
                updateStatus("Stitching MP4 stream elements... This might take a moment. Check console for progress.");
                
                await ffmpegCore.exec([
                    '-framerate', '1',               // Displays each slide frame for exactly 1 second
                    '-i', 'frame_%03d.jpg',          // Ingests sequentially padded image buffers
                    '-c:v', 'libx264',               // Compiles using clean, high-compatibility H.264 profile
                    '-r', '30',                      // Inflates output rate container to stable 30fps standard
                    '-pix_fmt', 'yuv420p',           // Enforces global color space readability criteria
                    'output.mp4'                     // Output target naming structure
                ]);
                
                // 6. Read Output Stream (Fix: Pass raw array, not .buffer)
                updateStatus("Conversion complete!");
                const videoData = await ffmpegCore.readFile('output.mp4');
                const videoBlob = new Blob([videoData], { type: 'video/mp4' });
                const videoUrl = URL.createObjectURL(videoBlob);
                
                if (downloadLink && downloadContainer) {
                    downloadLink.href = videoUrl;
                    downloadLink.download = `${file.name.replace(/\.[^/.]+$/, "")}.mp4`;
                    downloadContainer.classList.remove('hidden');
                }
                
                // 7. Housekeeping: Wipe virtual memory allocation streams
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    await ffmpegCore.deleteFile(`frame_${padZero(pageNum)}.jpg`).catch(()=>{});
                }
                await ffmpegCore.deleteFile('output.mp4').catch(()=>{});

            } catch (innerError) {
                console.error(innerError);
                updateStatus(`Processing Error: ${innerError.message}`, true);
            } finally {
                convertBtn.disabled = false;
            }
        };
        
        fileReader.readAsArrayBuffer(file);
        
    } catch (err) {
        console.error(err);
        updateStatus(`Engine Initialization Failure: ${err.message}`, true);
        convertBtn.disabled = false;
    }
}

// Attach Application Trigger Events
if (convertBtn) {
    convertBtn.addEventListener('click', convertPdfToVideo);
}