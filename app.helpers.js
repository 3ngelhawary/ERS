// File: app.helpers.js
window.AppHelpers = (function () {
  function uid() {
    return "L" + Date.now() + "_" + Math.random().toString(36).substring(2, 10);
  }

  function collectMeta(els, fileName, sourceType) {
    const fallback = fileName ? fileName.replace(/\.[^/.]+$/, "") : "Untitled Layer";
    return {
      title: (els.datasetTitle && els.datasetTitle.value.trim()) || fallback,
      owner_name: (els.userName && els.userName.value.trim()) || "Guest",
      category: (els.datasetCategory && els.datasetCategory.value.trim()) || "General",
      notes: (els.datasetNotes && els.datasetNotes.value.trim()) || "",
      sourceType: sourceType,
      uploadedAt: new Date().toISOString(),
      visible: true,
      lockOwner: "",
      lockedAt: ""
    };
  }

  function makeItem(meta, geojson, saved, layerId, color) {
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
      color: color || GisParsers.getColorBySource(meta.sourceType || "Unknown"),
      geojson: geojson,
      leafletLayer: null
    };
  }

  function sourceTextFromFileName(fileName) {
    const lower = (fileName || "").toLowerCase();
    if (lower.endsWith(".kmz")) return "KMZ";
    if (lower.endsWith(".kml")) return "KML";
    if (lower.endsWith(".zip")) return "ZIP Shapefile";
    if (lower.endsWith(".shp")) return "SHP";
    return "Unknown";
  }

  function splitFeatureCollection(geojson) {
    const normalized = GisParsers.normalizeGeoJson(geojson);
    return normalized.features.map(function (feature) {
      return {
        type: "Feature",
        properties: feature.properties || {},
        geometry: feature.geometry || null
      };
    }).filter(function (feature) {
      return feature.geometry !== null;
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
      }).filter(function (f) {
        return f.geometry !== null;
      })
    };
  }

  function isAdmin(els) {
    return (els.adminCode && els.adminCode.value.trim()) === AppConfig.adminCode;
  }

  function currentUser(els) {
    return (els.userName && els.userName.value.trim()) || "Guest";
  }

  return {
    uid: uid,
    collectMeta: collectMeta,
    makeItem: makeItem,
    sourceTextFromFileName: sourceTextFromFileName,
    splitFeatureCollection: splitFeatureCollection,
    featuresToCollection: featuresToCollection,
    isAdmin: isAdmin,
    currentUser: currentUser
  };
})();
