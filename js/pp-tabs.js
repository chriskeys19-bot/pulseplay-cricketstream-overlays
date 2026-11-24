/*
 * Visible-leader coordination for duplicate admin tabs.
 * BroadcastChannel carries heartbeats and the leader's stream snapshots.
 * navigator.locks inside supabase-js serializes the refresh itself.
 */
(function () {
  var rules = window.PulsePlayLiveWallRules;
  var listeners = [];
  var messages = [];
  var coord = null;
  var channel = null;
  var timer = null;
  var client = null;

  function emit() {
    var i;
    for (i = 0; i < listeners.length; i++) listeners[i]();
  }

  function visible() {
    return document.visibilityState !== "hidden";
  }

  function applyRefresh() {
    var on;
    if (!client || !client.auth || !coord) return;
    on = coord.shouldRefreshAuth(Date.now(), visible());
    if (on) {
      if (client.auth.startAutoRefresh) client.auth.startAutoRefresh();
    } else if (client.auth.stopAutoRefresh) {
      client.auth.stopAutoRefresh();
    }
  }

  function publish(msg) {
    if (!channel || !msg) return;
    try { channel.postMessage(msg); } catch (e) {}
  }

  function beat() {
    var msg;
    if (!coord) return;
    msg = coord.beat(Date.now(), visible());
    publish(msg);
    applyRefresh();
    emit();
  }

  function attach(supabase) {
    var tabId;
    if (coord) {
      client = supabase || client;
      applyRefresh();
      return;
    }
    if (!rules) return;
    tabId = "t" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    coord = rules.createCoordinator(tabId);
    client = supabase || null;
    try { channel = new BroadcastChannel("pulseplay-admin"); } catch (e) { channel = null; }
    if (channel) {
      channel.onmessage = function (event) {
        var data = event.data;
        var i;
        if (data && data.type === "beat") {
          coord.receive(data);
          applyRefresh();
          emit();
        }
        for (i = 0; i < messages.length; i++) messages[i](data);
      };
    }
    document.addEventListener("visibilitychange", beat);
    timer = window.setInterval(beat, 2000);
    beat();
  }

  window.PulsePlayTabs = {
    attach: attach,
    onChange: function (fn) { listeners.push(fn); },
    listen: function (fn) { messages.push(fn); },
    publish: publish,
    isLeader: function () { return coord ? coord.isLeader(Date.now()) : visible(); },
    shouldPoll: function (realtimeUp) {
      return coord ? coord.shouldPoll(Date.now(), visible(), !!realtimeUp) : visible() && !realtimeUp;
    },
    shouldSafetyPoll: function (realtimeUp) {
      return coord ? coord.shouldSafetyPoll(Date.now(), visible(), !!realtimeUp) : false;
    },
    visible: visible
  };
})();
