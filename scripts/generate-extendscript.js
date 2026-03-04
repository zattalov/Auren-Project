/**
 * generate-extendscript.js
 * 
 * Generates an After Effects ExtendScript (.jsx) that:
 *   1. Opens the working copy of Master_Project.aep
 *   2. Fills text layers in lower-third, keyword, and image compositions
 *   3. Replaces the image footage item
 *   4. Saves and closes the project
 */

const path = require('path');

/**
 * Escape a string for safe use inside ExtendScript string literals.
 * Handles backslashes, quotes, newlines, etc.
 */
function escapeForJsx(str) {
    if (!str) return '';
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}

/**
 * Convert a Windows path to ExtendScript-compatible forward-slash path.
 */
function toAEPath(winPath) {
    return winPath.replace(/\\/g, '/');
}

/**
 * Generate the ExtendScript .jsx content.
 * 
 * @param {Object} options
 * @param {string} options.aepPath        - Absolute path to the working .aep file
 * @param {string} options.projectDir     - Absolute path to the project data folder
 * @param {Object} options.data           - The parsed project JSON data
 * @param {Array}  options.data.nameTitles - [{name, title1, title2}, ...]
 * @param {Array}  options.data.keywords   - ["keyword1", "keyword2", ...]
 * @param {Array}  options.data.images     - [{fileName, source}, ...]
 * @returns {string} The ExtendScript source code
 */
function generateExtendScript({ aepPath, projectDir, data }) {
    const aepPathAE = toAEPath(aepPath);
    const projectDirAE = toAEPath(projectDir);

    const nameTitles = data.nameTitles || [];
    const keywords = data.keywords || [];
    const images = data.images || [];

    let jsx = `// Auto-generated ExtendScript for AUREN render pipeline
// Generated at: ${new Date().toISOString()}
// Project: ${escapeForJsx(data.slugName || 'unknown')}

(function() {
    // Suppress all dialogs
    app.beginSuppressDialogs();
    
    // Open the project file
    var projectFile = new File("${aepPathAE}");
    if (!projectFile.exists) {
        alert("ERROR: Project file not found: " + projectFile.fsName);
        app.endSuppressDialogs(false);
        return;
    }
    
    var proj = app.open(projectFile);
    if (!proj) {
        alert("ERROR: Could not open project");
        app.endSuppressDialogs(false);
        return;
    }
    
    // Helper: find a composition by name
    function findComp(name) {
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i) instanceof CompItem && app.project.item(i).name === name) {
                return app.project.item(i);
            }
        }
        return null;
    }
    
    // Helper: find a layer in a comp by name
    function findLayer(comp, layerName) {
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === layerName) {
                return comp.layer(i);
            }
        }
        return null;
    }
    
    // Helper: set text on a text layer
    function setTextValue(layer, text) {
        if (layer && layer.property("Source Text")) {
            var textProp = layer.property("Source Text");
            var textDoc = textProp.value;
            textDoc.text = text;
            textProp.setValue(textDoc);
        }
    }
    
    // Helper: find a footage item by name in the project panel
    function findFootageItem(name) {
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i) instanceof FootageItem && app.project.item(i).name === name) {
                return app.project.item(i);
            }
        }
        return null;
    }
`;

    // ══════════════════════════════════════════════
    // LOWER-THIRD: Fill name, title1, title2
    // ══════════════════════════════════════════════
    if (nameTitles.length > 0) {
        // Use the first entry to fill the lower-third comp
        const nt = nameTitles[0];
        jsx += `
    // ── LOWER-THIRD COMPOSITION ──
    var lowerThirdComp = findComp("lower-third");
    if (lowerThirdComp) {
        var nameLayer = findLayer(lowerThirdComp, "name");
        var title1Layer = findLayer(lowerThirdComp, "title1");
        var title2Layer = findLayer(lowerThirdComp, "title2");
        
        if (nameLayer) setTextValue(nameLayer, "${escapeForJsx(nt.name)}");
        if (title1Layer) setTextValue(title1Layer, "${escapeForJsx(nt.title1)}");
        if (title2Layer) setTextValue(title2Layer, "${escapeForJsx(nt.title2)}");
        
        $.writeln("AUREN: lower-third composition updated successfully");
    } else {
        $.writeln("AUREN WARNING: lower-third composition not found");
    }
`;
    }

    // ══════════════════════════════════════════════
    // KEYWORD: Fill Keyword_text
    // ══════════════════════════════════════════════
    if (keywords.length > 0) {
        // Use the first keyword to fill the keyword comp
        const kw = keywords[0];
        jsx += `
    // ── KEYWORD COMPOSITION ──
    var keywordComp = findComp("keyword");
    if (keywordComp) {
        var keywordLayer = findLayer(keywordComp, "Keyword_text");
        if (keywordLayer) setTextValue(keywordLayer, "${escapeForJsx(kw)}");
        
        $.writeln("AUREN: keyword composition updated successfully");
    } else {
        $.writeln("AUREN WARNING: keyword composition not found");
    }
`;
    }

    // ══════════════════════════════════════════════
    // IMAGE: Replace footage + set source text
    // ══════════════════════════════════════════════
    if (images.length > 0) {
        const img = images[0];
        const imageFileName = img.fileName || '';

        jsx += `
    // ── IMAGE COMPOSITION ──
    var imageComp = findComp("image");
    if (imageComp) {
`;

        // Replace the footage if an image file was provided
        if (imageFileName) {
            const imagePathAE = toAEPath(path.join(projectDir, imageFileName));
            jsx += `
        // Replace the sample image footage
        var imageFile = new File("${imagePathAE}");
        if (imageFile.exists) {
            var footageItem = findFootageItem("sample image.png");
            if (footageItem) {
                footageItem.replace(imageFile);
                $.writeln("AUREN: Image footage replaced successfully");
            } else {
                // Try to find any footage item in the image comp
                $.writeln("AUREN WARNING: sample image.png footage item not found in project");
            }
        } else {
            $.writeln("AUREN WARNING: Image file not found: " + imageFile.fsName);
        }
`;
        }

        // Set the source text
        if (img.source) {
            jsx += `
        // Set the source text
        var sourceLayer = findLayer(imageComp, "source");
        if (sourceLayer) setTextValue(sourceLayer, "${escapeForJsx(img.source)}");
`;
        }

        jsx += `
        $.writeln("AUREN: image composition updated successfully");
    } else {
        $.writeln("AUREN WARNING: image composition not found");
    }
`;
    }

    // ══════════════════════════════════════════════
    // SAVE AND CLOSE
    // ══════════════════════════════════════════════
    jsx += `
    // Save the project
    app.project.save();
    $.writeln("AUREN: Project saved successfully");
    
    app.endSuppressDialogs(false);
})();
`;

    return jsx;
}

module.exports = { generateExtendScript, escapeForJsx, toAEPath };
