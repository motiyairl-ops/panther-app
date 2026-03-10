// ===================== CHAT VIEWER =====================

function enableChatBodyMobileScroll() {
  const chatBodyEl = document.getElementById("chatBody");
  if (!chatBodyEl) return;

  chatBodyEl.style.overflowY = "auto";
  chatBodyEl.style.webkitOverflowScrolling = "touch";
  chatBodyEl.style.overscrollBehavior = "contain";
  chatBodyEl.style.touchAction = "pan-y";

  if (!chatBodyEl.dataset.touchBound) {
    ["touchstart", "touchmove", "wheel"].forEach((evt) => {
      chatBodyEl.addEventListener(
        evt,
        (e) => {
          e.stopPropagation();
        },
        { passive: true },
      );
    });
    chatBodyEl.dataset.touchBound = "1";
  }
}

// Long press for mobile chat open
let longPressTimer = null;
function handleCallTouchStart(event, callIndex) {
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    openChatViewer(callIndex);
  }, 500);
}
function handleCallTouchEnd() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}
function handleCallClick(event, callIndex) {
  // Desktop double-click only — handled by ondblclick
  // Mobile uses long press via touch events
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatChatBody(text) {
  return escapeHtml(text)
    .replace(/\*(.*?)\*/g, "<strong>$1</strong>")
    .replace(/התמונה הושמטה/g, "📷")
    .replace(/המדיה לא נכללה/g, "📷")
    .replace(/הודעה זו נמחקה/g, "🗑️ נמחק")
    .replace(
      /&lt;ההודעה נערכה&gt;/g,
      '<span style="color:#999;font-size:10px;"> ✏️</span>',
    )
    .trim();
}

function parseWhatsAppMessages(text) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const iosRe =
    /^\[(\d{1,2})\.(\d{1,2})\.(\d{4}), (\d{1,2}):(\d{2}):(\d{2})\] ([^:]+): ([\s\S]*)/;
  const andReSlash =
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})\s*[-–]\s*([^:]+):\s*([\s\S]*)/;
  const andReDots =
    /^(\d{1,2})\.(\d{1,2})\.(\d{2,4}),\s*(\d{1,2}):(\d{2})\s*[-–]\s*([^:]+):\s*([\s\S]*)/;

  const systemReIOS =
    /^\[(\d{1,2})\.(\d{1,2})\.(\d{4}), (\d{1,2}):(\d{2}):(\d{2})\]\s*([\s\S]*)/;
  const systemReAndSlash =
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})\s*[-–]\s*([\s\S]*)/;
  const systemReAndDots =
    /^(\d{1,2})\.(\d{1,2})\.(\d{2,4}),\s*(\d{1,2}):(\d{2})\s*[-–]\s*([\s\S]*)/;

  const msgs = [];
  let cur = null;

  const pushCur = () => {
    if (!cur) return;
    cur.body = String(cur.body || "").trim();
    cur.sender = String(cur.sender || "").trim();
    cur.systemText = String(cur.systemText || "").trim();
    msgs.push(cur);
    cur = null;
  };

  for (const rawLine of lines) {
    const line = rawLine || "";

    let m = iosRe.exec(line);
    let isAndroid = false;
    if (!m) {
      m = andReSlash.exec(line);
      isAndroid = !!m;
    }
    if (!m) {
      m = andReDots.exec(line);
      isAndroid = !!m;
    }

    if (m) {
      pushCur();
      let y = parseInt(m[3], 10);
      if (isAndroid && y < 100) y += 2000;
      cur = {
        type: "message",
        dateStr: `${m[1].padStart(2, "0")}.${m[2].padStart(2, "0")}.${String(y)}`,
        timeStr: `${m[4].padStart(2, "0")}:${m[5]}`,
        sender: m[6].replace(/^~ /, "").trim(),
        body: m[7].trim(),
        systemText: "",
      };
      continue;
    }

    let sys = systemReIOS.exec(line);
    isAndroid = false;
    if (!sys) {
      sys = systemReAndSlash.exec(line);
      isAndroid = !!sys;
    }
    if (!sys) {
      sys = systemReAndDots.exec(line);
      isAndroid = !!sys;
    }

    if (sys) {
      pushCur();
      let y = parseInt(sys[3], 10);
      if (isAndroid && y < 100) y += 2000;
      cur = {
        type: "system",
        dateStr: `${sys[1].padStart(2, "0")}.${sys[2].padStart(2, "0")}.${String(y)}`,
        timeStr: `${sys[4].padStart(2, "0")}:${sys[5]}`,
        sender: "",
        body: "",
        systemText: sys[6].trim(),
      };
      continue;
    }

    if (cur) {
      if (cur.type === "system") cur.systemText += "\n" + line;
      else cur.body += "\n" + line;
    }
  }

  pushCur();
  return msgs;
}

