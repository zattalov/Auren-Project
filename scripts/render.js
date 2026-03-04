/**
 * render.js
 * 
 * Orchestrates the After Effects render pipeline:
 *   1. Copies Master_Project.aep to a working copy
 *   2. Runs the ExtendScript via AfterFX.exe to fill compositions
 *   3. Calls aerender.exe to render each composition
 *   4. Returns the output file paths
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const { generateExtendScript } = require('./generate-extendscript');

// ── Configuration ──
const AFTER_EFFECTS_DIR = 'C:\\Program Files\\Adobe\\Adobe After Effects 2025\\Support Files';
const AERENDER_PATH = path.join(AFTER_EFFECTS_DIR, 'aerender.exe');
const AFTERFX_PATH = path.join(AFTER_EFFECTS_DIR, 'AfterFX.exe');

const BASE_DIR = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(BASE_DIR, 'templates');
const DATA_DIR = path.join(BASE_DIR, 'Data');
const EXPORT_DIR = path.join(BASE_DIR, 'exported-videos');
const MASTER_AEP = path.join(TEMPLATES_DIR, 'Master_Project.aep');

/**
 * Check if After Effects is currently running.
 * @returns {Promise<boolean>}
 */
function isAfterEffectsRunning() {
    return new Promise((resolve) => {
        const proc = spawn('tasklist', ['/FI', 'IMAGENAME eq AfterFX.exe', '/FO', 'CSV', '/NH'], {
            shell: true,
        });
        let output = '';
        proc.stdout.on('data', (data) => { output += data.toString(); });
        proc.on('close', () => {
            resolve(output.toLowerCase().includes('afterfx.exe'));
        });
    });
}

/**
 * Run an ExtendScript via AfterFX.exe -r flag.
 * This opens AE in headless-ish mode, runs the script, and exits.
 * 
 * @param {string} jsxPath - Absolute path to the .jsx file
 * @returns {Promise<{success: boolean, output: string}>}
 */
function runExtendScript(jsxPath) {
    return new Promise((resolve, reject) => {
        console.log(`[AUREN] Running ExtendScript: ${jsxPath}`);

        // Use AfterFX.exe with -r flag to run script, -noui for no splash
        const proc = spawn(AFTERFX_PATH, ['-noui', '-r', jsxPath], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            const line = data.toString();
            stdout += line;
            console.log(`[AE Script] ${line.trim()}`);
        });

        proc.stderr.on('data', (data) => {
            const line = data.toString();
            stderr += line;
            console.error(`[AE Script ERR] ${line.trim()}`);
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve({ success: true, output: stdout });
            } else {
                resolve({ success: false, output: stderr || stdout || `Exit code: ${code}` });
            }
        });

        proc.on('error', (err) => {
            reject(new Error(`Failed to launch AfterFX.exe: ${err.message}`));
        });
    });
}

/**
 * Render a single composition using aerender.exe.
 * 
 * @param {Object} options
 * @param {string} options.aepPath   - Path to the .aep project file
 * @param {string} options.compName  - Composition name to render
 * @param {string} options.outputPath - Full output file path (including extension)
 * @param {Function} options.onProgress - Callback for progress updates
 * @returns {Promise<{success: boolean, output: string, outputFile: string}>}
 */
function renderComposition({ aepPath, compName, outputPath, onProgress }) {
    return new Promise((resolve, reject) => {
        console.log(`[AUREN] Rendering comp "${compName}" → ${outputPath}`);

        // Ensure parent directory exists
        fs.ensureDirSync(path.dirname(outputPath));

        const args = [
            '-project', aepPath,
            '-comp', compName,
            '-output', outputPath,
            '-close', 'DO_NOT_SAVE_CHANGES',
            '-sound', 'ON',
        ];

        console.log(`[AUREN] aerender ${args.join(' ')}`);

        const proc = spawn(AERENDER_PATH, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            const line = data.toString();
            stdout += line;

            // Parse progress from aerender output
            const progressMatch = line.match(/(\d+:\d+:\d+)\s+\((\d+)\)/);
            if (progressMatch && onProgress) {
                onProgress({ time: progressMatch[1], frame: parseInt(progressMatch[2]) });
            }

            console.log(`[aerender] ${line.trim()}`);
        });

        proc.stderr.on('data', (data) => {
            const line = data.toString();
            stderr += line;
            console.error(`[aerender ERR] ${line.trim()}`);
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve({ success: true, output: stdout, outputFile: outputPath });
            } else {
                resolve({
                    success: false,
                    output: stderr || stdout || `aerender exited with code ${code}`,
                    outputFile: outputPath,
                });
            }
        });

        proc.on('error', (err) => {
            reject(new Error(`Failed to launch aerender: ${err.message}`));
        });
    });
}

