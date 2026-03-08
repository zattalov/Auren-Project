/**
 * render.js
 * 
 * Orchestrates the After Effects render pipeline:
 *   1. Copies Master_Project.aep to a working copy
 *   2. Generates an all-in-one ExtendScript (.jsx) that fills text AND renders
 *   3. Runs the script via AfterFX.com -s "$.evalFile(...)"
 *   4. Returns the output file paths
 * 
 * The script does text replacement AND rendering inside AE's render queue,
 * avoiding the unreliable two-step approach (fill → aerender).
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const { generateExtendScript } = require('./generate-extendscript');

// ── Configuration ──
const AFTER_EFFECTS_DIR = 'C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files';
const AERENDER_PATH = path.join(AFTER_EFFECTS_DIR, 'aerender.exe');
const AFTERFX_PATH = path.join(AFTER_EFFECTS_DIR, 'AfterFX.exe');
const AFTERFX_COM_PATH = path.join(AFTER_EFFECTS_DIR, 'AfterFX.com');

const BASE_DIR = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(BASE_DIR, 'templates');
const DATA_DIR = path.join(BASE_DIR, 'Data');
const EXPORT_DIR = path.join(BASE_DIR, 'exported-videos');
const MASTER_AEP = path.join(TEMPLATES_DIR, 'Master_Project.aep');

/**
 * Check if aerender.exe / AfterFX.exe exist at the configured paths.
 */
async function isAfterEffectsRunning() {
    return (await fs.pathExists(AFTERFX_COM_PATH)) && (await fs.pathExists(AERENDER_PATH));
}

/**
 * Run an ExtendScript via AfterFX.com -s "$.evalFile(...)".
 * AfterFX.com is the console version of After Effects, designed for CLI usage.
 * Using -s with $.evalFile() is the most reliable way to run scripts from command line.
 * 
 * @param {string} jsxPath - Absolute path to the .jsx file
 * @returns {Promise<{success: boolean, output: string}>}
 */
function runExtendScript(jsxPath, outputDir) {
    return new Promise(async (resolve, reject) => {
        console.log('[AUREN] Running ExtendScript via AfterFX.exe: ' + jsxPath);

        // Pre-clean any old signaling files
        const doneFile = path.join(outputDir, 'auren_done.txt');
        const errFile = path.join(outputDir, 'auren_error.txt');
        await fs.remove(doneFile);
        await fs.remove(errFile);

        // Launch the actual AfterFX.exe application in GUI mode with -r (run script)
        // Using detached: true and stdio: 'ignore' ensures Node.js doesn't hang
        // waiting for AE to close.
        const proc = spawn(AFTERFX_PATH, ['-r', jsxPath], {
            detached: true,
            stdio: 'ignore'
        });

        proc.unref(); // Release the process from Node's event loop

        // Poll for completion since we have no stdout/close event
        const checkInterval = setInterval(async () => {
            try {
                if (await fs.pathExists(doneFile)) {
                    clearInterval(checkInterval);
                    console.log('[AUREN] ExtendScript completed successfully');
                    resolve({ success: true, output: 'Render queue prepared' });
                } else if (await fs.pathExists(errFile)) {
                    clearInterval(checkInterval);
                    const err = await fs.readFile(errFile, 'utf8');
                    console.error('[AUREN] ExtendScript failed: ' + err);
                    resolve({ success: false, output: err });
                }
            } catch (e) {
                // Ignore transient file system errors during polling
            }
        }, 2000);
    });
}

/**
 * Execute aerender.exe to natively render the pre-configured render queue.
 * 
 * @param {string} aepPath - Absolute path to the .aep file
 * @returns {Promise<{success: boolean, output: string}>}
 */
function runAERender(aepPath) {
    return new Promise((resolve) => {
        console.log('[AUREN] Starting native aerender.exe on: ' + aepPath);
        
        const proc = spawn(AERENDER_PATH, ['-project', aepPath], {
            detached: false,
        });

        let outputLog = '';

        proc.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            lines.forEach(line => {
                if (line.trim()) console.log(`[AERender] ${line.trim()}`);
            });
            outputLog += data.toString();
        });

        proc.stderr.on('data', (data) => {
            console.error(`[AERender Warning] ${data.toString().trim()}`);
            outputLog += data.toString();
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve({ success: true, output: outputLog });
            } else {
                resolve({ success: false, output: `aerender exited with code ${code}` });
            }
        });
        
        proc.on('error', (err) => {
            console.error('[AERender Error]', err);
            resolve({ success: false, output: err.message });
        });
    });
}

