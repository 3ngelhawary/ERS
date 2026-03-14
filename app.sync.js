// File: app.sync.js
window.AppSync = (function () {
  function removeLeafletLayer(savedGroup, unsavedGroup, item) {
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

    const currentActiveId = state.activeId;
    const unsavedItems = state.items.filter(function (x) { return !x.saved; });

    state.items
      .filter(function (x) { return x.saved; })
      .forEach(function (item) {
        removeLeafletLayer(savedGroup, unsavedGroup, item);
      });

    const rebuiltSavedItems = rows.map(function (row) {
      const item = AppHelpers.makeItem(
        {
          title: row.title,
          owner: row.owner,
          category: row.category,
          notes: row.notes,
          sourceType: row.sourceType,
          uploadedAt: row.uploadedAt
        },
        row.geojson,
        true,
        row.docId,
        row.color
      );

      createLayer(item, savedGroup);
      return item;
    });

    state.items = unsavedItems.concat(rebuiltSavedItems);

    const activeStillExists = state.items.some(function (x) {
      return x.id === currentActiveId;
    });

    if (!activeStillExists) {
      state.activeId = null;
    }

    renderSidebar();
  }

  return {
    removeLeafletLayer: removeLeafletLayer,
    syncSavedRows: syncSavedRows
  };
})();
