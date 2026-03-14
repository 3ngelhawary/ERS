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

  function uid() {
    return "L" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
  }

  function collectMeta(fileName, sourceType) {
    const fallbackName = fileName ? fileName.replace(/\.[^/.]+$/, "") : "Untitled Layer";
    return {
      title: (els.datasetTitle && els.datasetTitle.value.trim()) || fallbackName,
      owner: (els.datasetOwner && els.datasetOwner.value.trim()) || "",
      category: (els.datasetCategory && els.datasetCategory.value.trim()) || "",
      notes: (els.datasetNotes && els.datasetNotes.value.trim()) || "",
      sourceType: sourceType,
      uploadedAt: new Date().toISOString()
    };
  }

  function renderSidebar() {
    const keyword = els.searchBox ? els.searchBox.value.trim().toLowerCase() : "";
    els.layerList.innerHTML = "";

    state.items
      .filter(function (item) {
        if (!keyword) return true;
        return [item.title, item.owner, item.category, item.sourceType].some(function (v) {
          return (v || "").toLowerCase().includes(keyword);
        });
      })
      .sort(function (a, b) {
        return new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime();
      })
      .forEach(function (item) {
        const card = document.createElement("div");
        const featureCount = GisParsers.countFeatures(item.geojson);
        const badge = item.saved ? "Saved" : "Unsaved";

        card.className = "layer-card" + (state.activeId === item.id ? " active" : "");
        card.innerHTML =
          '<div class="layer-top"><div style="flex:1">' +
          '<div class="layer-title">' + GisUI.escapeHtml(item.title) + "</div>" +
          '<div class="layer-meta">' + badge + " | " + GisUI.escapeHtml(item.sourceType) + "<br>" +
          "Features: " + featureCount + "<br>" +
          "Owner: " + GisUI.escapeHtml(item.owner || "-") + "<br>" +
          "Category: " + GisUI.escapeHtml(item.category || "-") +
          '</div></div><div class="color-chip" style="background:' + item.color + '"></div></div>' +
          '<div class="layer-actions">' +
          '<button class="small-btn view">View</button>' +
          '<button class="small-btn edit">Edit</button>' +
          (item.saved ? "" : '<button class="small-btn save">Save</button>') +
          '<button class="small-btn delete">' + (item.saved ? "Delete DB" : "Remove") + "</button></div>";

        const buttons = card.querySelectorAll("button");
        buttons[0].onclick = function () { focusItem(item.id); };
        buttons[1].onclick = function () { enableEdit(item.id); };
        if (!item.saved) buttons[2].onclick = function () { saveItem(item.id); };
        buttons[item.saved ? 2 : 3].onclick = function () { removeItem(item.id); };

        els.layerList.appendChild(card);
      });

    els.dbCountBadge.textContent = String(state.items.filter(function (x) { return x.saved; }).length);
  }

  function focusItem(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item || !item.leafletLayer) return;
    state.activeId = id;
    renderSidebar();
    GisUI.fitToLayer(map, item.leafletLayer);
  }

  function clearEditState() {
    editableGroup.clearLayers();
  }

  function enableEdit(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item || !item.leafletLayer) return;
    clearEditState();
    state.activeId = id;

    item.leafletLayer.eachLayer(function (layer) {
      editableGroup.addLayer(layer);
      if (layer.editing && typeof layer.editing.enable === "function") layer.editing.enable();
    });

    GisUI.fitToLayer(map, item.leafletLayer);
    renderSidebar();
    GisUI.setStatus(els, "Editing: " + item.title);
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

  function addItem(meta, geojson, saved, docId) {
    const item = {
      id: uid(),
      docId: docId || null,
      saved: saved,
      title: meta.title,
      owner: meta.owner,
      category: meta.category,
      notes: meta.notes,
      sourceType: meta.sourceType,
      uploadedAt: meta.uploadedAt,
      color: GisParsers.getColorBySource(meta.sourceType),
      geojson: geojson,
      leafletLayer: null
    };

    GisUI.createLeafletLayer(item, saved ? savedGroup : unsavedGroup, state, renderSidebar);
    state.items.push(item);
    state.activeId = item.id;
    renderSidebar();
    GisUI.fitToLayer(map, item.leafletLayer);
    return item;
  }

  async function saveItem(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item) return;

    try {
      if (state.activeId === item.id && editableGroup.getLayers().length > 0) await updateGeoJsonFromEditable(item);
      if (item.leafletLayer) {
        unsavedGroup.removeLayer(item.leafletLayer);
        savedGroup.removeLayer(item.leafletLayer);
      }

      const payload = {
        title: item.title,
        owner: item.owner,
        category: item.category,
        notes: item.notes,
        sourceType: item.sourceType,
        uploadedAt: item.uploadedAt,
        updatedAt: new Date().toISOString(),
        color: item.color,
        geojson: item.geojson
      };

      if (item.docId) await db.collection("gis_layers").doc(item.docId).set(payload, { merge: true });
      else item.docId = (await db.collection("gis_layers").add(payload)).id;

      item.saved = true;
      GisUI.createLeafletLayer(item, savedGroup, state, renderSidebar);
      clearEditState();
      renderSidebar();
      GisUI.setStatus(els, "Saved to database: " + item.title);
    } catch (err) {
      alert("Save error: " + err.message);
      GisUI.setStatus(els, "Save failed");
    }
  }

  async function removeItem(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item) return;

    try {
      if (item.saved && item.docId) await db.collection("gis_layers").doc(item.docId).delete();
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
      GisUI.setStatus(els, "Removed: " + item.title);
    } catch (err) {
      alert("Delete error: " + err.message);
      GisUI.setStatus(els, "Delete failed");
    }
  }

  async function loadDatabaseLayers() {
    try {
      GisUI.setStatus(els, "Loading database layers...");
      savedGroup.clearLayers();

      const snapshot = await db.collection("gis_layers").get();
      const unsaved = state.items.filter(function (x) { return !x.saved; });
      state.items = unsaved;

      snapshot.forEach(function (doc) {
        const data = doc.data();
        if (!data.geojson) return;

        addItem({
          title: data.title || "Untitled",
          owner: data.owner || "",
          category: data.category || "",
          notes: data.notes || "",
          sourceType: data.sourceType || "database",
          uploadedAt: data.uploadedAt || new Date().toISOString()
        }, GisParsers.normalizeGeoJson(data.geojson), true, doc.id);
      });

      renderSidebar();
      GisUI.zoomAll(map, savedGroup, unsavedGroup);
      GisUI.setStatus(els, "Database loaded");
    } catch (err) {
      alert("Database load error: " + err.message);
      GisUI.setStatus(els, "Database load failed");
    }
  }

  async function handleFileUpload(file) {
    if (!file) return;
    GisUI.setStatus(els, "Reading file: " + file.name);

    try {
      const name = file.name || "Imported File";
      const lower = name.toLowerCase();
      let geojson = null;
      let sourceType = "";

      if (lower.endsWith(".kmz")) {
        geojson = await GisParsers.parseKmz(await file.arrayBuffer());
        sourceType = "KMZ";
      } else if (lower.endsWith(".kml")) {
        geojson = await GisParsers.parseKmlText(await file.text());
        sourceType = "KML";
      } else if (lower.endsWith(".zip") || lower.endsWith(".shp")) {
        geojson = await GisParsers.parseShpZip(await file.arrayBuffer());
        sourceType = lower.endsWith(".zip") ? "ZIP Shapefile" : "SHP";
      } else {
        throw new Error("Supported files: KMZ, KML, ZIP Shapefile, SHP");
      }

      addItem(collectMeta(name, sourceType), geojson, false, null);
      GisUI.setStatus(els, "Imported: " + name);
    } catch (err) {
      alert("Import error: " + err.message);
      GisUI.setStatus(els, "Import failed");
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
    GisUI.setStatus(els, "Unsaved layers cleared");
  }

  map.on(L.Draw.Event.CREATED, async function (e) {
    addItem(collectMeta("Drawn Layer", "Draw"), GisParsers.normalizeGeoJson(e.layer.toGeoJSON()), false, null);
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
        GisUI.setStatus(els, "Layer updated: " + item.title);
      }
    } catch (err) {
      GisUI.setStatus(els, "Edit update failed");
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
