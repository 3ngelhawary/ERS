// File: app.js
(function () {
  if (!window.supabase) {
    alert("Supabase library not loaded.");
    return;
  }

  const canvasRenderer = L.canvas({ padding: 0.5 });
  const supabaseClient = window.supabase.createClient(
    AppConfig.supabaseUrl,
    AppConfig.supabaseAnonKey
  );

  const map = L.map("map", { preferCanvas: true }).setView([24.7136, 46.6753], 6);

  const streetLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { attribution: "&copy; OpenStreetMap contributors" }
  ).addTo(map);

  const satelliteLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles &copy; Esri" }
  );

  const savedGroup = L.featureGroup().addTo(map);
  const unsavedGroup = L.featureGroup().addTo(map);
  const editableGroup = new L.FeatureGroup().addTo(map);

  map.addControl(new L.Control.Draw({
    edit: { featureGroup: editableGroup, remove: false },
    draw: {
      rectangle: true,
      polygon: true,
      polyline: false,
      circle: false,
      circlemarker: false,
      marker: false
    }
  }));

  const state = {
    items: [],
    activeId: null,
    firstDbFitDone: false,
    visibleFilter: "all",
    channel: null
  };

  const els = {
    fileInput: document.getElementById("fileInput"),
    dropZone: document.getElementById("dropZone"),
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
    basemapSelect: document.getElementById("basemapSelect"),
    visibilityFilter: document.getElementById("visibilityFilter"),
    attributeSummary: document.getElementById("attributeSummary"),
    attributeTable: document.getElementById("attributeTable").querySelector("tbody"),
    savedLayerCount: document.getElementById("savedLayerCount"),
    unsavedLayerCount: document.getElementById("unsavedLayerCount"),
    visibleLayerCount: document.getElementById("visibleLayerCount"),
    lockedLayerCount: document.getElementById("lockedLayerCount")
  };

  function setStatus(text) {
    els.statusText.textContent = text;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function uid() {
    return "L" + Date.now() + "_" + Math.random().toString(36).substring(2, 10);
  }

  function currentUser() {
    return (els.userName.value || "").trim();
  }

  function isAdmin() {
    return (els.adminCode.value || "").trim() === AppConfig.adminCode;
  }

  function requireUserName() {
    if (currentUser()) return true;
    alert("User name is required.");
    return false;
  }

  function sourceTextFromFiles(files) {
    const names = Array.from(files || []).map(function (f) { return f.name.toLowerCase(); });
    if (names.some(function (n) { return n.endsWith(".kmz"); })) return "KMZ";
    if (names.some(function (n) { return n.endsWith(".kml"); })) return "KML";
    if (names.some(function (n) { return n.endsWith(".zip"); })) return "ZIP Shapefile";
    if (names.some(function (n) { return n.endsWith(".shp"); })) return "SHP";
    return "Unknown";
  }

  function getColorBySource(sourceType) {
    const s = (sourceType || "").toLowerCase();
    if (s.includes("kmz") || s.includes("kml")) return "#ff9f1a";
    if (s.includes("zip") || s.includes("shp")) return "#1f9bff";
    if (s.includes("draw")) return "#18c37e";
    return "#7c54ff";
  }

  function normalizeGeoJson(geojson) {
    if (!geojson) throw new Error("Empty GIS data.");
    if (geojson.type === "FeatureCollection") return geojson;
    if (geojson.type === "Feature") return { type: "FeatureCollection", features: [geojson] };
    if (Array.isArray(geojson)) return { type: "FeatureCollection", features: geojson };
    throw new Error("Unsupported GeoJSON structure.");
  }

  function countFeatures(geojson) {
    const normalized = normalizeGeoJson(geojson);
    return normalized.features.length;
  }

  function buildItem(meta, geojson, saved, layerId, color) {
    return {
      id: uid(),
      layerId: layerId || null,
      saved: !!saved,
      title: meta.title || "Untitled Layer",
      owner_name: meta.owner_name || "Guest",
      category: meta.category || "General",
      notes: meta.notes || "",
      sourceType: meta.sourceType || "Unknown",
      uploadedAt: meta.uploadedAt || new Date().toISOString(),
      visible: meta.visible !== false,
      lockOwner: meta.lockOwner || "",
      lockedAt: meta.lockedAt || "",
      color: color || getColorBySource(meta.sourceType),
      geojson: normalizeGeoJson(geojson),
      leafletLayer: null
    };
  }

  function splitFeatureCollection(geojson) {
    const normalized = normalizeGeoJson(geojson);
    return normalized.features
      .filter(function (feature) { return !!feature.geometry; })
      .map(function (feature) {
        return {
          type: "Feature",
          properties: feature.properties || {},
          geometry: feature.geometry
        };
      });
  }

  function featuresToCollection(features) {
    return {
      type: "FeatureCollection",
      features: (features || []).map(function (f) {
        return {
          type: "Feature",
          properties: f.properties || {},
          geometry: f.geometry || null
        };
      }).filter(function (f) { return !!f.geometry; })
    };
  }

  function clearAttributeTable() {
    els.attributeSummary.textContent = "No feature selected";
    els.attributeTable.innerHTML = "";
  }

  function renderAttributeTable(props) {
    const keys = Object.keys(props || {});
    els.attributeSummary.textContent = keys.length ? ("Fields: " + keys.length) : "No attributes";
    els.attributeTable.innerHTML = keys.map(function (k) {
      return "<tr><td>" + escapeHtml(k) + "</td><td>" + escapeHtml(props[k]) + "</td></tr>";
    }).join("");
  }

  function removeLeafletLayer(item) {
    if (!item || !item.leafletLayer) return;
    savedGroup.removeLayer(item.leafletLayer);
    unsavedGroup.removeLayer(item.leafletLayer);
    item.leafletLayer = null;
  }

  function createLayer(item, targetGroup) {
    const color = item.color;

    item.leafletLayer = L.geoJSON(item.geojson, {
      renderer: canvasRenderer,
      style: function () {
        return {
          color: color,
          fillColor: color,
          weight: 1.2,
          fillOpacity: 0.25
        };
      },
      pointToLayer: function (feature, latlng) {
        return L.circleMarker(latlng, {
          renderer: canvasRenderer,
          radius: 4,
          color: color,
          fillColor: color,
          fillOpacity: 0.9,
          weight: 1
        });
      },
      onEachFeature: function (feature, lyr) {
        lyr.on("click", function () {
          state.activeId = item.id;
          renderAttributeTable(feature.properties || {});
          renderSidebar();
        });
      }
    }).addTo(targetGroup);
  }

  function addItem(meta, geojson, saved, layerId, color, fitMap) {
    const item = buildItem(meta, geojson, saved, layerId, color);

    if (item.visible !== false) {
      createLayer(item, saved ? savedGroup : unsavedGroup);
    }

    state.items.push(item);
    state.activeId = item.id;
    renderSidebar();

    if (fitMap !== false && item.leafletLayer) {
      fitToLayer(item.leafletLayer);
    }

    return item;
  }

  function fitToLayer(layer) {
    try {
      const bounds = layer.getBounds();
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    } catch (e) {
    }
  }

  function zoomAll() {
    const group = L.featureGroup();
    savedGroup.eachLayer(function (l) { group.addLayer(l); });
    unsavedGroup.eachLayer(function (l) { group.addLayer(l); });
    try {
      const bounds = group.getBounds();
      if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
    } catch (e) {
    }
  }

  function toggleSidebarView(open) {
    els.sidebar.classList.toggle("collapsed", !open);
    document.body.classList.toggle("sidebar-is-collapsed", !open);
    setTimeout(function () { map.invalidateSize(); }, 260);
  }

  function canEdit(item) {
    return !item.lockOwner || item.lockOwner === currentUser() || isAdmin();
  }

  function renderStats() {
    const savedCount = state.items.filter(function (x) { return x.saved; }).length;
    const unsavedCount = state.items.filter(function (x) { return !x.saved; }).length;
    const visibleCount = state.items.filter(function (x) { return x.visible !== false; }).length;
    const lockedCount = state.items.filter(function (x) { return !!x.lockOwner; }).length;

    els.savedLayerCount.textContent = String(savedCount);
    els.unsavedLayerCount.textContent = String(unsavedCount);
    els.visibleLayerCount.textContent = String(visibleCount);
    els.lockedLayerCount.textContent = String(lockedCount);
    els.dbCountBadge.textContent = String(savedCount);
  }

  function renderSidebar() {
    const keyword = (els.searchBox.value || "").trim().toLowerCase();
    const filterMode = els.visibilityFilter.value;
    els.layerList.innerHTML = "";

    state.items
      .filter(function (item) {
        const keywordOk = !keyword || [item.title, item.owner_name, item.category, item.sourceType].some(function (v) {
          return (v || "").toLowerCase().includes(keyword);
        });

        const visibleOk =
          filterMode === "all" ||
          (filterMode === "visible" && item.visible !== false) ||
          (filterMode === "hidden" && item.visible === false);

        return keywordOk && visibleOk;
      })
      .sort(function (a, b) {
        return new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0);
      })
      .forEach(function (item) {
        const count = countFeatures(item.geojson);
        const lockTxt = item.lockOwner ? ("Locked: " + item.lockOwner) : "Unlocked";
        const card = document.createElement("div");

        card.className = "layer-card" + (state.activeId === item.id ? " active" : "");
        card.innerHTML =
          '<div class="layer-top">' +
            '<div style="flex:1">' +
              '<div class="layer-title">' + escapeHtml(item.title) + '</div>' +
              '<div class="layer-meta">' +
                escapeHtml(item.category) + " | " + escapeHtml(item.owner_name) +
                "<br>Features: " + count +
                "<br>" + escapeHtml(lockTxt) +
                "<br>Visible: " + (item.visible !== false ? "Yes" : "No") +
              '</div>' +
            '</div>' +
            '<div class="color-chip" style="background:' + item.color + '"></div>' +
          '</div>' +
          '<div class="layer-actions">' +
            '<button class="small-btn view">View</button>' +
            '<button class="small-btn toggle">' + (item.visible !== false ? "Hide" : "Show") + '</button>' +
            '<button class="small-btn edit">Edit</button>' +
            (item.saved ? ('<button class="small-btn lock">' + (item.lockOwner ? "Unlock" : "Lock") + '</button>') : "") +
            (item.saved ? "" : '<button class="small-btn save">Save</button>') +
            '<button class="small-btn delete">' + (item.saved ? "Delete" : "Remove") + "</button>" +
          "</div>";

        const btns = card.querySelectorAll("button");
        let i = 0;

        btns[i++].onclick = function () { focusItem(item.id); };
        btns[i++].onclick = function () { toggleVisibility(item.id); };
        btns[i++].onclick = function () { enableEdit(item.id); };

        if (item.saved) {
          btns[i++].onclick = function () { toggleLock(item.id); };
        }

        if (!item.saved) {
          btns[i++].onclick = function () { saveItem(item.id); };
        }

        btns[i++].onclick = function () { removeItem(item.id); };
        els.layerList.appendChild(card);
      });

    renderStats();
  }

  function focusItem(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item || !item.leafletLayer) return;
    state.activeId = id;
    renderSidebar();
    fitToLayer(item.leafletLayer);
  }

  function clearEditState() {
    editableGroup.clearLayers();
  }

  function enableEdit(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item) return;

    if (item.saved && !canEdit(item)) {
      alert("Layer locked by: " + item.lockOwner);
      return;
    }

    clearEditState();
    state.activeId = id;
    if (!item.leafletLayer) return;

    item.leafletLayer.eachLayer(function (layer) {
      editableGroup.addLayer(layer);
      if (layer.editing && typeof layer.editing.enable === "function") {
        layer.editing.enable();
      }
    });

    fitToLayer(item.leafletLayer);
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

    if (features.length > 0) {
      item.geojson = { type: "FeatureCollection", features: features };
    }
  }

  async function saveLayerRow(item) {
    const payload = {
      title: item.title,
      owner_name: item.owner_name,
      category: item.category,
      notes: item.notes,
      color: item.color,
      visible: item.visible !== false,
      lock_owner: item.lockOwner || null,
      locked_at: item.lockedAt || null,
      updated_at: new Date().toISOString()
    };

    if (item.layerId) {
      const result = await supabaseClient
        .from(AppConfig.layersTable)
        .update(payload)
        .eq("id", item.layerId)
        .select("id")
        .single();

      if (result.error) throw result.error;
      return result.data.id;
    }

    payload.created_at = new Date().toISOString();

    const inserted = await supabaseClient
      .from(AppConfig.layersTable)
      .insert(payload)
      .select("id")
      .single();

    if (inserted.error) throw inserted.error;
    return inserted.data.id;
  }

  async function replaceFeatures(layerId, geojson) {
    const deleteResult = await supabaseClient
      .from(AppConfig.featuresTable)
      .delete()
      .eq("layer_id", layerId);

    if (deleteResult.error) throw deleteResult.error;

    const rows = splitFeatureCollection(geojson).map(function (feature) {
      return {
        layer_id: layerId,
        geometry: feature.geometry,
        properties: feature.properties || {},
        created_by: currentUser(),
        updated_by: currentUser(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    });

    if (!rows.length) return;

    const insertResult = await supabaseClient
      .from(AppConfig.featuresTable)
      .insert(rows);

    if (insertResult.error) throw insertResult.error;
  }

  async function saveItem(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item || !requireUserName()) return;

    try {
      if (editableGroup.getLayers().length > 0) {
        await updateGeoJsonFromEditable(item);
      }

      item.owner_name = currentUser();
      item.layerId = await saveLayerRow(item);
      await replaceFeatures(item.layerId, item.geojson);
      item.saved = true;

      removeLeafletLayer(item);
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

    if (!isAdmin()) {
      alert("Delete allowed for admin only.");
      return;
    }

    try {
      if (item.saved && item.layerId) {
        const result = await supabaseClient
          .from(AppConfig.layersTable)
          .delete()
          .eq("id", item.layerId);

        if (result.error) throw result.error;
      }

      removeLeafletLayer(item);
      state.items = state.items.filter(function (x) { return x.id !== id; });

      if (state.activeId === id) {
        state.activeId = null;
      }

      clearAttributeTable();
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
      if (!item.visible) removeLeafletLayer(item);
      renderSidebar();
      return;
    }

    const result = await supabaseClient
      .from(AppConfig.layersTable)
      .update({
        visible: item.visible === false ? true : false,
        updated_at: new Date().toISOString()
      })
      .eq("id", item.layerId);

    if (result.error) {
      alert("Visibility error: " + result.error.message);
    }
  }

  async function toggleLock(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item || !item.saved) return;

    if (item.lockOwner && item.lockOwner !== currentUser() && !isAdmin()) {
      alert("Locked by: " + item.lockOwner);
      return;
    }

    if (!requireUserName()) return;

    const nextOwner = item.lockOwner ? null : currentUser();

    const result = await supabaseClient
      .from(AppConfig.layersTable)
      .update({
        lock_owner: nextOwner,
        locked_at: nextOwner ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      })
      .eq("id", item.layerId);

    if (result.error) {
      alert("Lock error: " + result.error.message);
    }
  }

  async function loadAllRows() {
    const layersResult = await supabaseClient
      .from(AppConfig.layersTable)
      .select("*")
      .order("updated_at", { ascending: false });

    if (layersResult.error) throw layersResult.error;

    const featuresResult = await supabaseClient
      .from(AppConfig.featuresTable)
      .select("*");

    if (featuresResult.error) throw featuresResult.error;

    const byLayer = {};
    (featuresResult.data || []).forEach(function (row) {
      if (!byLayer[row.layer_id]) byLayer[row.layer_id] = [];
      byLayer[row.layer_id].push({
        geometry: row.geometry,
        properties: row.properties || {}
      });
    });

    return (layersResult.data || []).map(function (row) {
      return {
        layerId: row.id,
        title: row.title || "Untitled",
        owner_name: row.owner_name || "Guest",
        category: row.category || "General",
        notes: row.notes || "",
        sourceType: "Database",
        uploadedAt: row.created_at || new Date().toISOString(),
        color: row.color || "#1f9bff",
        visible: row.visible !== false,
        lockOwner: row.lock_owner || "",
        lockedAt: row.locked_at || "",
        geojson: featuresToCollection(byLayer[row.id] || [])
      };
    });
  }

  function syncSavedRows(rows) {
    const unsavedItems = state.items.filter(function (x) { return !x.saved; });

    state.items.filter(function (x) { return x.saved; }).forEach(function (item) {
      removeLeafletLayer(item);
    });

    const rebuilt = rows.map(function (row) {
      const item = buildItem(
        {
          title: row.title,
          owner_name: row.owner_name,
          category: row.category,
          notes: row.notes,
          sourceType: row.sourceType,
          uploadedAt: row.uploadedAt,
          visible: row.visible,
          lockOwner: row.lockOwner,
          lockedAt: row.lockedAt
        },
        row.geojson,
        true,
        row.layerId,
        row.color
      );

      if (item.visible !== false) {
        createLayer(item, savedGroup);
      }

      return item;
    });

    state.items = unsavedItems.concat(rebuilt);
    renderSidebar();
  }

  async function startRealtimeSync() {
    try {
      setStatus("Connecting database...");
      if (state.channel) {
        supabaseClient.removeChannel(state.channel);
        state.channel = null;
      }

      state.channel = supabaseClient.channel("gis-live-sync");

      state.channel
        .on("postgres_changes", { event: "*", schema: "public", table: AppConfig.layersTable }, async function () {
          const rows = await loadAllRows();
          syncSavedRows(rows);
          if (!state.firstDbFitDone) {
            zoomAll();
            state.firstDbFitDone = true;
          }
          setStatus("Database synced");
        })
        .on("postgres_changes", { event: "*", schema: "public", table: AppConfig.featuresTable }, async function () {
          const rows = await loadAllRows();
          syncSavedRows(rows);
          if (!state.firstDbFitDone) {
            zoomAll();
            state.firstDbFitDone = true;
          }
          setStatus("Database synced");
        })
        .subscribe(async function (status) {
          if (status === "SUBSCRIBED") {
            const rows = await loadAllRows();
            syncSavedRows(rows);
            if (!state.firstDbFitDone) {
              zoomAll();
              state.firstDbFitDone = true;
            }
            setStatus("Database synced");
          }
        });
    } catch (err) {
      alert("Database sync error: " + err.message);
      setStatus("Database sync failed");
    }
  }

  async function parseKmlText(text) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "text/xml");
    if (window.toGeoJSON) return normalizeGeoJson(window.toGeoJSON.kml(xml));
    if (window.togeojson) return normalizeGeoJson(window.togeojson.kml(xml));
    throw new Error("KML library not loaded.");
  }

  async function parseKmz(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const kmlName = Object.keys(zip.files).find(function (name) {
      return name.toLowerCase().endsWith(".kml");
    });

    if (!kmlName) throw new Error("No KML found inside KMZ.");

    const text = await zip.file(kmlName).async("string");
    return parseKmlText(text);
  }

  async function parseShpFamily(files) {
    const shpFile = Array.from(files).find(function (f) { return /\.shp$/i.test(f.name); });
    const dbfFile = Array.from(files).find(function (f) { return /\.dbf$/i.test(f.name); });
    const shxFile = Array.from(files).find(function (f) { return /\.shx$/i.test(f.name); });
    const prjFile = Array.from(files).find(function (f) { return /\.prj$/i.test(f.name); });

    if (!shpFile || !dbfFile || !shxFile) {
      throw new Error("SHP requires .shp + .dbf + .shx together.");
    }

    if (!prjFile) {
      alert("Warning: .prj file is missing for this SHP.");
    }

    const zip = new JSZip();
    Array.from(files).forEach(function (f) {
      zip.file(f.name, f);
    });

    const zipped = await zip.generateAsync({ type: "arraybuffer" });
    return normalizeGeoJson(await shp(zipped));
  }

  async function filesToGeoJson(files) {
    const sourceType = sourceTextFromFiles(files);
    const list = Array.from(files || []);
    const zipFile = list.find(function (f) { return /\.zip$/i.test(f.name); });
    const kmzFile = list.find(function (f) { return /\.kmz$/i.test(f.name); });
    const kmlFile = list.find(function (f) { return /\.kml$/i.test(f.name); });

    if (kmzFile) {
      return {
        name: kmzFile.name,
        sourceType: "KMZ",
        geojson: await parseKmz(await kmzFile.arrayBuffer())
      };
    }

    if (kmlFile) {
      return {
        name: kmlFile.name,
        sourceType: "KML",
        geojson: await parseKmlText(await kmlFile.text())
      };
    }

    if (zipFile) {
      return {
        name: zipFile.name,
        sourceType: "ZIP Shapefile",
        geojson: normalizeGeoJson(await shp(await zipFile.arrayBuffer()))
      };
    }

    if (sourceType === "SHP") {
      const shpFile = list.find(function (f) { return /\.shp$/i.test(f.name); });
      return {
        name: shpFile.name,
        sourceType: "SHP",
        geojson: await parseShpFamily(list)
      };
    }

    throw new Error("Supported: KMZ, KML, ZIP Shapefile, or SHP family.");
  }

  async function handleFiles(files) {
    if (!files || !files.length) return;
    setStatus("Reading file...");

    try {
      const result = await filesToGeoJson(files);
      addItem(
        {
          title: els.datasetTitle.value.trim() || result.name.replace(/\.[^.]+$/, ""),
          owner_name: currentUser() || "Guest",
          category: els.datasetCategory.value.trim() || "General",
          notes: els.datasetNotes.value.trim() || "",
          sourceType: result.sourceType,
          uploadedAt: new Date().toISOString(),
          visible: true,
          lockOwner: "",
          lockedAt: ""
        },
        result.geojson,
        false,
        null,
        getColorBySource(result.sourceType),
        true
      );

      setStatus("Imported: " + result.name);
    } catch (err) {
      alert("Import error: " + err.message);
      setStatus("Import failed");
    }
  }

  function clearUnsaved() {
    state.items.filter(function (x) { return !x.saved; }).forEach(function (item) {
      removeLeafletLayer(item);
    });

    state.items = state.items.filter(function (x) { return x.saved; });
    state.activeId = null;
    clearAttributeTable();
    clearEditState();
    renderSidebar();
    setStatus("Unsaved layers cleared");
  }

  function setupDragDrop() {
    function stop(e) {
      e.preventDefault();
      e.stopPropagation();
    }

    ["dragenter", "dragover", "dragleave", "drop"].forEach(function (eventName) {
      els.dropZone.addEventListener(eventName, stop, false);
    });

    ["dragenter", "dragover"].forEach(function (eventName) {
      els.dropZone.addEventListener(eventName, function () {
        els.dropZone.classList.add("drag-over");
      }, false);
    });

    ["dragleave", "drop"].forEach(function (eventName) {
      els.dropZone.addEventListener(eventName, function () {
        els.dropZone.classList.remove("drag-over");
      }, false);
    });

    els.dropZone.addEventListener("drop", async function (e) {
      await handleFiles(e.dataTransfer.files);
    }, false);

    els.dropZone.addEventListener("click", function () {
      els.fileInput.click();
    }, false);
  }

  map.on(L.Draw.Event.CREATED, function (e) {
    addItem(
      {
        title: els.datasetTitle.value.trim() || "Drawn Layer",
        owner_name: currentUser() || "Guest",
        category: els.datasetCategory.value.trim() || "General",
        notes: els.datasetNotes.value.trim() || "",
        sourceType: "Draw",
        uploadedAt: new Date().toISOString(),
        visible: true,
        lockOwner: "",
        lockedAt: ""
      },
      normalizeGeoJson(e.layer.toGeoJSON()),
      false,
      null,
      getColorBySource("Draw"),
      true
    );

    enableEdit(state.activeId);
  });

  map.on(L.Draw.Event.EDITED, async function () {
    const item = state.items.find(function (x) { return x.id === state.activeId; });
    if (!item) return;

    try {
      await updateGeoJsonFromEditable(item);
      removeLeafletLayer(item);
      if (item.visible !== false) createLayer(item, item.saved ? savedGroup : unsavedGroup);
      renderSidebar();
      setStatus("Layer updated: " + item.title);
    } catch (err) {
      setStatus("Edit update failed");
    }
  });

  els.fileInput.addEventListener("change", async function (e) {
    await handleFiles(e.target.files);
    e.target.value = "";
  });

  els.saveSelectedBtn.addEventListener("click", async function () {
    const item =
      state.items.find(function (x) { return x.id === state.activeId && !x.saved; }) ||
      state.items.find(function (x) { return !x.saved; });

    if (!item) {
      alert("No unsaved layer selected.");
      return;
    }

    await saveItem(item.id);
  });

  els.refreshDbBtn.addEventListener("click", startRealtimeSync);
  els.clearUnsavedBtn.addEventListener("click", clearUnsaved);
  els.zoomAllBtn.addEventListener("click", zoomAll);

  els.searchBox.addEventListener("input", renderSidebar);
  els.visibilityFilter.addEventListener("change", renderSidebar);

  els.clearSelectionBtn.addEventListener("click", function () {
    state.activeId = null;
    clearAttributeTable();
    renderSidebar();
  });

  els.toggleSidebar.addEventListener("click", function () {
    toggleSidebarView(false);
  });

  els.sidebarReopenBtn.addEventListener("click", function () {
    toggleSidebarView(true);
  });

  els.basemapSelect.addEventListener("change", function () {
    if (els.basemapSelect.value === "satellite") {
      if (map.hasLayer(streetLayer)) map.removeLayer(streetLayer);
      if (!map.hasLayer(satelliteLayer)) satelliteLayer.addTo(map);
    } else {
      if (map.hasLayer(satelliteLayer)) map.removeLayer(satelliteLayer);
      if (!map.hasLayer(streetLayer)) streetLayer.addTo(map);
    }
  });

  setTimeout(function () {
    map.invalidateSize();
  }, 300);

  clearAttributeTable();
  setupDragDrop();
  startRealtimeSync();
})();
