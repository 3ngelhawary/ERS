// File: app.helpers.js
window.AppHelpers = (function () {
  function uid() {
    return "L" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
  }

  function collectMeta(els, fileName, sourceType) {
    const fallback = fileName ? fileName.replace(/\.[^/.]+$/, "") : "Untitled Layer";
    return {
      title: (els.datasetTitle && els.datasetTitle.value.trim()) || fallback,
      owner: (els.userName && els.userName.value.trim()) || "Guest",
      category: (els.datasetCategory && els.datasetCategory.value.trim()) || "General",
      notes: (els.datasetNotes && els.datasetNotes.value.trim()) || "",
      sourceType: sourceType,
      uploadedAt: new Date().toISOString(),
      visible: true,
      lockOwner: "",
      lockedAt: ""
    };
  }

  function makeItem(meta, geojson, saved, docId, color) {
    return {
      id: uid(),
      docId: docId || null,
      saved: !!saved,
      title: meta.title,
      owner: meta.owner,
      category: meta.category,
      notes: meta.notes,
      sourceType: meta.sourceType,
      uploadedAt: meta.uploadedAt,
      visible: meta.visible !== false,
      lockOwner: meta.lockOwner || "",
      lockedAt: meta.lockedAt || "",
      color: color || GisParsers.getColorBySource(meta.sourceType),
      geojson: geojson,
      leafletLayer: null
    };
  }

  function buildPayload(item) {
    return {
      title: item.title || "",
      owner: item.owner || "",
      category: item.category || "",
      notes: item.notes || "",
      sourceType: item.sourceType || "",
      uploadedAt: item.uploadedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      color: item.color || "",
      visible: item.visible !== false,
      lockOwner: item.lockOwner || "",
      lockedAt: item.lockedAt || "",
      featureCount: GisParsers.countFeatures(item.geojson),
      geojsonText: JSON.stringify(item.geojson)
    };
  }

  function textToGeoJson(text) {
    return GisParsers.normalizeGeoJson(JSON.parse(text));
  }

  function sourceTextFromFileName(fileName) {
    const lower = (fileName || "").toLowerCase();
    if (lower.endsWith(".kmz")) return "KMZ";
    if (lower.endsWith(".kml")) return "KML";
    if (lower.endsWith(".zip")) return "ZIP Shapefile";
    if (lower.endsWith(".shp")) return "SHP";
    return "Unknown";
  }

  function isAdmin(els) {
    return (els.adminCode && els.adminCode.value.trim()) === "ADMIN123";
  }

  return {
    uid: uid,
    collectMeta: collectMeta,
    makeItem: makeItem,
    buildPayload: buildPayload,
    textToGeoJson: textToGeoJson,
    sourceTextFromFileName: sourceTextFromFileName,
    isAdmin: isAdmin
  };
})();
