/**
 * AUREN Premiere Pro Panel — Application Logic
 * 
 * Vanilla JS that mirrors the React frontend's data model and
 * connects to the AUREN Express backend for saving + rendering.
 */

// ── Configuration ──
const SUPABASE_URL = 'https://fdregdbxjcjpqikpxwym.supabase.co';
// WARNING: This is the anon public key. You need to paste your anon public key here.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkcmVnZGJ4amNqcHFpa3B4d3ltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NTk4NzksImV4cCI6MjA4ODUzNTg3OX0.TKZA8Q58gD6ZeBbTY1x7kA0PPWWeo0Ra6GKZaf18Yfc';

let supabaseClient = null;

function initSupabase() {
    if (window.supabase) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log("Supabase client initialized.");
    } else {
        console.error('Supabase library not loaded! Check index.html CDN link.');
    }
}

// ── CSInterface (may be null outside Premiere Pro) ──
let csInterface = null;
try {
    csInterface = new CSInterface();
} catch (e) {
    console.log('CSInterface not available — running outside Premiere Pro');
}

// ══════════════════════════════════════════════
//  DATA MODEL
// ══════════════════════════════════════════════

const state = {
    activeTab: 'name-title',
    nameTitles: [{ name: '', title1: '', title2: '' }],
    keywords: [''],
    images: [{ file: null, source: '', aspectRatio: '' }],
    slugName: '',
    projectAspectRatio: '',
    isRendering: false,
    renderStatus: '',
};

// ══════════════════════════════════════════════
//  RENDERING HELPERS
// ══════════════════════════════════════════════

function createRemoveButton() {
    const btn = document.createElement('button');
    btn.className = 'btn-remove';
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
    return btn;
}

// ── Name & Title Tab ──

function renderNameTitles() {
    const container = document.getElementById('name-title-entries');
    container.innerHTML = '';
    container.className = 'entries-grid' + (state.nameTitles.length > 1 ? ' multi' : '');

    state.nameTitles.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'entry-card';

        // Remove button (only if more than 1)
        if (state.nameTitles.length > 1) {
            const removeBtn = createRemoveButton();
            removeBtn.addEventListener('click', () => {
                state.nameTitles.splice(index, 1);
                renderNameTitles();
            });
            card.appendChild(removeBtn);
        }

        card.innerHTML += `
            <div class="field-group">
                <label class="field-label">Name ${index + 1}</label>
                <input type="text" class="input-field" placeholder="Enter Person Name"
                       data-index="${index}" data-field="name" value="${escapeHtml(item.name)}">
            </div>
            <div class="field-row">
                <div class="field-group">
                    <label class="field-label">Title 1</label>
                    <input type="text" class="input-field" placeholder="Primary title..."
                           data-index="${index}" data-field="title1" value="${escapeHtml(item.title1)}">
                </div>
                <div class="field-group">
                    <label class="field-label">Title 2</label>
                    <input type="text" class="input-field" placeholder="Secondary title..."
                           data-index="${index}" data-field="title2" value="${escapeHtml(item.title2)}">
                </div>
            </div>
        `;

        container.appendChild(card);
    });

    // Bind input events
    container.querySelectorAll('input[data-field]').forEach(input => {
        input.addEventListener('input', (e) => {
            const i = parseInt(e.target.dataset.index);
            const field = e.target.dataset.field;
            state.nameTitles[i][field] = e.target.value;
        });
    });
}

// ── Keyword Tab ──

function renderKeywords() {
    const container = document.getElementById('keyword-entries');
    container.innerHTML = '';
    container.className = 'entries-grid' + (state.keywords.length > 1 ? ' multi' : '');

    state.keywords.forEach((keyword, index) => {
        const card = document.createElement('div');
        card.className = 'entry-card';

        if (state.keywords.length > 1) {
            const removeBtn = createRemoveButton();
            removeBtn.addEventListener('click', () => {
                state.keywords.splice(index, 1);
                renderKeywords();
            });
            card.appendChild(removeBtn);
        }

        card.innerHTML += `
            <div class="field-group">
                <label class="field-label">Keyword ${index + 1}</label>
                <textarea class="input-field" rows="2" placeholder="Enter text"
                          data-index="${index}">${escapeHtml(keyword)}</textarea>
            </div>
        `;

        container.appendChild(card);
    });

    container.querySelectorAll('textarea[data-index]').forEach(ta => {
        ta.addEventListener('input', (e) => {
            const i = parseInt(e.target.dataset.index);
            state.keywords[i] = e.target.value;
        });
    });
}

// ── Image Tab ──

