/* Usage analytics - visits, visitors and run totals, never content.
 *
 * The rule (owner-approved 2026-10-23, widened 2026-11-06): count visitors and
 * the SHAPE of a run - how many pictures, how many bytes in and out, which
 * formats, which plan, how long it took. Never a file name, a path, a pixel, a
 * thumbnail or any text a person typed. Pictures never leave the device; this
 * file is the only thing on the page that talks to anything but its own address.
 *
 * Since 2026-11-06 (owner decision) it also loads the shared add-on every
 * syedsarib.com site uses, https://analytics.syedsarib.com/t/plus.js: the
 * visitor's device and browser details, their IP address and the network that
 * owns it (looked up by analytics.syedsarib.com/api/net), whether they look
 * human, and how long each page was visible and how far it was scrolled.
 *
 * Consent (owner decision, 2026-11-17, same as syedsarib.com): until the visitor
 * accepts in the consent bar, PostHog is cookieless (memory persistence, no person
 * profiles, no session replay) and the add-on runs in consent mode: no IP lookup,
 * no ?via naming. Accepting switches the running page to the full shared setup.
 * The choice lives in this site's localStorage; a "Cookie choices" link reopens it.
 *
 * Events go to PostHog through our own proxy, e.syedsarib.com; the add-on comes
 * from analytics.syedsarib.com. Those are the two extra origins the CSP in
 * vercel.json allows. Config follows the shared contract in
 * the analytics repo (TRACKING.md / posthog-snippet.html), plus hardening for a
 * page whose screen is full of other people's file names:
 *
 *   - autocapture keeps no element text and no element attributes, so a click
 *     on a queue row cannot carry the name printed on it;
 *   - session replay masks every input and ALL text, and blocks outright the
 *     regions that show pictures or names (queue, comparison frame, name box);
 *   - console logs are never recorded.
 *
 * A classic script, external, because the CSP forbids inline script. It runs
 * only on the production host: local servers, CI and Vercel previews load
 * nothing and send nothing, so the browser gates stay hermetic. */
