// File: app.sync.js
window.AppSync = (function () {
  function removeLayer(savedGroup, unsavedGroup, item) {
    if (!item || !item.leafletLayer) return;
    savedGroup.removeLayer(item.leafletLayer);
    unsavedGroup.removeLayer(item.leafletLayer);
    item.leafletLayer = null;
  }

  function syncSavedRows(args) {
    const state = args.state;
    const rows = args.rows;
    const savedGroup = args.savedGroup;
    const unsavedGroup = args.unsavedGroup;
    const createLayer = args.createLayer;
    const renderSidebar = args.renderSidebar;

    const unsavedItems = state.items.filter(function (x) { return !x.saved; });

    state.items.filter(function (x) { return x.saved; }).forEach(function (item) {
      removeLayer(savedGroup, unsavedGroup, item);
    });

    const rebuilt = rows.map(function (row) {
      const item = AppHelpers.makeItem(
        {
          title: row.title,
          owner: row.owner,
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
        row.docId,
        row.color
      );
      if (item.visible !== false) createLayer(item, savedGroup);
      return item;
    });

    state.items = unsavedItems.concat(rebuilt);
    renderSidebar();
  }

  return {
    removeLayer: removeLayer,
    syncSavedRows: syncSavedRows
  };
})();