function renderImages() {
    const container = document.getElementById('image-entries');
    container.innerHTML = '';
    container.className = 'entries-grid' + (state.images.length > 1 ? ' multi' : '');

    state.images.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'entry-card';

        if (state.images.length > 1) {
            const removeBtn = createRemoveButton();
            removeBtn.addEventListener('click', () => {
                state.images.splice(index, 1);
                renderImages();
            });
            card.appendChild(removeBtn);
        }

        const hasFile = item.file !== null;

        card.innerHTML += `
            <div class="field-row">
                <div class="field-group">
                    <label class="field-label">Aspect Ratio ${index + 1} *</label>
                    <select class="input-field" data-index="${index}" data-field="aspectRatio">
                        <option value="" disabled ${item.aspectRatio === '' ? 'selected' : ''}>Select Ratio</option>
                        <option value="Vertical" ${item.aspectRatio === 'Vertical' ? 'selected' : ''}>Vertical (9:16)</option>
                        <option value="Horizontal" ${item.aspectRatio === 'Horizontal' ? 'selected' : ''}>Horizontal (16:9)</option>
                        <option value="Square" ${item.aspectRatio === 'Square' ? 'selected' : ''}>Square (1:1)</option>
                    </select>
                </div>
                <div class="field-group">
                    <label class="field-label">Image Source</label>
                    <input type="text" class="input-field" placeholder="e.g. Getty Images..."
                           data-index="${index}" data-field="source" value="${escapeHtml(item.source)}">
                </div>
            </div>
            <div class="field-group">
                <label class="field-label">Project Image</label>
                <div class="upload-zone ${hasFile ? 'has-file' : ''}" id="upload-zone-${index}">
                    <input type="file" accept="image/*" data-index="${index}">
                    <svg class="upload-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <p class="upload-text">${hasFile ? escapeHtml(item.file.name) : 'Click or drag to upload image'}</p>
                    <p class="upload-hint">PNG, JPG up to 10MB</p>
                </div>
            </div>
        `;

        container.appendChild(card);
    });

    // Select and text inputs
    container.querySelectorAll('select[data-field], input[data-field]').forEach(el => {
        el.addEventListener('input', (e) => {
            const i = parseInt(e.target.dataset.index);
            const field = e.target.dataset.field;
            state.images[i][field] = e.target.value;
        });
        el.addEventListener('change', (e) => {
            const i = parseInt(e.target.dataset.index);
            const field = e.target.dataset.field;
            state.images[i][field] = e.target.value;
        });
    });

    // File inputs
    container.querySelectorAll('input[type="file"]').forEach(input => {
        input.addEventListener('change', (e) => {
            const i = parseInt(e.target.dataset.index);
            if (e.target.files && e.target.files[0]) {
                state.images[i].file = e.target.files[0];
                renderImages();
            }
        });
    });
}

// ══════════════════════════════════════════════
//  TAB SWITCHING
// ══════════════════════════════════════════════

const tabTitles = {
    'name-title': 'Name & Title',
    'keyword': 'Keyword',
    'image': 'Image',
};

function switchTab(tabId) {
    state.activeTab = tabId;

    // Nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Tab content
    document.querySelectorAll('.tab-content').forEach(tc => {
        tc.classList.toggle('active', tc.id === `tab-${tabId}`);
    });

    // Breadcrumb
    document.getElementById('header-title').textContent = tabTitles[tabId] || tabId;
}

// ══════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ══════════════════════════════════════════════

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const iconSvg = type === 'success'
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
        : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;

    toast.innerHTML = `
        <span class="toast-icon">${iconSvg}</span>
        <span class="toast-msg">${escapeHtml(message)}</span>
        <button class="toast-close">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    `;

    toast.querySelector('.toast-close').addEventListener('click', () => dismissToast(toast));
    container.appendChild(toast);

    setTimeout(() => dismissToast(toast), 4000);
}

function dismissToast(toast) {
    if (!toast.parentNode) return;
    toast.classList.add('removing');
    setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
}

// ══════════════════════════════════════════════
//  RENDER WORKFLOW
// ══════════════════════════════════════════════

async function handleRender() {
    const slugName = document.getElementById('slug-name').value.trim();

    if (!slugName) {
        showToast('Please enter a Slug Name before rendering', 'error');
        return;
    }

    state.slugName = slugName;
    state.projectAspectRatio = document.getElementById('project-aspect-ratio').value;

    // Build export data (same shape as the React frontend)
    const exportData = {
        slugName: state.slugName,
        projectAspectRatio: state.projectAspectRatio,
        nameTitles: state.nameTitles.filter(nt => nt.name.trim() || nt.title1.trim() || nt.title2.trim()),
        keywords: state.keywords.filter(k => k.trim()),
        images: state.images
            .filter(img => img.file || img.source.trim() || img.aspectRatio.trim())
            .map(img => ({
                source: img.source,
                aspectRatio: img.aspectRatio,
                fileName: img.file ? img.file.name : null,
                fileSize: img.file ? img.file.size : null,
            })),
    };

    if (!supabaseClient) {
        showToast('Supabase client not initialized.', 'error');
        return;
    }

    try {
        setRendering(true, 'Uploading files to Cloud...');

        // 1. Upload Images to Supabase Storage
        for (let i = 0; i < state.images.length; i++) {
            const img = state.images[i];
            if (img.file) {
                const filePath = `${state.slugName}/${img.file.name}`;
                const { error: uploadError } = await supabaseClient
                    .storage
                    .from('project-files')
                    .upload(filePath, img.file, { upsert: true });

                if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);
            }
        }

        setRendering(true, 'Saving project data to Cloud...');

        // 2. Insert Job into Supabase Database
        const { data, error: dbError } = await supabaseClient
            .from('render_jobs')
            .insert([{
                slug_name: state.slugName,
                status: 'pending',
                export_data: exportData
            }])
            .select('id')
            .single();

        if (dbError) throw new Error(`Database error: ${dbError.message}`);

        showToast('Project queued for rendering!', 'success');

        // 3. Poll for status
        pollRenderStatus(data.id);

    } catch (error) {
        console.error('Render error:', error);
        showToast(`Failed: ${error.message}`, 'error');
        setRendering(false);
    }
}

