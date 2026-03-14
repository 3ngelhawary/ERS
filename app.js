// Initialize Leaflet map
var map = L.map('map').setView([24.7136, 46.6753], 10); // Default: Riyadh zoom
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Layer group to hold all uploaded polygons
var uploadedLayer = L.layerGroup().addTo(map);

// File upload handling
document.getElementById('file-input').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if(!file) return;

    var reader = new FileReader();

    // ---------------- SHAPEFILE / ZIP ----------------
    if(file.name.endsWith('.shp') || file.name.endsWith('.zip')) {
        reader.onload = function() {
            shp(reader.result).then(function(geojson) {
                uploadedLayer.clearLayers();
                var layer = L.geoJSON(geojson, {
                    style: { color: 'blue', weight: 2, fillOpacity: 0.3 },
                    onEachFeature: function(feature, layer) {
                        if(feature.properties) {
                            var popupContent = Object.keys(feature.properties)
                                .map(k => `<b>${k}</b>: ${feature.properties[k]}`)
                                .join('<br>');
                            layer.bindPopup(popupContent);
                        }
                    }
                }).addTo(uploadedLayer);
                map.fitBounds(layer.getBounds());
            }).catch(err => alert("Error reading shapefile: " + err));
        };
        reader.readAsArrayBuffer(file);
    }

    // ---------------- KMZ / KML ----------------
    else if(file.name.endsWith('.kmz') || file.name.endsWith('.kml')) {
        reader.onload = function() {
            var parser = new DOMParser();

            if(file.name.endsWith('.kmz')) {
                JSZip.loadAsync(reader.result).then(function(zip) {
                    // Find first KML file inside
                    var kmlFile = Object.keys(zip.files).find(f => f.toLowerCase().endsWith('.kml'));
                    if(!kmlFile) return alert("No KML found inside KMZ!");
                    zip.file(kmlFile).async("string").then(function(kmlText) {
                        var xml = parser.parseFromString(kmlText, "text/xml");
                        var geojson = toGeoJSON.kml(xml);
                        uploadedLayer.clearLayers();
                        var layer = L.geoJSON(geojson, {
                            style: { color: 'red', weight: 2, fillOpacity: 0.3 }
                        }).addTo(uploadedLayer);
                        map.fitBounds(layer.getBounds());
                    });
                });
            } else { // .kml
                var xml = parser.parseFromString(reader.result, "text/xml");
                var geojson = toGeoJSON.kml(xml);
                uploadedLayer.clearLayers();
                var layer = L.geoJSON(geojson, {
                    style: { color: 'red', weight: 2, fillOpacity: 0.3 }
                }).addTo(uploadedLayer);
                map.fitBounds(layer.getBounds());
            }
        };
        if(file.name.endsWith('.kmz')) reader.readAsArrayBuffer(file);
        else reader.readAsText(file);
    }

    else {
        alert("Unsupported file type!");
    }
});
