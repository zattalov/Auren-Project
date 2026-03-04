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
const { renderProject, isAfterEffectsRunning, DATA_DIR, EXPORT_DIR, AERENDER_PATH } = require('./scripts/render');

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
 * Lists all available projects in the Data/ directory.
 */
app.get('/api/projects', async (req, res) => {
    try {
        const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
        const projects = [];

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const jsonPath = path.join(DATA_DIR, entry.name, `${entry.name}.json`);
                if (await fs.pathExists(jsonPath)) {
                    const data = await fs.readJson(jsonPath);
                    projects.push({
                        slugName: entry.name,
                        projectAspectRatio: data.projectAspectRatio || '',
                        nameTitleCount: (data.nameTitles || []).length,
                        keywordCount: (data.keywords || []).length,
                        imageCount: (data.images || []).length,
                    });
                }
            }
        }

        res.json({ success: true, projects });
    } catch (err) {
        console.error('[AUREN] Error listing projects:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/render
 * Starts an After Effects render for the specified project.
 * 
 * Body: { slugName: string }
 */
app.post('/api/render', async (req, res) => {
    const { slugName } = req.body;

    if (!slugName) {
        return res.status(400).json({ success: false, error: 'Missing slugName' });
    }

    // Check if a render is already in progress
    if (activeRender) {
        return res.status(409).json({
            success: false,
            error: `A render is already in progress for "${activeRender.slugName}". Please wait for it to complete.`,
        });
    }

    // Check if AE is already running (it would lock the project)
    const aeRunning = await isAfterEffectsRunning();
    if (aeRunning) {
        return res.status(409).json({
            success: false,
            error: 'After Effects is currently running. Please close it before starting a render.',
        });
    }

    // Validate the project exists
    const jsonPath = path.join(DATA_DIR, slugName, `${slugName}.json`);
    if (!await fs.pathExists(jsonPath)) {
        return res.status(404).json({
            success: false,
            error: `Project "${slugName}" not found. Save the project data first.`,
        });
    }

    // Start the render (don't await — respond immediately)
    activeRender = {
        slugName,
        status: 'starting',
        startedAt: new Date().toISOString(),
        currentStep: 0,
        totalSteps: 7,
        currentComp: null,
    };

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[AUREN] 🎬 Starting render for project: ${slugName}`);
    console.log(`${'═'.repeat(60)}\n`);

    // Respond immediately so the frontend isn't blocked
    res.json({
        success: true,
        message: `Render started for "${slugName}"`,
        status: 'rendering',
    });

    // Map status strings to step numbers for progress tracking
    const stepMap = {
        'Validating project...': 1,
        'Reading project data...': 2,
        'Preparing After Effects project...': 3,
        'Generating ExtendScript...': 4,
        'Filling After Effects data...': 5,
    };

    // Run the render pipeline in the background
    try {
        const result = await renderProject(slugName, (status) => {
            activeRender.status = status;
            // Track step number
            if (stepMap[status]) {
                activeRender.currentStep = stepMap[status];
            }
            // Track which comp is rendering
            const compMatch = status.match(/^Rendering (\S+)/);
            if (compMatch) {
                activeRender.currentStep = 6;
                activeRender.currentComp = compMatch[1].replace(':', '');
            }
            console.log(`[AUREN] Status: ${status}`);
        });

        if (result.success) {
            console.log(`\n${'═'.repeat(60)}`);
            console.log(`[AUREN] ✅ Render complete for: ${slugName}`);
            console.log(`[AUREN]    Outputs: ${result.outputs.join(', ')}`);
            console.log(`${'═'.repeat(60)}\n`);
        } else {
            console.error(`\n${'═'.repeat(60)}`);
            console.error(`[AUREN] ❌ Render failed for: ${slugName}`);
            console.error(`[AUREN]    Errors: ${result.errors.join(', ')}`);
            console.error(`${'═'.repeat(60)}\n`);
        }

        activeRender.result = result;
        activeRender.status = result.success ? 'completed' : 'failed';
        activeRender.currentStep = 7;
        activeRender.completedAt = new Date().toISOString();

    } catch (err) {
        console.error(`[AUREN] Pipeline crash: ${err.message}`);
        activeRender.status = 'crashed';
        activeRender.error = err.message;
    }
});

/**
 * GET /api/render/status
 * Returns the current render status.
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
 * POST /api/render/clear
 * Clears the last render result so a new render can start.
 */
app.post('/api/render/clear', (req, res) => {
    if (activeRender && (activeRender.status === 'completed' || activeRender.status === 'failed' || activeRender.status === 'crashed')) {
        activeRender = null;
        return res.json({ success: true, message: 'Render state cleared' });
    }

    if (activeRender) {
        return res.status(409).json({ success: false, error: 'Cannot clear — render still in progress' });
    }

    res.json({ success: true, message: 'Nothing to clear' });
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
