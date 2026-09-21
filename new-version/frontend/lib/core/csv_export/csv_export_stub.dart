/// Non-web platforms don't get a browser download; the Browse screen hides
/// its export button when this no-ops (see `dart.library.html` check).
void downloadCsv(String filename, String csvContent) {}
