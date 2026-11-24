/*
 * Admin Access tab. Adds a person by email and sets their scope.
 * The edge function sends the email. This page can also show a copyable link.
 */
(function () {
  var scopeApi = function () { return window.PulsePlayScope; };
  var grants = [];
  var tournaments = ["AMLCA", "NCCA", "NYCT", "PSD"];
  var ageGroups = ["U9", "U11", "U13", "U15", "U17", "U19"];
  var notice = "";
  var noticeKind = "";
  var inviteLink = "";
  var inflight = "";
  var editing = "";

  function setText(node, text) {
    if (!node) return;
    if (node.textContent !== undefined) node.textContent = text;
    else node.innerText = text;
  }

  function liveClient() {
    if (window.PulsePlaySupabase && window.PulsePlaySupabase.get) return window.PulsePlaySupabase.get();
    return null;
  }

  function explain(message, fallback) {
    var api = scopeApi();
    if (api && api.explainFunctionError) return api.explainFunctionError(message, fallback);
    return message || fallback;
  }

  function readError(error) {
    var context = error && error.context;
    var fallback = explain(error && error.message, "That access request failed.");
    if (context && context.json) {
      return context.json().then(function (body) {
        if (body && body.error) return body.error;
        if (body && body.warning) return body.warning;
        return fallback;
      }).catch(function () { return fallback; });
    }
    if (context && context.text) {
      return context.text().then(function (text) {
        try {
          var body = JSON.parse(text);
          if (body && body.error) return body.error;
        } catch (e) { /* not JSON */ }
        return text ? explain(String(text).slice(0, 180), fallback) : fallback;
      }).catch(function () { return fallback; });
    }
    return Promise.resolve(fallback);
  }

  function invoke(body) {
    var supabase = liveClient();
    if (!supabase) return Promise.resolve({ error: "Access grants run on the live admin site after you sign in." });
    return supabase.functions.invoke("pp-access", { body: body }).then(function (result) {
      if (result.error) return readError(result.error).then(function (message) { return { error: message, data: result.data }; });
      if (result.data && result.data.error) return { error: result.data.error, data: result.data };
      return { data: result.data };
    }).catch(function (error) {
      return { error: explain(error && error.message, "That access request failed.") };
    });
  }

  function access() {
    return window.PulsePlayAccess || null;
  }

  function managedTournaments() {
    var api = scopeApi();
    var current = access();
    var out = [];
    var scopes;
    var i;
    if (!current || current.fullAdmin || !api) return tournaments.slice();
    scopes = current.scopes || [];
    for (i = 0; i < scopes.length; i++) {
      if (scopes[i].status && scopes[i].status !== "active") continue;
      if (scopes[i].role === "admin" && scopes[i].scopeType === "tournament" && scopes[i].tournament && out.indexOf(scopes[i].tournament) === -1) {
        out.push(scopes[i].tournament);
      }
    }
    return out.length ? out : tournaments.slice();
  }

  function paintNote() {
    var node = document.getElementById("access-note");
    var link = document.getElementById("access-link-wrap");
    var field = document.getElementById("access-link");
    if (node) {
      if (!notice) {
        node.className = "broadcast-notice is-off";
        setText(node, "");
      } else {
        node.className = "broadcast-notice" + (noticeKind === "ok" ? " is-ok" : noticeKind === "err" ? " is-err" : "");
        setText(node, notice);
      }
    }
    if (link && field) {
      if (!inviteLink) {
        link.classList.add("is-off");
        field.value = "";
      } else {
        link.classList.remove("is-off");
        field.value = inviteLink;
      }
    }
  }

  function option(value, text) {
    var node = document.createElement("option");
    node.value = value;
    setText(node, text);
    return node;
  }

  function fillSelect(select, values, placeholder) {
    var previous = select.value;
    var i;
    select.innerHTML = "";
    if (placeholder) select.appendChild(option("", placeholder));
    for (i = 0; i < values.length; i++) select.appendChild(option(values[i], values[i]));
    if (previous && select.querySelector && select.querySelector('option[value="' + previous + '"]')) select.value = previous;
  }

  function syncScopeFields() {
    var scope = document.getElementById("access-scope");
    var tournamentLabel = document.getElementById("access-tournament-label");
    var divisionLabel = document.getElementById("access-division-label");
    var tournament = document.getElementById("access-tournament");
    var division = document.getElementById("access-division");
    var value = scope ? scope.value : "all";
    var current = access();
    if (scope && current && !current.fullAdmin) {
      if (scope.querySelector('option[value="all"]')) scope.querySelector('option[value="all"]').hidden = true;
      if (value === "all") scope.value = "tournament";
      value = scope.value;
    }
    if (tournament) fillSelect(tournament, managedTournaments(), value === "division" ? "Every tournament" : "");
    if (division) fillSelect(division, ageGroups, "");
    if (tournamentLabel) tournamentLabel.classList.toggle("is-off", value === "all");
    if (divisionLabel) divisionLabel.classList.toggle("is-off", value !== "division");
  }

  function formScope(prefix) {
    var scope = document.getElementById(prefix + "scope");
    var tournament = document.getElementById(prefix + "tournament");
    var division = document.getElementById(prefix + "division");
    var role = document.getElementById(prefix + "role");
    var value = scope ? scope.value : "all";
    return {
      scopeType: value,
      tournament: value === "all" ? "" : (tournament ? tournament.value : ""),
      division: value === "division" && division ? division.value : "",
      role: role ? role.value : "operator"
    };
  }

  function paint() {
    var list = document.getElementById("access-list");
    var button = document.getElementById("access-submit");
    var i;
    syncScopeFields();
    if (button) {
      button.disabled = !!inflight;
      setText(button, inflight === "grant" ? "Saving…" : "Add");
    }
    if (!list) return;
    list.innerHTML = "";
    if (!grants.length) {
      var empty = document.createElement("p");
      empty.className = "hint";
      setText(empty, "No grants yet.");
      list.appendChild(empty);
      return;
    }
    for (i = 0; i < grants.length; i++) list.appendChild(grantCard(grants[i]));
  }

  function grantCard(row) {
    var api = scopeApi();
    var card = document.createElement("article");
    var title = document.createElement("p");
    var meta = document.createElement("p");
    var actions = document.createElement("div");
    card.className = "stream-row access-grant";
    setText(title, row.email);
    title.className = "stream-title";
    setText(meta, (api ? api.label(row) : row.scopeType) + " · " + statusLabel(row.status));
    card.appendChild(title);
    card.appendChild(meta);
    actions.className = "access-actions broadcast-actions";
    if (row.status !== "revoked") {
      actions.appendChild(actionButton(inflight === row.id + ":resend" ? "Sending…" : "Resend invite", "", resend(row)));
      actions.appendChild(actionButton(inflight === row.id + ":link" ? "Working…" : "Copy invite link", "", copyLink(row)));
      actions.appendChild(actionButton("Change scope", "", toggleEdit(row)));
    }
    actions.appendChild(actionButton("Revoke", "btn-danger", revoke(row)));
    card.appendChild(actions);
    if (editing === row.id) card.appendChild(editForm(row));
    if (row.inviteLink) card.appendChild(linkField(row.inviteLink));
    return card;
  }

  function statusLabel(status) {
    if (status === "active") return "Active";
    if (status === "revoked") return "Revoked";
    return "Pending";
  }

  function linkField(url) {
    var wrap = document.createElement("label");
    var input = document.createElement("input");
    wrap.className = "access-link-field";
    setText(wrap, "Invite link");
    input.type = "text";
    input.readOnly = true;
    input.value = url;
    wrap.appendChild(input);
    return wrap;
  }

  function actionButton(label, className, onclick) {
    var node = document.createElement("button");
    node.type = "button";
    if (className) node.className = className;
    node.disabled = !!inflight;
    setText(node, label);
    node.onclick = onclick;
    return node;
  }

  function editForm(row) {
    var form = document.createElement("form");
    var scope = document.createElement("select");
    var tournament = document.createElement("select");
    var division = document.createElement("select");
    var role = document.createElement("select");
    var save = document.createElement("button");
    var current = access();
    form.className = "access-edit";
    scope.id = "edit-" + row.id + "-scope";
    tournament.id = "edit-" + row.id + "-tournament";
    division.id = "edit-" + row.id + "-division";
    role.id = "edit-" + row.id + "-role";
    if (!current || current.fullAdmin) scope.appendChild(option("all", "All tournaments"));
    scope.appendChild(option("tournament", "Tournament"));
    scope.appendChild(option("division", "Age group"));
    scope.value = row.scopeType || "division";
    fillSelect(tournament, managedTournaments(), "Every tournament");
    fillSelect(division, ageGroups, "");
    tournament.value = row.tournament || "";
    division.value = row.division || ageGroups[0];
    role.appendChild(option("admin", "Admin"));
    role.appendChild(option("operator", "Operator"));
    role.value = row.role || "operator";
    save.type = "submit";
    setText(save, inflight === row.id + ":update" ? "Saving…" : "Save scope");
    form.appendChild(labeled("Scope", scope));
    form.appendChild(labeled("Tournament", tournament));
    form.appendChild(labeled("Age group", division));
    form.appendChild(labeled("Role", role));
    form.appendChild(save);
    form.onsubmit = function (event) {
      var body;
      event.preventDefault();
      if (inflight) return;
      body = {
        action: "update",
        id: row.id,
        scopeType: scope.value,
        tournament: scope.value === "all" ? "" : tournament.value,
        division: scope.value === "division" ? division.value : "",
        role: role.value
      };
      inflight = row.id + ":update";
      notice = "";
      paint();
      invoke(body).then(function (result) {
        inflight = "";
        noticeKind = result.error ? "err" : "ok";
        notice = result.error || ("Updated " + row.email + ".");
        if (!result.error) editing = "";
        paintNote();
        load();
      });
    };
    return form;
  }

  function labeled(text, control) {
    var node = document.createElement("label");
    setText(node, text);
    node.appendChild(control);
    return node;
  }

  function remember(result, fallback) {
    var data = result.data || {};
    inviteLink = data.inviteLink || "";
    if (result.error) {
      noticeKind = "err";
      notice = result.error;
      return;
    }
    if (data.warning) {
      noticeKind = "err";
      notice = data.warning;
      return;
    }
    noticeKind = "ok";
    notice = fallback;
  }

  function submitGrant(event) {
    var email = document.getElementById("access-email");
    var body;
    event.preventDefault();
    if (inflight) return;
    if (!email || !email.value || email.value.indexOf("@") === -1) {
      noticeKind = "err";
      notice = "Enter an email address.";
      inviteLink = "";
      paintNote();
      return;
    }
    body = formScope("access-");
    body.action = "grant";
    body.email = email.value;
    inflight = "grant";
    notice = "";
    inviteLink = "";
    paint();
    paintNote();
    invoke(body).then(function (result) {
      inflight = "";
      remember(result, email.value + " now has access.");
      if (!result.error && email) email.value = "";
      paintNote();
      load();
    });
  }

  function resend(row) {
    return function () {
      if (inflight) return;
      inflight = row.id + ":resend";
      notice = "";
      inviteLink = "";
      paint();
      invoke({ action: "resend", id: row.id }).then(function (result) {
        inflight = "";
        remember(result, "Invite resent to " + row.email + ".");
        paintNote();
        load();
      });
    };
  }

  function copyLink(row) {
    return function () {
      if (inflight) return;
      inflight = row.id + ":link";
      notice = "";
      paint();
      invoke({ action: "link", id: row.id }).then(function (result) {
        var link = result.data && result.data.inviteLink;
        inflight = "";
        if (result.error || !link) {
          noticeKind = "err";
          notice = result.error || "Could not create an invite link.";
          inviteLink = "";
        } else {
          inviteLink = link;
          noticeKind = result.data && result.data.warning ? "err" : "ok";
          notice = (result.data && result.data.warning) || "Invite link ready to copy.";
          copyText(link);
        }
        paintNote();
        paint();
      });
    };
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
    }
  }

  function toggleEdit(row) {
    return function () {
      editing = editing === row.id ? "" : row.id;
      paint();
    };
  }

  function revoke(row) {
    return function () {
      if (inflight) return;
      if (!window.confirm("Revoke " + row.email + "? They will lose this Pulse Play access.")) return;
      inflight = row.id + ":revoke";
      notice = "";
      inviteLink = "";
      paint();
      invoke({ action: "revoke", id: row.id }).then(function (result) {
        inflight = "";
        noticeKind = result.error ? "err" : "ok";
        notice = result.error || (row.email + " no longer has this access.");
        paintNote();
        load();
      });
    };
  }

  function load() {
    invoke({ action: "list" }).then(function (result) {
      if (result.error) {
        grants = [];
        if (!notice) {
          notice = result.error;
          noticeKind = /live admin site/i.test(result.error) ? "" : "err";
        }
      } else {
        grants = result.data && result.data.grants ? result.data.grants : [];
        if (result.data && result.data.tournaments && result.data.tournaments.length) tournaments = result.data.tournaments;
        if (result.data && result.data.ageGroups && result.data.ageGroups.length) ageGroups = result.data.ageGroups;
      }
      paintNote();
      paint();
    });
  }

  function bind() {
    var form = document.getElementById("access-form");
    var scope = document.getElementById("access-scope");
    var copy = document.getElementById("access-copy");
    if (document.body.getAttribute("data-access-bound") === "1") return;
    document.body.setAttribute("data-access-bound", "1");
    if (form) form.onsubmit = submitGrant;
    if (scope) scope.onchange = syncScopeFields;
    if (copy) copy.onclick = function () {
      var field = document.getElementById("access-link");
      if (field && field.value) copyText(field.value);
    };
  }

  window.PulsePlayAccessTab = {
    show: function () {
      bind();
      paint();
      load();
    }
  };
})();
