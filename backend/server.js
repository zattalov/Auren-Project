/**
 * AUREN Backend Server
 * 
 * Express server that orchestrates After Effects rendering.
 * Receives render requests from the frontend, processes project data,
 * and drives aerender.exe to produce rendered video files.
 * 
 * Run with:  node server.js
 * Port:      4000 (or PORT env variable)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { renderProject, isAfterEffectsRunning, DATA_DIR, EXPORT_DIR, AERENDER_PATH, BASE_DIR } = require('./scripts/render');

const SUPABASE_URL = 'https://fdregdbxjcjpqikpxwym.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkcmVnZGJ4amNqcHFpa3B4d3ltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NTk4NzksImV4cCI6MjA4ODUzNTg3OX0.TKZA8Q58gD6ZeBbTY1x7kA0PPWWeo0Ra6GKZaf18Yfc';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const HISTORY_DIR = path.join(BASE_DIR, 'History');
fs.ensureDirSync(HISTORY_DIR);

// Configure multer for image uploads (store in memory temporarily)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();
const PORT = process.env.PORT || 4000;
const SERVER_START_TIME = Date.now();

// ── Log Buffer (ring buffer for dashboard) ──
const LOG_BUFFER_MAX = 300;
const logBuffer = [];
let logIdCounter = 0;

function pushLog(level, message) {
    const entry = {
        id: ++logIdCounter,
        level,
        message,
        timestamp: new Date().toISOString(),
    };
    logBuffer.push(entry);
    if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
}

// Intercept console.log / console.error to also push to log buffer
const _origLog = console.log;
const _origError = console.error;
const _origWarn = console.warn;

console.log = (...args) => {
    _origLog(...args);
    pushLog('info', args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
};
console.error = (...args) => {
    _origError(...args);
    pushLog('error', args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
};
console.warn = (...args) => {
    _origWarn(...args);
    pushLog('warn', args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
};

// ── Middleware ──
app.use(cors());
app.use(express.json());

// Serve dashboard static files
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));

// Track active render job
let activeRender = null;

// ── Routes ──

/**
 * GET /api/server/info
 * Returns server metadata for the dashboard.
 */
app.get('/api/server/info', async (req, res) => {
    const aeInstalled = await fs.pathExists(AERENDER_PATH);
    const uptimeMs = Date.now() - SERVER_START_TIME;
    res.json({
        success: true,
        port: PORT,
        uptimeMs,
        startedAt: new Date(SERVER_START_TIME).toISOString(),
        aeInstalled,
        dataDir: DATA_DIR,
        exportDir: EXPORT_DIR,
    });
});

/**
 * GET /api/logs
 * Returns the log buffer (optionally filtered by `since` id query param).
 */
app.get('/api/logs', (req, res) => {
    const sinceId = parseInt(req.query.since) || 0;
    const entries = sinceId ? logBuffer.filter(e => e.id > sinceId) : logBuffer;
    res.json({ success: true, logs: entries });
});

// ==========================================
//  SUPABASE WORKER LOGIC
// ==========================================

