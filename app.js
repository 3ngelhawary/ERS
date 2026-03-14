// Initialize Leaflet map
var map = L.map('map').setView([0, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Handle file upload
document.getElementById('file-input').addEventListener('change', function(e) {
    var file = e.target.files[0];
    var reader = new FileReader();

    if(file.name.endsWith('.shp') || file.name.endsWith('.zip')) {
        // Shapefile / zipped shapefile
        reader.onload = function() {
            shp(reader.result).then(function(geojson) {
                L.geoJSON(geojson, {style:{color:'blue'}}).addTo(map);
                map.fitBounds(L.geoJSON(geojson).getBounds());
            });
        };
        reader.readAsArrayBuffer(file);
    }
    else if(file.name.endsWith('.kmz') || file.name.endsWith('.kml')) {
        reader.onload = function() {
            var parser = new DOMParser();
            var xmlDoc;
            if(file.name.endsWith('.kmz')) {
                JSZip.loadAsync(reader.result).then(function(zip) {
                    zip.file(/.kml$/i)[0].async("string").then(function(kmlText){
                        xmlDoc = parser.parseFromString(kmlText, "text/xml");
                        var geojson = toGeoJSON.kml(xmlDoc);
                        L.geoJSON(geojson, {style:{color:'red'}}).addTo(map);
                        map.fitBounds(L.geoJSON(geojson).getBounds());
                    });
                });
            } else { // .kml
                xmlDoc = parser.parseFromString(reader.result, "text/xml");
                var geojson = toGeoJSON.kml(xmlDoc);
                L.geoJSON(geojson, {style:{color:'red'}}).addTo(map);
                map.fitBounds(L.geoJSON(geojson).getBounds());
            }
        };
        if(file.name.endsWith('.kmz')) reader.readAsArrayBuffer(file);
        else reader.readAsText(file);
    }
});