function normalizeSystemText(msg) {
  if (!msg) return "";
  const raw = String(msg.systemText || msg.body || "").trim();
  if (!raw) return "";

  let text = raw
    .replace(/^~\s*/, "")
    .replace(/^\u200f|\u200e/g, "")
    .replace(/\*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  text = text.replace(/\bיצא\/ה\b/g, "יצא");
  text = text.replace(/\bהצטרף\/ה\b/g, "הצטרף");
  text = text.replace(/\bעזב\/ה\b/g, "עזב");
  text = text.replace(/\bהוסר\/ה\b/g, "הוסר");
  text = text.replace(/\bהוסרו\/ה\b/g, "הוסרו");

  return text;
}

function isSystemMessage(msg) {
  if (!msg) return false;
  if (msg.type === "system") return true;

  const sender = String(msg.sender || "").trim();
  const body = String(msg.body || "").trim();

  if (!sender && body) return true;
  if (/^~\s*/.test(body)) return true;
  if (/^[\u202a\u202c+0-9\s-]{7,}$/.test(sender)) return true;

  const systemSenderRe =
    /הסיר\/?ה את|הצטרף|הצטרפה|עזב|עזבה|צירף\/?ה את|שינה\/?תה את|שינה את|שינתה את|added|removed|left|joined/i;
  const systemBodyRe =
    /^[\u200f\u200e~\s]*[^\s:]{2,}[\s\u200f\u200e]*(יצא\/?ה|הצטרף\/?ה|עזב\/?ה|יצא$|יצאה$|הצטרף$|הצטרפה$|עזב$|עזבה$)/i;

  return systemSenderRe.test(sender) || systemBodyRe.test(body);
}

function findCallMessageIndex(msgs, call) {
  if (!Array.isArray(msgs) || !call) return 0;
  const [callH, callM] = String(call.time || "00:00")
    .split(":")
    .map(Number);
  const callMins = (callH || 0) * 60 + (callM || 0);

  let idx = msgs.findIndex((m) => {
    if (m.dateStr !== call.date || m.type === "system") return false;
    const [mh, mm] = String(m.timeStr || "00:00")
      .split(":")
      .map(Number);
    return Math.abs((mh || 0) * 60 + (mm || 0) - callMins) <= 2;
  });

  if (idx >= 0) return idx;

  idx = msgs.findIndex((m) => m.dateStr === call.date && m.type !== "system");
  return idx >= 0 ? idx : 0;
}

function renderChatMessages(msgs, call) {
  document.getElementById("chatModalTitle").textContent = `📍 ${call.location}`;
  document.getElementById("chatModalSub").textContent =
    `${call.date} · ${call.time} · מרחב ${call.region}`;

  const callMsgIdx = findCallMessageIndex(msgs, call);
  const CALL_MSG_RE = /^\*מוקד\s*(ארצי|מרחב|צפון|אצרצי)/i;

  let html = "";
  let lastDate = "";

  msgs.forEach((msg, idx) => {
    if (msg.dateStr !== lastDate) {
      lastDate = msg.dateStr;
      html += `<div style="text-align:center;margin:10px 0;"><span style="background:rgba(0,0,0,0.12);color:#555;font-size:11px;padding:3px 10px;border-radius:10px;">${escapeHtml(msg.dateStr)}</span></div>`;
    }

    if (isSystemMessage(msg)) {
      const sysText = normalizeSystemText(msg);
      if (sysText) {
        html += `<div id="chatmsg-${idx}" style="text-align:center;margin:10px 0;"><span style="background:#e9edf3;color:#555;font-size:12px;padding:5px 14px;border-radius:999px;display:inline-block;">${escapeHtml(sysText)}</span></div>`;
      }
      return;
    }

    const bodyText = String(msg.body || "").trim();
    const isCallMsg = idx === callMsgIdx;
    const isBlueMsg = CALL_MSG_RE.test(bodyText);
    const cleanBody = formatChatBody(bodyText);
    const senderClean = escapeHtml(cleanName(msg.sender));

    const bubbleStyle = isBlueMsg
      ? "background:#dbeeff;border-radius:10px 0 10px 10px;margin-right:auto;margin-left:20px;border-right:3px solid #1a73e8;"
      : "background:white;border-radius:0 10px 10px 10px;margin-right:20px;margin-left:auto;";
    const align = isBlueMsg
      ? "align-items:flex-start;"
      : "align-items:flex-end;";
    const senderColor = isBlueMsg ? "#1a73e8" : "var(--orange)";
    const senderPrefix = isCallMsg ? "📞 קריאה – " : "";

    html += `<div id="chatmsg-${idx}" style="display:flex;flex-direction:column;margin-bottom:8px;${align}">
      <div style="max-width:82%;padding:8px 12px;${bubbleStyle}box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <div style="font-size:11px;font-weight:700;color:${senderColor};margin-bottom:3px;">${senderPrefix}${senderClean}</div>
        <div style="font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">${cleanBody}</div>
        <div style="font-size:10px;color:#999;text-align:left;margin-top:3px;">${escapeHtml(msg.timeStr)}</div>
      </div>
    </div>`;
  });

  document.getElementById("chatBody").innerHTML =
    html ||
    '<div style="color:var(--text-muted);text-align:center;padding:20px;">אין הודעות</div>';
  enableChatBodyMobileScroll();
  document.getElementById("chatOverlay").classList.add("open");

  setTimeout(() => {
    const target = document.getElementById(`chatmsg-${callMsgIdx}`);
    const chatBodyEl = document.getElementById("chatBody");
    if (target && chatBodyEl) {
      const targetTop = Math.max(0, target.offsetTop - 120);
      chatBodyEl.scrollTop = targetTop;
      target.style.outline = "2px solid var(--orange)";
      target.style.borderRadius = "6px";
      setTimeout(() => {
        target.style.outline = "";
      }, 2500);
    }
  }, 80);
}

function renderChatFromContext(c) {
  const msgs = parseWhatsAppMessages(c?.rawContext || "");
  renderChatMessages(msgs, c);
}

function openChatViewer(callIndex) {
  const c = parsedData.calls[callIndex];
  console.log(
    "[openChatViewer] call:",
    c?.date,
    c?.time,
    "rawContext len:",
    c?.rawContext?.length,
    "rawText len:",
    rawText?.length,
  );

  if (!c) {
    alert("לא נמצאה קריאה");
    return;
  }

  const sourceText = rawText || c?.rawContext || "";
  if (!sourceText) {
    alert("לא נמצא קובץ שיחה");
    return;
  }

  const msgs = parseWhatsAppMessages(sourceText);
  renderChatMessages(msgs, c);
}

function closeChatModal(e) {
  if (e && e.target !== document.getElementById("chatOverlay")) return;
  document.getElementById("chatOverlay").classList.remove("open");
  onModalClose();
}

// iOS Safari scroll — handled via CSS (overscroll-behavior:contain + touch-action:pan-y)