/**
 * Main render pipeline.
 * 
 * @param {string} slugName - The project slug (subfolder name in Data/)
 * @param {Function} onStatus - Callback for progress updates
 * @returns {Promise<Object>} Results with success flag, outputs, and errors
 */
async function renderProject(slugName, onStatus = () => { }) {
    const results = { success: false, outputs: [], errors: [] };

    try {
        // ── Step 1: Validate ──
        onStatus('Validating project...');
        const projectDir = path.join(DATA_DIR, slugName);
        const jsonPath = path.join(projectDir, slugName + '.json');

        if (!await fs.pathExists(projectDir)) {
            throw new Error('Project directory not found: ' + slugName);
        }
        if (!await fs.pathExists(jsonPath)) {
            throw new Error('Project JSON not found: ' + slugName + '.json');
        }
        if (!await fs.pathExists(MASTER_AEP)) {
            throw new Error('Master_Project.aep not found in templates/');
        }

        console.log('[AUREN] ══════════════════════════════════════════');
        console.log('[AUREN] Starting render for: ' + slugName);
        console.log('[AUREN] ══════════════════════════════════════════');

        // ── Step 2: Read project data ──
        onStatus('Reading project data...');
        const data = await fs.readJson(jsonPath);
        console.log('[AUREN] Project data loaded: ' + slugName);

        // ── Step 3: Copy Master_Project.aep to working copy ──
        onStatus('Preparing AE project...');
        const workingAep = path.join(projectDir, slugName + '.aep');
        await fs.copy(MASTER_AEP, workingAep, { overwrite: true });

        // Also copy template assets (images) if they don't exist in project dir
        const templateFiles = await fs.readdir(TEMPLATES_DIR);
        for (const file of templateFiles) {
            if (file === 'Master_Project.aep') continue;
            const src = path.join(TEMPLATES_DIR, file);
            const dest = path.join(projectDir, file);
            const stat = await fs.stat(src);
            if (stat.isFile() && !await fs.pathExists(dest)) {
                await fs.copy(src, dest);
            }
        }

        console.log('[AUREN] Working AEP created: ' + workingAep);

        // ── Step 4: Generate the all-in-one ExtendScript ──
        onStatus('Generating ExtendScript...');
        const outputDir = path.join(EXPORT_DIR, slugName);
        await fs.ensureDir(outputDir);
        
        // Ensure Auto-Save folder exists to prevent silent After Effects crash
        const autoSaveDir = path.join(projectDir, 'Adobe After Effects Auto-Save');
        await fs.ensureDir(autoSaveDir);

        const jsxContent = generateExtendScript({
            aepPath: workingAep,
            projectDir: projectDir,
            outputDir: outputDir,
            data: data,
        });

        const jsxPath = path.join(projectDir, 'fill_and_render.jsx');
        await fs.writeFile(jsxPath, jsxContent, 'utf-8');
        console.log('[AUREN] ExtendScript generated: ' + jsxPath);

        // ── Step 5: Run the script (fills text + prepares render queue) ──
        onStatus('Running After Effects (fill + render)...');
        const scriptResult = await runExtendScript(jsxPath, outputDir);

        if (!scriptResult.success) {
            throw new Error('ExtendScript execution failed: ' + scriptResult.output);
        }

        // ── Step 6: Execute Background Render ──
        onStatus('Executing aerender.exe...');
        const renderResult = await runAERender(workingAep);

        if (!renderResult.success) {
            throw new Error('aerender.exe execution failed: ' + renderResult.output);
        }

        // ── Step 7: Collect output files ──
        onStatus('Collecting outputs...');
        const outputFiles = await fs.readdir(outputDir);
        for (const file of outputFiles) {
            const fullPath = path.join(outputDir, file);
            const stat = await fs.stat(fullPath);
            if (stat.isFile()) {
                results.outputs.push(fullPath);
                console.log('[AUREN] Output: ' + fullPath);
            }
        }

        results.success = results.outputs.length > 0;
        if (results.success) {
            console.log('[AUREN] ══════════════════════════════════════════');
            console.log('[AUREN] ✅ Render complete for: ' + slugName);
            console.log('[AUREN] Outputs: ' + results.outputs.join(', '));
            console.log('[AUREN] ══════════════════════════════════════════');
        } else {
            results.errors.push('No output files found after rendering');
        }

    } catch (err) {
        results.success = false;
        results.errors.push(err.message);
        console.error('[AUREN] Pipeline error: ' + err.message);
    }

    return results;
}

module.exports = {
    renderProject,
    runExtendScript,
    isAfterEffectsRunning,
    AERENDER_PATH,
    AFTERFX_PATH,
    BASE_DIR,
    DATA_DIR,
    EXPORT_DIR,
    TEMPLATES_DIR,
};
