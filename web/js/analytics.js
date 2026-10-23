/* Usage analytics - visits and anonymous totals, never content.
 *
 * The rule (owner-approved 2026-10-23): count visitors and the SHAPE of a run -
 * how many pictures, how many bytes in and out, which formats, which plan, how
 * long it took. Never a file name, a path, a pixel, a thumbnail or any text a
 * person typed. Pictures never leave the device; this file is the only thing
 * on the page that talks to anything but its own address.
 *
 * Events go to PostHog through our own proxy, e.syedsarib.com, the one extra
 * origin the CSP in vercel.json allows. Config follows the shared contract in
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
    person_profiles: "always",
    cross_subdomain_cookie: true,               // one visitor across *.syedsarib.com
    enable_heatmaps: true,
    capture_performance: { web_vitals: true },
    mask_all_text: true,                        // autocapture: no element text
    mask_all_element_attributes: true,          // autocapture: no attributes
    enable_recording_console_log: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
      blockSelector: CONTENT
    },
    loaded: function (ph) {
      ph.register({ site: "pocketsize" });
      // Personal links: ?via=<name> names this visitor, then leaves the URL clean.
      try {
        var u = new URL(location.href), via = (u.searchParams.get("via") || "").trim().toLowerCase().slice(0, 60);
        if (via) {
          if (ph.get_property("$user_state") !== "identified") ph.identify("via:" + via, { name: via, via: via });
          else ph.setPersonProperties({ via: via });
          ph.capture("via_link_opened", { via: via });
          u.searchParams.delete("via");
          history.replaceState(history.state, "", u.pathname + (u.search || "") + u.hash);
        }
      } catch (e) {}
    }
  });

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
