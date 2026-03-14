// File: app.panel.js
window.AppPanel = (function () {
  function clear(panel) {
    panel.innerHTML = "<div class='layer-meta'>No feature selected</div>";
  }

  function render(panel, props) {
    const keys = Object.keys(props || {});
    if (!keys.length) {
      panel.innerHTML = "<div class='layer-meta'>No attributes</div>";
      return;
    }

    panel.innerHTML = keys.map(function (k) {
      return (
        "<div class='attr-row'>" +
        "<div class='attr-key'>" + GisUI.escapeHtml(k) + "</div>" +
        "<div>" + GisUI.escapeHtml(props[k]) + "</div>" +
        "</div>"
      );
    }).join("");
  }

  return {
    clear: clear,
    render: render
  };
})();
