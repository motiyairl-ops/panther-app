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

function normalizeExportDate(day, month, year, isAndroid) {
  let y = parseInt(year, 10);
  if (isAndroid && y < 100) y += 2000;
  return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${String(y)}`;
}

function parseWhatsAppMessagesForViewer(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n");

  const iosRe =
    /^\[(\d{1,2})\.(\d{1,2})\.(\d{4}),\s*(\d{1,2}):(\d{2})(?::\d{2})?\]\s*([^:]+):\s*([\s\S]*)/;
  const andReSlash =
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})\s*[-–]\s*([^:]+):\s*([\s\S]*)/;
  const andReDots =
    /^(\d{1,2})\.(\d{1,2})\.(\d{4}),\s*(\d{1,2}):(\d{2})\s*[-–]\s*([^:]+):\s*([\s\S]*)/;

  const iosSystemRe =
    /^\[(\d{1,2})\.(\d{1,2})\.(\d{4}),\s*(\d{1,2}):(\d{2})(?::\d{2})?\]\s*([\s\S]+)$/;
  const andSystemSlashRe =
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})\s*[-–]\s*([\s\S]+)$/;
  const andSystemDotsRe =
    /^(\d{1,2})\.(\d{1,2})\.(\d{4}),\s*(\d{1,2}):(\d{2})\s*[-–]\s*([\s\S]+)$/;

  const messages = [];
  let cur = null;

  const pushCur = () => {
    if (!cur) return;
    cur.sender = String(cur.sender || "")
      .replace(/^~\s*/, "")
      .trim();
    cur.body = String(cur.body || "").trim();
    messages.push(cur);
    cur = null;
  };

  for (const rawLine of lines) {
    const line = rawLine || "";

    let m = iosRe.exec(line);
    let isAndroid = false;
    let isSystem = false;

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
      cur = {
        dateStr: normalizeExportDate(m[1], m[2], m[3], isAndroid),
        timeStr: `${String(m[4]).padStart(2, "0")}:${m[5]}`,
        sender: m[6],
        body: m[7],
        isSystem: false,
      };
      continue;
    }

    m = iosSystemRe.exec(line);
    isAndroid = false;
    if (!m) {
      m = andSystemSlashRe.exec(line);
      isAndroid = !!m;
    }
    if (!m) {
      m = andSystemDotsRe.exec(line);
      isAndroid = !!m;
    }

    if (m) {
      pushCur();
      isSystem = true;
      cur = {
        dateStr: normalizeExportDate(m[1], m[2], m[3], isAndroid),
        timeStr: `${String(m[4]).padStart(2, "0")}:${m[5]}`,
        sender: "",
        body: m[6],
        isSystem,
      };
      continue;
    }

    if (cur) {
      cur.body += `\n${line}`;
    }
  }

  pushCur();
  return messages;
}

function isSystemMessageForViewer(msg) {
  if (!msg) return false;
  if (msg.isSystem) return true;

  const sender = String(msg.sender || "").trim();
  const body = String(msg.body || "").trim();

  const systemSenderRe =
    /הסיר\/ה את|הצטרף|הצטרפה|עזב|עזבה|צירף\/ה את|שינה\/תה את|שינה את|שינתה את|added|removed|left|joined/i;
  const systemBodyRe =
    /^(~\s*)?.{1,80}(יצא\/ה|הצטרף\/ה|עזב\/ה|יצא|יצאה|הצטרף|הצטרפה|עזב|עזבה|removed|left|joined|added)(\s|$)/i;
  const phoneOnlyRe = /^[\u202a\u202c+0-9\s-]{7,}$/;

  return (
    !sender ||
    phoneOnlyRe.test(sender) ||
    systemSenderRe.test(sender) ||
    systemBodyRe.test(body)
  );
}

function formatMessageBodyForViewer(text) {
  let html = escapeHtml(text)
    .replace(/\*(.*?)\*/g, "<strong>$1</strong>")
    .replace(/התמונה הושמטה/g, "📷")
    .replace(/המדיה לא נכללה/g, "📷")
    .replace(/הודעה זו נמחקה/g, "🗑️ נמחק")
    .replace(
      /&lt;ההודעה נערכה&gt;/g,
      '<span style="color:#999;font-size:10px;"> ✏️</span>',
    );

  return html.trim();
}

function findCallMessageIndex(messages, c) {
  const [callH, callM] = String(c.time || "00:00")
    .split(":")
    .map(Number);
  const callMins = callH * 60 + callM;
  const callDate = c.date;
  const CALL_MSG_RE = /^\*מוקד\s*(ארצי|מרחב|צפון|אצרצי)/i;

  let idx = messages.findIndex((m) => {
    if (m.dateStr !== callDate) return false;
    const [mh, mm] = String(m.timeStr || "00:00")
      .split(":")
      .map(Number);
    return (
      Math.abs(mh * 60 + mm - callMins) <= 2 &&
      CALL_MSG_RE.test(String(m.body || "").trim())
    );
  });

  if (idx >= 0) return idx;

  idx = messages.findIndex((m) => {
    if (m.dateStr !== callDate) return false;
    const [mh, mm] = String(m.timeStr || "00:00")
      .split(":")
      .map(Number);
    return Math.abs(mh * 60 + mm - callMins) <= 2;
  });

  return idx >= 0 ? idx : 0;
}

function renderChatMessages(messages, c, callMsgIdx, idPrefix) {
  document.getElementById("chatModalTitle").textContent = `📍 ${c.location}`;
  document.getElementById("chatModalSub").textContent =
    `${c.date} · ${c.time} · מרחב ${c.region}`;

  const CALL_MSG_RE = /^\*מוקד\s*(ארצי|מרחב|צפון|אצרצי)/i;
  let html = "";
  let lastDate = "";

  messages.forEach((msg, idx) => {
    if (msg.dateStr !== lastDate) {
      lastDate = msg.dateStr;
      html += `<div style="text-align:center;margin:10px 0;"><span style="background:rgba(0,0,0,0.12);color:#555;font-size:11px;padding:3px 10px;border-radius:10px;">${escapeHtml(msg.dateStr)}</span></div>`;
    }

    if (isSystemMessageForViewer(msg)) {
      const sender = String(msg.sender || "").trim();
      const body = String(msg.body || "")
        .replace(/\*/g, "")
        .trim();
      const sysText = [sender, body].filter(Boolean).join(" ").trim();
      html += `<div style="text-align:center;margin:8px 0;"><span style="background:#e9edf3;color:#555;font-size:12px;padding:4px 12px;border-radius:10px;display:inline-block;">${escapeHtml(sysText)}</span></div>`;
      return;
    }

    const isCallMsg = idx === callMsgIdx;
    const isBlueMsg = CALL_MSG_RE.test(String(msg.body || "").trim());
    const senderClean = cleanName(msg.sender || "");
    const cleanBody = formatMessageBodyForViewer(msg.body || "");

    const bubbleStyle = isBlueMsg
      ? "background:#dbeeff;border-radius:10px 0 10px 10px;margin-right:auto;margin-left:20px;border-right:3px solid #1a73e8;"
      : "background:white;border-radius:0 10px 10px 10px;margin-right:20px;margin-left:auto;";
    const align = isBlueMsg
      ? "align-items:flex-start;"
      : "align-items:flex-end;";
    const senderColor = isBlueMsg ? "#1a73e8" : "var(--orange)";
    const senderPrefix = isCallMsg ? "📞 קריאה – " : "";

    html += `<div id="${idPrefix}-${idx}" style="display:flex;flex-direction:column;margin-bottom:8px;${align}">
      <div style="max-width:82%;padding:8px 12px;${bubbleStyle}box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <div style="font-size:11px;font-weight:700;color:${senderColor};margin-bottom:3px;">${senderPrefix}${escapeHtml(senderClean)}</div>
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
    const target = document.getElementById(`${idPrefix}-${callMsgIdx}`);
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
  const msgs = parseWhatsAppMessagesForViewer(c.rawContext || "");
  const callMsgIdx = findCallMessageIndex(msgs, c);
  renderChatMessages(msgs, c, callMsgIdx, "ctxmsg");
}

