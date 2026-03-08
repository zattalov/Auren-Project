const { app, BrowserWindow, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

let mainWindow;
let backendProcess;
let frontendProcess;

const FRONTEND_URL = 'http://localhost:3000';
const BACKEND_PORT = 4000;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 768,
        title: "AUREN - Dashboard",
        icon: path.join(__dirname, 'dashboard', 'favicon.ico'), // Optional: provide an icon path if available
        autoHideMenuBar: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        }
    });

    const menuTemplate = [
        {
            label: 'View',
            submenu: [
                {
                    label: 'AUREN Frontend',
                    accelerator: 'CmdOrCtrl+1',
                    click: () => {
                        mainWindow.loadURL(FRONTEND_URL);
                    }
                },
                {
                    label: 'Backend Dashboard',
                    accelerator: 'CmdOrCtrl+2',
                    click: () => {
                        mainWindow.loadURL(`http://localhost:${BACKEND_PORT}/dashboard`);
                    }
                },
                { type: 'separator' },
                { role: 'reload' },
                { role: 'toggledevtools' }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);

    // We'll load a temporary loading screen or just wait until the frontend acts up
    mainWindow.loadFile(path.join(__dirname, 'loading.html')).catch(() => {
        // Fallback: just wait on a blank screen if loading.html doesn't exist
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function startServices() {
    console.log('[Electron] Starting Backend Service...');
    // Start backend in the background so it doesn't open a separate cmd window
    backendProcess = spawn('node', ['server.js'], {
        cwd: __dirname,
        shell: true,
        windowsHide: true,
    });

    backendProcess.stdout.on('data', (data) => console.log(`[Backend] ${data}`));
    backendProcess.stderr.on('data', (data) => console.error(`[Backend Error] ${data}`));


    console.log('[Electron] Starting Frontend Service...');
    // Start Vite frontend
    frontendProcess = spawn('npm', ['run', 'dev'], {
        cwd: path.join(__dirname, 'AUREN-frontend'),
        shell: true,
        windowsHide: true,
    });

    frontendProcess.stdout.on('data', (data) => console.log(`[Frontend] ${data}`));
    frontendProcess.stderr.on('data', (data) => console.error(`[Frontend Error] ${data}`));
}

function waitForFrontend(url, timeoutMs, intervalMs) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const check = () => {
            http.get(url, (res) => {
                if (res.statusCode === 200) {
                    console.log(`[Electron] Frontend is ready!`);
                    resolve();
                } else {
                    retry();
                }
            }).on('error', retry);
        };

        const retry = () => {
            if (Date.now() - startTime > timeoutMs) {
                reject(new Error(`Timeout waiting for frontend at ${url}`));
            } else {
                setTimeout(check, intervalMs);
            }
        };

        check();
    });
}

app.whenReady().then(async () => {
    createWindow();
    startServices();

    try {
        console.log('[Electron] Waiting for Vite server to start...');
        // Wait up to 30 seconds, checking every 500ms
        await waitForFrontend(FRONTEND_URL, 30000, 500);

        // Load the React Frontend!
        if (mainWindow) {
            mainWindow.loadURL(FRONTEND_URL);
        }
    } catch (error) {
        console.error('[Electron] Error waiting for frontend:', error);
        if (mainWindow) {
            // Error loading state? Maybe show an error HTML instead.
        }
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// Quit when all windows are closed, and ensure we kill background Node processes
app.on('window-all-closed', () => {
    // Kill child processes on Windows
    if (backendProcess) {
        spawn("taskkill", ["/pid", backendProcess.pid, '/f', '/t'], { windowsHide: true });
    }
    if (frontendProcess) {
        spawn("taskkill", ["/pid", frontendProcess.pid, '/f', '/t'], { windowsHide: true });
    }

    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Extra safety: Catch process exit to kill detached children
process.on('exit', () => {
    if (backendProcess) {
        spawn("taskkill", ["/pid", backendProcess.pid, '/f', '/t'], { windowsHide: true });
    }
    if (frontendProcess) {
        spawn("taskkill", ["/pid", frontendProcess.pid, '/f', '/t'], { windowsHide: true });
    }
});
