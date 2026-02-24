(function() {
    // ==========================================
    // ADMIN CONFIGURATION
    // ==========================================
    // Update this array with the emails of users who paid/are allowed.
    const ALLOWED_EMAILS = [
        "user1@example.com",
        "admin@example.com",
        "test@gmail.com"
    ];

    // ==========================================
    // UI CREATION
    // ==========================================
    if (document.getElementById("wardyati-sniper-ui")) return; // Prevent duplicates

    const ui = document.createElement("div");
    ui.id = "wardyati-sniper-ui";
    ui.style.cssText = "position:fixed; bottom:20px; right:20px; width:320px; background:#1e1e1e; color:#fff; padding:15px; border-radius:10px; z-index:999999; font-family:sans-serif; box-shadow: 0 4px 15px rgba(0,0,0,0.5); border: 2px solid #4CAF50;";
    
    ui.innerHTML = `
        <h3 style="margin-top:0; color:#4CAF50; text-align:center;">🎯 Sniper Bot</h3>
        <label style="font-size:12px;">Your Email:</label>
        <input type="email" id="sn-email" style="width:100%; margin-bottom:10px; padding:5px; border-radius:5px; border:none;" placeholder="Enter to verify auth...">
        
        <label style="font-size:12px;">Room ID:</label>
        <input type="text" id="sn-room" style="width:100%; margin-bottom:10px; padding:5px; border-radius:5px; border:none;">
        
        <label style="font-size:12px;">Shift ID:</label>
        <input type="text" id="sn-shift" style="width:100%; margin-bottom:10px; padding:5px; border-radius:5px; border:none;">
        
        <button id="sn-start" style="width:100%; background:#4CAF50; color:white; border:none; padding:10px; border-radius:5px; cursor:pointer; font-weight:bold; margin-bottom:5px;">START SNIPING</button>
        <button id="sn-stop" style="width:100%; background:#f44336; color:white; border:none; padding:10px; border-radius:5px; cursor:pointer; font-weight:bold; display:none;">STOP</button>
        
        <div id="sn-log" style="margin-top:10px; font-size:11px; color:#aaa; max-height:100px; overflow-y:auto; background:#000; padding:5px; border-radius:5px;">System ready...</div>
    `;
    document.body.appendChild(ui);

    // ==========================================
    // LOGIC & LOOP
    // ==========================================
    let sniperInterval = null;

    const log = (msg) => {
        const logDiv = document.getElementById("sn-log");
        logDiv.innerHTML = `<div>> ${msg}</div>` + logDiv.innerHTML;
    };

    const getCsrfToken = () => {
        const match = document.cookie.match(/csrftoken=([^;]+)/);
        return match ? match[1] : null;
    };

    document.getElementById("sn-start").onclick = () => {
        const email = document.getElementById("sn-email").value.trim().toLowerCase();
        const roomId = document.getElementById("sn-room").value.trim();
        const shiftId = document.getElementById("sn-shift").value.trim();
        const csrf = getCsrfToken();

        if (!ALLOWED_EMAILS.includes(email)) {
            return log("<span style='color:red;'>❌ UNAUTHORIZED. Contact Admin.</span>");
        }
        if (!roomId || !shiftId) {
            return log("<span style='color:orange;'>⚠️ Missing Room or Shift ID.</span>");
        }
        if (!csrf) {
            return log("<span style='color:red;'>❌ No CSRF token. Are you logged in?</span>");
        }

        document.getElementById("sn-start").style.display = "none";
        document.getElementById("sn-stop").style.display = "block";
        log(`▶️ Sniping Room: ${roomId}, Shift: ${shiftId}`);

        let attempts = 0;
        sniperInterval = setInterval(() => {
            attempts++;
            fetch(`/rooms/${roomId}/shift-instances/${shiftId}/action/hold/`, {
                method: 'POST',
                headers: {
                    'X-CSRFToken': csrf,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Origin': 'https://wardyati.com',
                    'Referer': `https://wardyati.com/rooms/${roomId}/arena/`
                }
            })
            .then(res => {
                if (res.status === 200 || res.status === 201) {
                    log(`<span style='color:#4CAF50;'>[${attempts}] ✅ SUCCESS! Shift Reserved!</span>`);
                    document.getElementById("sn-stop").click(); // Auto-stop on success
                } else if (res.status === 403) {
                    log(`<span style='color:red;'>[${attempts}] ⚠️ 403 Forbidden. CSRF expired?</span>`);
                } else {
                    log(`[${attempts}] 🔄 Status ${res.status}. Retrying...`);
                }
            })
            .catch(err => log(`<span style='color:red;'>[${attempts}] ❌ Network Error.</span>`));
        }, 1500); // Hits the server every 1.5 seconds
    };

    document.getElementById("sn-stop").onclick = () => {
        clearInterval(sniperInterval);
        document.getElementById("sn-start").style.display = "block";
        document.getElementById("sn-stop").style.display = "none";
        log("🛑 Sniper stopped.");
    };
})();
