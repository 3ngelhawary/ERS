// File: gis.parsers.js
window.GisParsers = (function () {
  function normalizeGeoJson(geojson) {
    if (!geojson) throw new Error("Empty GIS data.");

    if (geojson.type === "FeatureCollection") return geojson;

    if (geojson.type === "Feature") {
      return { type: "FeatureCollection", features: [geojson] };
    }

    if (Array.isArray(geojson)) {
      return { type: "FeatureCollection", features: geojson };
    }

    throw new Error("Unsupported GeoJSON structure.");
  }

  function getToGeoJsonLib() {
    if (window.toGeoJSON) return window.toGeoJSON;
    if (window.togeojson) return window.togeojson;
    throw new Error("toGeoJSON library not loaded.");
  }

  async function parseKmlText(kmlText) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(kmlText, "text/xml");
    const parseErrors = xml.getElementsByTagName("parsererror");

    if (parseErrors && parseErrors.length > 0) {
      throw new Error("KML parse error.");
    }

    const lib = getToGeoJsonLib();
    return normalizeGeoJson(lib.kml(xml));
  }

  async function parseKmz(arrayBuffer) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const names = Object.keys(zip.files);

    const kmlName = names.find(function (n) {
      return n.toLowerCase().endsWith(".kml");
    });

    if (!kmlName) {
      throw new Error("No KML file found inside KMZ.");
    }

    const kmlText = await zip.file(kmlName).async("string");
    return parseKmlText(kmlText);
  }

  async function parseShpZip(arrayBuffer) {
    const geojson = await shp(arrayBuffer);
    return normalizeGeoJson(geojson);
  }

  function countFeatures(geojson) {
    if (!geojson) return 0;
    if (geojson.type === "FeatureCollection" && Array.isArray(geojson.features)) {
      return geojson.features.length;
    }
    if (geojson.type === "Feature") return 1;
    return 0;
  }

  function getColorBySource(sourceType) {
    const s = (sourceType || "").toLowerCase();
    if (s.includes("kmz") || s.includes("kml")) return "#ff7a18";
    if (s.includes("zip") || s.includes("shp")) return "#1ea7ff";
    if (s.includes("draw")) return "#18c37e";
    return "#b87cff";
  }

  return {
    normalizeGeoJson: normalizeGeoJson,
    parseKmlText: parseKmlText,
    parseKmz: parseKmz,
    parseShpZip: parseShpZip,
    countFeatures: countFeatures,
    getColorBySource: getColorBySource
  };
})();
