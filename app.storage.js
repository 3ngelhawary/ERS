// File: app.storage.js
window.AppStorage = (function () {
  async function saveItem(db, item) {
    const payload = AppHelpers.buildPayload(item);

    if (payload.geojsonText.indexOf("[[") >= 0) {
      payload.geojsonText = payload.geojsonText.replace(/\u2028/g, "").replace(/\u2029/g, "");
    }

    if (item.docId) {
      await db.collection("gis_layers").doc(item.docId).set(payload, { merge: true });
      return item.docId;
    }

    const docRef = await db.collection("gis_layers").add(payload);
    return docRef.id;
  }

  async function deleteItem(db, item) {
    if (item.saved && item.docId) {
      await db.collection("gis_layers").doc(item.docId).delete();
    }
  }

  async function loadAll(db) {
    const result = [];
    const snapshot = await db.collection("gis_layers").get();

    snapshot.forEach(function (doc) {
      const d = doc.data();
      if (!d || !d.geojsonText) return;

      result.push({
        docId: doc.id,
        title: d.title || "Untitled",
        owner: d.owner || "",
        category: d.category || "",
        notes: d.notes || "",
        sourceType: d.sourceType || "database",
        uploadedAt: d.uploadedAt || new Date().toISOString(),
        color: d.color || GisParsers.getColorBySource(d.sourceType || "database"),
        geojson: AppHelpers.textToGeoJson(d.geojsonText)
      });
    });

    return result;
  }

  return {
    saveItem: saveItem,
    deleteItem: deleteItem,
    loadAll: loadAll
  };
})();