/**
 * Full render pipeline for a project.
 * 
 * @param {string} slugName - The project slug name
 * @param {Function} onStatus - Callback for status updates
 * @returns {Promise<{success: boolean, outputs: string[], errors: string[]}>}
 */
async function renderProject(slugName, onStatus = () => { }) {
    const results = { success: true, outputs: [], errors: [] };

    try {
        // ── Step 1: Validate paths ──
        onStatus('Validating project...');

        const projectDir = path.join(DATA_DIR, slugName);
        const jsonPath = path.join(projectDir, `${slugName}.json`);

        if (!await fs.pathExists(jsonPath)) {
            throw new Error(`Project JSON not found: ${jsonPath}`);
        }

        if (!await fs.pathExists(MASTER_AEP)) {
            throw new Error(`Master project not found: ${MASTER_AEP}`);
        }

        // ── Step 2: Read project data ──
        onStatus('Reading project data...');
        const data = await fs.readJson(jsonPath);
        console.log(`[AUREN] Project data loaded for "${slugName}":`, JSON.stringify(data, null, 2));

        // ── Step 3: Copy master AEP to working copy ──
        onStatus('Preparing After Effects project...');
        const workingAep = path.join(projectDir, `${slugName}.aep`);
        await fs.copy(MASTER_AEP, workingAep, { overwrite: true });

        // Also copy the template assets (sample images, etc.) so AE can find them
        const templateFiles = await fs.readdir(TEMPLATES_DIR);
        for (const file of templateFiles) {
            if (file !== 'Master_Project.aep') {
                const src = path.join(TEMPLATES_DIR, file);
                const dest = path.join(projectDir, file);
                if (!await fs.pathExists(dest)) {
                    await fs.copy(src, dest);
                }
            }
        }

        console.log(`[AUREN] Working AEP created: ${workingAep}`);

        // ── Step 4: Generate ExtendScript ──
        onStatus('Generating ExtendScript...');
        const jsxContent = generateExtendScript({
            aepPath: workingAep,
            projectDir: projectDir,
            data: data,
        });

        const jsxPath = path.join(projectDir, 'fill_data.jsx');
        await fs.writeFile(jsxPath, jsxContent, 'utf-8');
        console.log(`[AUREN] ExtendScript generated: ${jsxPath}`);

        // ── Step 5: Run ExtendScript to fill data ──
        onStatus('Filling After Effects data...');
        const scriptResult = await runExtendScript(jsxPath);

        if (!scriptResult.success) {
            console.warn(`[AUREN] ExtendScript returned non-zero, but continuing. Output: ${scriptResult.output}`);
        }

        // Wait a moment for AE to fully close after script execution
        await new Promise(r => setTimeout(r, 3000));

        // ── Step 6: Determine which compositions to render ──
        const outputDir = path.join(EXPORT_DIR, slugName);
        await fs.ensureDir(outputDir);

        const compsToRender = [];

        if (data.nameTitles && data.nameTitles.length > 0) {
            compsToRender.push({
                compName: 'lower-third',
                outputPath: path.join(outputDir, 'lower-third.avi'),
            });
        }

        if (data.keywords && data.keywords.length > 0) {
            compsToRender.push({
                compName: 'keyword',
                outputPath: path.join(outputDir, 'keyword.avi'),
            });
        }

        if (data.images && data.images.length > 0 && data.images.some(img => img.fileName || img.source)) {
            compsToRender.push({
                compName: 'image',
                outputPath: path.join(outputDir, 'image.avi'),
            });
        }

        if (compsToRender.length === 0) {
            throw new Error('No compositions have data to render');
        }

        // ── Step 7: Render each composition ──
        for (let i = 0; i < compsToRender.length; i++) {
            const { compName, outputPath: outPath } = compsToRender[i];
            onStatus(`Rendering ${compName} (${i + 1}/${compsToRender.length})...`);

            const renderResult = await renderComposition({
                aepPath: workingAep,
                compName,
                outputPath: outPath,
                onProgress: (progress) => {
                    onStatus(`Rendering ${compName}: frame ${progress.frame}...`);
                },
            });

            if (renderResult.success) {
                results.outputs.push(renderResult.outputFile);
                console.log(`[AUREN] ✓ Rendered: ${compName}`);
            } else {
                results.errors.push(`${compName}: ${renderResult.output}`);
                console.error(`[AUREN] ✗ Failed: ${compName}`);
            }
        }

        // Overall success only if no errors
        results.success = results.errors.length === 0;

    } catch (err) {
        results.success = false;
        results.errors.push(err.message);
        console.error(`[AUREN] Pipeline error: ${err.message}`);
    }

    return results;
}

module.exports = {
    renderProject,
    renderComposition,
    runExtendScript,
    isAfterEffectsRunning,
    AERENDER_PATH,
    AFTERFX_PATH,
    BASE_DIR,
    DATA_DIR,
    EXPORT_DIR,
    TEMPLATES_DIR,
};