async function startSupabaseWorker() {
    console.log('[AUREN] Supabase worker started, polling for jobs at https://fdregdbxjcjpqikpxwym.supabase.co...');

    setInterval(async () => {
        if (activeRender) return; // Wait until current render is done

        try {
            // Check for pending jobs
            const { data: job, error } = await supabase
                .from('render_jobs')
                .select('*')
                .eq('status', 'pending')
                .order('created_at', { ascending: true })
                .limit(1)
                .single();

            // Suppress "No rows" errors since those are normal for polling
            if (error && error.code === 'PGRST116') return;
            if (error || !job) return;

            console.log(`\n${'═'.repeat(60)}`);
            console.log(`[AUREN] 🎬 Found new job from Cloud: ${job.slug_name}`);
            console.log(`${'═'.repeat(60)}\n`);

            // Mark job as rendering immediately to prevent other workers from taking it
            await supabase.from('render_jobs').update({ status: 'rendering' }).eq('id', job.id);

            const exportData = job.export_data;
            const slugName = job.slug_name;

            // Prepare local folder
            const projectDir = path.join(DATA_DIR, slugName);
            await fs.ensureDir(projectDir);

            // Download images from storage
            if (exportData.images && exportData.images.length > 0) {
                for (const img of exportData.images) {
                    if (img.fileName) {
                        const cloudPath = `${slugName}/${img.fileName}`;
                        const localPath = path.join(projectDir, img.fileName);

                        console.log(`[AUREN] Downloading image: ${img.fileName}...`);
                        const { data: fileData, error: downloadError } = await supabase
                            .storage
                            .from('project-files')
                            .download(cloudPath);

                        if (downloadError) {
                            console.error(`[AUREN] Failed to download image ${img.fileName}:`, downloadError);
                        } else if (fileData) {
                            const buffer = Buffer.from(await fileData.arrayBuffer());
                            await fs.writeFile(localPath, buffer);
                            console.log(`[AUREN] Downloaded image successfully.`);
                        }
                    }
                }
            }

            // Save JSON
            const jsonPath = path.join(projectDir, `${slugName}.json`);
            await fs.writeJson(jsonPath, exportData, { spaces: 2 });
            console.log(`[AUREN] Saved project data locally.`);

            // Start Render
            const aeInstalled = await isAfterEffectsRunning();
            if (!aeInstalled) {
                throw new Error('After Effects installation not found.');
            }

            activeRender = {
                slugName,
                status: 'starting',
                startedAt: new Date().toISOString(),
                currentStep: 0,
                totalSteps: 6,
                currentComp: null,
            };

            const stepMap = {
                'Validating project...': 1,
                'Reading project data...': 2,
                'Preparing AE project...': 3,
                'Generating ExtendScript...': 4,
                'Running After Effects (fill + render)...': 5,
                'Collecting outputs...': 6,
            };

            const result = await renderProject(slugName, (status) => {
                activeRender.status = status;
                if (stepMap[status]) activeRender.currentStep = stepMap[status];
                console.log(`[AUREN] Status: ${status}`);
            });

            if (result.success) {
                console.log(`\n${'═'.repeat(60)}`);
                console.log(`[AUREN] ✅ Render complete for: ${slugName}`);
                console.log(`[AUREN]    Outputs: ${result.outputs.join(', ')}`);
                console.log(`${'═'.repeat(60)}\n`);

                // Move to history
                try {
                    const historyDir = path.join(HISTORY_DIR, slugName);
                    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
                    for (let attempt = 1; attempt <= 3; attempt++) {
                        try {
                            await fs.move(projectDir, historyDir, { overwrite: true });
                            console.log(`[AUREN] Moved project ${slugName} to History.`);
                            break;
                        } catch (err) {
                            if (attempt < 3 && err.code !== 'ENOENT') {
                                await delay(2000);
                            } else {
                                throw err;
                            }
                        }
                    }
                } catch (e) { console.error('[AUREN] History move error:', e); }

                // Update Supabase
                await supabase.from('render_jobs').update({ status: 'completed' }).eq('id', job.id);
            } else {
                console.error(`\n${'═'.repeat(60)}`);
                console.error(`[AUREN] ❌ Render failed for: ${slugName}`);
                console.error(`[AUREN]    Errors: ${result.errors.join(', ')}`);
                console.error(`${'═'.repeat(60)}\n`);

                await supabase.from('render_jobs').update({
                    status: 'failed',
                    error_message: result.errors.join(', ')
                }).eq('id', job.id);
            }

            activeRender.result = result;
            activeRender.status = result.success ? 'completed' : 'failed';
            activeRender.currentStep = 6;
            activeRender.completedAt = new Date().toISOString();

            // Auto-clear activeRender after 10 seconds so we can take the next job
            setTimeout(() => { activeRender = null; }, 10000);

        } catch (err) {
            console.error('[AUREN] Worker error:', err.message);
        }
    }, 5000); // Check every 5 seconds
}

startSupabaseWorker();

/**
 * GET /api/render/status
 * Returns the current render status for the local dashboard.
 */
app.get('/api/render/status', (req, res) => {
    if (!activeRender) {
        return res.json({ success: true, status: 'idle', message: 'No render in progress' });
    }

    res.json({
        success: true,
        ...activeRender,
    });
});

/**
 * Serve rendered videos as static files
 */
app.use('/exports', express.static(EXPORT_DIR));

// ── Start Server ──
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════╗
║          AUREN Render Backend                ║
║──────────────────────────────────────────────║
║  Server running on port ${PORT}                ║
║  Data directory:    ${DATA_DIR}              
║  Export directory:  ${EXPORT_DIR}            
║──────────────────────────────────────────────║
║  Endpoints:                                  ║
║    GET  /api/projects      - List projects   ║
║    POST /api/render        - Start render    ║
║    GET  /api/render/status - Render status   ║
║    POST /api/render/clear  - Clear state     ║
╚══════════════════════════════════════════════╝
  `);
});