(function () {
  "use strict";
  if (location.hostname !== "pocketsize.syedsarib.com") return;

  /* Consent. The bar is the system's own toast (s-toast) with two s-btn buttons,
     in its own s-toasts region so the app's receipts, which replace everything in
     #toast, never wipe it. */
  var STORAGE_KEY = "analytics-consent";
  var COOKIELESS = { persistence: "memory", person_profiles: "never", disable_session_recording: true };
  var FULL = { persistence: "localStorage+cookie", person_profiles: "always", disable_session_recording: false };
  function readConsent() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      return v === "accepted" || v === "declined" ? v : null;
    } catch (e) { return null; }
  }
  var consent = readConsent();
  // plus.js holds back IP lookups and ?via naming until this says yes.
  window.__saribConsentMode = true;
  window.__saribConsentGranted = consent === "accepted";

  /* PostHog's loader stub, verbatim from posthog-snippet.html. */
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

  /* Everything that can show a picture or a file name, blocked from replay
     entirely (not just masked): the queue rows, the comparison frame and the
     output-name box. Anything marked ph-no-capture is blocked too. */
  var CONTENT = "#queue-list, #frame, #out-name, .ph-no-capture";

  window.posthog.init("phc_sui4roRPYQyGvFR8m3zYSxaX4DLDfjs8YeTuyJKZydkP", {
    api_host: "https://e.syedsarib.com",       // our managed proxy
    ui_host: "https://eu.posthog.com",
    defaults: "2026-08-30",
    cross_subdomain_cookie: true,               // once accepted, one visitor across *.syedsarib.com
    enable_heatmaps: true,
    capture_performance: { web_vitals: true },
    mask_all_text: true,                        // autocapture: no element text
    mask_all_element_attributes: true,          // autocapture: no attributes
    enable_recording_console_log: false,
    persistence: consent === "accepted" ? FULL.persistence : COOKIELESS.persistence,
    person_profiles: consent === "accepted" ? FULL.person_profiles : COOKIELESS.person_profiles,
    disable_session_recording: consent !== "accepted",
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
      blockSelector: CONTENT
    },
    loaded: function (ph) {
      ph.register({ site: "pocketsize" });
      /* Personal links (?via=<name>) are handled by the add-on below, which
         names each browser on its own (analytics TRACKING.md). This page must
         not handle ?via itself: identifying as "via:<name>" merged everyone
         who opened one link into one person. */
      // Add-on (analytics TRACKING.md): device, network, human and time-on-page signals, from one shared file.
      try {
        window.posthog = ph;
        var s = document.createElement("script");
        // The frozen copy with Subresource Integrity (analytics TRACKING.md): a tampered file does not run.
        s.src = "https://analytics.syedsarib.com/t/plus.v1.js";
        s.integrity = "sha384-1s2AAFu4eJGpYiqxssEydytEhNuvWm4Oo+tOZ/7tmk2OBvmgxSH1z/qLGEwSPe0g";
        s.crossOrigin = "anonymous";
        s.async = true;
        document.head.appendChild(s);
      } catch (e) {}
    }
  });

  /* Saves the choice and switches the running PostHog over without a reload.
     Withdrawing a yes also drops the stored id, so later events cannot be tied
     back to the old cookie. */
  function saveConsent(choice) {
    var wasAccepted = consent === "accepted";
    consent = choice;
    try { localStorage.setItem(STORAGE_KEY, choice); } catch (e) {}
    try {
      var ph = window.posthog;
      if (choice === "declined" && wasAccepted) { ph.stopSessionRecording(); ph.reset(); }
      ph.set_config(choice === "accepted" ? FULL : COOKIELESS);
      ph.register({ site: "pocketsize" });
    } catch (e) {}
    // Tells the add-on: on a yes it names a pending ?via link and sends the full profile.
    window.__saribConsentGranted = choice === "accepted";
    window.dispatchEvent(new Event("saribconsent"));
  }

  function button(label, kind, onClick, large) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "s-btn s-btn--" + kind + (large ? "" : " s-btn--sm");
    var l = document.createElement("span");
    l.className = "s-btn__label";
    l.textContent = label;
    b.append(l);
    b.addEventListener("click", onClick);
    return b;
  }

  var bar = null;
  function closeBar() {
    var card = bar;
    if (!card) return;
    bar = null;
    card.dataset.closing = "";                  // the system's exit: fade, then go
    setTimeout(function () { card.parentNode && card.parentNode.remove(); }, 160);
  }
  function showBar(focus) {
    if (bar) return;
    var region = document.createElement("div");
    region.className = "s-toasts";
    var card = document.createElement("div");
    card.className = "s-toast";
    card.setAttribute("role", "region");
    card.setAttribute("aria-label", "Cookie choices");
    var text = document.createElement("span");
    text.className = "s-toast__text";
    text.textContent = "Can I use cookies and session replays to learn how people use this site?";
    var accept = button("Accept", "primary", function () { saveConsent("accepted"); closeBar(); });
    card.append(text, button("No thanks", "ghost", function () { saveConsent("declined"); closeBar(); }), accept);
    region.append(card);
    document.body.append(region);
    bar = card;
    if (focus) accept.focus();
  }

  /* The way back: a link at the end of the page's text, so a choice is never final. */
  function addCookieChoicesLink() {
    var host = document.querySelector("#about .about-inner") || document.querySelector("main section:last-of-type");
    if (!host) return;
    var p = document.createElement("p");
    p.append(button("Cookie choices", "link-neutral", function () { showBar(true); }, true));
    host.append(p);
  }

  function start() {
    addCookieChoicesLink();
    if (consent === null) showBar(false);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  /* The app's one door to analytics. Callers pass counts and labels only;
     anything that is not a number, a boolean, a short label or a list of short
     labels is dropped here as a last line of defence. */
  var LABEL = /^[a-z0-9_.+\/-]{0,40}$/i;
  window.pocketsizeTrack = function (event, props) {
    var clean = {};
    for (var k in props) {
      var v = props[k];
      if (typeof v === "number" || typeof v === "boolean") clean[k] = v;
      else if (typeof v === "string" && LABEL.test(v)) clean[k] = v;
      else if (Array.isArray(v)) clean[k] = v.filter(function (x) { return typeof x === "string" && LABEL.test(x); });
    }
    window.posthog.capture(event, clean);
  };

  /* Links that leave the site: where to (host and path of OUR links - GitHub
     and the like), never anything about the visitor's files. */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a || a.protocol.indexOf("http") !== 0 || a.host === location.host) return;
    window.posthog.capture("outbound_clicked", { host: a.host, path: a.pathname.slice(0, 80) });
  }, true);
})();
