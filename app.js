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
    {
      attribution: "Tiles &copy; Esri"
    }
  );

  const baseMaps = {
    Street: osm,
    Satellite: imagery
  };

  const savedGroup = L.featureGroup().addTo(map);
  const unsavedGroup = L.featureGroup().addTo(map);
  const editableGroup = new L.FeatureGroup().addTo(map);

  L.control.layers(
    baseMaps,
    {
      "Saved Database": savedGroup,
      "Unsaved Imports": unsavedGroup
    },
    { collapsed: false }
  ).addTo(map);

  const drawControl = new L.Control.Draw({
    edit: {
      featureGroup: editableGroup,
      remove: false
    },
    draw: {
      rectangle: true,
      polygon: true,
      polyline: false,
      circle: false,
      circlemarker: false,
      marker: false
    }
  });
  map.addControl(drawControl);

  const state = {
    items: [],
    activeId: null
  };

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
    if (els.statusText) {
      els.statusText.textContent = text;
    }
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
    return "L" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
  }

  function countFeatures(geojson) {
    if (!geojson) return 0;
    if (geojson.type === "FeatureCollection" && Array.isArray(geojson.features)) {
      return geojson.features.length;
    }
    if (geojson.type === "Feature") {
      return 1;
    }
    return 0;
  }

  function buildPopupContent(feature, item) {
    const props = feature && feature.properties ? feature.properties : {};
    const rows = Object.keys(props).length
      ? Object.keys(props)
          .map(function (k) {
            return "<div><b>" + escapeHtml(k) + "</b>: " + escapeHtml(props[k]) + "</div>";
          })
          .join("")
      : "<div>No attributes</div>";

    return (
      '<div style="min-width:220px">' +
      '<div style="font-size:14px;font-weight:700;margin-bottom:8px">' +
      escapeHtml(item.title) +
      "</div>" +
      '<div style="font-size:11px;color:#a9c3d8;margin-bottom:8px">' +
      "Owner: " +
      escapeHtml(item.owner || "-") +
      "<br>" +
      "Category: " +
      escapeHtml(item.category || "-") +
      "<br>" +
      "Source: " +
      escapeHtml(item.sourceType || "-") +
      "</div>" +
      rows +
      "</div>"
    );
  }

  function defaultStyle(color) {
    return {
      color: color,
      weight: 2,
      fillColor: color,
      fillOpacity: 0.28
    };
  }

  function getColorBySource(sourceType) {
    const s = (sourceType || "").toLowerCase();
    if (s.includes("kmz") || s.includes("kml")) return "#ff7a18";
    if (s.includes("zip") || s.includes("shp")) return "#1ea7ff";
    if (s.includes("draw")) return "#18c37e";
    return "#b87cff";
  }

  function normalizeGeoJson(geojson) {
    if (!geojson) {
      throw new Error("Empty GIS data.");
    }

    if (geojson.type === "FeatureCollection") {
      return geojson;
    }

    if (geojson.type === "Feature") {
      return {
        type: "FeatureCollection",
        features: [geojson]
      };
    }

    if (Array.isArray(geojson)) {
      return {
        type: "FeatureCollection",
        features: geojson
      };
    }

    throw new Error("Unsupported GeoJSON structure.");
  }

  function createLeafletLayer(item, targetGroup) {
    const color = item.color || getColorBySource(item.sourceType);

    const layer = L.geoJSON(item.geojson, {
      style: function () {
        return defaultStyle(color);
      },
      pointToLayer: function (feature, latlng) {
        return L.circleMarker(latlng, {
          radius: 6,
          color: color,
          fillColor: color,
          fillOpacity: 0.9,
          weight: 1
        });
      },
      onEachFeature: function (feature, lyr) {
        lyr.bindPopup(buildPopupContent(feature, item));
        lyr.on("click", function () {
          state.activeId = item.id;
          renderSidebar();
        });
      }
    });

    layer.addTo(targetGroup);
    item.leafletLayer = layer;
    return layer;
  }

  function collectMetaFromForm(fileName, sourceType) {
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

  async function parseKmlText(kmlText) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(kmlText, "text/xml");
    const parseErrors = xml.getElementsByTagName("parsererror");

    if (parseErrors && parseErrors.length > 0) {
      throw new Error("KML parse error.");
    }

    return normalizeGeoJson(togeojson.kml(xml));
  }

  async function parseKmz(arrayBuffer) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const names = Object.keys(zip.files);

    const kmlName = names.find(function (n) {
      return n.toLowerCase().endsWith(".kml");
    });

    if (!kmlName) {
      throw new Error("No KML file found inside KMZ.");
    }

    const kmlText = await zip.file(kmlName).async("string");
    return await parseKmlText(kmlText);
  }

  async function parseShpZip(arrayBuffer) {
    const geojson = await shp(arrayBuffer);
    return normalizeGeoJson(geojson);
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

  function renderSidebar() {
    if (!els.layerList) return;

    const keyword = els.searchBox ? els.searchBox.value.trim().toLowerCase() : "";
    els.layerList.innerHTML = "";

    const visibleItems = state.items.filter(function (item) {
      if (!keyword) return true;

      return (
        (item.title || "").toLowerCase().includes(keyword) ||
        (item.owner || "").toLowerCase().includes(keyword) ||
        (item.category || "").toLowerCase().includes(keyword) ||
        (item.sourceType || "").toLowerCase().includes(keyword)
      );
    });

    visibleItems
      .sort(function (a, b) {
        const aTime = new Date(a.uploadedAt || 0).getTime();
        const bTime = new Date(b.uploadedAt || 0).getTime();
        return bTime - aTime;
      })
      .forEach(function (item) {
        const card = document.createElement("div");
        card.className = "layer-card" + (state.activeId === item.id ? " active" : "");

        const dbLabel = item.saved ? "Saved" : "Unsaved";
        const featureCount = countFeatures(item.geojson);

        card.innerHTML =
          '<div class="layer-top">' +
          '<div style="flex:1">' +
          '<div class="layer-title">' +
          escapeHtml(item.title) +
          "</div>" +
          '<div class="layer-meta">' +
          escapeHtml(dbLabel) +
          " | " +
          escapeHtml(item.sourceType || "-") +
          "<br>" +
          "Features: " +
          featureCount +
          "<br>" +
          "Owner: " +
          escapeHtml(item.owner || "-") +
          "<br>" +
          "Category: " +
          escapeHtml(item.category || "-") +
          "</div>" +
          "</div>" +
          '<div class="color-chip" style="background:' +
          escapeHtml(item.color || "#1ea7ff") +
          '"></div>' +
          "</div>" +
          '<div class="layer-actions">' +
          '<button class="small-btn view">View</button>' +
          '<button class="small-btn edit">Edit</button>' +
          (item.saved ? "" : '<button class="small-btn save">Save</button>') +
          '<button class="small-btn delete">' +
          (item.saved ? "Delete DB" : "Remove") +
          "</button>" +
          "</div>";

        const buttons = card.querySelectorAll("button");
        const viewBtn = buttons[0];
        const editBtn = buttons[1];
        const saveBtn = item.saved ? null : buttons[2];
        const deleteBtn = item.saved ? buttons[2] : buttons[3];

        viewBtn.addEventListener("click", function () {
          focusItem(item.id);
        });

        editBtn.addEventListener("click", function () {
          enableEdit(item.id);
        });

        if (saveBtn) {
          saveBtn.addEventListener("click", function () {
            saveItemToDatabase(item.id);
          });
        }

        deleteBtn.addEventListener("click", function () {
          removeItem(item.id);
        });

        els.layerList.appendChild(card);
      });

    if (els.dbCountBadge) {
      els.dbCountBadge.textContent = String(
        state.items.filter(function (x) {
          return x.saved;
        }).length
      );
    }
  }

  function focusItem(id) {
    const item = state.items.find(function (x) {
      return x.id === id;
    });

    if (!item || !item.leafletLayer) return;

    state.activeId = id;
    renderSidebar();
    fitToLayer(item.leafletLayer);
  }

  function clearEditState() {
    editableGroup.clearLayers();
  }

  function enableEdit(id) {
    const item = state.items.find(function (x) {
      return x.id === id;
    });

    if (!item || !item.leafletLayer) return;

    clearEditState();
    state.activeId = id;

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
      if (typeof layer.toGeoJSON === "function") {
        const gj = layer.toGeoJSON();

        if (gj.type === "FeatureCollection" && Array.isArray(gj.features)) {
          gj.features.forEach(function (f) {
            features.push(f);
          });
        } else if (gj.type === "Feature") {
          features.push(gj);
        }
      }
    });

    if (features.length > 0) {
      item.geojson = {
        type: "FeatureCollection",
        features: features
      };
    }
  }

  async function importGeoJsonToApp(fileName, sourceType, geojson) {
    const meta = collectMetaFromForm(fileName, sourceType);

    const item = {
      id: uid(),
      saved: false,
      docId: null,
      title: meta.title,
      owner: meta.owner,
      category: meta.category,
      notes: meta.notes,
      sourceType: meta.sourceType,
      uploadedAt: meta.uploadedAt,
      color: getColorBySource(sourceType),
      geojson: geojson,
      leafletLayer: null
    };

    createLeafletLayer(item, unsavedGroup);
    state.items.push(item);
    state.activeId = item.id;

    renderSidebar();
    fitToLayer(item.leafletLayer);
    setStatus("Imported: " + item.title);
  }

  async function saveItemToDatabase(id) {
    const item = state.items.find(function (x) {
      return x.id === id;
    });

    if (!item) return;

    try {
      if (state.activeId === item.id && editableGroup.getLayers().length > 0) {
        await updateGeoJsonFromEditable(item);

        if (item.leafletLayer) {
          unsavedGroup.removeLayer(item.leafletLayer);
          savedGroup.removeLayer(item.leafletLayer);
        }

        createLeafletLayer(item, item.saved ? savedGroup : unsavedGroup);
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

      if (item.docId) {
        await db.collection("gis_layers").doc(item.docId).set(payload, { merge: true });
      } else {
        const docRef = await db.collection("gis_layers").add(payload);
        item.docId = docRef.id;
      }

      item.saved = true;

      if (item.leafletLayer) {
        unsavedGroup.removeLayer(item.leafletLayer);
        savedGroup.removeLayer(item.leafletLayer);
      }

      createLeafletLayer(item, savedGroup);
      clearEditState();
      renderSidebar();
      setStatus("Saved to database: " + item.title);
    } catch (err) {
      console.error(err);
      alert("Save error: " + err.message);
      setStatus("Save failed");
    }
  }

  async function removeItem(id) {
    const item = state.items.find(function (x) {
      return x.id === id;
    });

    if (!item) return;

    try {
      if (item.saved && item.docId) {
        await db.collection("gis_layers").doc(item.docId).delete();
      }

      if (item.leafletLayer) {
        savedGroup.removeLayer(item.leafletLayer);
        unsavedGroup.removeLayer(item.leafletLayer);
      }

      state.items = state.items.filter(function (x) {
        return x.id !== id;
      });

      if (state.activeId === id) {
        state.activeId = null;
        clearEditState();
      }

      renderSidebar();
      setStatus("Removed: " + item.title);
    } catch (err) {
      console.error(err);
      alert("Delete error: " + err.message);
      setStatus("Delete failed");
    }
  }

  async function loadDatabaseLayers() {
    try {
      setStatus("Loading database layers...");
      savedGroup.clearLayers();

      const snapshot = await db.collection("gis_layers").get();
      const savedDocs = [];

      snapshot.forEach(function (doc) {
        savedDocs.push({
          docId: doc.id,
          data: doc.data()
        });
      });

      const unsavedItems = state.items.filter(function (x) {
        return !x.saved;
      });

      state.items = unsavedItems;

      savedDocs.forEach(function (entry) {
        const data = entry.data;

        if (!data.geojson) return;

        const item = {
          id: uid(),
          saved: true,
          docId: entry.docId,
          title: data.title || "Untitled",
          owner: data.owner || "",
          category: data.category || "",
          notes: data.notes || "",
          sourceType: data.sourceType || "database",
          uploadedAt: data.uploadedAt || "",
          color: data.color || getColorBySource(data.sourceType || "database"),
          geojson: normalizeGeoJson(data.geojson),
          leafletLayer: null
        };

        createLeafletLayer(item, savedGroup);
        state.items.push(item);
      });

      renderSidebar();

      const group = L.featureGroup();
      savedGroup.eachLayer(function (layer) {
        group.addLayer(layer);
      });

      try {
        const bounds = group.getBounds();
        if (bounds && bounds.isValid()) {
          map.fitBounds(bounds, { padding: [40, 40] });
        }
      } catch (e) {
      }

      setStatus("Database loaded");
    } catch (err) {
      console.error(err);
      alert("Database load error: " + err.message);
      setStatus("Database load failed");
    }
  }

  async function handleFileUpload(file) {
    if (!file) return;

    setStatus("Reading file: " + file.name);

    try {
      const fileName = file.name || "Imported File";
      const lower = fileName.toLowerCase();

      if (lower.endsWith(".kmz")) {
        const buffer = await file.arrayBuffer();
        const geojson = await parseKmz(buffer);
        await importGeoJsonToApp(fileName, "KMZ", geojson);
        return;
      }

      if (lower.endsWith(".kml")) {
        const text = await file.text();
        const geojson = await parseKmlText(text);
        await importGeoJsonToApp(fileName, "KML", geojson);
        return;
      }

      if (lower.endsWith(".zip") || lower.endsWith(".shp")) {
        const buffer = await file.arrayBuffer();
        const geojson = await parseShpZip(buffer);
        await importGeoJsonToApp(
          fileName,
          lower.endsWith(".zip") ? "ZIP Shapefile" : "SHP",
          geojson
        );
        return;
      }

      alert("Supported files: KMZ, KML, ZIP Shapefile, SHP");
      setStatus("Unsupported file type");
    } catch (err) {
      console.error(err);
      alert("Import error: " + err.message);
      setStatus("Import failed");
    }
  }

  function zoomAll() {
    const group = L.featureGroup();

    savedGroup.eachLayer(function (l) {
      group.addLayer(l);
    });

    unsavedGroup.eachLayer(function (l) {
      group.addLayer(l);
    });

    try {
      const bounds = group.getBounds();
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    } catch (e) {
    }
  }

  function clearUnsaved() {
    const unsavedItems = state.items.filter(function (x) {
      return !x.saved;
    });

    unsavedItems.forEach(function (item) {
      if (item.leafletLayer) {
        unsavedGroup.removeLayer(item.leafletLayer);
      }
    });

    state.items = state.items.filter(function (x) {
      return x.saved;
    });

    state.activeId = null;
    clearEditState();
    renderSidebar();
    setStatus("Unsaved layers cleared");
  }

  map.on(L.Draw.Event.CREATED, async function (e) {
    const layer = e.layer;

    editableGroup.clearLayers();
    editableGroup.addLayer(layer);

    if (layer.editing && typeof layer.editing.enable === "function") {
      layer.editing.enable();
    }

    const geojson = normalizeGeoJson(layer.toGeoJSON());

    await importGeoJsonToApp("Drawn Layer", "Draw", geojson);

    editableGroup.clearLayers();

    const current = state.items.find(function (x) {
      return x.id === state.activeId;
    });

    if (current && current.leafletLayer) {
      current.leafletLayer.eachLayer(function (l) {
        editableGroup.addLayer(l);
        if (l.editing && typeof l.editing.enable === "function") {
          l.editing.enable();
        }
      });
    }
  });

  map.on(L.Draw.Event.EDITED, async function () {
    const item = state.items.find(function (x) {
      return x.id === state.activeId;
    });

    if (!item) return;

    try {
      await updateGeoJsonFromEditable(item);

      if (item.leafletLayer) {
        savedGroup.removeLayer(item.leafletLayer);
        unsavedGroup.removeLayer(item.leafletLayer);
      }

      createLeafletLayer(item, item.saved ? savedGroup : unsavedGroup);

      if (item.saved) {
        await saveItemToDatabase(item.id);
      } else {
        renderSidebar();
        setStatus("Layer updated: " + item.title);
      }
    } catch (err) {
      console.error(err);
      setStatus("Edit update failed");
    }
  });

  if (els.fileInput) {
    els.fileInput.addEventListener("change", async function (e) {
      const file = e.target.files[0];
      await handleFileUpload(file);
      e.target.value = "";
    });
  }

  if (els.saveSelectedBtn) {
    els.saveSelectedBtn.addEventListener("click", async function () {
      const item =
        state.items.find(function (x) {
          return x.id === state.activeId && !x.saved;
        }) ||
        state.items.find(function (x) {
          return !x.saved;
        });

      if (!item) {
        alert("No unsaved layer selected.");
        return;
      }

      await saveItemToDatabase(item.id);
    });
  }

  if (els.refreshDbBtn) {
    els.refreshDbBtn.addEventListener("click", async function () {
      await loadDatabaseLayers();
    });
  }

  if (els.clearUnsavedBtn) {
    els.clearUnsavedBtn.addEventListener("click", function () {
      clearUnsaved();
    });
  }

  if (els.zoomAllBtn) {
    els.zoomAllBtn.addEventListener("click", function () {
      zoomAll();
    });
  }

  if (els.searchBox) {
    els.searchBox.addEventListener("input", function () {
      renderSidebar();
    });
  }

  if (els.toggleSidebar) {
    els.toggleSidebar.addEventListener("click", function () {
      els.sidebar.classList.toggle("collapsed");
      setTimeout(function () {
        map.invalidateSize();
      }, 260);
    });
  }

  loadDatabaseLayers();
})();
