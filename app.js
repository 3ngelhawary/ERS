// File: app.js
(function () {
  if (!window.supabase) {
    alert("Supabase library not loaded.");
    return;
  }

  const supabaseClient = window.supabase.createClient(
    AppConfig.supabaseUrl,
    AppConfig.supabaseAnonKey
  );

  const map = L.map("map", { preferCanvas: true }).setView([24.7136, 46.6753], 6);

  const streetLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 22,
      maxNativeZoom: 19,
      crossOrigin: true
    }
  ).addTo(map);

  const satelliteLayer = L.tileLayer(
    "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Tiles &copy; Esri",
      maxZoom: 22,
      maxNativeZoom: 19,
      crossOrigin: true
    }
  );

  streetLayer.on("tileerror", function () {
    setStatus("Street basemap tile error");
  });

  satelliteLayer.on("tileerror", function () {
    setStatus("Satellite basemap tile error");
  });

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
    activeFeatureRef: null,
    firstDbFitDone: false,
    channel: null
  };

  const els = {
    fileInput: document.getElementById("fileInput"),
    dropZone: document.getElementById("dropZone"),
    datasetTitle: document.getElementById("datasetTitle"),
    userName: document.getElementById("userName"),
    adminCode: document.getElementById("adminCode"),
    datasetCategory: document.getElementById("datasetCategory"),
    datasetGroup: document.getElementById("datasetGroup"),
    datasetNotes: document.getElementById("datasetNotes"),
    saveSelectedBtn: document.getElementById("saveSelectedBtn"),
    refreshDbBtn: document.getElementById("refreshDbBtn"),
    clearUnsavedBtn: document.getElementById("clearUnsavedBtn"),
    zoomAllBtn: document.getElementById("zoomAllBtn"),
    clearSelectionBtn: document.getElementById("clearSelectionBtn"),
    layerTree: document.getElementById("layerTree"),
    dbCountBadge: document.getElementById("dbCountBadge"),
    statusText: document.getElementById("statusText"),
    searchBox: document.getElementById("searchBox"),
    sidebar: document.getElementById("sidebar"),
    toggleSidebar: document.getElementById("toggleSidebar"),
    sidebarReopenBtn: document.getElementById("sidebarReopenBtn"),
    basemapSelect: document.getElementById("basemapSelect"),
    visibilityFilter: document.getElementById("visibilityFilter"),
    attributeSummary: document.getElementById("attributeSummary"),
    attributeTableBody: document.getElementById("attributeTableBody"),
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
    return normalizeGeoJson(geojson).features.length;
  }

  function splitFeatureCollection(geojson) {
    return normalizeGeoJson(geojson).features.filter(function (f) {
      return !!f.geometry;
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
    els.attributeTableBody.innerHTML = "";
    state.activeFeatureRef = null;
  }

  function renderAttributeTable(props) {
    const keys = Object.keys(props || {}).filter(function (k) { return k !== "_style"; });
    els.attributeSummary.textContent = keys.length ? ("Fields: " + keys.length) : "No attributes";
    els.attributeTableBody.innerHTML = keys.map(function (k) {
      return "<tr><td>" + escapeHtml(k) + "</td><td>" + escapeHtml(props[k]) + "</td></tr>";
    }).join("");
  }

  function buildItem(meta, geojson, saved, layerId, color, fillOpacity, lineWeight, styleMode) {
    return {
      id: uid(),
      layerId: layerId || null,
      saved: !!saved,
      title: meta.title || "Untitled Layer",
      owner_name: meta.owner_name || "Guest",
      category: meta.category || "General",
      group_name: meta.group_name || "General",
      notes: meta.notes || "",
      sourceType: meta.sourceType || "Unknown",
      uploadedAt: meta.uploadedAt || new Date().toISOString(),
      visible: meta.visible !== false,
      lockOwner: meta.lockOwner || "",
      lockedAt: meta.lockedAt || "",
      color: color || getColorBySource(meta.sourceType),
      fillOpacity: typeof fillOpacity === "number" ? fillOpacity : 0.25,
      lineWeight: typeof lineWeight === "number" ? lineWeight : 1.2,
      styleMode: styleMode || "layer",
      geojson: normalizeGeoJson(geojson),
      leafletLayer: null
    };
  }

  function removeLeafletLayer(item) {
    if (!item || !item.leafletLayer) return;
    savedGroup.removeLayer(item.leafletLayer);
    unsavedGroup.removeLayer(item.leafletLayer);
    item.leafletLayer = null;
  }

  function getFeatureStyle(feature, item) {
    const fs = feature && feature.properties && feature.properties._style ? feature.properties._style : null;
    if (item.styleMode === "feature" && fs) {
      return {
        color: fs.color || item.color,
        fillColor: fs.color || item.color,
        weight: typeof fs.weight === "number" ? fs.weight : item.lineWeight,
        fillOpacity: typeof fs.fillOpacity === "number" ? fs.fillOpacity : item.fillOpacity
      };
    }
    return {
      color: item.color,
      fillColor: item.color,
      weight: item.lineWeight,
      fillOpacity: item.fillOpacity
    };
  }

  function createLayer(item, targetGroup) {
    item.leafletLayer = L.geoJSON(item.geojson, {
      renderer: L.canvas({ padding: 0.5 }),
      style: function (feature) {
        return getFeatureStyle(feature, item);
      },
      pointToLayer: function (feature, latlng) {
        const style = getFeatureStyle(feature, item);
        return L.circleMarker(latlng, {
          radius: 4,
          color: style.color,
          fillColor: style.fillColor,
          fillOpacity: Math.max(style.fillOpacity, 0.35),
          weight: Math.max(style.weight, 1)
        });
      },
      onEachFeature: function (feature, lyr) {
        lyr.on("click", function () {
          state.activeId = item.id;
          state.activeFeatureRef = { itemId: item.id, feature: feature };
          renderAttributeTable(feature.properties || {});
          renderLayerTree();
        });
      }
    }).addTo(targetGroup);
  }

  function addItem(meta, geojson, saved, layerId, color, fillOpacity, lineWeight, styleMode, fitMap) {
    const item = buildItem(meta, geojson, saved, layerId, color, fillOpacity, lineWeight, styleMode);

    if (item.visible !== false) {
      createLayer(item, saved ? savedGroup : unsavedGroup);
    }

    state.items.push(item);
    state.activeId = item.id;
    renderLayerTree();

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
    const g = L.featureGroup();
    savedGroup.eachLayer(function (l) { g.addLayer(l); });
    unsavedGroup.eachLayer(function (l) { g.addLayer(l); });
    try {
      const bounds = g.getBounds();
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
    els.savedLayerCount.textContent = String(state.items.filter(function (x) { return x.saved; }).length);
    els.unsavedLayerCount.textContent = String(state.items.filter(function (x) { return !x.saved; }).length);
    els.visibleLayerCount.textContent = String(state.items.filter(function (x) { return x.visible !== false; }).length);
    els.lockedLayerCount.textContent = String(state.items.filter(function (x) { return !!x.lockOwner; }).length);
    els.dbCountBadge.textContent = String(state.items.filter(function (x) { return x.saved; }).length);
  }

  function buildStyleBoxHtml(item, currentStyle) {
    const styleColor = currentStyle && currentStyle.color ? currentStyle.color : item.color;
    const styleFillOpacity = currentStyle && typeof currentStyle.fillOpacity === "number" ? currentStyle.fillOpacity : item.fillOpacity;
    const styleWeight = currentStyle && typeof currentStyle.weight === "number" ? currentStyle.weight : item.lineWeight;

    return '' +
      '<div class="layer-style-box">' +
        '<div class="layer-style-title">Style</div>' +
        '<div class="layer-style-grid">' +
          '<label class="field-label full">' +
            '<span>Mode</span>' +
            '<select class="style-mode">' +
              '<option value="layer"' + (item.styleMode === "layer" ? " selected" : "") + '>Shared layer style</option>' +
              '<option value="feature"' + (item.styleMode === "feature" ? " selected" : "") + '>Selected feature style</option>' +
            '</select>' +
          '</label>' +
          '<label class="field-label">' +
            '<span>Color</span>' +
            '<input class="style-color" type="color" value="' + escapeHtml(styleColor) + '">' +
          '</label>' +
          '<label class="field-label">' +
            '<span>Fill Opacity</span>' +
            '<input class="style-fill" type="range" min="0" max="1" step="0.05" value="' + escapeHtml(String(styleFillOpacity)) + '">' +
          '</label>' +
          '<label class="field-label full">' +
            '<span>Line Weight</span>' +
            '<input class="style-weight" type="range" min="1" max="8" step="0.5" value="' + escapeHtml(String(styleWeight)) + '">' +
          '</label>' +
          '<button class="small-btn save full style-apply">Apply Style</button>' +
        '</div>' +
      '</div>';
  }

  function renderLayerCard(item) {
    const card = document.createElement("div");
    const count = countFeatures(item.geojson);
    const lockTxt = item.lockOwner ? ("Locked: " + item.lockOwner) : "Unlocked";
    const currentStyle =
      state.activeFeatureRef &&
      state.activeFeatureRef.itemId === item.id &&
      state.activeFeatureRef.feature &&
      state.activeFeatureRef.feature.properties &&
      state.activeFeatureRef.feature.properties._style
        ? state.activeFeatureRef.feature.properties._style
        : null;

    card.className = "layer-card" + (state.activeId === item.id ? " active" : "");
    card.innerHTML =
      '<div class="layer-top">' +
        '<div style="flex:1">' +
          '<div class="layer-title">' + escapeHtml(item.title) + '</div>' +
          '<div class="layer-meta">' +
            'Group: ' + escapeHtml(item.group_name) +
            '<br>Category: ' + escapeHtml(item.category) +
            '<br>Owner: ' + escapeHtml(item.owner_name) +
            '<br>Features: ' + count +
            '<br>' + escapeHtml(lockTxt) +
            '<br>Visible: ' + (item.visible !== false ? 'Yes' : 'No') +
            '<br>Style: ' + escapeHtml(item.styleMode) +
          '</div>' +
        '</div>' +
        '<div class="color-chip" style="background:' + item.color + '"></div>' +
      '</div>' +
      '<div class="layer-actions">' +
        '<button class="small-btn view">View</button>' +
        '<button class="small-btn toggle">' + (item.visible !== false ? 'Hide' : 'Show') + '</button>' +
        '<button class="small-btn edit">Edit</button>' +
        (item.saved ? ('<button class="small-btn lock">' + (item.lockOwner ? 'Unlock' : 'Lock') + '</button>') : '') +
        (item.saved ? '' : '<button class="small-btn save">Save</button>') +
        '<button class="small-btn delete">' + (item.saved ? 'Delete' : 'Remove') + '</button>' +
      '</div>' +
      buildStyleBoxHtml(item, currentStyle);

    const buttons = card.querySelectorAll(".layer-actions button");
    let i = 0;
    buttons[i++].onclick = function () { focusItem(item.id); };
    buttons[i++].onclick = function () { toggleVisibility(item.id); };
    buttons[i++].onclick = function () { enableEdit(item.id); };
    if (item.saved) buttons[i++].onclick = function () { toggleLock(item.id); };
    if (!item.saved) buttons[i++].onclick = function () { saveItem(item.id); };
    buttons[i++].onclick = function () { removeItem(item.id); };

    const modeEl = card.querySelector(".style-mode");
    const colorEl = card.querySelector(".style-color");
    const fillEl = card.querySelector(".style-fill");
    const weightEl = card.querySelector(".style-weight");
    const applyEl = card.querySelector(".style-apply");

    applyEl.onclick = function () {
      applyStyleToItem(item.id, {
        mode: modeEl.value,
        color: colorEl.value,
        fillOpacity: parseFloat(fillEl.value),
        weight: parseFloat(weightEl.value)
      });
    };

    return card;
  }

  function renderLayerTree() {
    const keyword = (els.searchBox.value || "").trim().toLowerCase();
    const filterMode = els.visibilityFilter.value;
    els.layerTree.innerHTML = "";

    const filtered = state.items.filter(function (item) {
      const keywordOk = !keyword || [item.title, item.owner_name, item.category, item.group_name, item.sourceType].some(function (v) {
        return (v || "").toLowerCase().includes(keyword);
      });

      const visibleOk =
        filterMode === "all" ||
        (filterMode === "visible" && item.visible !== false) ||
        (filterMode === "hidden" && item.visible === false);

      return keywordOk && visibleOk;
    });

    const groups = {};
    filtered.forEach(function (item) {
      const g = item.group_name || "General";
      if (!groups[g]) groups[g] = [];
      groups[g].push(item);
    });

    Object.keys(groups).sort().forEach(function (groupName) {
      const groupBox = document.createElement("div");
      const groupHead = document.createElement("div");
      const groupBody = document.createElement("div");

      groupBox.className = "group-box";
      groupHead.className = "group-head";
      groupBody.className = "group-body";

      groupHead.innerHTML =
        '<div class="group-title">' + escapeHtml(groupName) + '</div>' +
        '<div class="group-count">' + groups[groupName].length + ' layer(s)</div>';

      groupHead.onclick = function () {
        groupBox.classList.toggle("collapsed");
      };

      groups[groupName]
        .sort(function (a, b) { return new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0); })
        .forEach(function (item) {
          groupBody.appendChild(renderLayerCard(item));
        });

      groupBox.appendChild(groupHead);
      groupBox.appendChild(groupBody);
      els.layerTree.appendChild(groupBox);
    });

    renderStats();
  }

  function focusItem(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item || !item.leafletLayer) return;
    state.activeId = id;
    renderLayerTree();
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
    renderLayerTree();
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

  async function saveLayerRow(item) {
    const payload = {
      title: item.title,
      owner_name: item.owner_name,
      category: item.category,
      group_name: item.group_name,
      notes: item.notes,
      color: item.color,
      fill_opacity: item.fillOpacity,
      line_weight: item.lineWeight,
      style_mode: item.styleMode,
      visible: item.visible !== false,
      lock_owner: item.lockOwner || null,
      locked_at: item.lockedAt || null,
      updated_at: new Date().toISOString()
    };

    if (item.layerId) {
      const updated = await supabaseClient
        .from(AppConfig.layersTable)
        .update(payload)
        .eq("id", item.layerId)
        .select("id")
        .single();

      if (updated.error) throw updated.error;
      return updated.data.id;
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
    const removed = await supabaseClient
      .from(AppConfig.featuresTable)
      .delete()
      .eq("layer_id", layerId);

    if (removed.error) throw removed.error;

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

    const inserted = await supabaseClient
      .from(AppConfig.featuresTable)
      .insert(rows);

    if (inserted.error) throw inserted.error;
  }

  async function saveItem(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item || !requireUserName()) return;

    try {
      if (editableGroup.getLayers().length > 0) {
        await updateGeoJsonFromEditable(item);
      }

      item.owner_name = currentUser();
      item.group_name = (item.group_name || els.datasetGroup.value || "General").trim() || "General";

      let createdLayerId = null;
      let featuresSaved = false;

      try {
        createdLayerId = await saveLayerRow(item);
        item.layerId = createdLayerId;
        await replaceFeatures(item.layerId, item.geojson);
        featuresSaved = true;
      } catch (innerErr) {
        if (createdLayerId && !featuresSaved) {
          await supabaseClient.from(AppConfig.layersTable).delete().eq("id", createdLayerId);
        }
        throw innerErr;
      }

      item.saved = true;
      removeLeafletLayer(item);
      state.items = state.items.filter(function (x) { return x.id !== item.id; });
      state.activeId = null;
      clearEditState();
      renderLayerTree();
      setStatus("Saved successfully");
    } catch (err) {
      alert("Save error: " + err.message);
      setStatus("Save failed");
    }
  }

  async function removeItem(id) {
    const item = state.items.find(function (x) { return x.id === id; });
    if (!item) return;

    if (item.saved && !isAdmin()) {
      alert("Delete allowed for admin only.");
      return;
    }

    try {
      if (item.saved && item.layerId) {
        const deleted = await supabaseClient
          .from(AppConfig.layersTable)
          .delete()
          .eq("id", item.layerId);

        if (deleted.error) throw deleted.error;
      }

      removeLeafletLayer(item);
      state.items = state.items.filter(function (x) { return x.id !== id; });

      if (state.activeId === id) state.activeId = null;

      clearAttributeTable();
      clearEditState();
      renderLayerTree();
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
      renderLayerTree();
      return;
    }

    const changed = await supabaseClient
      .from(AppConfig.layersTable)
      .update({
        visible: item.visible === false ? true : false,
        updated_at: new Date().toISOString()
      })
      .eq("id", item.layerId);

    if (changed.error) alert("Visibility error: " + changed.error.message);
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

    const changed = await supabaseClient
      .from(AppConfig.layersTable)
      .update({
        lock_owner: nextOwner,
        locked_at: nextOwner ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      })
      .eq("id", item.layerId);

    if (changed.error) alert("Lock error: " + changed.error.message);
  }

  async function applyStyleToItem(itemId, styleValues) {
    const item = state.items.find(function (x) { return x.id === itemId; });
    if (!item) return;

    if (item.saved && !canEdit(item)) {
      alert("Layer locked by: " + item.lockOwner);
      return;
    }

    if (styleValues.mode === "layer") {
      item.styleMode = "layer";
      item.color = styleValues.color;
      item.fillOpacity = styleValues.fillOpacity;
      item.lineWeight = styleValues.weight;
    } else {
      item.styleMode = "feature";
      if (!state.activeFeatureRef || state.activeFeatureRef.itemId !== item.id) {
        alert("Select a feature from this layer first.");
        return;
      }
      state.activeFeatureRef.feature.properties = state.activeFeatureRef.feature.properties || {};
      state.activeFeatureRef.feature.properties._style = {
        color: styleValues.color,
        fillOpacity: styleValues.fillOpacity,
        weight: styleValues.weight
      };
    }

    removeLeafletLayer(item);
    if (item.visible !== false) createLayer(item, item.saved ? savedGroup : unsavedGroup);
    renderLayerTree();

    if (item.saved) {
      try {
        await saveLayerRow(item);
        await replaceFeatures(item.layerId, item.geojson);
        setStatus("Shared style updated");
      } catch (err) {
        alert("Style save error: " + err.message);
        setStatus("Style update failed");
      }
    } else {
      setStatus("Unsaved layer style updated");
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

    return (layersResult.data || [])
      .filter(function (row) {
        return (byLayer[row.id] || []).length > 0;
      })
      .map(function (row) {
        return {
          layerId: row.id,
          title: row.title || "Untitled",
          owner_name: row.owner_name || "Guest",
          category: row.category || "General",
          group_name: row.group_name || "General",
          notes: row.notes || "",
          sourceType: "Database",
          uploadedAt: row.created_at || new Date().toISOString(),
          color: row.color || "#1f9bff",
          fillOpacity: typeof row.fill_opacity === "number" ? row.fill_opacity : 0.25,
          lineWeight: typeof row.line_weight === "number" ? row.line_weight : 1.2,
          styleMode: row.style_mode || "layer",
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
          group_name: row.group_name,
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
        row.color,
        row.fillOpacity,
        row.lineWeight,
        row.styleMode
      );

      if (item.visible !== false) createLayer(item, savedGroup);
      return item;
    });

    state.items = unsavedItems.concat(rebuilt);
    renderLayerTree();
  }

  async function startRealtimeSync() {
    try {
      setStatus("Connecting database...");

      if (state.channel) {
        supabaseClient.removeChannel(state.channel);
        state.channel = null;
      }

      async function reloadShared() {
        const rows = await loadAllRows();
        syncSavedRows(rows);
        if (!state.firstDbFitDone) {
          zoomAll();
          state.firstDbFitDone = true;
        }
        setStatus("Database synced");
      }

      state.channel = supabaseClient.channel("gis-live-sync");
      state.channel
        .on("postgres_changes", { event: "*", schema: "public", table: AppConfig.layersTable }, reloadShared)
        .on("postgres_changes", { event: "*", schema: "public", table: AppConfig.featuresTable }, reloadShared)
        .subscribe(async function (status) {
          if (status === "SUBSCRIBED") await reloadShared();
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

    if (!prjFile) alert("Warning: .prj file is missing for this SHP.");

    const zip = new JSZip();
    Array.from(files).forEach(function (f) { zip.file(f.name, f); });
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
      return { name: kmzFile.name, sourceType: "KMZ", geojson: await parseKmz(await kmzFile.arrayBuffer()) };
    }
    if (kmlFile) {
      return { name: kmlFile.name, sourceType: "KML", geojson: await parseKmlText(await kmlFile.text()) };
    }
    if (zipFile) {
      return { name: zipFile.name, sourceType: "ZIP Shapefile", geojson: normalizeGeoJson(await shp(await zipFile.arrayBuffer())) };
    }
    if (sourceType === "SHP") {
      const shpFile = list.find(function (f) { return /\.shp$/i.test(f.name); });
      return { name: shpFile.name, sourceType: "SHP", geojson: await parseShpFamily(list) };
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
          group_name: (els.datasetGroup.value || "General").trim() || "General",
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
        0.25,
        1.2,
        "layer",
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
    renderLayerTree();
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
        group_name: (els.datasetGroup.value || "General").trim() || "General",
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
      0.25,
      1.2,
      "layer",
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
      renderLayerTree();
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
  els.searchBox.addEventListener("input", renderLayerTree);
  els.visibilityFilter.addEventListener("change", renderLayerTree);

  els.clearSelectionBtn.addEventListener("click", function () {
    state.activeId = null;
    clearAttributeTable();
    renderLayerTree();
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
