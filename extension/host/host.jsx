/**
 * AUREN Premiere Pro Host Script (ExtendScript)
 * 
 * Functions callable from the HTML panel via csInterface.evalScript().
 */

/**
 * Returns the name of the currently active sequence in Premiere Pro.
 * Useful for auto-populating the slug name field.
 */
function getActiveSequenceName() {
    try {
        var seq = app.project.activeSequence;
        if (seq) {
            return seq.name;
        }
        return "";
    } catch (e) {
        return "";
    }
}

/**
 * Shows a native alert dialog in Premiere Pro.
 * @param {string} msg - Message to display
 */
function showAlert(msg) {
    alert(msg);
}

/**
 * Import a rendered video file into the current Premiere Pro project.
 * @param {string} filePath - Absolute path to the video file
 * @returns {string} "true" on success, error message on failure
 */
function importRenderedVideo(filePath) {
    try {
        var importArray = [filePath];
        var result = app.project.importFiles(importArray, true);
        return "true";
    } catch (e) {
        return "Error: " + e.message;
    }
}
