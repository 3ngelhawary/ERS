// File: app.sidebar.js
window.AppSidebar = (function () {
  function safeText(value) {
    if (window.GisUI && typeof window.GisUI.escapeHtml === "function") {
      return window.GisUI.escapeHtml(value);
    }
    return String(value ?? "");
  }

  function featureCount(item) {
    if (window.GisParsers && typeof window.GisParsers.countFeatures === "function") {
      return window.GisParsers.countFeatures(item.geojson);
    }
    if (item && item.geojson && item.geojson.type === "FeatureCollection" && Array.isArray(item.geojson.features)) {
      return item.geojson.features.length;
    }
    return 0;
  }

  function render(state, els, actions) {
    const keyword = (els.searchBox && els.searchBox.value.trim().toLowerCase()) || "";
    els.layerList.innerHTML = "";

    state.items
      .filter(function (item) {
        if (!keyword) return true;
        return [item.title, item.owner_name, item.category, item.sourceType].some(function (v) {
          return (v || "").toLowerCase().includes(keyword);
        });
      })
      .sort(function (a, b) {
        return new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0);
      })
      .forEach(function (item) {
        const cnt = featureCount(item);
        const lockTxt = item.lockOwner ? "Locked: " + item.lockOwner : "Unlocked";
        const card = document.createElement("div");

        card.className = "layer-card" + (state.activeId === item.id ? " active" : "");
        card.innerHTML =
          '<div class="layer-top"><div style="flex:1">' +
          '<div class="layer-title">' + safeText(item.title) + '</div>' +
          '<div class="layer-meta">' +
          safeText(item.category) + " | " + safeText(item.owner_name) +
          "<br>Features: " + cnt +
          "<br>" + safeText(lockTxt) +
          "<br>Visible: " + (item.visible !== false ? "Yes" : "No") +
          '</div></div><div class="color-chip" style="background:' + item.color + '"></div></div>' +
          '<div class="layer-actions">' +
          '<button class="small-btn view">View</button>' +
          '<button class="small-btn toggle">' + (item.visible !== false ? "Hide" : "Show") + '</button>' +
          '<button class="small-btn edit">Edit</button>' +
          (item.saved ? '<button class="small-btn lock">' + (item.lockOwner ? "Unlock" : "Lock") + '</button>' : "") +
          (item.saved ? "" : '<button class="small-btn save">Save</button>') +
          '<button class="small-btn delete">' + (item.saved ? "Delete" : "Remove") + "</button></div>";

        const btns = card.querySelectorAll("button");
        let i = 0;
        btns[i++].onclick = function () { actions.focusItem(item.id); };
        btns[i++].onclick = function () { actions.toggleVisibility(item.id); };
        btns[i++].onclick = function () { actions.enableEdit(item.id); };
        if (item.saved) btns[i++].onclick = function () { actions.toggleLock(item.id); };
        if (!item.saved) btns[i++].onclick = function () { actions.saveItem(item.id); };
        btns[i++].onclick = function () { actions.removeItem(item.id); };

        els.layerList.appendChild(card);
      });

    els.dbCountBadge.textContent = String(
      state.items.filter(function (x) { return x.saved; }).length
    );
  }

  return {
    render: render
  };
})();
