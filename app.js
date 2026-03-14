// Initialize Leaflet map
var map = L.map('map').setView([24.7136, 46.6753], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

var uploadedLayer = L.layerGroup().addTo(map);

// Firebase config
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Store uploaded layers
var layers = [];

document.getElementById('file-input').addEventListener('change', async function(e){
    const file = e.target.files[0];
    if(!file) return;

    const reader = new FileReader();

    // ---------- SHAPEFILE / ZIP ----------
    if(file.name.endsWith('.shp') || file.name.endsWith('.zip')) {
        reader.onload = async function() {
            const geojson = await shp(reader.result);
            addLayerToMap(file.name, geojson, 'blue');
        };
        reader.readAsArrayBuffer(file);
    }
    // ---------- KMZ / KML ----------
    else if(file.name.endsWith('.kmz') || file.name.endsWith('.kml')) {
        reader.onload = async function() {
            const parser = new DOMParser();
            if(file.name.endsWith('.kmz')) {
                const zip = await JSZip.loadAsync(reader.result);
                const kmlFileName = Object.keys(zip.files).find(f => f.toLowerCase().endsWith('.kml'));
                if(!kmlFileName) return alert("No KML found inside KMZ!");
                const kmlText = await zip.file(kmlFileName).async("string");
                const xml = parser.parseFromString(kmlText, "text/xml");
                const geojson = toGeoJSON.kml(xml);
                addLayerToMap(file.name, geojson, 'red');
            } else {
                const xml = parser.parseFromString(reader.result, "text/xml");
                const geojson = toGeoJSON.kml(xml);
                addLayerToMap(file.name, geojson, 'red');
            }
        };
        if(file.name.endsWith('.kmz')) reader.readAsArrayBuffer(file);
        else reader.readAsText(file);
    } else {
        alert("Unsupported file type!");
    }
});

// Add layer + update sidebar
function addLayerToMap(name, geojson, color) {
    uploadedLayer.clearLayers(); // Optional: keep previous layers?
    const layer = L.geoJSON(geojson, {
        style: { color, weight: 2, fillOpacity: 0.3 },
        onEachFeature: function(feature, lyr) {
            if(feature.properties) {
                const popup = Object.keys(feature.properties)
                    .map(k => `<b>${k}</b>: ${feature.properties[k]}`).join('<br>');
                lyr.bindPopup(popup);
            }
        }
    }).addTo(uploadedLayer);

    map.fitBounds(layer.getBounds());

    // Save layer to array
    layers.push({ name, geojson, layer });

    updateSidebar();
}

// Update sidebar UI
function updateSidebar() {
    const list = document.getElementById('layer-list');
    list.innerHTML = '';
    layers.forEach((l, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${l.name}</span> 
                        <button class="edit">Edit</button> 
                        <button class="remove">Remove</button>`;
        list.appendChild(li);

        li.querySelector('.edit').onclick = () => editLayer(idx);
        li.querySelector('.remove').onclick = () => removeLayer(idx);
    });
}

// Edit layer placeholder (can integrate Leaflet.draw later)
function editLayer(idx) {
    alert("Editing layer: " + layers[idx].name);
}

// Remove layer
function removeLayer(idx) {
    uploadedLayer.removeLayer(layers[idx].layer);
    layers.splice(idx,1);
    updateSidebar();
}

// Save all layers to Firebase
document.getElementById('save-all').onclick = async function() {
    for(const l of layers){
        await db.collection("polygons").add(l.geojson);
    }
    alert("All layers saved to database!");
}
