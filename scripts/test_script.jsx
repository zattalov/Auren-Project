// Simple test script - writes a file to prove it ran
(function () {
    var f = new File(Folder.desktop.fullName + "/ae_test_success.txt");
    f.open("w");
    f.write("AE script executed at: " + new Date().toString());
    f.close();
    $.writeln("TEST: Script executed successfully!");
})();