async function ensureFullChatTextLoaded() {
  const currentRaw = typeof rawText === "string" ? rawText.trim() : "";
  if (currentRaw.length > 0) return currentRaw;

  if (typeof readFile === "function") {
    try {
      const driveText = await readFile("panther-chat.txt");
      if (driveText && String(driveText).trim()) {
        rawText = String(driveText);
        return rawText;
      }
    } catch (err) {
      console.warn("Failed loading full chat from Drive", err);
    }
  }

  return "";
}

async function openChatViewer(callIndex) {
  const c = parsedData.calls[callIndex];
  if (!c) return;

  let fullText = typeof rawText === "string" ? rawText.trim() : "";

  // טען מה-Drive רק אם אין בכלל rawText בזיכרון
  if (!fullText && typeof readFile === "function") {
    try {
      const driveText = await readFile("panther-chat.txt");
      if (driveText && String(driveText).trim()) {
        rawText = String(driveText);
        fullText = rawText.trim();
      }
    } catch (err) {
      console.warn("Failed loading full chat from Drive", err);
    }
  }

  console.log(
    "[openChatViewer] call:",
    c?.date,
    c?.time,
    "rawContext len:",
    c?.rawContext?.length,
    "rawText len:",
    fullText?.length,
  );

  if (!fullText) {
    renderChatFromContext(c);
    return;
  }

  const allMsgs = parseWhatsAppMessagesForViewer(fullText);
  const callMsgIdx = findCallMessageIndex(allMsgs, c);
  renderChatMessages(allMsgs, c, callMsgIdx, "chatmsg");
}

function closeChatModal(e) {
  if (e && e.target !== document.getElementById("chatOverlay")) return;
  document.getElementById("chatOverlay").classList.remove("open");
  onModalClose();
}

// iOS Safari scroll — handled via CSS (overscroll-behavior:contain + touch-action:pan-y)
