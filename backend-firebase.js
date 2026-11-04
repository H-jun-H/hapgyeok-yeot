/*
 * 합격엿 교문 — standalone backend adapter
 *
 * The game was written against a small capability API: window.claude.use(name)
 * resolving to "db", "user", "room" or "downloads" (or null when unavailable).
 * This file provides that same API on top of Firebase, so the game code itself
 * stays identical between the Claude preview and the public website.
 *
 *   db    -> Cloud Firestore  (one document per player per server, + server-side totals)
 *   user  -> Firebase Anonymous Auth (no sign-up; one id per browser)
 *   room  -> Realtime Database /presence (who is online + live throws)
 *   downloads -> plain browser download
 *
 * With no Firebase config (firebase-config.js still has REPLACE_ME) everything
 * resolves to null and the game runs in single-device mode, which is handy for
 * local testing.
 */
(function () {
  "use strict";

  var CFG = window.YEOT_CONFIG || {};
  var FB = CFG.firebase || {};
  var enabled = !!(FB.apiKey && FB.projectId && !/REPLACE/i.test(FB.apiKey));
  var SDK = "https://www.gstatic.com/firebasejs/" + (CFG.sdkVersion || "10.12.2") + "/";
  var log = function () { if (CFG.debug) console.log.apply(console, ["[yeot]"].concat([].slice.call(arguments))); };

  /* ---------- downloads (works without Firebase) ---------- */
  var downloads = {
    save: function (req) {
      return new Promise(function (resolve, reject) {
        try {
          var data = req && req.data;
          var blob = data instanceof Blob ? data : new Blob([data]);
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url; a.download = (req && req.filename) || "download";
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          resolve({ saved: true });
        } catch (e) { reject({ code: "unavailable", message: String(e) }); }
      });
    }
  };

  if (!enabled) {
    log("Firebase config not set — running in single-device mode");
    window.claude = { use: function (name) { return Promise.resolve(name === "downloads" ? downloads : null); } };
    return;
  }

  /* ---------- boot Firebase once ---------- */
  var bootP = null;
  function boot() {
    if (bootP) return bootP;
    bootP = Promise.all([
      import(SDK + "firebase-app.js"),
      import(SDK + "firebase-auth.js"),
      import(SDK + "firebase-firestore.js"),
      FB.databaseURL ? import(SDK + "firebase-database.js") : Promise.resolve(null)
    ]).then(function (mods) {
      var appM = mods[0], authM = mods[1], fsM = mods[2], rtM = mods[3];
      var app = appM.initializeApp(FB);
      var auth = authM.getAuth(app);
      return authM.signInAnonymously(auth).then(function (cred) {
        var u = cred.user;
        return u.getIdTokenResult().catch(function () { return { claims: {} }; }).then(function (tok) {
          var F = {
            fsM: fsM, rtM: rtM, uid: u.uid, admin: tok.claims && tok.claims.admin === true,
            fs: fsM.getFirestore(app), rt: rtM ? rtM.getDatabase(app) : null
          };
          log("signed in anonymously as", F.uid, F.admin ? "(admin)" : "");
          return F;
        });
      });
    });
    return bootP;
  }

  /* ---------- db: Firestore ---------- */
  function errOut(e) {
    // The game treats "invalid_argument" as "this viewer may not write" and goes read-only.
    // On the website everyone may write, so every failure is reported as temporary.
    return { code: "unavailable", message: String((e && e.message) || e) };
  }
  function snapDoc(d) {
    return {
      id: d.id, exists: d.exists(), data: function () { return d.data(); },
      metadata: { fromCache: d.metadata.fromCache, hasPendingWrites: d.metadata.hasPendingWrites }
    };
  }
  function makeDb(F) {
    var fsM = F.fsM, fs = F.fs, LIMIT = CFG.wallLimit || 60;
    return {
      collection: function (col) {
        return {
          // Only the most recently active players are streamed; totals come from stats() below.
          onSnapshot: function (next, error) {
            var q = fsM.query(fsM.collection(fs, col), fsM.orderBy("ts", "desc"), fsM.limit(LIMIT));
            return fsM.onSnapshot(q, function (snap) {
              next({
                docs: snap.docs.map(snapDoc), size: snap.size, empty: snap.empty,
                metadata: { fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites },
                docChanges: function () { return []; }
              });
            }, function (e) { if (error) error(errOut(e)); });
          },
          doc: function (id) {
            var ref = fsM.doc(fs, col, id);
            var write = function (data) { return fsM.setDoc(ref, Object.assign({}, data, { at: fsM.serverTimestamp() })); };
            return {
              id: id, path: col + "/" + id,
              get: function () { return fsM.getDoc(ref).then(snapDoc).catch(function (e) { throw errOut(e); }); },
              set: function (data) {
                // one retry covers the 0.8 s write-rate rule in firestore.rules
                return write(data).catch(function () {
                  return new Promise(function (r) { setTimeout(r, 1200); }).then(function () { return write(data); });
                }).catch(function (e) { throw errOut(e); });
              }
            };
          }
        };
      },
      // Server-side totals: sum of throws and number of players, refreshed every few seconds.
      stats: function (col, cb) {
        var run = function () {
          fsM.getAggregateFromServer(fsM.collection(fs, col), { t: fsM.sum("n"), p: fsM.count() })
            .then(function (agg) { var d = agg.data(); cb({ t: d.t || 0, p: d.p || 0 }); })
            .catch(function (e) { log("stats failed", col, e); });
        };
        run();
        var id = setInterval(function () { if (!document.hidden) run(); }, (CFG.statsIntervalSec || 20) * 1000);
        return function () { clearInterval(id); };
      }
    };
  }

  /* ---------- user: anonymous auth ---------- */
  function makeUser(F) {
    var uid = F.uid;
    return {
      id: function () { return Promise.resolve(uid); },
      me: function () { return Promise.resolve({ id: uid, name: "", email: null, guest: false }); },
      isOwner: function () { return Promise.resolve(F.admin); },
      canEdit: function () { return Promise.resolve(F.admin); },
      can: function (name) { return Promise.resolve(name === "data.write" ? true : null); },
      profiles: function () { return Promise.resolve({}); },
      search: function () { return Promise.resolve([]); }
    };
  }

  /* ---------- room: Realtime Database presence ---------- */
  function makeRoom(F) {
    if (!F.rt) return null;
    var rtM = F.rtM, rt = F.rt, uid = F.uid;
    var myRef = rtM.ref(rt, "presence/" + uid);
    var mine = {}, peers = [], prev = new Map(), listeners = [];

    var push = function () {
      var body = Object.assign({}, mine, { t: rtM.serverTimestamp() });
      return rtM.set(myRef, body);
    };
    rtM.onValue(rtM.ref(rt, ".info/connected"), function (s) {
      if (s.val() !== true) return;
      rtM.onDisconnect(myRef).remove();
      if (Object.keys(mine).length) push().catch(function () {});
    });
    rtM.onValue(rtM.ref(rt, "presence"), function (snap) {
      var val = snap.val() || {}, now = Date.now(), next = new Map(), joined = [], left = [], updated = [];
      Object.keys(val).forEach(function (k) {
        var v = val[k]; if (!v || typeof v !== "object") return;
        var p = { peer: k, by: k, isMe: k === uid, sameTab: k === uid, kind: "viewer", guest: false, presence: Object.freeze(Object.assign({}, v)), updatedAt: now };
        var old = prev.get(k);
        if (!old) joined.push(p);
        else if (JSON.stringify(old.presence) !== JSON.stringify(p.presence)) updated.push(p);
        else p = old;
        next.set(k, p);
      });
      prev.forEach(function (p, k) { if (!next.has(k)) left.push(p); });
      prev = next; peers = Array.from(next.values());
      if (joined.length || left.length || updated.length) {
        listeners.slice().forEach(function (fn) { try { fn({ peers: peers, joined: joined, left: left, updated: updated }); } catch (e) { console.error(e); } });
      }
    });

    return {
      presence: function (patch) {
        Object.keys(patch || {}).forEach(function (k) { if (patch[k] === null) delete mine[k]; else mine[k] = patch[k]; });
        return push().catch(function (e) { log("presence write failed", e); });
      },
      peers: function () { return peers; },
      onPeers: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
      emit: function () { return Promise.resolve(); },
      on: function () { return function () {}; },
      join: function () { return null; }
    };
  }

  /* ---------- the capability entry point the game calls ---------- */
  var cache = {};
  var withTimeout = function (p, ms) {
    return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(null); }, ms); })]);
  };
  window.claude = {
    use: function (name) {
      if (name === "downloads") return Promise.resolve(downloads);
      if (name !== "db" && name !== "user" && name !== "room") return Promise.resolve(null);
      if (!cache[name]) {
        cache[name] = withTimeout(boot().then(function (F) {
          return name === "db" ? makeDb(F) : name === "user" ? makeUser(F) : makeRoom(F);
        }), 10000).catch(function (e) { console.warn("[yeot] backend unavailable:", e); return null; });
      }
      return cache[name];
    }
  };
})();
