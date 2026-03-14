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

  function watchAll(db, onData, onError) {
    if (unsubscribeLayers) {
      unsubscribeLayers();
      unsubscribeLayers = null;
    }

    unsubscribeLayers = db
      .collection("gis_layers")
      .orderBy("updatedAt", "desc")
      .onSnapshot(
        function (snapshot) {
          const rows = [];

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
                geojson: AppHelpers.textToGeoJson(d.geojsonText)
              });
            } catch (e) {
            }
          });

          onData(rows);
        },
        function (error) {
          if (onError) onError(error);
        }
      );

    return unsubscribeLayers;
  }

  function stopWatch() {
    if (unsubscribeLayers) {
      unsubscribeLayers();
      unsubscribeLayers = null;
    }
  }

  return {
    saveItem: saveItem,
    deleteItem: deleteItem,
    watchAll: watchAll,
    stopWatch: stopWatch
  };
})();
