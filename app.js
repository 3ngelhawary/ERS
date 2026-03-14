// Initialize Leaflet map
var map = L.map('map').setView([0, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Load polygons from local GeoJSON
fetch('data/polygons.geojson')
.then(res => res.json())
.then(data => {
    L.geoJSON(data, {
        style: { color: 'blue', weight: 2 },
        onEachFeature: function (feature, layer) {
            layer.on('click', function() {
                alert('Polygon clicked: ' + feature.properties.name);
            });
        }
    }).addTo(map);
});

// Firebase configuration
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Save new polygon example
function savePolygon(geojson) {
    db.collection("polygons").add(geojson)
      .then(() => alert("Polygon saved!"))
      .catch(err => console.error(err));
}