async function pollRenderStatus(jobId) {
    if (!jobId || !supabaseClient) return;

    try {
        const { data, error } = await supabaseClient
            .from('render_jobs')
            .select('status, error_message')
            .eq('id', jobId)
            .single();

        if (error) throw error;

        if (data.status === 'completed') {
            setRendering(false);
            showToast(`Render complete! Extracted by worker.`, 'success');
            return;
        }

        if (data.status === 'failed') {
            setRendering(false);
            showToast(`Render failed: ${data.error_message || 'Unknown error'}`, 'error');
            return;
        }

        // Still rendering
        setRendering(true, data.status === 'pending' ? 'Queued...' : 'Rendering...');
        setTimeout(() => pollRenderStatus(jobId), 3000);
    } catch {
        // Soft fail, try again
        setTimeout(() => pollRenderStatus(jobId), 3000);
    }
}

function setRendering(active, status) {
    state.isRendering = active;
    state.renderStatus = status || '';

    const btn = document.getElementById('btn-render');
    btn.disabled = active;

    if (active) {
        btn.innerHTML = `<span class="spinner"></span><span>${escapeHtml(status || 'Rendering...')}</span>`;
    } else {
        btn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
            <span>Render</span>
        `;
    }
}

// ══════════════════════════════════════════════
//  BACKEND STATUS CHECK
// ══════════════════════════════════════════════

async function checkBackendConnection() {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');

    if (!supabaseClient) {
        dot.className = 'status-dot disconnected';
        text.textContent = 'Setup Required';
        console.warn("checkBackendConnection: supabase client is null");
        return;
    }

    try {
        console.log("Checking Supabase connection...");
        // Use a lightweight query to check if we can reach Supabase
        const { data, error } = await supabaseClient.from('render_jobs').select('id').limit(1);

        if (error) {
            throw error;
        }

        dot.className = 'status-dot connected';
        text.textContent = 'Cloud Connected';
    } catch (e) {
        console.error("Connection check failed:", e.message || e);
        dot.className = 'status-dot disconnected';
        text.textContent = 'Cloud Disconnected';
    }
}

// ══════════════════════════════════════════════
//  SEQUENCE NAME (from Premiere Pro)
// ══════════════════════════════════════════════

function tryGetSequenceName() {
    if (!csInterface || typeof csInterface.evalScript !== 'function') {
        console.warn('CSInterface.evalScript not available, skipping auto-fill slug.');
        return;
    }

    try {
        csInterface.evalScript('getActiveSequenceName()', (result) => {
            if (result && result !== 'EvalScript error.' && result.trim()) {
                const slugInput = document.getElementById('slug-name');
                if (slugInput && !slugInput.value.trim()) {
                    slugInput.value = result.trim();
                    state.slugName = result.trim();
                }
            }
        });
    } catch (e) {
        console.error('Failed to get sequence name:', e);
    }
}

// ══════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ══════════════════════════════════════════════
//  INITIALIZATION
// ══════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    try {
        // Initialize Supabase
        initSupabase();

        // Initial render
        renderNameTitles();
        renderKeywords();
        renderImages();

        // Tab navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });

        // Add entry buttons
        document.getElementById('add-name-title').addEventListener('click', () => {
            state.nameTitles.push({ name: '', title1: '', title2: '' });
            renderNameTitles();
        });

        document.getElementById('add-keyword').addEventListener('click', () => {
            state.keywords.push('');
            renderKeywords();
        });

        document.getElementById('add-image').addEventListener('click', () => {
            state.images.push({ file: null, source: '', aspectRatio: '' });
            renderImages();
        });

        // Bottom bar inputs → sync to state
        document.getElementById('slug-name').addEventListener('input', (e) => {
            state.slugName = e.target.value;
        });

        document.getElementById('project-aspect-ratio').addEventListener('change', (e) => {
            state.projectAspectRatio = e.target.value;
        });

        // Render button
        document.getElementById('btn-render').addEventListener('click', handleRender);

        // Check backend connection
        checkBackendConnection();
        setInterval(checkBackendConnection, 15000);
        
        // Try to auto-fill slug from Premiere Pro sequence
        tryGetSequenceName();

    } catch (e) {
        console.error('Fatal Initialization Error:', e);
        showToast('Extension failed to load correctly. See console.', 'error');
    }
});
