/**
 * generate-extendscript.js
 * 
 * Generates an After Effects ExtendScript (.jsx) that does everything
 * in a single script execution:
 *   1. Opens the working copy of Master_Project.aep
 *   2. Fills text layers in lower-third, keyword, and image compositions
 *   3. Replaces the image footage item
 *   4. Adds compositions to the render queue
 *   5. Renders via AE's built-in render queue
 *   6. Saves, closes, and quits AE
 */

const path = require('path');

function escapeForJsx(str) {
    if (!str) return '';
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}

function toAEPath(winPath) {
    return winPath.replace(/\\/g, '/');
}

function generateExtendScript({ aepPath, projectDir, outputDir, data }) {
    const aepPathAE = toAEPath(aepPath);
    const projectDirAE = toAEPath(projectDir);
    const outputDirAE = toAEPath(outputDir);

    const nameTitles = data.nameTitles || [];
    const keywords = data.keywords || [];
    const images = data.images || [];

    // Determine which compositions to render
    const compsToRender = [];
    if (nameTitles.length > 0 && nameTitles.some(function (nt) { return nt.name || nt.title1 || nt.title2; })) {
        compsToRender.push('lower-third');
    }
    if (keywords.length > 0 && keywords.some(function (k) { return k && k.trim(); })) {
        compsToRender.push('keyword');
    }
    if (images.length > 0 && images.some(function (img) { return img.fileName || img.source; })) {
        compsToRender.push('image');
    }

    var lines = [];

    // Header
    lines.push('// Auto-generated ExtendScript for AUREN render pipeline');
    lines.push('// Generated at: ' + new Date().toISOString());
    lines.push('// Project: ' + (data.slugName || 'unknown'));
    lines.push('');
    lines.push('(function() {');
    lines.push('    app.beginSuppressDialogs();');
    lines.push('');

    // Helpers
    lines.push('    function findComp(name) {');
    lines.push('        for (var i = 1; i <= app.project.numItems; i++) {');
    lines.push('            if (app.project.item(i) instanceof CompItem && app.project.item(i).name === name) {');
    lines.push('                return app.project.item(i);');
    lines.push('            }');
    lines.push('        }');
    lines.push('        return null;');
    lines.push('    }');
    lines.push('');
    lines.push('    function setTextLayerValue(comp, layerName, newText) {');
    lines.push('        for (var i = 1; i <= comp.numLayers; i++) {');
    lines.push('            var layer = comp.layer(i);');
    lines.push('            if (layer.name === layerName && layer instanceof TextLayer) {');
    lines.push('                var textProp = layer.property("Source Text");');
    lines.push('                var textDoc = textProp.value;');
    lines.push('                textDoc.text = newText;');
    lines.push('                textProp.setValue(textDoc);');
    lines.push('                $.writeln("AUREN: Set " + layerName + " = " + newText);');
    lines.push('                return true;');
    lines.push('            }');
    lines.push('        }');
    lines.push('        $.writeln("AUREN WARNING: Layer \'" + layerName + "\' not found in comp \'" + comp.name + "\'");');
    lines.push('        return false;');
    lines.push('    }');
    lines.push('');
    lines.push('    function findFootageItem(name) {');
    lines.push('        for (var i = 1; i <= app.project.numItems; i++) {');
    lines.push('            if (app.project.item(i) instanceof FootageItem && app.project.item(i).name === name) {');
    lines.push('                return app.project.item(i);');
    lines.push('            }');
    lines.push('        }');
    lines.push('        return null;');
    lines.push('    }');
    lines.push('');

    // Open project
    lines.push('    // ── OPEN PROJECT ──');
    lines.push('    var projectFile = new File("' + aepPathAE + '");');
    lines.push('    if (!projectFile.exists) {');
    lines.push('        $.writeln("ERROR: Project file not found: " + projectFile.fsName);');
    lines.push('        app.endSuppressDialogs(false);');
    lines.push('        app.quit();');
    lines.push('        return;');
    lines.push('    }');
    lines.push('');
    lines.push('    var proj = app.open(projectFile);');
    lines.push('    if (!proj) {');
    lines.push('        $.writeln("ERROR: Could not open project");');
    lines.push('        app.endSuppressDialogs(false);');
    lines.push('        app.quit();');
    lines.push('        return;');
    lines.push('    }');
    lines.push('    $.writeln("AUREN: Project opened successfully");');
    lines.push('');

    // Create output folder
    lines.push('    // ── CREATE OUTPUT FOLDER ──');
    lines.push('    var outputDir = new Folder("' + outputDirAE + '");');
    lines.push('    if (!outputDir.exists) outputDir.create();');
    lines.push('');

    // Fill lower-third
    if (nameTitles.length > 0) {
        var nt = nameTitles[0];
        lines.push('    // ── FILL LOWER-THIRD ──');
        lines.push('    var lowerThirdComp = findComp("lower-third");');
        lines.push('    if (lowerThirdComp) {');
        lines.push('        setTextLayerValue(lowerThirdComp, "name", "' + escapeForJsx(nt.name || '') + '");');
        lines.push('        setTextLayerValue(lowerThirdComp, "title1", "' + escapeForJsx(nt.title1 || '') + '");');
        lines.push('        setTextLayerValue(lowerThirdComp, "title2", "' + escapeForJsx(nt.title2 || '') + '");');
        lines.push('        $.writeln("AUREN: lower-third text replaced");');
        lines.push('    } else {');
        lines.push('        $.writeln("AUREN WARNING: lower-third composition not found");');
        lines.push('    }');
        lines.push('');
    }

    // Fill keyword
    if (keywords.length > 0) {
        var keywordText = keywords.filter(function (k) { return k && k.trim(); }).join('\\n');
        lines.push('    // ── FILL KEYWORD ──');
        lines.push('    var keywordComp = findComp("keyword");');
        lines.push('    if (keywordComp) {');
        lines.push('        setTextLayerValue(keywordComp, "Keyword_text", "' + escapeForJsx(keywordText) + '");');
        lines.push('        $.writeln("AUREN: keyword text replaced");');
        lines.push('    } else {');
        lines.push('        $.writeln("AUREN WARNING: keyword composition not found");');
        lines.push('    }');
        lines.push('');
    }

    // Fill image
    if (images.length > 0 && images.some(function (img) { return img.fileName || img.source; })) {
        var img = images[0];
        lines.push('    // ── FILL IMAGE COMP ──');
        lines.push('    var imageComp = findComp("image");');
        lines.push('    if (imageComp) {');

        if (img.fileName) {
            lines.push('        var existingFootage = findFootageItem("sample image.png");');
            lines.push('        if (existingFootage) {');
            lines.push('            var newImgFile = new File("' + projectDirAE + '/' + escapeForJsx(img.fileName) + '");');
            lines.push('            if (newImgFile.exists) {');
            lines.push('                existingFootage.replace(newImgFile);');
            lines.push('                $.writeln("AUREN: Image replaced with " + newImgFile.fsName);');
            lines.push('            }');
            lines.push('        }');
        }
        if (img.source) {
            lines.push('        setTextLayerValue(imageComp, "source", "' + escapeForJsx(img.source) + '");');
        }

        lines.push('        $.writeln("AUREN: image composition updated");');
        lines.push('    } else {');
        lines.push('        $.writeln("AUREN WARNING: image composition not found");');
        lines.push('    }');
        lines.push('');
    }

    // Save project before rendering
    lines.push('    // ── SAVE PROJECT ──');
    lines.push('    app.project.save();');
    lines.push('    $.writeln("AUREN: Project saved with updated text");');
    lines.push('');

    // Clear render queue and add compositions
    lines.push('    // ── SET UP RENDER QUEUE ──');
    lines.push('    while (app.project.renderQueue.numItems > 0) {');
    lines.push('        app.project.renderQueue.item(1).remove();');
    lines.push('    }');
    lines.push('');

    for (var i = 0; i < compsToRender.length; i++) {
        var compName = compsToRender[i];
        var varName = compName.replace(/-/g, '_') + '_comp';
        var outputFile = outputDirAE + '/' + compName + '.mov';

        lines.push('    var ' + varName + ' = findComp("' + compName + '");');
        lines.push('    if (' + varName + ') {');
        lines.push('        var rqItem_' + i + ' = app.project.renderQueue.items.add(' + varName + ');');
        lines.push('        var om_' + i + ' = rqItem_' + i + '.outputModule(1);');
        lines.push('        om_' + i + '.applyTemplate("ProRes4444+A");');
        lines.push('        om_' + i + '.file = new File("' + outputFile + '");');
        lines.push('        $.writeln("AUREN: Added to render queue: ' + compName + '");');
        lines.push('    }');
        lines.push('');
    }

    // Render
    lines.push('    // ── RENDER ──');
    lines.push('    $.writeln("AUREN: Starting render queue (' + compsToRender.length + ' compositions)...");');
    lines.push('    try {');
    lines.push('        app.project.renderQueue.render();');
    lines.push('        $.writeln("AUREN: Render queue completed!");');
    lines.push('');
    lines.push('        // Save, DO NOT quit');
    lines.push('        // ── SAVE & LEAVE OPEN ──');
    lines.push('        app.project.save();');
    lines.push('        $.writeln("AUREN: All done! Master project kept open.");');
    lines.push('');
    lines.push('        // Write success file for Node.js to detect completion');
    lines.push('        var doneFile = new File("' + outputDirAE + '/auren_done.txt");');
    lines.push('        doneFile.open("w");');
    lines.push('        doneFile.write("SUCCESS");');
    lines.push('        doneFile.close();');
    lines.push('    } catch(err) {');
    lines.push('        var errFile = new File("' + outputDirAE + '/auren_error.txt");');
    lines.push('        errFile.open("w");');
    lines.push('        errFile.write(err.toString());');
    lines.push('        errFile.close();');
    lines.push('    }');
    lines.push('');
    lines.push('    app.endSuppressDialogs(false);');
    lines.push('})();');
    lines.push('');

    return lines.join('\n');
}

module.exports = { generateExtendScript, escapeForJsx, toAEPath };
