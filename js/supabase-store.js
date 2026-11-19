/*
 * Supabase adapter for the cheetahs-club project. Plain fetch (XHR if fetch
 * is missing). No supabase-js. Renderers poll; a Realtime socket is optional
 * and never required for a switch to land.
 *
 * Reads use the publishable key (anon). Writes use the club admin's access
 * token from email/password sign-in. The migration is not applied by this repo.
 */
(function (global) {
  var SESSION_KEY = "pulseplay.supabaseSession";
  var BUCKET = "pulseplay-assets";

  function createSupabaseStore(runtime) {
    var base = String(runtime.supabaseUrl || "").replace(/\/$/, "");
    var key = runtime.supabaseKey;
    var pollMs = runtime.pollMs || 2000;

    function request(path, options, callback) {
      var opts = options || {};
      var headers = opts.headers || {};
      var url = path.indexOf("http") === 0 ? path : base + path;
      var body = opts.body;
      var token = opts.token || key;
      headers.apikey = key;
      if (!headers.Authorization) headers.Authorization = "Bearer " + token;
      if (global.fetch) {
        global.fetch(url, {
          method: opts.method || "GET",
          headers: headers,
          body: body
        }).then(function (response) {
          response.text().then(function (text) {
            var parsed = null;
            if (text) {
              try { parsed = JSON.parse(text); } catch (e) { parsed = text; }
            }
            if (!response.ok) {
              callback(new Error(errorText(parsed, response.status)));
              return;
            }
            callback(null, parsed);
          });
        }).catch(function (err) {
          callback(err);
        });
        return;
      }
      var xhr = new XMLHttpRequest();
      xhr.open(opts.method || "GET", url, true);
      var name;
      for (name in headers) {
        if (headers.hasOwnProperty(name)) xhr.setRequestHeader(name, headers[name]);
      }
      xhr.onreadystatechange = function () {
        var parsed;
        if (xhr.readyState !== 4) return;
        parsed = null;
        if (xhr.responseText) {
          try { parsed = JSON.parse(xhr.responseText); } catch (e2) { parsed = xhr.responseText; }
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          callback(new Error(errorText(parsed, xhr.status)));
          return;
        }
        callback(null, parsed);
      };
      xhr.send(body || null);
    }

    function errorText(parsed, status) {
      if (parsed && parsed.message) return parsed.message;
      if (parsed && parsed.error_description) return parsed.error_description;
      if (parsed && parsed.msg) return parsed.msg;
      return "Supabase request failed (" + status + ").";
    }

    function rest(path, method, token, body, prefer, callback) {
      var headers = { Accept: "application/json" };
      if (prefer) headers.Prefer = prefer;
      if (body !== undefined && body !== null) headers["Content-Type"] = "application/json";
      request("/rest/v1/" + path, {
        method: method,
        token: token,
        headers: headers,
        body: body === undefined || body === null ? null : JSON.stringify(body)
      }, callback);
    }

    function readSession() {
      var raw;
      try { raw = global.localStorage.getItem(SESSION_KEY); }
      catch (e) { return null; }
      if (!raw) return null;
      try { return JSON.parse(raw); }
      catch (e2) { return null; }
    }

    function writeSession(session) {
      try {
        if (!session) global.localStorage.removeItem(SESSION_KEY);
        else global.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } catch (e) {}
    }

    function sessionFromAuth(data) {
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: new Date().getTime() + ((data.expires_in || 3600) * 1000),
        email: data.user && data.user.email,
        user_id: data.user && data.user.id
      };
    }

    function adoptSession(session, callback) {
      var expiresAt;
      if (!session || !session.access_token) {
        writeSession(null);
        if (callback) callback(null);
        return;
      }
      expiresAt = session.expires_at || 0;
      if (expiresAt && expiresAt < 100000000000) expiresAt = expiresAt * 1000;
      if (!expiresAt) expiresAt = new Date().getTime() + 3600 * 1000;
      writeSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: expiresAt,
        email: session.user && session.user.email,
        user_id: session.user && session.user.id
      });
      if (callback) callback(null);
    }

    function fetchRole(callback) {
      getSession(function (session) {
        if (!session || !session.user_id) {
          callback(new Error("Sign in before checking the club role."));
          return;
        }
        rest("profiles?id=eq." + encodeURIComponent(session.user_id) + "&select=role", "GET", session.access_token, null, null, function (err, rows) {
          if (err) { callback(err); return; }
          callback(null, rows && rows[0] ? rows[0].role : "");
        });
      });
    }

    function refresh(session, callback) {
      request("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      }, function (err, data) {
        if (err) { writeSession(null); callback(err); return; }
        var next = sessionFromAuth(data);
        writeSession(next);
        callback(null, next);
      });
    }

    function getSession(callback) {
      var session = readSession();
      if (!session) { callback(null); return; }
      if (session.expires_at > new Date().getTime() + 60000) { callback(session); return; }
      refresh(session, function (err, next) {
        if (err) callback(null);
        else callback(next);
      });
    }

    function withToken(callback) {
      getSession(function (session) {
        if (!session) {
          callback(new Error("Sign in as a club admin before changing overlays."));
          return;
        }
        callback(null, session.access_token);
      });
    }

    function publicUrl(storagePath) {
      return base + "/storage/v1/object/public/" + BUCKET + "/" + storagePath;
    }

    function displaySrc(row) {
      if (!row.storage_path) return "";
      if (row.storage_path.indexOf("http") === 0) return row.storage_path;
      return publicUrl(row.storage_path);
    }

    function assemble(settingsRows, assetRows, groundRows, linkRows) {
      var settings = (settingsRows && settingsRows[0]) || {};
      var assets = [];
      var grounds = [];
      var byGround = {};
      var i;
      var row;
      var ground;
      for (i = 0; i < (assetRows || []).length; i++) {
        row = assetRows[i];
        assets.push({
          id: row.id,
          kind: row.kind,
          label: row.label,
          description: row.description || "",
          src: displaySrc(row),
          storage_path: row.storage_path,
          mime: row.mime,
          size: row.size,
          logo_type: row.logo_type,
          auto_return: row.auto_return,
          created_at: row.created_at
        });
      }
      for (i = 0; i < (groundRows || []).length; i++) {
        row = groundRows[i];
        ground = {
          id: row.id,
          name: row.name,
          short_link: row.short_link,
          resolved_url: row.resolved_url,
          device: row.device,
          mode: row.mode,
          active_ad: row.active_ad_id,
          score_url: row.score_url,
          logos: {
            age_group_sponsor: row.logo_age_id || "",
            tournament: row.logo_tournament_id || "",
            cricketcraze: row.logo_cricketcraze_id || ""
          },
          ad_ids: [],
          updated_at: row.updated_at
        };
        byGround[ground.id] = ground;
        grounds.push(ground);
      }
      for (i = 0; i < (linkRows || []).length; i++) {
        row = linkRows[i];
        ground = byGround[row.ground_id];
        if (ground) ground.ad_ids.push(row.asset_id);
      }
      return {
        version: 3,
        poll_ms: settings.poll_ms || pollMs,
        auto_return_on_end: settings.auto_return_on_end !== false,
        assets: assets,
        grounds: grounds
      };
    }

    function read(callback) {
      var pending = 4;
      var failed = false;
      var bag = {};
      function done(name, rows) {
        if (failed) return;
        bag[name] = rows || [];
        pending -= 1;
        if (pending === 0) callback(null, assemble(bag.settings, bag.assets, bag.grounds, bag.links), "supabase");
      }
      function fail(err) {
        if (failed) return;
        failed = true;
        callback(err);
      }
      rest("pp_settings?select=*", "GET", key, null, null, function (err, rows) {
        if (err) fail(err); else done("settings", rows);
      });
      rest("pp_assets?select=*&order=created_at.asc", "GET", key, null, null, function (err, rows) {
        if (err) fail(err); else done("assets", rows);
      });
      rest("pp_grounds?select=*&order=name.asc", "GET", key, null, null, function (err, rows) {
        if (err) fail(err); else done("grounds", rows);
      });
      rest("pp_ground_ads?select=*&order=position.asc", "GET", key, null, null, function (err, rows) {
        if (err) fail(err); else done("links", rows);
      });
    }

    function emptyToNull(value) {
      return value ? value : null;
    }

    function write(doc, callback) {
      withToken(function (err, token) {
        var assets = [];
        var grounds = [];
        var links = [];
        var assetIds = [];
        var groundIds = [];
        var i;
        var j;
        var asset;
        var ground;
        if (err) { callback(err); return; }
        for (i = 0; i < (doc.assets || []).length; i++) {
          asset = doc.assets[i];
          assetIds.push(asset.id);
          assets.push({
            id: asset.id,
            kind: asset.kind,
            label: asset.label,
            description: asset.description || "",
            storage_path: asset.storage_path,
            mime: asset.mime || null,
            size: asset.size || null,
            logo_type: asset.logo_type || null,
            auto_return: asset.kind === "ad" ? asset.auto_return !== false : null,
            created_at: asset.created_at
          });
        }
        for (i = 0; i < (doc.grounds || []).length; i++) {
          ground = doc.grounds[i];
          groundIds.push(ground.id);
          grounds.push({
            id: ground.id,
            name: ground.name,
            short_link: ground.short_link,
            resolved_url: ground.resolved_url,
            device: ground.device,
            score_url: ground.score_url,
            logo_age_id: emptyToNull(ground.logos && ground.logos.age_group_sponsor),
            logo_tournament_id: emptyToNull(ground.logos && ground.logos.tournament),
            logo_cricketcraze_id: emptyToNull(ground.logos && ground.logos.cricketcraze),
            mode: ground.mode || "logos_score",
            active_ad_id: emptyToNull(ground.active_ad),
            updated_at: ground.updated_at
          });
          for (j = 0; j < (ground.ad_ids || []).length; j++) {
            links.push({ ground_id: ground.id, asset_id: ground.ad_ids[j], position: j });
          }
        }
        rest("pp_settings?on_conflict=id", "POST", token, [{
          id: 1,
          poll_ms: doc.poll_ms || pollMs,
          auto_return_on_end: doc.auto_return_on_end !== false
        }], "resolution=merge-duplicates,return=minimal", function (settingsErr) {
          if (settingsErr) { callback(settingsErr); return; }
          upsert("pp_assets", assets, token, function (assetErr) {
            if (assetErr) { callback(assetErr); return; }
            upsert("pp_grounds", grounds, token, function (groundErr) {
              if (groundErr) { callback(groundErr); return; }
              replaceLinks(links, groundIds, token, function (linkErr) {
                if (linkErr) { callback(linkErr); return; }
                removeMissing("pp_grounds", groundIds, token, function (delGroundErr) {
                  if (delGroundErr) { callback(delGroundErr); return; }
                  removeMissing("pp_assets", assetIds, token, function (delAssetErr) {
                    if (delAssetErr) callback(delAssetErr);
                    else callback(null, doc, "supabase");
                  });
                });
              });
            });
          });
        });
      });
    }

    function upsert(table, rows, token, callback) {
      if (!rows.length) { callback(null); return; }
      rest(table + "?on_conflict=id", "POST", token, rows, "resolution=merge-duplicates,return=minimal", callback);
    }

    function quoteFilterValue(value) {
      return "\"" + String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"";
    }

    function quotedList(ids) {
      var parts = [];
      var i;
      for (i = 0; i < ids.length; i++) parts.push(encodeURIComponent(quoteFilterValue(ids[i])));
      return parts.join(",");
    }

    function replaceLinks(links, groundIds, token, callback) {
      function postLinks() {
        if (!links.length) { callback(null); return; }
        rest("pp_ground_ads", "POST", token, links, "return=minimal", callback);
      }
      /* No grounds means there are no junction rows to replace. An unfiltered
         DELETE is rejected by PostgREST ("DELETE requires a WHERE clause"). */
      if (!groundIds.length) {
        postLinks();
        return;
      }
      rest("pp_ground_ads?ground_id=in.(" + quotedList(groundIds) + ")", "DELETE", token, null, "return=minimal", function (err) {
        if (err) { callback(err); return; }
        postLinks();
      });
    }

    function removeMissing(table, ids, token, callback) {
      var filter = !ids.length
        ? "?id=not.is.null"
        : "?id=not.in.(" + quotedList(ids) + ")";
      rest(table + filter, "DELETE", token, null, "return=minimal", callback);
    }

    function subscribe(listener) {
      var stopped = false;
      var ws = null;
      var ref = 0;
      var beat = null;
      function send(topic, event, payload) {
        ref += 1;
        if (!ws || ws.readyState !== 1) return;
        ws.send(JSON.stringify({ topic: topic, event: event, payload: payload, ref: String(ref) }));
      }
      function connect() {
        var wsUrl;
        if (stopped || !global.WebSocket) return;
        wsUrl = base.replace(/^http/, "ws") + "/realtime/v1/websocket?apikey=" + encodeURIComponent(key) + "&vsn=1.0.0";
        try { ws = new global.WebSocket(wsUrl); }
        catch (e) { return; }
        ws.onopen = function () {
          send("realtime:pulseplay-grounds", "phx_join", {
            config: {
              broadcast: { self: false },
              presence: { key: "" },
              postgres_changes: [{ event: "*", schema: "public", table: "pp_grounds" }]
            },
            access_token: key
          });
        };
        ws.onmessage = function (event) {
          var msg;
          try { msg = JSON.parse(event.data); } catch (e) { return; }
          if (!msg || !msg.event || msg.event.indexOf("postgres_changes") === -1) return;
          read(function (err, doc) {
            if (!err && doc) listener(null, doc, "realtime");
          });
        };
        ws.onclose = function () {
          if (!stopped) global.setTimeout(connect, 5000);
        };
      }
      connect();
      beat = global.setInterval(function () { send("phoenix", "heartbeat", {}); }, 25000);
      return function () {
        stopped = true;
        global.clearInterval(beat);
        if (ws) {
          try { ws.close(); } catch (e) {}
        }
      };
    }

    function extOf(file) {
      var name = (file.name || "").toLowerCase();
      var dot = name.lastIndexOf(".");
      if (dot !== -1) return name.substring(dot);
      if ((file.type || "").indexOf("video/") === 0) return ".mp4";
      if (file.type === "image/jpeg" || file.type === "image/jpg") return ".jpg";
      if (file.type === "image/webp") return ".webp";
      if (file.type === "image/svg+xml") return ".svg";
      return ".png";
    }

    function putBlob(id, file, callback) {
      withToken(function (err, token) {
        var folder = (file.type || "").indexOf("video/") === 0 ? "ads" : "logos";
        var path = folder + "/" + id + extOf(file);
        if (err) { callback(err); return; }
        if (file.size > 50 * 1024 * 1024) {
          callback(new Error("This file is over 50 MB. The Supabase free plan rejects it. Compress it under 50 MB."));
          return;
        }
        request("/storage/v1/object/" + BUCKET + "/" + path, {
          method: "POST",
          token: token,
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "x-upsert": "true"
          },
          body: file
        }, function (uploadErr) {
          if (uploadErr) { callback(uploadErr); return; }
          callback(null, {
            src: publicUrl(path),
            storage_path: path,
            mime: file.type || "",
            size: file.size || 0
          });
        });
      });
    }

    function deleteBlob(storagePath, callback) {
      if (!storagePath || storagePath.indexOf("idb:") === 0 || storagePath.indexOf("assets/") === 0) {
        callback(null);
        return;
      }
      withToken(function (err, token) {
        if (err) { callback(err); return; }
        request("/storage/v1/object/" + BUCKET + "/" + storagePath, {
          method: "DELETE",
          token: token
        }, function (delErr) {
          callback(delErr);
        });
      });
    }

    function mediaUrl(src, callback) {
      if (!src) { callback(new Error("Missing media path.")); return; }
      callback(null, src);
    }

    function signIn(email, password, callback) {
      request("/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, password: password })
      }, function (err, data) {
        if (err) { callback(err); return; }
        writeSession(sessionFromAuth(data));
        callback(null);
      });
    }

    function signOut(callback) {
      var session = readSession();
      writeSession(null);
      if (!session) { callback(null); return; }
      request("/auth/v1/logout", {
        method: "POST",
        token: session.access_token,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "local" })
      }, function () { callback(null); });
    }

    function reset(callback) {
      callback(new Error("Reset applies to the mock store. Supabase rows stay until an admin deletes them."));
    }

    return {
      read: read,
      write: write,
      reset: reset,
      subscribe: subscribe,
      mediaUrl: mediaUrl,
      putBlob: putBlob,
      deleteBlob: deleteBlob,
      getSession: getSession,
      signIn: signIn,
      signOut: signOut,
      adoptSession: adoptSession,
      fetchRole: fetchRole
    };
  }

  if (!global.PulsePlayStore) global.PulsePlayStore = {};
  global.PulsePlayStore.createSupabaseStore = createSupabaseStore;
})(window);
