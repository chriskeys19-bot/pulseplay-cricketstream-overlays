/*
 * Admin Access tab. Invites division operators. The function sends the email.
 * This page never builds or shows the sign-in link.
 */
(function () {
  var DIVISIONS = ["U9", "U11", "U13", "U15"];
  var operators = [];
  var notice = "";
  var noticeKind = "";
  var inflight = "";

  function setText(node, text) {
    if (!node) return;
    if (node.textContent !== undefined) node.textContent = text;
    else node.innerText = text;
  }

  function liveClient() {
    if (window.PulsePlaySupabase && window.PulsePlaySupabase.get) return window.PulsePlaySupabase.get();
    return null;
  }

  function readError(error) {
    var context = error && error.context;
    if (context && context.json) {
      return context.json().then(function (body) {
        return body && body.error ? body.error : "That invite could not be sent.";
      }).catch(function () { return "That invite could not be sent."; });
    }
    return Promise.resolve(error && error.message ? error.message : "That invite could not be sent.");
  }

  function invoke(body) {
    var supabase = liveClient();
    if (!supabase) return Promise.resolve({ error: "Invites run on the live admin site after you sign in." });
    return supabase.functions.invoke("pp-access", { body: body }).then(function (result) {
      if (result.error) return readError(result.error).then(function (message) { return { error: message }; });
      if (result.data && result.data.error) return { error: result.data.error };
      return { data: result.data };
    });
  }

  function paintNote() {
    var node = document.getElementById("access-note");
    if (!node) return;
    if (!notice) {
      node.className = "broadcast-notice is-off";
      setText(node, "");
      return;
    }
    node.className = "broadcast-notice" + (noticeKind === "ok" ? "" : " is-err");
    setText(node, notice);
  }

  function peopleFor(division) {
    var out = [];
    var i;
    for (i = 0; i < operators.length; i++) {
      if (operators[i].divisions && operators[i].divisions.indexOf(division) !== -1) out.push(operators[i]);
    }
    return out;
  }

  function paint() {
    var root = document.getElementById("access-divisions");
    var list = document.getElementById("access-list");
    var i;
    var division;
    var block;
    var input;
    var button;
    var people;
    var j;
    if (!root || !list) return;
    root.innerHTML = "";
    for (i = 0; i < DIVISIONS.length; i++) {
      division = DIVISIONS[i];
      block = document.createElement("div");
      block.className = "access-division";
      block.appendChild(document.createTextNode(division));
      input = document.createElement("input");
      input.type = "email";
      input.id = "access-email-" + division;
      input.autocomplete = "off";
      input.placeholder = "operator@" + division.toLowerCase() + ".example";
      block.appendChild(input);
      button = document.createElement("button");
      button.type = "button";
      setText(button, inflight === division ? "Sending…" : "Invite");
      button.disabled = !!inflight;
      button.onclick = invite(division);
      block.appendChild(button);
      people = peopleFor(division);
      if (people.length) {
        var named = document.createElement("p");
        var labels = [];
        for (j = 0; j < people.length; j++) labels.push(people[j].email);
        setText(named, "Current: " + labels.join(", "));
        block.appendChild(named);
      }
      root.appendChild(block);
    }
    list.innerHTML = "";
    if (!operators.length) {
      var empty = document.createElement("p");
      empty.className = "hint";
      setText(empty, "No operators yet.");
      list.appendChild(empty);
      return;
    }
    for (i = 0; i < operators.length; i++) list.appendChild(operatorRow(operators[i]));
  }

  function operatorRow(row) {
    var card = document.createElement("article");
    var title = document.createElement("p");
    var actions = document.createElement("div");
    card.className = "stream-row";
    setText(title, row.email + " · " + (row.divisions || []).join(", "));
    card.appendChild(title);
    actions.className = "access-actions broadcast-actions";
    actions.appendChild(actionButton(inflight === row.id ? "Sending…" : "Resend", false, resend(row)));
    actions.appendChild(actionButton("Revoke", true, revoke(row)));
    card.appendChild(actions);
    return card;
  }

  function actionButton(label, danger, onclick) {
    var node = document.createElement("button");
    node.type = "button";
    if (danger) node.className = "btn-danger";
    node.disabled = !!inflight;
    setText(node, label);
    node.onclick = onclick;
    return node;
  }

  function invite(division) {
    return function () {
      var input = document.getElementById("access-email-" + division);
      var email = input ? input.value : "";
      if (inflight) return;
      if (!email || email.indexOf("@") === -1) {
        noticeKind = "err";
        notice = "Enter an email for " + division + ".";
        paintNote();
        return;
      }
      inflight = division;
      notice = "";
      paint();
      invoke({ action: "invite", email: email, divisions: [division] }).then(function (result) {
        inflight = "";
        if (result.error) {
          noticeKind = "err";
          notice = result.error;
        } else {
          noticeKind = "ok";
          notice = "Invite sent for " + division + ".";
          if (input) input.value = "";
        }
        paintNote();
        load();
      });
    };
  }

  function resend(row) {
    return function () {
      if (inflight) return;
      inflight = row.id;
      notice = "";
      paint();
      invoke({ action: "resend", id: row.id }).then(function (result) {
        inflight = "";
        noticeKind = result.error ? "err" : "ok";
        notice = result.error || ("Invite resent to " + row.email + ".");
        paintNote();
        load();
      });
    };
  }

  function revoke(row) {
    return function () {
      if (inflight) return;
      if (!window.confirm("Revoke " + row.email + "? They will lose Pulse Play access.")) return;
      inflight = row.id;
      notice = "";
      paint();
      invoke({ action: "revoke", id: row.id }).then(function (result) {
        inflight = "";
        noticeKind = result.error ? "err" : "ok";
        notice = result.error || (row.email + " can no longer open Pulse Play.");
        paintNote();
        load();
      });
    };
  }

  function load() {
    invoke({ action: "list" }).then(function (result) {
      if (result.error) {
        operators = [];
        noticeKind = "err";
        notice = result.error;
      } else {
        operators = result.data && result.data.operators ? result.data.operators : [];
      }
      paintNote();
      paint();
    });
  }

  function bind() {
    if (document.body.getAttribute("data-access-bound") === "1") return;
    document.body.setAttribute("data-access-bound", "1");
  }

  window.PulsePlayAccessTab = {
    show: function () {
      bind();
      paint();
      load();
    }
  };
})();
