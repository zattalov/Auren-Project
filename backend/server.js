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

const SETTINGS_FILE = path.join(BASE_DIR, 'settings.json');
const DEFAULT_SETTINGS = {
    nameTitle: { 
        compName: 'lower-third', 
        layerName_name: 'name', 
        layerName_title1: 'title1', 
        layerName_title2: 'title2' 
    },
    keyword: { 
        compName: 'keyword', 
        layerName_keyword: 'Keyword_text' 
    },
    image: { 
        compName: 'image', 
        layerName_source: 'source', 
        footageName: 'sample image.png' 
    }
};

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

/**
 * GET /api/projects
 * Scans Data and History directories to return all projects for the dashboard.
 */
app.get('/api/projects', async (req, res) => {
    try {
        const projects = [];

        // Scan DATA_DIR (active projects)
        if (await fs.pathExists(DATA_DIR)) {
            const dirs = await fs.readdir(DATA_DIR);
            for (const dir of dirs) {
                const projectPath = path.join(DATA_DIR, dir);
                const stat = await fs.stat(projectPath);
                if (stat.isDirectory()) {
                    const jsonPath = path.join(projectPath, `${dir}.json`);
                    let data = {};
                    if (await fs.pathExists(jsonPath)) {
                        data = await fs.readJson(jsonPath);
                    }
                    
                    let status = 'pending';
                    if (activeRender && activeRender.slugName === dir && activeRender.status !== 'failed') {
                        status = 'in progress';
                    } else if (activeRender && activeRender.slugName === dir && activeRender.status === 'failed') {
                        status = 'failed';
                    }

                    projects.push({
                        slugName: dir,
                        status: status,
                        nameTitleCount: (data.nameTitles || []).length,
                        keywordCount: (data.keywords || []).length,
                        imageCount: (data.images || []).length,
                        projectAspectRatio: data.projectAspectRatio || ''
                    });
                }
            }
        }

        // Scan HISTORY_DIR (completed projects)
        if (await fs.pathExists(HISTORY_DIR)) {
            const dirs = await fs.readdir(HISTORY_DIR);
            for (const dir of dirs) {
                const projectPath = path.join(HISTORY_DIR, dir);
                const stat = await fs.stat(projectPath);
                if (stat.isDirectory()) {
                    const jsonPath = path.join(projectPath, `${dir}.json`);
                    let data = {};
                    if (await fs.pathExists(jsonPath)) {
                        data = await fs.readJson(jsonPath);
                    }
                    projects.push({
                        slugName: dir,
                        status: 'done',
                        nameTitleCount: (data.nameTitles || []).length,
                        keywordCount: (data.keywords || []).length,
                        imageCount: (data.images || []).length,
                        projectAspectRatio: data.projectAspectRatio || ''
                    });
                }
            }
        }

        res.json({ success: true, projects });
    } catch (error) {
        console.error('[AUREN] Failed to fetch projects:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch projects' });
    }
});

/**
 * GET /api/settings
 * Returns the currently saved Settings map
 */
app.get('/api/settings', async (req, res) => {
    try {
        if (await fs.pathExists(SETTINGS_FILE)) {
            const settings = await fs.readJson(SETTINGS_FILE);
            res.json({ success: true, settings });
        } else {
            res.json({ success: true, settings: DEFAULT_SETTINGS });
        }
    } catch (error) {
        console.error('[AUREN] Failed to read settings:', error);
        res.status(500).json({ success: false, error: 'Failed to read settings.' });
    }
});

/**
 * POST /api/settings
 * Saves the Settings map
 */
app.post('/api/settings', async (req, res) => {
    try {
        const settings = req.body.settings;
        if (!settings) {
            return res.status(400).json({ success: false, error: 'Invalid settings object.' });
        }
        await fs.writeJson(SETTINGS_FILE, settings, { spaces: 2 });
        res.json({ success: true, message: 'Settings saved successfully.' });
    } catch (error) {
        console.error('[AUREN] Failed to save settings:', error);
        res.status(500).json({ success: false, error: 'Failed to save settings.' });
    }
});

/**
 * POST /api/history/:slug/rerender
 * Moves a project back to Data and resets its Supabase status to pending.
 */
app.post('/api/history/:slug/rerender', async (req, res) => {
    try {
        const slug = req.params.slug;
        const historyPath = path.join(HISTORY_DIR, slug);
        const dataPath = path.join(DATA_DIR, slug);

        if (await fs.pathExists(historyPath)) {
            await fs.move(historyPath, dataPath, { overwrite: true });
        } else if (!await fs.pathExists(dataPath)) {
            return res.status(404).json({ success: false, error: 'Project not found locally.' });
        }

        // Reset in Supabase so worker picks it up
        await supabase.from('render_jobs')
            .update({ status: 'pending', error_message: null })
            .eq('slug_name', slug);

        res.json({ success: true, message: 'Project queued for re-render.' });
    } catch (error) {
        console.error('[AUREN] Re-render error:', error);
        res.status(500).json({ success: false, error: 'Failed to queue re-render.' });
    }
});

