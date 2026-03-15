// File: app.storage.js
window.AppStorage = (function () {
  let channel = null;

  function getClient() {
    if (!window.supabase) throw new Error("Supabase library not loaded.");
    if (!AppConfig.supabaseAnonKey || AppConfig.supabaseAnonKey === "PUT_YOUR_SUPABASE_ANON_KEY_HERE") {
      throw new Error("Supabase anon key is missing in app.config.js");
    }
    if (!window.__appSupabaseClient) {
      window.__appSupabaseClient = window.supabase.createClient(
        AppConfig.supabaseUrl,
        AppConfig.supabaseAnonKey
      );
    }
    return window.__appSupabaseClient;
  }

  async function saveLayerRow(client, item) {
    const payload = {
      title: item.title,
      owner_name: item.owner_name,
      category: item.category,
      notes: item.notes,
      color: item.color,
      visible: item.visible !== false,
      lock_owner: item.lockOwner || null,
      locked_at: item.lockedAt || null,
      updated_at: new Date().toISOString()
    };

    if (item.layerId) {
      const result = await client
        .from(AppConfig.layersTable)
        .update(payload)
        .eq("id", item.layerId)
        .select("id")
        .single();

      if (result.error) throw result.error;
      return result.data.id;
    }

    payload.created_at = new Date().toISOString();

    const created = await client
      .from(AppConfig.layersTable)
      .insert(payload)
      .select("id")
      .single();

    if (created.error) throw created.error;
    return created.data.id;
  }

  async function replaceFeatures(client, layerId, geojson, userName) {
    const deleteResult = await client
      .from(AppConfig.featuresTable)
      .delete()
      .eq("layer_id", layerId);

    if (deleteResult.error) throw deleteResult.error;

    const featureRows = AppHelpers.splitFeatureCollection(geojson).map(function (feature) {
      return {
        layer_id: layerId,
        geometry: feature.geometry,
        properties: feature.properties || {},
        created_by: userName,
        updated_by: userName,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    });

    if (!featureRows.length) return;

    const insertResult = await client
      .from(AppConfig.featuresTable)
      .insert(featureRows);

    if (insertResult.error) throw insertResult.error;
  }

  async function saveItem(item, userName) {
    const client = getClient();
    const layerId = await saveLayerRow(client, item);
    await replaceFeatures(client, layerId, item.geojson, userName);
    return layerId;
  }

  async function deleteItem(item) {
    if (!item || !item.saved || !item.layerId) return;
    const client = getClient();

    const result = await client
      .from(AppConfig.layersTable)
      .delete()
      .eq("id", item.layerId);

    if (result.error) throw result.error;
  }

  async function toggleVisibility(item) {
    if (!item || !item.layerId) return;
    const client = getClient();

    const result = await client
      .from(AppConfig.layersTable)
      .update({
        visible: item.visible === false ? true : false,
        updated_at: new Date().toISOString()
      })
      .eq("id", item.layerId);

    if (result.error) throw result.error;
  }

  async function toggleLock(item, userName) {
    if (!item || !item.layerId) return;
    const client = getClient();
    const nextOwner = item.lockOwner ? null : userName;

    const result = await client
      .from(AppConfig.layersTable)
      .update({
        lock_owner: nextOwner,
        locked_at: nextOwner ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      })
      .eq("id", item.layerId);

    if (result.error) throw result.error;
  }

  async function loadAll() {
    const client = getClient();

    const layersResult = await client
      .from(AppConfig.layersTable)
      .select("*")
      .order("updated_at", { ascending: false });

    if (layersResult.error) throw layersResult.error;

    const featuresResult = await client
      .from(AppConfig.featuresTable)
      .select("*");

    if (featuresResult.error) throw featuresResult.error;

    const featuresByLayer = {};
    (featuresResult.data || []).forEach(function (row) {
      if (!featuresByLayer[row.layer_id]) featuresByLayer[row.layer_id] = [];
      featuresByLayer[row.layer_id].push({
        geometry: row.geometry,
        properties: row.properties || {}
      });
    });

    return (layersResult.data || []).map(function (row) {
      return {
        layerId: row.id,
        title: row.title || "Untitled",
        owner_name: row.owner_name || "Guest",
        category: row.category || "General",
        notes: row.notes || "",
        sourceType: "Database",
        uploadedAt: row.created_at || new Date().toISOString(),
        color: row.color || "#1ea7ff",
        visible: row.visible !== false,
        lockOwner: row.lock_owner || "",
        lockedAt: row.locked_at || "",
        geojson: AppHelpers.featuresToCollection(featuresByLayer[row.id] || [])
      };
    });
  }

  function watchAll(onData, onError) {
    const client = getClient();

    if (channel) {
      client.removeChannel(channel);
      channel = null;
    }

    channel = client.channel("gis-live-sync");

    channel
      .on("postgres_changes", { event: "*", schema: "public", table: AppConfig.layersTable }, async function () {
        try {
          const rows = await loadAll();
          onData(rows);
        } catch (err) {
          if (onError) onError(err);
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: AppConfig.featuresTable }, async function () {
        try {
          const rows = await loadAll();
          onData(rows);
        } catch (err) {
          if (onError) onError(err);
        }
      })
      .subscribe(async function (status) {
        if (status === "SUBSCRIBED") {
          try {
            const rows = await loadAll();
            onData(rows);
          } catch (err) {
            if (onError) onError(err);
          }
        }
      });
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
