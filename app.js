// File: app.js
(function () {
  const canvasRenderer = L.canvas({ padding: 0.5 });
  const map = L.map("map", { preferCanvas: true }).setView([24.7136, 46.6753], 6);
  const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  const imagery = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "Tiles &copy; Esri" });
  const savedGroup = L.featureGroup().addTo(map), unsavedGroup = L.featureGroup().addTo(map), editableGroup = new L.FeatureGroup().addTo(map);

  const state = { items: [], activeId: null, firstDbFitDone: false, pendingShpName: "" };
  const els = {
    fileInput: document.getElementById("fileInput"),
    folderInput: document.getElementById("folderInput"),
    dropZone: document.getElementById("dropZone"),
    dropZoneFileName: document.getElementById("dropZoneFileName"),
    datasetTitle: document.getElementById("datasetTitle"),
    userName: document.getElementById("userName"),
    adminCode: document.getElementById("adminCode"),
    datasetCategory: document.getElementById("datasetCategory"),
    datasetNotes: document.getElementById("datasetNotes"),
    saveSelectedBtn: document.getElementById("saveSelectedBtn"),
    refreshDbBtn: document.getElementById("refreshDbBtn"),
    clearUnsavedBtn: document.getElementById("clearUnsavedBtn"),
    zoomAllBtn: document.getElementById("zoomAllBtn"),
    clearSelectionBtn: document.getElementById("clearSelectionBtn"),
    layerList: document.getElementById("layerList"),
    dbCountBadge: document.getElementById("dbCountBadge"),
    statusText: document.getElementById("statusText"),
    searchBox: document.getElementById("searchBox"),
    sidebar: document.getElementById("sidebar"),
    toggleSidebar: document.getElementById("toggleSidebar"),
    sidebarReopenBtn: document.getElementById("sidebarReopenBtn"),
    attributePanel: document.getElementById("attributePanel"),
    basemapSelect: document.getElementById("basemapSelect")
  };

  function setStatus(t) { GisUI.setStatus(els, t); }
  function renderSidebar() { AppSidebar.render(state, els, actions); }
  function clearEditState() { editableGroup.clearLayers(); }
  function currentUser() { return AppHelpers.currentUser(els); }
  function requireUserName() { if (currentUser().trim()) return true; alert("User name is required before save."); return false; }
  function toggleSidebarView(open) { els.sidebar.classList.toggle("collapsed", !open); document.body.classList.toggle("sidebar-is-collapsed", !open); setTimeout(function () { map.invalidateSize(); }, 260); }

  function createLayer(item, targetGroup) {
    const color = item.color;
    item.leafletLayer = L.geoJSON(item.geojson, {
      renderer: canvasRenderer,
      style: function () { return { color: color, fillColor: color, weight: 1.6, fillOpacity: 0.28 }; },
      pointToLayer: function (feature, latlng) { return L.circleMarker(latlng, { renderer: canvasRenderer, radius: 5, color: color, fillColor: color, fillOpacity: 0.9, weight: 1 }); },
      onEachFeature: function (feature, lyr) {
        lyr.on("click", function () { state.activeId = item.id; AppPanel.render(els.attributePanel, feature.properties || {}); renderSidebar(); });
      }
    }).addTo(targetGroup);
  }

  function addItem(meta, geojson, saved, layerId, color, fitMap) {
    const item = AppHelpers.makeItem(meta, geojson, saved, layerId, color);
    if (item.visible !== false) createLayer(item, saved ? savedGroup : unsavedGroup);
    state.items.push(item);
    state.activeId = item.id;
    renderSidebar();
    if (fitMap !== false && item.leafletLayer) GisUI.fitToLayer(map, item.leafletLayer);
    return item;
  }

  function focusItem(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item || !item.leafletLayer) return;
    state.activeId = id;
    renderSidebar();
    GisUI.fitToLayer(map, item.leafletLayer);
  }

  function canEdit(item) { return !item.lockOwner || item.lockOwner === currentUser() || AppHelpers.isAdmin(els); }

  function enableEdit(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item) return;
    if (item.saved && !canEdit(item)) return alert("Layer locked by: " + item.lockOwner);
    clearEditState();
    state.activeId = id;
    if (!item.leafletLayer) return;
    item.leafletLayer.eachLayer(function (layer) {
      editableGroup.addLayer(layer);
      if (layer.editing && typeof layer.editing.enable === "function") layer.editing.enable();
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
    if (!item || !requireUserName()) return;
    try {
      if (editableGroup.getLayers().length > 0) await updateGeoJsonFromEditable(item);
      item.owner_name = currentUser();
      item.layerId = await AppStorage.saveItem(item, currentUser());
      item.saved = true;
      AppSync.removeLayer(savedGroup, unsavedGroup, item);
      state.items = state.items.filter(function (x) { return x.id !== item.id; });
      state.activeId = null;
      clearEditState();
      renderSidebar();
      setStatus("Saved successfully");
    } catch (err) {
      alert("Save error: " + err.message);
      setStatus("Save failed");
    }
  }

  async function removeItem(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item) return;
    if (!AppHelpers.isAdmin(els)) return alert("Delete allowed for admin only.");
    try {
      await AppStorage.deleteItem(item);
      AppSync.removeLayer(savedGroup, unsavedGroup, item);
      state.items = state.items.filter(function (x) { return x.id !== id; });
      if (state.activeId === id) state.activeId = null;
      AppPanel.clear(els.attributePanel);
      clearEditState();
      renderSidebar();
      setStatus("Removed: " + item.title);
    } catch (err) {
      alert("Delete error: " + err.message);
      setStatus("Delete failed");
    }
  }

  async function toggleVisibility(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item) return;
    if (!item.saved) {
      item.visible = !item.visible;
      if (item.visible && !item.leafletLayer) createLayer(item, unsavedGroup);
      if (!item.visible) AppSync.removeLayer(savedGroup, unsavedGroup, item);
      renderSidebar();
      return;
    }
    await AppStorage.toggleVisibility(item);
  }

  async function toggleLock(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item || !item.saved) return;
    if (item.lockOwner && item.lockOwner !== currentUser() && !AppHelpers.isAdmin(els)) return alert("Locked by: " + item.lockOwner);
    if (!currentUser().trim()) return alert("User name is required before lock/unlock.");
    await AppStorage.toggleLock(item, currentUser());
  }

  async function parseShpFamily(files, shpName) {
    const lowerBase = shpName.replace(/\.shp$/i, "").toLowerCase();
    const related = Array.from(files).filter(function (f) {
      return f.name.replace(/\.[^.]+$/,"").toLowerCase() === lowerBase;
    });

    const hasDbf = related.some(function (f) { return /\.dbf$/i.test(f.name); });
    const hasShx = related.some(function (f) { return /\.shx$/i.test(f.name); });
    const hasPrj = related.some(function (f) { return /\.prj$/i.test(f.name); });

    if (!hasDbf || !hasShx) {
      throw new Error("Missing related SHP files. Required in same folder: .dbf and .shx");
    }

    if (!hasPrj) {
      alert("Warning: .prj file is missing for this SHP.");
    }

    const zip = new JSZip();
    related.forEach(function (f) { zip.file(f.name, f); });
    const zipped = await zip.generateAsync({ type: "arraybuffer" });
    return { name: shpName, sourceType: "SHP", geojson: await GisParsers.parseShpZip(zipped) };
  }

  async function filesToGeoJson(files) {
    const list = Array.from(files || []);
    if (!list.length) throw new Error("No file selected.");

    const oneZip = list.find(function (f) { return /\.zip$/i.test(f.name); });
    const oneKmz = list.find(function (f) { return /\.kmz$/i.test(f.name); });
    const oneKml = list.find(function (f) { return /\.kml$/i.test(f.name); });
    const oneShp = list.find(function (f) { return /\.shp$/i.test(f.name); });

    if (oneKmz) return { name: oneKmz.name, sourceType: "KMZ", geojson: await GisParsers.parseKmz(await oneKmz.arrayBuffer()) };
    if (oneKml) return { name: oneKml.name, sourceType: "KML", geojson: await GisParsers.parseKmlText(await oneKml.text()) };
    if (oneZip) return { name: oneZip.name, sourceType: "ZIP Shapefile", geojson: await GisParsers.parseShpZip(await oneZip.arrayBuffer()) };
    if (oneShp) return await parseShpFamily(list, oneShp.name);

    throw new Error("Supported: KMZ, KML, ZIP Shapefile, or SHP.");
  }

  async function handleFiles(files) {
    setStatus("Reading file...");
    try {
      const result = await filesToGeoJson(files);
      els.dropZoneFileName.textContent = result.name;
      addItem(AppHelpers.collectMeta(els, result.name, result.sourceType), result.geojson, false, null, null, true);
      setStatus("Imported: " + result.name);
    } catch (err) {
      alert("Import error: " + err.message);
      setStatus("Import failed");
    }
  }

  function clearUnsaved() {
    state.items.filter(function (x) { return !x.saved; }).forEach(function (item) { AppSync.removeLayer(savedGroup, unsavedGroup, item); });
    state.items = state.items.filter(function (x) { return x.saved; });
    state.activeId = null;
    AppPanel.clear(els.attributePanel);
    clearEditState();
    renderSidebar();
    els.dropZoneFileName.textContent = "No file selected";
    state.pendingShpName = "";
    setStatus("Unsaved layers cleared");
  }

  function startRealtimeSync() {
    setStatus("Connecting database...");
    AppStorage.watchAll(function (rows) {
      AppSync.syncSavedRows({ state: state, rows: rows, savedGroup: savedGroup, unsavedGroup: unsavedGroup, createLayer: createLayer, renderSidebar: renderSidebar });
      if (!state.firstDbFitDone) {
        GisUI.zoomAll(map, savedGroup, unsavedGroup);
        state.firstDbFitDone = true;
      }
      setStatus("Database synced");
    }, function (error) {
      alert("Database sync error: " + error.message);
      setStatus("Database sync failed");
    });
  }

  function setupDragDrop() {
    function stop(e) { e.preventDefault(); e.stopPropagation(); }
    ["dragenter","dragover","dragleave","drop"].forEach(function (n) { els.dropZone.addEventListener(n, stop, false); });
    ["dragenter","dragover"].forEach(function (n) { els.dropZone.addEventListener(n, function () { els.dropZone.classList.add("drag-over"); }, false); });
    ["dragleave","drop"].forEach(function (n) { els.dropZone.addEventListener(n, function () { els.dropZone.classList.remove("drag-over"); }, false); });
    els.dropZone.addEventListener("drop", async function (e) { await handleFiles(e.dataTransfer.files); }, false);

    els.dropZone.addEventListener("click", function () {
      els.fileInput.click();
    });
  }

  const actions = { focusItem: focusItem, enableEdit: enableEdit, saveItem: saveItem, removeItem: removeItem, toggleVisibility: toggleVisibility, toggleLock: toggleLock };

  map.on(L.Draw.Event.CREATED, function (e) {
    addItem(AppHelpers.collectMeta(els, "Drawn Layer", "Draw"), GisParsers.normalizeGeoJson(e.layer.toGeoJSON()), false, null, null, true);
    enableEdit(state.activeId);
  });

  map.on(L.Draw.Event.EDITED, async function () {
    const item = state.items.find(function (x) { return x.id === state.activeId; });
    if (!item) return;
    try {
      await updateGeoJsonFromEditable(item);
      AppSync.removeLayer(savedGroup, unsavedGroup, item);
      if (item.visible !== false) createLayer(item, item.saved ? savedGroup : unsavedGroup);
      renderSidebar();
      setStatus("Layer updated: " + item.title);
    } catch (err) {
      setStatus("Edit update failed");
    }
  });

  els.fileInput.addEventListener("change", async function (e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const shp = files.find(function (f) { return /\.shp$/i.test(f.name); });
    if (shp) {
      state.pendingShpName = shp.name;
      els.dropZoneFileName.textContent = shp.name;
      alert("Now choose the folder containing this SHP so the app can load .dbf/.shx/.prj from the same directory.");
      els.folderInput.click();
    } else {
      await handleFiles(files);
    }
    e.target.value = "";
  });

  els.folderInput.addEventListener("change", async function (e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (state.pendingShpName) {
      const shpFiles = files.filter(function (f) {
        return f.name.replace(/\.[^.]+$/,"").toLowerCase() === state.pendingShpName.replace(/\.shp$/i,"").toLowerCase();
      });
      await handleFiles(shpFiles);
      state.pendingShpName = "";
    } else {
      await handleFiles(files);
    }
    e.target.value = "";
  });

  els.saveSelectedBtn.addEventListener("click", async function () {
    const item = state.items.find(function (x) { return x.id === state.activeId && !x.saved; }) || state.items.find(function (x) { return !x.saved; });
    if (!item) return alert("No unsaved layer selected.");
    await saveItem(item.id);
  });

  els.refreshDbBtn.addEventListener("click", startRealtimeSync);
  els.clearUnsavedBtn.addEventListener("click", clearUnsaved);
  els.zoomAllBtn.addEventListener("click", function () { GisUI.zoomAll(map, savedGroup, unsavedGroup); });
  els.searchBox.addEventListener("input", renderSidebar);
  els.clearSelectionBtn.addEventListener("click", function () { state.activeId = null; AppPanel.clear(els.attributePanel); renderSidebar(); });
  els.toggleSidebar.addEventListener("click", function () { toggleSidebarView(false); });
  els.sidebarReopenBtn.addEventListener("click", function () { toggleSidebarView(true); });
  els.basemapSelect.addEventListener("change", function () {
    if (els.basemapSelect.value === "satellite") {
      if (map.hasLayer(osm)) map.removeLayer(osm);
      if (!map.hasLayer(imagery)) imagery.addTo(map);
    } else {
      if (map.hasLayer(imagery)) map.removeLayer(imagery);
      if (!map.hasLayer(osm)) osm.addTo(map);
    }
  });

  setTimeout(function () { map.invalidateSize(); }, 300);
  AppPanel.clear(els.attributePanel);
  setupDragDrop();
  startRealtimeSync();
})();
