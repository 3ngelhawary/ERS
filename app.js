// File: app.js
(function () {
  const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID"
  };

  firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();

  const map = L.map("map", { preferCanvas: true }).setView([24.7136, 46.6753], 6);
  const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const imagery = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles &copy; Esri" }
  );

  const savedGroup = L.featureGroup().addTo(map);
  const unsavedGroup = L.featureGroup().addTo(map);
  const editableGroup = new L.FeatureGroup().addTo(map);

  L.control.layers(
    { Street: osm, Satellite: imagery },
    { "Saved Database": savedGroup, "Unsaved Imports": unsavedGroup },
    { collapsed: false }
  ).addTo(map);

  map.addControl(new L.Control.Draw({
    edit: { featureGroup: editableGroup, remove: false },
    draw: { rectangle: true, polygon: true, polyline: false, circle: false, circlemarker: false, marker: false }
  }));

  const state = { items: [], activeId: null };
  const els = {
    fileInput: document.getElementById("fileInput"),
    datasetTitle: document.getElementById("datasetTitle"),
    datasetOwner: document.getElementById("datasetOwner"),
    datasetCategory: document.getElementById("datasetCategory"),
    datasetNotes: document.getElementById("datasetNotes"),
    saveSelectedBtn: document.getElementById("saveSelectedBtn"),
    refreshDbBtn: document.getElementById("refreshDbBtn"),
    clearUnsavedBtn: document.getElementById("clearUnsavedBtn"),
    zoomAllBtn: document.getElementById("zoomAllBtn"),
    layerList: document.getElementById("layerList"),
    dbCountBadge: document.getElementById("dbCountBadge"),
    statusText: document.getElementById("statusText"),
    searchBox: document.getElementById("searchBox"),
    sidebar: document.getElementById("sidebar"),
    toggleSidebar: document.getElementById("toggleSidebar")
  };

  function setStatus(text) {
    GisUI.setStatus(els, text);
  }

  function renderSidebar() {
    AppSidebar.render(state, els, actions);
  }

  function clearEditState() {
    editableGroup.clearLayers();
  }

  function addItem(meta, geojson, saved, docId, color) {
    const item = AppHelpers.makeItem(meta, geojson, saved, docId, color);
    GisUI.createLeafletLayer(item, saved ? savedGroup : unsavedGroup, state, renderSidebar);
    state.items.push(item);
    state.activeId = item.id;
    renderSidebar();
    GisUI.fitToLayer(map, item.leafletLayer);
    return item;
  }

  function focusItem(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item || !item.leafletLayer) return;
    state.activeId = id;
    renderSidebar();
    GisUI.fitToLayer(map, item.leafletLayer);
  }

  function enableEdit(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item || !item.leafletLayer) return;

    clearEditState();
    state.activeId = id;

    item.leafletLayer.eachLayer(function (layer) {
      editableGroup.addLayer(layer);
      if (layer.editing && typeof layer.editing.enable === "function") {
        layer.editing.enable();
      }
    });

    GisUI.fitToLayer(map, item.leafletLayer);
    renderSidebar();
    setStatus("Editing: " + item.title);
  }

  async function updateGeoJsonFromEditable(item) {
    const features = [];
    editableGroup.eachLayer(function (layer) {
      const gj = typeof layer.toGeoJSON === "function" ? layer.toGeoJSON() : null;
      if (!gj) return;
      if (gj.type === "FeatureCollection") gj.features.forEach(function (f) { features.push(f); });
      else if (gj.type === "Feature") features.push(gj);
    });
    if (features.length > 0) item.geojson = { type: "FeatureCollection", features: features };
  }

  async function saveItem(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item) return;

    try {
      if (state.activeId === item.id && editableGroup.getLayers().length > 0) {
        await updateGeoJsonFromEditable(item);
      }

      if (item.leafletLayer) {
        unsavedGroup.removeLayer(item.leafletLayer);
        savedGroup.removeLayer(item.leafletLayer);
      }

      item.docId = await AppStorage.saveItem(db, item);
      item.saved = true;

      GisUI.createLeafletLayer(item, savedGroup, state, renderSidebar);
      clearEditState();
      renderSidebar();
      setStatus("Saved to database: " + item.title);
    } catch (err) {
      alert("Save error: " + err.message);
      setStatus("Save failed");
    }
  }

  async function removeItem(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item) return;

    try {
      await AppStorage.deleteItem(db, item);

      if (item.leafletLayer) {
        savedGroup.removeLayer(item.leafletLayer);
        unsavedGroup.removeLayer(item.leafletLayer);
      }

      state.items = state.items.filter(function (x) { return x.id !== id; });
      if (state.activeId === id) {
        state.activeId = null;
        clearEditState();
      }

      renderSidebar();
      setStatus("Removed: " + item.title);
    } catch (err) {
      alert("Delete error: " + err.message);
      setStatus("Delete failed");
    }
  }

  async function loadDatabaseLayers() {
    try {
      setStatus("Loading database layers...");
      savedGroup.clearLayers();
      state.items = state.items.filter(function (x) { return !x.saved; });

      const rows = await AppStorage.loadAll(db);
      rows.forEach(function (row) {
        addItem({
          title: row.title,
          owner: row.owner,
          category: row.category,
          notes: row.notes,
          sourceType: row.sourceType,
          uploadedAt: row.uploadedAt
        }, row.geojson, true, row.docId, row.color);
      });

      renderSidebar();
      GisUI.zoomAll(map, savedGroup, unsavedGroup);
      setStatus("Database loaded");
    } catch (err) {
      alert("Database load error: " + err.message);
      setStatus("Database load failed");
    }
  }

  async function handleFileUpload(file) {
    if (!file) return;
    setStatus("Reading file: " + file.name);

    try {
      const name = file.name || "Imported File";
      const sourceType = AppHelpers.sourceTextFromFileName(name);
      let geojson = null;

      if (sourceType === "KMZ") geojson = await GisParsers.parseKmz(await file.arrayBuffer());
      else if (sourceType === "KML") geojson = await GisParsers.parseKmlText(await file.text());
      else if (sourceType === "ZIP Shapefile" || sourceType === "SHP") geojson = await GisParsers.parseShpZip(await file.arrayBuffer());
      else throw new Error("Supported files: KMZ, KML, ZIP Shapefile, SHP");

      addItem(AppHelpers.collectMeta(els, name, sourceType), geojson, false, null);
      setStatus("Imported: " + name);
    } catch (err) {
      alert("Import error: " + err.message);
      setStatus("Import failed");
    }
  }

  function clearUnsaved() {
    state.items.filter(function (x) { return !x.saved; }).forEach(function (item) {
      if (item.leafletLayer) unsavedGroup.removeLayer(item.leafletLayer);
    });

    state.items = state.items.filter(function (x) { return x.saved; });
    state.activeId = null;
    clearEditState();
    renderSidebar();
    setStatus("Unsaved layers cleared");
  }

  const actions = {
    focusItem: focusItem,
    enableEdit: enableEdit,
    saveItem: saveItem,
    removeItem: removeItem
  };

  map.on(L.Draw.Event.CREATED, function (e) {
    addItem(
      AppHelpers.collectMeta(els, "Drawn Layer", "Draw"),
      GisParsers.normalizeGeoJson(e.layer.toGeoJSON()),
      false,
      null
    );
    enableEdit(state.activeId);
  });

  map.on(L.Draw.Event.EDITED, async function () {
    const item = state.items.find(function (x) { return x.id === state.activeId; });
    if (!item) return;

    try {
      await updateGeoJsonFromEditable(item);
      if (item.leafletLayer) {
        savedGroup.removeLayer(item.leafletLayer);
        unsavedGroup.removeLayer(item.leafletLayer);
      }

      GisUI.createLeafletLayer(item, item.saved ? savedGroup : unsavedGroup, state, renderSidebar);
      if (item.saved) await saveItem(item.id);
      else {
        renderSidebar();
        setStatus("Layer updated: " + item.title);
      }
    } catch (err) {
      setStatus("Edit update failed");
    }
  });

  els.fileInput.addEventListener("change", async function (e) {
    await handleFileUpload(e.target.files[0]);
    e.target.value = "";
  });

  els.saveSelectedBtn.addEventListener("click", async function () {
    const item = state.items.find(function (x) { return x.id === state.activeId && !x.saved; }) ||
                 state.items.find(function (x) { return !x.saved; });
    if (!item) return alert("No unsaved layer selected.");
    await saveItem(item.id);
  });

  els.refreshDbBtn.addEventListener("click", loadDatabaseLayers);
  els.clearUnsavedBtn.addEventListener("click", clearUnsaved);
  els.zoomAllBtn.addEventListener("click", function () { GisUI.zoomAll(map, savedGroup, unsavedGroup); });
  els.searchBox.addEventListener("input", renderSidebar);

  els.toggleSidebar.addEventListener("click", function () {
    els.sidebar.classList.toggle("collapsed");
    setTimeout(function () { map.invalidateSize(); }, 260);
  });

  setTimeout(function () { map.invalidateSize(); }, 300);
  loadDatabaseLayers();
})();
