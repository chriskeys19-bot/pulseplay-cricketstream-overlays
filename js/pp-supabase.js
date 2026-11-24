/*
 * One Supabase client for this tab. Streams, Broadcasts, Access, and the
 * Live Wall all share it, and every tab shares localStorage. supabase-js
 * 2.81 locks token refresh with navigator.locks. Live Wall leadership
 * (js/pp-tabs.js) additionally stops auto-refresh on every tab except the
 * visible leader, so idle tabs do not rotate the refresh token.
 * This client is Pulse Play only. It does not read or write Cheetahs tables.
 */
(function (global) {
  var client = null;

  function adapterName() {
    if (global.PulsePlayStore && global.PulsePlayStore.chosenAdapter) return global.PulsePlayStore.chosenAdapter;
    return (global.PulsePlayRuntime || {}).adapter || "";
  }

  function ready() {
    var runtime = global.PulsePlayRuntime || {};
    return !!(global.supabase && global.supabase.createClient && adapterName() === "supabase" && runtime.supabaseUrl && runtime.supabaseKey);
  }

  function get() {
    var runtime;
    if (client) return client;
    if (!ready()) return null;
    runtime = global.PulsePlayRuntime;
    client = global.supabase.createClient(runtime.supabaseUrl, runtime.supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        storage: global.localStorage
      }
    });
    return client;
  }

  function currentSession(callback) {
    var supabase = get();
    if (!supabase || !supabase.auth) {
      callback(null);
      return;
    }
    supabase.auth.getSession().then(function (result) {
      var session = result && result.data ? result.data.session : null;
      callback(session || null);
    }).catch(function () { callback(null); });
  }

  global.PulsePlaySupabase = {
    ready: ready,
    get: get,
    currentSession: currentSession
  };
})(window);
