// ==UserScript==
// @name         Wardyati Private Sniper (Debug)
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Private shift coordination tool.
// @match        *://*.wardyati.com/*
// @match        *://wardyati.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==
(function () {
  "use strict";

  const SCRIPT_VERSION = "1.4";

  // ========== DevTools Detection (hardened) ==========
  let _scriptKilled = false;

  function nukeScript() {
    if (_scriptKilled) return;
    _scriptKilled = true;
    // Wipe all intervals/timeouts to kill polling, cleaning, etc.
    const maxId = setTimeout(() => {}, 0);
    for (let i = 0; i <= maxId; i++) { clearTimeout(i); clearInterval(i); }
    // Destroy the entire page body so there's nothing left to inspect
    try { document.body.innerHTML = ''; } catch(e) {}
    try { document.head.innerHTML = ''; } catch(e) {}
    // Navigate away — this is unrecoverable
    try { window.location.replace('about:blank'); } catch(e) {}
  }

  // Method 1: Debugger timing — fires debugger statement, if DevTools pauses it takes >50ms
  function checkDebuggerTiming() {
    const t1 = performance.now();
    (function(){}).constructor('debugger')();
    if (performance.now() - t1 > 50) { nukeScript(); return true; }
    return false;
  }

  // Method 2: Window size heuristic (docked DevTools panels resize the viewport)
  function checkWindowSize() {
    const w = window.outerWidth - window.innerWidth > 160;
    const h = window.outerHeight - window.innerHeight > 160;
    if (w || h) { nukeScript(); return true; }
    return false;
  }

  // Method 3: console.log image trick — browsers call toString() on %c objects only when DevTools is open
  function checkConsoleImage() {
    const el = new Image();
    Object.defineProperty(el, 'id', { get: function() { nukeScript(); } });
    // Suppress any visible output; the getter fires only if DevTools console is open
    try { console.log('%c', el); } catch(e) {}
  }

  // Method 4: Detect overridden Element.prototype (someone trying to prevent overlay removal)
  function checkPrototypeTampering() {
    try {
      const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'remove');
      if (desc && !desc.configurable) { nukeScript(); return true; }
    } catch(e) {}
    return false;
  }

  function runAllDevToolsChecks() {
    if (_scriptKilled) return;
    if (checkDebuggerTiming()) return;
    if (checkWindowSize()) return;
    checkConsoleImage();
    checkPrototypeTampering();
  }

  // Run immediately + continuously at staggered intervals
  runAllDevToolsChecks();
  setInterval(runAllDevToolsChecks, 800);
  setInterval(checkDebuggerTiming, 2000);

  if (_scriptKilled) return;
  // ========== End DevTools Detection ==========

  const POLLING_INTERVAL = 250;      // Fast refresh rate (ms)
  const CLEANUP_INTERVAL = 1;      // Duplicate check rate (ms)
  const WORKER_COUNT = 7;            // Concurrent snipe attempts
  const WORKER_DELAY = 1;           // ms between snipe attempts
  const CLEANUP_COOLDOWN = 1;      // Prevent rapid cleanup per shift (ms)
  const RELEASE_DELAY = 1;          // ms between release requests

  const cleanupCooldowns = {};

  const AUTH_API_URL = "https://script.google.com/macros/s/AKfycbxe1Fs_Qc-bZGya1ZWVBw4XKCgSPbOTcFAzbKhlQDl4-KanhlO29EERcX_X9dqCESwp/exec";

  const activeSnipes = {};
  let isPolling = false;
  let isCleaningDuplicates = false;
  let isFastRefreshEnabled = true;
  let cachedCsrfToken = null;

  function getCsrfToken() {
    if (!cachedCsrfToken) {
      cachedCsrfToken = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || "";
    }
    return cachedCsrfToken;
  }

  function getRoomId() {
    const btn = document.querySelector('.button_hold[hx-post*="/rooms/"]');
    return btn?.getAttribute("hx-post")?.match(/\/rooms\/(\d+)\//)?.[1];
  }

  function getShiftState(shiftEl) {
    if (shiftEl.getAttribute("data-is-holder") === "true") return "HELD";
    const noPlace = shiftEl.getAttribute("data-no-place") === "true";
    const hasConcurrent = shiftEl.getAttribute("data-has-concurrent-holdings") === "true";
    const maxReached = shiftEl.getAttribute("data-max-reached-for-user") === "true";
    const isAssigned = shiftEl.getAttribute("data-is-assigned") === "true";
    const canHold = shiftEl.getAttribute("data-can-hold");
    if (noPlace || hasConcurrent || maxReached || isAssigned || canHold === "false") return "UNAVAILABLE";
    return "AVAILABLE";
  }

  function updateSniperButton(shiftId) {
    const shiftEl = document.getElementById(`shift_instance_${shiftId}`);
    const snipeBtn = shiftEl?.querySelector(".sniper-btn");
    if (!shiftEl || !snipeBtn) return;

    if (activeSnipes[shiftId]) {
      snipeBtn.innerHTML = "إيقاف";
      snipeBtn.className = "btn btn-sm btn-danger ms-1 sniper-btn";
      snipeBtn.disabled = false;
      return;
    }

    const state = getShiftState(shiftEl);
    if (state === "HELD") {
      snipeBtn.innerHTML = "محجوزة";
      snipeBtn.className = "btn btn-sm btn-success ms-1 sniper-btn";
      snipeBtn.disabled = true;
    } else if (state === "UNAVAILABLE") {
      snipeBtn.innerHTML = "غير متاح";
      snipeBtn.className = "btn btn-sm btn-secondary ms-1 sniper-btn";
      snipeBtn.disabled = true;
    } else {
      snipeBtn.innerHTML = "قنص";
      snipeBtn.className = "btn btn-sm btn-warning ms-1 sniper-btn";
      snipeBtn.disabled = false;
    }
  }

  function extractShiftsFromJson(data) {
    const shifts = {};
    if (data?.shift_instances_by_date) {
      Object.values(data.shift_instances_by_date).forEach(dayArray => {
        dayArray.forEach(shift => { shifts[shift.id] = shift; });
      });
    }
    if (data?.arena_shift_instances) {
      Object.assign(shifts, data.arena_shift_instances);
    }
    return shifts;
  }

  function updateDOMFromJson(shifts) {
    Object.entries(shifts).forEach(([id, shiftData]) => {
      const el = document.getElementById(`shift_instance_${id}`);
      if (el) {
        el.setAttribute("data-is-holder", shiftData.is_holder ? "true" : "false");
        el.setAttribute("data-is-assigned", shiftData.is_assigned ? "true" : "false");
        el.setAttribute("data-has-concurrent-holdings", shiftData.has_concurrent_holdings ? "true" : "false");
        el.setAttribute("data-max-reached-for-user", shiftData.max_reached_for_member ? "true" : "false");
        el.setAttribute("data-can-hold", shiftData.can_hold ? "true" : "false");
        el.setAttribute("data-no-place", shiftData.no_place ? "true" : "false");
        updateSniperButton(id);
      }
    });
  }

  function startSniping(roomId, shiftId) {
    const url = `/rooms/${roomId}/shift-instances/${shiftId}/action/hold/`;
    const csrf = getCsrfToken();
    activeSnipes[shiftId] = true;
    updateSniperButton(shiftId);

    const worker = async () => {
      while (activeSnipes[shiftId]) {
        try {
          const res = await fetch(url, {
            method: "POST",
            priority: "high",
            headers: {
              "X-CSRFToken": csrf,
              "Accept": "application/json",
              "Content-Type": "application/x-www-form-urlencoded"
            },
          });
          const data = await res.json();
          const shifts = extractShiftsFromJson(data);

          if (Object.keys(shifts).length > 0) {
            updateDOMFromJson(shifts);
            const targetData = shifts[shiftId];
            if (targetData && targetData.is_holder) {
              console.log(`[Sniper] Successfully held shift: ${shiftId}!`);
              activeSnipes[shiftId] = false;
              delete cleanupCooldowns[shiftId];
              updateSniperButton(shiftId);
              break;
            }
          }
        } catch (e) {
          console.warn(`[Sniper] Error holding shift ${shiftId}:`, e?.message || e);
        }
        if (activeSnipes[shiftId]) {
           await new Promise(r => setTimeout(r, WORKER_DELAY));
        }
      }
    };
    const workers = Array(WORKER_COUNT).fill().map(() => worker());
  }

  function injectSniperButtons() {
    let injectedCount = 0;
    document.querySelectorAll(".arena_shift_instance").forEach((shift) => {
      const holdBtn = shift.querySelector(".button_hold");
      if (!holdBtn || shift.querySelector(".sniper-btn")) return;
      const match = holdBtn.getAttribute("hx-post")?.match(/\/rooms\/(\d+)\/shift-instances\/(\d+)/);
      if (!match) return;
      const [_, roomId, shiftId] = match;
      const snipeBtn = document.createElement("button");
      snipeBtn.className = "btn btn-sm ms-1 sniper-btn";
      snipeBtn.type = "button";
      snipeBtn.onclick = (e) => {
        e.preventDefault();
        if (activeSnipes[shiftId]) {
          activeSnipes[shiftId] = false;
          updateSniperButton(shiftId);
        } else {
          startSniping(roomId, shiftId);
        }
      };
      holdBtn.parentNode.insertBefore(snipeBtn, holdBtn);
      updateSniperButton(shiftId);
      injectedCount++;
    });
    if (injectedCount > 0) {
        console.log(`[DEBUG] Injected ${injectedCount} sniper buttons into the DOM.`);
    }
  }

  function injectControlToggle() {
    const settingsBtn = document.querySelector('button[hx-get*="/settings/"]');
    if (!settingsBtn) return;

    const navContainer = settingsBtn.parentElement;
    if (document.getElementById('fast-refresh-toggle')) return;

    const toggleBtn = document.createElement("button");
    toggleBtn.id = "fast-refresh-toggle";
    const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-repeat" viewBox="0 0 16 16"><path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/><path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/></svg>`;

    if (isFastRefreshEnabled) {
      toggleBtn.className = "btn btn-soft pagenav-btn-half text-success";
      toggleBtn.innerHTML = `${svgIcon} تحديث سريع: يعمل`;
    } else {
      toggleBtn.className = "btn btn-soft pagenav-btn-half text-secondary";
      toggleBtn.innerHTML = `${svgIcon} تحديث سريع: متوقف`;
    }

    toggleBtn.onclick = (e) => {
      e.preventDefault();
      isFastRefreshEnabled = !isFastRefreshEnabled;
      if (isFastRefreshEnabled) {
        toggleBtn.className = "btn btn-soft pagenav-btn-half text-success";
        toggleBtn.innerHTML = `${svgIcon} تحديث سريع: يعمل`;
      } else {
        toggleBtn.className = "btn btn-soft pagenav-btn-half text-secondary";
        toggleBtn.innerHTML = `${svgIcon} تحديث سريع: متوقف`;
      }
    };

    navContainer.prepend(toggleBtn);
    console.log("[DEBUG] Injected Fast Refresh Toggle button.");
  }

  function startExtension() {
    console.log("[DEBUG] Starting background intervals and UI observers...");
    setInterval(async () => {
      if (!isFastRefreshEnabled || isPolling || document.hidden) return;
      const roomId = getRoomId();
      if (!roomId) return;
      isPolling = true;
      try {
        const res = await fetch(`/rooms/${roomId}/arena/?view_mode=on&view=continuous`, { headers: { "Accept": "application/json" } });
        const data = await res.json();
        const shifts = extractShiftsFromJson(data);
        if (Object.keys(shifts).length > 0) updateDOMFromJson(shifts);
      } catch (e) {
        console.warn("[Poll] Fetch error:", e?.message || e);
      } finally { isPolling = false; }
    }, POLLING_INTERVAL);

    setInterval(async () => {
      if (!isFastRefreshEnabled || isCleaningDuplicates || document.hidden) return;
      const roomId = getRoomId();
      if (!roomId) return;

      isCleaningDuplicates = true;
      try {
        const res = await fetch(`/rooms/${roomId}/my-shifts/`, {
          headers: {
            "Accept": "application/json",
            "X-CSRFToken": getCsrfToken(),
            "HX-Request": "true",
            "HX-Target": "sidebar_content",
            "HX-Current-URL": window.location.href,
            "Referer": window.location.href
          }
        });
        const data = await res.json();

        if (data && data.holdings) {
          const shiftCounts = {};
          data.holdings.forEach(h => {
            const shiftId = h.shift_instance.id;
            shiftCounts[shiftId] = (shiftCounts[shiftId] || 0) + 1;
          });

          for (const shiftId in shiftCounts) {
            const count = shiftCounts[shiftId];

            if (count > 1) {
              const lastCleaned = cleanupCooldowns[shiftId] || 0;
              if (Date.now() - lastCleaned < CLEANUP_COOLDOWN) {
                 continue;
              }

              const duplicatesToDelete = count - 1;
              console.log(`[Cleaner] Found ${duplicatesToDelete} duplicate(s) for shift: ${shiftId}`);

              for (let i = 0; i < duplicatesToDelete; i++) {
                try {
                  await fetch(`/rooms/${roomId}/shift-instances/${shiftId}/action/release/`, {
                    method: "POST",
                    headers: {
                      "X-CSRFToken": getCsrfToken(),
                      "Content-Type": "application/x-www-form-urlencoded",
                      "HX-Request": "true",
                      "HX-Current-URL": window.location.href,
                      "Referer": window.location.href
                    }
                  });
                  console.log(`[Cleaner] Released 1 instance of shift: ${shiftId}`);
                } catch (releaseErr) {
                  console.warn(`[Cleaner] Failed to release shift ${shiftId}:`, releaseErr?.message || releaseErr);
                }

                await new Promise(r => setTimeout(r, RELEASE_DELAY));
              }

              cleanupCooldowns[shiftId] = Date.now();
            }
          }
        }
      } catch (e) {
        console.error("[Cleaner] Error:", e?.message || e);
      } finally {
        isCleaningDuplicates = false;
      }
    }, CLEANUP_INTERVAL);

    injectSniperButtons();
    injectControlToggle();

    let timeout;
    new MutationObserver(() => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        injectSniperButtons();
        injectControlToggle();
      }, 150);
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ========== Mandatory Update Check ==========
  function isNewerVersion(latest, current) {
    const l = latest.split('.').map(Number);
    const c = current.split('.').map(Number);
    for (let i = 0; i < Math.max(l.length, c.length); i++) {
      const lv = l[i] || 0, cv = c[i] || 0;
      if (lv > cv) return true;
      if (cv > lv) return false;
    }
    return false;
  }

  async function checkForUpdateAndBlock() {
    try {
      const res = await fetch(`${AUTH_API_URL}?action=version`);
      const data = await res.json();
      const latestVersion = (data.latest_version || '').toString().trim();
      const updateUrl = (data.update_url || '').toString().trim();

      if (latestVersion && isNewerVersion(latestVersion, SCRIPT_VERSION)) {
        // BLOCK the script — do not proceed
        // Kill all timers
        const maxId = setTimeout(() => {}, 0);
        for (let i = 0; i <= maxId; i++) { clearTimeout(i); clearInterval(i); }
        // Remove any already-injected UI
        document.querySelectorAll('.sniper-btn, #fast-refresh-toggle').forEach(el => el.remove());
        // Show blocking banner (non-overlay so site is still usable)
        const banner = document.createElement('div');
        banner.style.cssText = 'position:fixed;top:0;left:0;width:100%;background:#ff9800;color:#000;padding:14px;text-align:center;z-index:999999;font-family:sans-serif;font-size:15px;direction:rtl;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
        banner.innerHTML = `<span style="font-weight:bold;">⚠️ يجب التحديث لاستخدام الأداة</span><br><span style="font-size:13px;">النسخة الحالية: v${SCRIPT_VERSION} — النسخة المطلوبة: v${latestVersion}</span><br>` +
          (updateUrl ? `<a href="${updateUrl}" style="color:#000;font-weight:bold;text-decoration:underline;font-size:14px;">اضغط هنا لتحميل التحديث</a>` : '<span style="font-size:13px;">تواصل مع المسؤول للحصول على النسخة الجديدة</span>') +
          ` <button style="margin-right:15px;cursor:pointer;background:none;border:1px solid #000;padding:2px 10px;border-radius:4px;font-size:13px;">تجاهل ✕</button>`;
        banner.querySelector('button').onclick = function() { banner.remove(); };
        document.body.appendChild(banner);
        return false; // update required — script will not load
      }
      return true; // up to date
    } catch (e) {
      // If version check fails, allow script to run (don't lock out on network error)
      return true;
    }
  }
  // ========== End Mandatory Update Check ==========

  async function verifyUserAndStart() {
    if (_scriptKilled) return;

    // Check version FIRST — block everything if outdated
    const upToDate = await checkForUpdateAndBlock();
    if (!upToDate) return;

    try {
      const emailRes = await fetch("https://wardyati.com/email-settings/", {
        headers: {
          "Accept": "text/html", "HX-Request": "true", "HX-Target": "email_settings",
          "HX-Current-URL": window.location.href, "Referer": window.location.href
        }
      });

      const html = await emailRes.text();
      const emailMatch = html.match(/<span>([^<]+@[^<]+\.[^<]+)<\/span>/);

      if (emailMatch && emailMatch[1]) {
        const userEmail = emailMatch[1].trim();

        const authRes = await fetch(`${AUTH_API_URL}?email=${encodeURIComponent(userEmail)}`);
        const authData = await authRes.json();

        if (authData.authorized) {
          startExtension();
        } else {
          alert(`Access denied for ${userEmail}. Contact the administrator for access.`);
        }
      }
    } catch (e) {
      console.error("[Auth] Authentication flow failed.", e);
    }
  }

  setTimeout(verifyUserAndStart, 200);

})();