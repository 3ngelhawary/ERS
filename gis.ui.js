// File: gis.ui.js
window.GisUI = (function () {
  function setStatus(els, text) {
    if (els.statusText) els.statusText.textContent = text;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildPopupContent(feature, item) {
    const props = feature && feature.properties ? feature.properties : {};
    const rows = Object.keys(props).length
      ? Object.keys(props).map(function (k) {
          return "<div><b>" + escapeHtml(k) + "</b>: " + escapeHtml(props[k]) + "</div>";
        }).join("")
      : "<div>No attributes</div>";

    return (
      '<div style="min-width:220px">' +
      '<div style="font-size:14px;font-weight:700;margin-bottom:8px">' + escapeHtml(item.title) + "</div>" +
      '<div style="font-size:11px;color:#a9c3d8;margin-bottom:8px">' +
      "Owner: " + escapeHtml(item.owner || "-") + "<br>" +
      "Category: " + escapeHtml(item.category || "-") + "<br>" +
      "Source: " + escapeHtml(item.sourceType || "-") +
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

  function createLeafletLayer(item, targetGroup, state, renderSidebar) {
    const color = item.color || "#1ea7ff";

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

  function fitToLayer(map, layer) {
    try {
      const bounds = layer.getBounds();
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    } catch (e) {}
  }

  function zoomAll(map, savedGroup, unsavedGroup) {
    const group = L.featureGroup();
    savedGroup.eachLayer(function (l) { group.addLayer(l); });
    unsavedGroup.eachLayer(function (l) { group.addLayer(l); });

    try {
      const bounds = group.getBounds();
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    } catch (e) {}
  }

  return {
    setStatus: setStatus,
    escapeHtml: escapeHtml,
    buildPopupContent: buildPopupContent,
    createLeafletLayer: createLeafletLayer,
    fitToLayer: fitToLayer,
    zoomAll: zoomAll
  };
})();
