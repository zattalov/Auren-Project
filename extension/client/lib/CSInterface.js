/**
 * CSInterface.js — Adobe CEP Interface Library (Minimal Shim)
 * 
 * This is a minimal implementation of the CSInterface that works
 * both inside Adobe CEP panels and in standalone browser testing.
 * 
 * When running inside Premiere Pro, the real CSInterface is injected
 * by the CEP runtime. This file acts as a fallback for browser testing.
 */

if (typeof CSInterface === 'undefined') {

    function CSInterface() { }

    /**
     * Evaluate an ExtendScript expression in the host application.
     * @param {string} script - ExtendScript to evaluate
     * @param {function} callback - Called with the result string
     */
    CSInterface.prototype.evalScript = function (script, callback) {
        if (callback) {
            callback('');
        }
    };

    /**
     * Returns the host environment info.
     */
    CSInterface.prototype.getHostEnvironment = function () {
        return {
            appName: 'browser',
            appVersion: '0.0.0',
            appLocale: 'en_US',
        };
    };

    /**
     * Returns the system path of a given type.
     * @param {string} pathType
     */
    CSInterface.prototype.getSystemPath = function (pathType) {
        return '';
    };

    /**
     * Open a URL in the default browser.
     * @param {string} url
     */
    CSInterface.prototype.openURLInDefaultBrowser = function (url) {
        window.open(url, '_blank');
    };

    /**
     * Request to open a native file dialog.
     */
    CSInterface.prototype.evalScript = function (script, callback) {
        try {
            // In a real CEP environment, this calls into the host app
            // In browser mode, just return empty
            if (typeof __adobe_cep__ !== 'undefined') {
                __adobe_cep__.evalScript(script, callback);
            } else if (callback) {
                callback('');
            }
        } catch (e) {
            if (callback) callback('');
        }
    };
}
