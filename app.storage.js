// File: app.storage.js
window.AppStorage = (function () {
  let unsubscribeLayers = null;

  async function saveItem(db, item) {
    const payload = AppHelpers.buildPayload(item);
    if (item.docId) {
      await db.collection("gis_layers").doc(item.docId).set(payload, { merge: true });
      return item.docId;
    }
    const docRef = await db.collection("gis_layers").add(payload);
    return docRef.id;
  }

  async function deleteItem(db, item) {
    if (item && item.saved && item.docId) {
      await db.collection("gis_layers").doc(item.docId).delete();
    }
  }

  async function toggleVisibility(db, item) {
    if (!item.docId) return;
    await db.collection("gis_layers").doc(item.docId).set({
      visible: item.visible === false ? true : false,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  }

  async function toggleLock(db, item, userName) {
    if (!item.docId) return;
    const nextOwner = item.lockOwner ? "" : (userName || "Guest");
    await db.collection("gis_layers").doc(item.docId).set({
      lockOwner: nextOwner,
      lockedAt: nextOwner ? new Date().toISOString() : "",
      updatedAt: new Date().toISOString()
    }, { merge: true });
  }

  async function loadAll(db) {
    const rows = [];
    const snapshot = await db.collection("gis_layers").orderBy("updatedAt", "desc").get();
    snapshot.forEach(function (doc) {
      const d = doc.data();
      if (!d || !d.geojsonText) return;
      try {
        rows.push({
          docId: doc.id,
          title: d.title || "Untitled",
          owner: d.owner || "",
          category: d.category || "",
          notes: d.notes || "",
          sourceType: d.sourceType || "database",
          uploadedAt: d.uploadedAt || new Date().toISOString(),
          color: d.color || GisParsers.getColorBySource(d.sourceType || "database"),
          visible: d.visible !== false,
          lockOwner: d.lockOwner || "",
          lockedAt: d.lockedAt || "",
          geojson: AppHelpers.textToGeoJson(d.geojsonText)
        });
      } catch (e) {}
    });
    return rows;
  }

  function watchAll(db, onData, onError) {
    if (unsubscribeLayers) unsubscribeLayers();
    unsubscribeLayers = db.collection("gis_layers").orderBy("updatedAt", "desc").onSnapshot(
      async function () {
        try {
          const rows = await loadAll(db);
          onData(rows);
        } catch (e) {
          if (onError) onError(e);
        }
      },
      function (error) {
        if (onError) onError(error);
      }
    );
    return unsubscribeLayers;
  }

  return {
    saveItem: saveItem,
    deleteItem: deleteItem,
    toggleVisibility: toggleVisibility,
    toggleLock: toggleLock,
    loadAll: loadAll,
    watchAll: watchAll
  };
})();
