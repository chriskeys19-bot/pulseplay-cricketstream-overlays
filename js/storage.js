/*
 * Overlay storage adapter.
 *
 * read(callback), write(doc, callback), subscribe(listener), mediaUrl(src, callback).
 * callback is callback(err, result).
 *
 * Mock: seed JSON is fetched with a cache-busting ?t= on every read. The working
 * copy lives in localStorage. Uploaded ads and logos live in IndexedDB.
 * Their metadata is one assets list with kind "ad" or "logo", the same shape
 * as a later shared Supabase Storage bucket and assets table (kind column).
 * subscribe() listens for localStorage changes from other tabs of this browser.
 * A later Supabase adapter should keep these methods and implement subscribe()
 * with Realtime (postgres_changes) instead of the storage event. Do not commit keys.
 *
 * A YoloBox is a different device. It cannot see this browser's localStorage or
 * IndexedDB. Cross-device playback waits on the Supabase adapter.
 */
(function (global) {
  var DEFAULT_POLL_MS = 2000;
  var STORAGE_KEY = "pulseplay.overlayConfig.v3";
  var DB_NAME = "pulseplay.overlay";
  var DB_STORE = "blobs";
  var WARN_BYTES = 12 * 1024 * 1024;
  var MAX_BYTES = 80 * 1024 * 1024;
  var BLOCK_HOSTS = ["cricclubs.com", "www.cricclubs.com"];
  var blobUrls = {};

  function detectSiteRoot() {
    var scripts = document.getElementsByTagName("script");
    var i;
    var src;
    var marker;
    for (i = scripts.length - 1; i >= 0; i--) {
      src = scripts[i].getAttribute("src") || "";
      marker = src.indexOf("js/storage.js");
      if (marker !== -1) return src.substring(0, marker);
    }
    return "";
  }

  var siteRoot = detectSiteRoot();

  function resolveUrl(url) {
    if (!url) return "";
    var value = String(url);
    if (/^[a-z]+:/i.test(value) || value.indexOf("//") === 0) return value;
    return siteRoot + value;
  }

  function safeUrl(url) {
    var resolved = resolveUrl(url).replace(/^\s+/, "");
    if (!resolved) return "";
    if (resolved.toLowerCase().indexOf("javascript:") === 0) return "";
    return resolved;
  }

  function hostnameOf(url) {
    var safe = safeUrl(url);
    if (!safe) return "";
    var anchor = document.createElement("a");
    anchor.href = safe;
    return (anchor.hostname || "").toLowerCase();
  }

  function isCrossOrigin(url) {
    var safe = safeUrl(url);
    if (!safe) return false;
    if (safe.indexOf("http://") !== 0 && safe.indexOf("https://") !== 0 && safe.indexOf("//") !== 0) {
      return false;
    }
    var anchor = document.createElement("a");
    anchor.href = safe;
    return anchor.host !== global.location.host;
  }

  function hostBlocksEmbed(url) {
    var host = hostnameOf(url);
    var i;
    var blocked;
    if (!host) return false;
    for (i = 0; i < BLOCK_HOSTS.length; i++) {
      blocked = BLOCK_HOSTS[i];
      if (host === blocked) return true;
      if (host.length > blocked.length && host.substring(host.length - blocked.length - 1) === "." + blocked) {
        return true;
      }
    }
    return false;
  }

  function openDb(callback) {
    var req;
    if (!global.indexedDB) {
      callback(new Error("This browser has no IndexedDB, so uploads cannot be stored."));
      return;
    }
    try {
      req = global.indexedDB.open(DB_NAME, 1);
    } catch (e) {
      callback(e);
      return;
    }
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = function () { callback(null, req.result); };
    req.onerror = function () { callback(req.error || new Error("IndexedDB failed to open.")); };
  }

  function idbPut(key, value, callback) {
    openDb(function (err, db) {
      if (err) { callback(err); return; }
      var tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = function () { callback(null); };
      tx.onerror = function () { callback(tx.error || new Error("Could not store the file.")); };
    });
  }

  function idbGet(key, callback) {
    openDb(function (err, db) {
      if (err) { callback(err); return; }
      var tx = db.transaction(DB_STORE, "readonly");
      var req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = function () { callback(null, req.result || null); };
      req.onerror = function () { callback(req.error || new Error("Could not read the file.")); };
    });
  }

  function idbDelete(key, callback) {
    if (blobUrls[key]) {
      try { global.URL.revokeObjectURL(blobUrls[key]); } catch (e) {}
      delete blobUrls[key];
    }
    openDb(function (err, db) {
      if (err) { callback(err); return; }
      var tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete(key);
      tx.oncomplete = function () { callback(null); };
      tx.onerror = function () { callback(tx.error || new Error("Could not delete the file.")); };
    });
  }

  function idbClear(callback) {
    var key;
    for (key in blobUrls) {
      if (blobUrls.hasOwnProperty(key)) {
        try { global.URL.revokeObjectURL(blobUrls[key]); } catch (e) {}
      }
    }
    blobUrls = {};
    openDb(function (err, db) {
      if (err) { callback(err); return; }
      var tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).clear();
      tx.oncomplete = function () { callback(null); };
      tx.onerror = function () { callback(tx.error || new Error("Could not clear uploads.")); };
    });
  }

  function createMockStore(options) {
    var configUrl = options.configUrl;
    var storageKey = options.storageKey || STORAGE_KEY;

    function readLocal() {
      var raw;
      try { raw = global.localStorage.getItem(storageKey); }
      catch (e) { return null; }
      if (!raw) return null;
      try {
        var doc = JSON.parse(raw);
        if (!doc || !doc.grounds || !doc.assets) return null;
        return doc;
      } catch (e2) {
        return null;
      }
    }

    function write(doc, callback) {
      try { global.localStorage.setItem(storageKey, JSON.stringify(doc)); }
      catch (e) {
        if (callback) callback(e);
        return;
      }
      if (callback) callback(null, doc, "localStorage");
    }

    function fetchJson(callback) {
      var sep = configUrl.indexOf("?") === -1 ? "?" : "&";
      var xhr = new XMLHttpRequest();
      try { xhr.open("GET", configUrl + sep + "t=" + new Date().getTime(), true); }
      catch (e) { callback(e); return; }
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          try { callback(null, JSON.parse(xhr.responseText)); }
          catch (parseError) { callback(parseError); }
          return;
        }
        if (xhr.status === 0) {
          callback(new Error("Could not fetch the overlay config. Open this site over http (a local server or GitHub Pages), not as a file."));
          return;
        }
        callback(new Error("Config request failed (" + xhr.status + ")."));
      };
      xhr.send(null);
    }

    function read(callback) {
      fetchJson(function (err, fileDoc) {
        var localDoc = readLocal();
        if (localDoc) {
          callback(null, localDoc, "localStorage");
          return;
        }
        if (err) { callback(err); return; }
        write(fileDoc, function (writeErr) {
          if (writeErr) { callback(writeErr); return; }
          callback(null, fileDoc, "file");
        });
      });
    }

    function reset(callback) {
      try { global.localStorage.removeItem(storageKey); }
      catch (e) { callback(e); return; }
      idbClear(function () {
        fetchJson(function (err, fileDoc) {
          if (err) { callback(err); return; }
          write(fileDoc, callback);
        });
      });
    }

    /*
     * Push channel. The mock fires when another tab writes localStorage.
     * Supabase Realtime should call listener(null, doc, "realtime") and can
     * ignore the poll. The renderer keeps polling as a fallback either way.
     */
    function subscribe(listener) {
      function onStorage(event) {
        if (!event || event.key !== storageKey || !event.newValue) return;
        try { listener(null, JSON.parse(event.newValue), "storage"); }
        catch (e) { listener(e); }
      }
      global.addEventListener("storage", onStorage);
      return function () { global.removeEventListener("storage", onStorage); };
    }

    function mediaUrl(src, callback) {
      var key;
      if (!src) { callback(new Error("Missing media path.")); return; }
      if (src.indexOf("idb:") !== 0) {
        callback(null, resolveUrl(src));
        return;
      }
      key = src.substring(4);
      if (blobUrls[key]) { callback(null, blobUrls[key]); return; }
      idbGet(key, function (err, rec) {
        if (err) { callback(err); return; }
        if (!rec || !rec.blob) {
          callback(new Error("Uploaded file is not in this browser (" + key + ")."));
          return;
        }
        blobUrls[key] = global.URL.createObjectURL(rec.blob);
        callback(null, blobUrls[key]);
      });
    }

    function putBlob(key, file, callback) {
      idbPut(key, { blob: file, type: file.type || "", name: file.name || "" }, function (err) {
        if (err) { callback(err); return; }
        if (blobUrls[key]) {
          try { global.URL.revokeObjectURL(blobUrls[key]); } catch (e) {}
          delete blobUrls[key];
        }
        callback(null, "idb:" + key);
      });
    }

    function deleteBlob(key, callback) {
      var id = key || "";
      if (id.indexOf("idb:") === 0) id = id.substring(4);
      if (!id || id.indexOf("assets/") === 0) {
        callback(null);
        return;
      }
      idbDelete(id, callback);
    }

    return {
      read: read,
      write: write,
      reset: reset,
      subscribe: subscribe,
      mediaUrl: mediaUrl,
      putBlob: putBlob,
      deleteBlob: deleteBlob
    };
  }

  function create(options) {
    var runtime = global.PulsePlayRuntime || {};
    var which = (options && options.adapter) || runtime.adapter || "mock";
    if (which === "supabase") {
      if (!global.PulsePlayStore.createSupabaseStore) {
        throw new Error("Supabase adapter is not loaded.");
      }
      return global.PulsePlayStore.createSupabaseStore(runtime);
    }
    return createMockStore(options || {});
  }

  global.PulsePlayStore = {
    DEFAULT_POLL_MS: DEFAULT_POLL_MS,
    WARN_BYTES: WARN_BYTES,
    MAX_BYTES: MAX_BYTES,
    create: create,
    createMockStore: createMockStore,
    resolveUrl: resolveUrl,
    safeUrl: safeUrl,
    isCrossOrigin: isCrossOrigin,
    hostBlocksEmbed: hostBlocksEmbed
  };
})(window);
