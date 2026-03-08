// Diagnostic - write to desktop using Folder.desktop
(function () {
    app.beginSuppressDialogs();
    var projectFile = new File("C:/Users/AJMN/Desktop/AUREN backend/templates/Master_Project.aep");
    var proj = app.open(projectFile);

    var report = "";
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof CompItem) {
            report += "COMP: " + item.name + "\n";
            for (var j = 1; j <= item.numLayers; j++) {
                var layer = item.layer(j);
                var isText = (layer instanceof TextLayer);
                var txt = "";
                if (isText) {
                    var tp = layer.property("Source Text");
                    if (tp) txt = tp.value.text;
                }
                report += "  L" + j + ": " + (isText ? "TEXT" : "OTHER") + " name=\"" + layer.name + "\"" + (txt ? " text=\"" + txt + "\"" : "") + "\n";
            }
        }
    }

    var desktop = Folder.desktop;
    var f = new File(desktop.fullName + "/ae_report.txt");
    f.open("w");
    f.write(report);
    f.close();

    app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    app.endSuppressDialogs(false);
    app.quit();
})();