/**
 * DELETE /api/history/:slug
 * Deletes a project from the local History and exported-videos folder.
 */
app.delete('/api/history/:slug', async (req, res) => {
    try {
        const slug = req.params.slug;
        const historyPath = path.join(HISTORY_DIR, slug);
        const exportPath = path.join(EXPORT_DIR, slug);

        await fs.remove(historyPath);
        await fs.remove(exportPath);

        // Optional: Remove from Supabase or leave as is?
        // We'll just do local deletion.

        res.json({ success: true, message: 'Project deleted from history.' });
    } catch (error) {
        console.error('[AUREN] Delete history error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete project.' });
    }
});

/**
 * POST /api/history/:slug/open
 * Opens the rendered video export folder in Windows Explorer.
 */
app.post('/api/history/:slug/open', async (req, res) => {
    try {
        const slug = req.params.slug;
        const exportPath = path.join(EXPORT_DIR, slug);

        if (!await fs.pathExists(exportPath)) {
            return res.status(404).json({ success: false, error: 'Export folder not found.' });
        }

        const { exec } = require('child_process');
        exec(`start "" "${exportPath}"`);

        res.json({ success: true, message: 'Folder opened.' });
    } catch (error) {
        console.error('[AUREN] Open folder error:', error);
        res.status(500).json({ success: false, error: 'Failed to open folder.' });
    }
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

            // Read Settings
            let settings = DEFAULT_SETTINGS;
            try {
                if (await fs.pathExists(SETTINGS_FILE)) settings = await fs.readJson(SETTINGS_FILE);
            } catch (e) { console.error('Settings read error', e); }

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

            const result = await renderProject(slugName, settings, (status) => {
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
 * POST /api/render
 * Starts the render pipeline for a specific project directory.
 */
app.post('/api/render', async (req, res) => {
    if (activeRender) {
        return res.status(400).json({ success: false, error: 'A render is already in progress.' });
    }

    const { slugName } = req.body;
    if (!slugName) return res.status(400).json({ success: false, error: 'Missing slugName.' });

    const projectDir = path.join(DATA_DIR, slugName);
    if (!await fs.pathExists(projectDir)) {
        return res.status(404).json({ success: false, error: 'Project not found locally.' });
    }

    // Read Settings
    let settings = DEFAULT_SETTINGS;
    try {
        if (await fs.pathExists(SETTINGS_FILE)) settings = await fs.readJson(SETTINGS_FILE);
    } catch (e) {
        console.error('Settings read error', e);
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[AUREN] 🎬 Starting LOCAL render for: ${slugName}`);
    console.log(`${'═'.repeat(60)}\n`);

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

    // Respond immediately, render in background
    res.json({ success: true, message: 'Render started.' });

    try {
        const aeInstalled = await isAfterEffectsRunning();
        if (!aeInstalled) throw new Error('After Effects installation not found.');

        const result = await renderProject(slugName, settings, (status) => {
            if (!activeRender) return;
            activeRender.status = status;
            if (stepMap[status]) activeRender.currentStep = stepMap[status];
            console.log(`[AUREN] Status: ${status}`);
        });

        if (!activeRender) return; // if it was cleared

        if (result.success) {
            console.log(`\n${'═'.repeat(60)}`);
            console.log(`[AUREN] ✅ LOCAL Render complete for: ${slugName}`);
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

            // Update Supabase if it exists
            await supabase.from('render_jobs').update({ status: 'completed' }).eq('slug_name', slugName);
        } else {
            console.error(`\n${'═'.repeat(60)}`);
            console.error(`[AUREN] ❌ LOCAL Render failed for: ${slugName}`);
            console.error(`[AUREN]    Errors: ${result.errors.join(', ')}`);
            console.error(`${'═'.repeat(60)}\n`);

            await supabase.from('render_jobs').update({
                status: 'failed',
                error_message: result.errors.join(', ')
            }).eq('slug_name', slugName);
        }

        activeRender.result = result;
        activeRender.status = result.success ? 'completed' : 'failed';
        activeRender.currentStep = 6;
        activeRender.completedAt = new Date().toISOString();

    } catch (err) {
        console.error('[AUREN] Local render pipeline error:', err);
        if (activeRender) {
            activeRender.status = 'failed';
            activeRender.result = { success: false, errors: [err.message] };
            activeRender.completedAt = new Date().toISOString();
        }
    }
}
);

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
