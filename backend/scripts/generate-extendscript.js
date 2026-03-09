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

function generateExtendScript({ aepPath, projectDir, outputDir, data, settings }) {
    const aepPathAE = toAEPath(aepPath);
    const projectDirAE = toAEPath(projectDir);
    const outputDirAE = toAEPath(outputDir);

    const nameTitles = data.nameTitles || [];
    const keywords = data.keywords || [];
    const images = data.images || [];

    // Fallback if settings isn't passed for some reason
    if (!settings) {
        settings = {
            nameTitle: { compName: 'lower-third', layerName_name: 'name', layerName_title1: 'title1', layerName_title2: 'title2' },
            keyword: { compName: 'keyword', layerName_keyword: 'Keyword_text' },
            image: { compName: 'image', layerName_source: 'source', footageName: 'sample image.png' }
        };
    }

    // We will dynamically push duplicate compositions during processing
    const compsToRender = [];

    var lines = [];

    // Header
    lines.push('// Auto-generated ExtendScript for AUREN render pipeline');
    lines.push('// Generated at: ' + new Date().toISOString());
    lines.push('// Project: ' + (data.slugName || 'unknown'));
    lines.push('');
    lines.push('(function() {');
    lines.push('    app.beginSuppressDialogs();');
    lines.push('    try {');
    lines.push('        try {');
    lines.push('            app.preferences.savePrefAsLong("Auto Save", "Enable Auto Save", 0);');
    lines.push('            app.preferences.saveToDisk();');
    lines.push('        } catch(e) { $.writeln("Warning: could not disable Auto-Save."); }');
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

    // ── FILL LOWER-THIRD ──
    if (nameTitles.length > 0) {
        lines.push('    var baseLowerThird = findComp("' + escapeForJsx(settings.nameTitle.compName) + '");');
        lines.push('    if (baseLowerThird) {');
        for (let i = 0; i < nameTitles.length; i++) {
            const nt = nameTitles[i];
            if (!nt.name && !nt.title1 && !nt.title2) continue; // Skip empty fields

            const dupName = `lower-third_${i + 1}`;
            lines.push(`        var dupNT_${i} = baseLowerThird.duplicate();`);
            lines.push(`        dupNT_${i}.name = "${dupName}";`);
            lines.push(`        setTextLayerValue(dupNT_${i}, "${escapeForJsx(settings.nameTitle.layerName_name)}", "${escapeForJsx(nt.name || '')}");`);
            lines.push(`        setTextLayerValue(dupNT_${i}, "${escapeForJsx(settings.nameTitle.layerName_title1)}", "${escapeForJsx(nt.title1 || '')}");`);
            lines.push(`        setTextLayerValue(dupNT_${i}, "${escapeForJsx(settings.nameTitle.layerName_title2)}", "${escapeForJsx(nt.title2 || '')}");`);
            lines.push(`        $.writeln("AUREN: lower-third duplicated for ${dupName}");`);
            
            compsToRender.push({ compName: dupName, outputName: `lower-third-${i + 1}` });
        }
        lines.push('    } else {');
        lines.push('        $.writeln("AUREN WARNING: base lower-third template not found");');
        lines.push('    }');
        lines.push('');
    }

    // ── FILL KEYWORD ──
    if (keywords.length > 0) {
        lines.push('    var baseKeyword = findComp("' + escapeForJsx(settings.keyword.compName) + '");');
        lines.push('    if (baseKeyword) {');
        for (let i = 0; i < keywords.length; i++) {
            const kw = keywords[i];
            if (!kw || !kw.trim()) continue;

            const dupName = `keyword_${i + 1}`;
            lines.push(`        var dupKW_${i} = baseKeyword.duplicate();`);
            lines.push(`        dupKW_${i}.name = "${dupName}";`);
            lines.push(`        setTextLayerValue(dupKW_${i}, "${escapeForJsx(settings.keyword.layerName_keyword)}", "${escapeForJsx(kw)}");`);
            lines.push(`        $.writeln("AUREN: keyword duplicated for ${dupName}");`);
            
            compsToRender.push({ compName: dupName, outputName: `keyword-${i + 1}` });
        }
        lines.push('    } else {');
        lines.push('        $.writeln("AUREN WARNING: base keyword template not found");');
        lines.push('    }');
        lines.push('');
    }

    // ── FILL IMAGE COMP ──
    if (images.length > 0) {
        lines.push('    var baseImageComp = findComp("' + escapeForJsx(settings.image.compName) + '");');
        lines.push('    if (baseImageComp) {');
        for (let i = 0; i < images.length; i++) {
            const img = images[i];
            if (!img.fileName && !img.source) continue;

            const dupName = `image_${i + 1}`;
            lines.push(`        var dupIMG_${i} = baseImageComp.duplicate();`);
            lines.push(`        dupIMG_${i}.name = "${dupName}";`);
            
            if (img.fileName) {
                // Import file uniquely for this duplicated composition to avoid global crossover
                lines.push(`        var imgFile_${i} = new File("${projectDirAE}/${escapeForJsx(img.fileName)}");`);
                lines.push(`        if (imgFile_${i}.exists) {`);
                lines.push(`            var newFootage_${i} = app.project.importFile(new ImportOptions(imgFile_${i}));`);
                // Replace the layer internally
                lines.push(`            var targetLayer_${i} = null;`);
                lines.push(`            for(var j=1; j<=dupIMG_${i}.numLayers; j++) {`);
                lines.push(`                var lay = dupIMG_${i}.layer(j);`);
                lines.push(`                if(lay.source && lay.source.name === "${escapeForJsx(settings.image.footageName)}") { targetLayer_${i} = lay; break; }`);
                lines.push(`            }`);
                lines.push(`            if (targetLayer_${i}) {`);
                lines.push(`                targetLayer_${i}.replaceSource(newFootage_${i}, false);`);
                lines.push(`                $.writeln("AUREN: Image source replaced for ${dupName}");`);
                lines.push(`            } else { $.writeln("AUREN WARNING: No matching sample layer for footage swap"); }`);
                lines.push(`        } else { $.writeln("AUREN WARNING: Local image asset missing: " + imgFile_${i}.fsName); }`);
            }

            if (img.source) {
                lines.push(`        setTextLayerValue(dupIMG_${i}, "${escapeForJsx(settings.image.layerName_source)}", "${escapeForJsx(img.source || '')}");`);
            }
            
            compsToRender.push({ compName: dupName, outputName: `image-${i + 1}` });
        }
        lines.push('    } else {');
        lines.push('        $.writeln("AUREN WARNING: base image template not found");');
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
        var compObj = compsToRender[i];
        var varName = 'targetComp_' + i;
        var outputFile = outputDirAE + '/' + compObj.outputName + '.mov';

        lines.push('    var ' + varName + ' = findComp("' + compObj.compName + '");');
        lines.push('    if (' + varName + ') {');
        lines.push('        var rqItem_' + i + ' = app.project.renderQueue.items.add(' + varName + ');');
        lines.push('        var om_' + i + ' = rqItem_' + i + '.outputModule(1);');
        lines.push('        om_' + i + '.applyTemplate("ProRes4444+A");');
        lines.push('        om_' + i + '.file = new File("' + outputFile + '");');
        lines.push('        $.writeln("AUREN: Added to render queue: ' + compObj.compName + ' as ' + compObj.outputName + '");');
        lines.push('    }');
        lines.push('');
    }

    lines.push('    // ── FINALIZE & QUIT ──');
    lines.push('        app.project.save();');
    lines.push('        $.writeln("AUREN: Save completed!");');
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
    lines.push('    app.quit();');
    lines.push('})();');
    lines.push('');

    return lines.join('\n');
}

module.exports = { generateExtendScript, escapeForJsx, toAEPath };
