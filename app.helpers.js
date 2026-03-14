// File: app.helpers.js
window.AppHelpers = (function () {
  function uid() {
    return "L" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
  }

  function collectMeta(els, fileName, sourceType) {
    const fallback = fileName ? fileName.replace(/\.[^/.]+$/, "") : "Untitled Layer";
    return {
      title: (els.datasetTitle && els.datasetTitle.value.trim()) || fallback,
      owner: (els.datasetOwner && els.datasetOwner.value.trim()) || "",
      category: (els.datasetCategory && els.datasetCategory.value.trim()) || "",
      notes: (els.datasetNotes && els.datasetNotes.value.trim()) || "",
      sourceType: sourceType,
      uploadedAt: new Date().toISOString()
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
      color: color || GisParsers.getColorBySource(meta.sourceType),
      geojson: geojson,
      leafletLayer: null
    };
  }

  function geoJsonToText(geojson) {
    return JSON.stringify(geojson);
  }

  function textToGeoJson(text) {
    return GisParsers.normalizeGeoJson(JSON.parse(text));
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
      featureCount: GisParsers.countFeatures(item.geojson),
      geojsonText: geoJsonToText(item.geojson)
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

  return {
    uid: uid,
    collectMeta: collectMeta,
    makeItem: makeItem,
    geoJsonToText: geoJsonToText,
    textToGeoJson: textToGeoJson,
    buildPayload: buildPayload,
    sourceTextFromFileName: sourceTextFromFileName
  };
})();
