// ===================== CHAT VIEWER =====================
// Long press for mobile chat open
let longPressTimer = null;
function handleCallTouchStart(event, callIndex) {
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    openChatViewer(callIndex);
  }, 500);
}
function handleCallTouchEnd() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
}
function handleCallClick(event, callIndex) {
  // Desktop double-click only — handled by ondblclick
  // Mobile uses long press via touch events
}


function renderChatFromContext(c) {
  document.getElementById('chatModalTitle').textContent = `📍 ${c.location}`;
  document.getElementById('chatModalSub').textContent = `${c.date} · ${c.time} · מרחב ${c.region}`;

  const lines = (c.rawContext || '').split('\n');
  const iosRe = /^\[(\d{1,2})\.(\d{1,2})\.(\d{4}), (\d{1,2}):(\d{2}):\d{2}\] ([^:]+): ([\s\S]*)/;
  const andRe = /^(\d{1,2})\.(\d{1,2})\.(\d{4}), (\d{1,2}):(\d{2})\s*[-–]\s*([^:]+): ([\s\S]*)/;

  const msgs = [];
  let cur = null;
  for (const line of lines) {
    let m = iosRe.exec(line) || andRe.exec(line);
    if (m) {
      if (cur) msgs.push(cur);
      cur = {
        dateStr: `${m[1].padStart(2,'0')}.${m[2].padStart(2,'0')}.${m[3]}`,
        timeStr: `${m[4].padStart(2,'0')}:${m[5]}`,
        sender: m[6].replace(/^~ /,'').trim(),
        body: m[7].trim()
      };
    } else if (cur) cur.body += '\n' + line;
  }
  if (cur) msgs.push(cur);

  // מצא את הודעת הקריאה לפי שעה ±2 דקות
  const [callH, callM] = c.time.split(':').map(Number);
  const callMins = callH * 60 + callM;
  const callMsgIdx = msgs.findIndex(m => {
    if (m.dateStr !== c.date) return false;
    const [mh, mm] = m.timeStr.split(':').map(Number);
    return Math.abs(mh * 60 + mm - callMins) <= 2;
  }) ?? 0;

  // קריאה מזוהה לפי פורמט ה-body בלבד
  const CALL_MSG_RE = /^\*מוקד\s*(ארצי|מרחב|צפון|אצרצי)/i;

  let html = '';
  let lastDate = '';
  msgs.forEach((msg, idx) => {
    // הפרדת תאריך
    if (msg.dateStr !== lastDate) {
      lastDate = msg.dateStr;
      html += `<div style="text-align:center;margin:10px 0;"><span style="background:rgba(0,0,0,0.12);color:#555;font-size:11px;padding:3px 10px;border-radius:10px;">${msg.dateStr}</span></div>`;
    }

    const isCallMsg = idx === callMsgIdx;
    const isBlueMsg = CALL_MSG_RE.test(msg.body.trim());

    // זיהוי הודעות מערכת — הסרה/הצטרפות/עזיבה
    // הודעות מערכת בווטסאפ: sender ריק, מספר טלפון בלבד, או sender מכיל מילות מערכת
    const systemRe = /הסיר\/ה את|הצטרף|הצטרפה|עזב|עזבה|צירף\/ה את|שינה\/תה את|שינה את|שינתה את|added|removed|left|joined/i;
    const systemBodyRe = /^[\u200f\u200e~\s]*[^\s:]{2,}[\s\u200f\u200e]*(יצא\/ה|הצטרף\/ה|עזב\/ה|יצא$|יצאה$|הצטרף$|הצטרפה$|עזב$|עזבה$)/i;
    const isPhoneOnly = /^[\u202a\u202c+0-9\s-]{7,}$/.test(msg.sender.trim());
    const isSystemMsg = !msg.sender || isPhoneOnly || systemRe.test(msg.sender) || systemBodyRe.test(msg.body);

    if (isSystemMsg || isPhoneOnly) {
      const sysText = isPhoneOnly ? msg.body : (msg.sender + ': ' + msg.body);
      html += `<div style="text-align:center;margin:6px 0;"><span style="background:rgba(0,0,0,0.08);color:#666;font-size:11px;padding:2px 10px;border-radius:8px;">${sysText.replace(/\*/g,'')}</span></div>`;
      return;
    }

    // המר *טקסט* → bold, נקה תמונות/מחיקות
    const formatBody = (text) => text
      .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
      .replace(/התמונה הושמטה/g,'📷')
      .replace(/המדיה לא נכללה/g,'📷')
      .replace(/הודעה זו נמחקה/g,'🗑️ נמחק')
      .replace(/<ההודעה נערכה>/g,'<span style="color:#999;font-size:10px;"> ✏️</span>')
      .trim();

    const cleanBody = formatBody(msg.body);
    const senderClean = cleanName(msg.sender);

    // בועת קריאה/מוקד — כחול. שאר — לבן
    const bubbleStyle = isBlueMsg
      ? 'background:#dbeeff;border-radius:10px 0 10px 10px;margin-right:auto;margin-left:20px;border-right:3px solid #1a73e8;'
      : 'background:white;border-radius:0 10px 10px 10px;margin-right:20px;margin-left:auto;';
    const align = isBlueMsg ? 'align-items:flex-start;' : 'align-items:flex-end;';

    html += '<div id="ctxmsg-' + idx + '" style="display:flex;flex-direction:column;margin-bottom:8px;' + align + '">'
      + '<div style="max-width:82%;padding:8px 12px;' + bubbleStyle + 'box-shadow:0 1px 3px rgba(0,0,0,0.1);">'
      + (isCallMsg
          ? '<div style="font-size:11px;font-weight:700;color:#1a73e8;margin-bottom:3px;">📞 קריאה – ' + senderClean + '</div>'
          : '<div style="font-size:11px;font-weight:700;color:' + (isBlueMsg ? '#1a73e8' : 'var(--orange)') + ';margin-bottom:3px;">' + senderClean + '</div>')
      + '<div style="font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">' + cleanBody + '</div>'
      + '<div style="font-size:10px;color:#999;text-align:left;margin-top:3px;">' + msg.timeStr + '</div>'
      + '</div></div>';
  });

  document.getElementById('chatBody').innerHTML = html || '<div style="color:var(--text-muted);text-align:center;padding:20px;">אין הודעות</div>';
  document.getElementById('chatOverlay').classList.add('open');

  // Scroll לקריאה עם הדגשה כתומה
  setTimeout(() => {
    const target = document.getElementById(`ctxmsg-${callMsgIdx}`);
    if (target) {
      target.scrollIntoView({ block: 'center' });
      target.style.outline = '2px solid var(--orange)';
      target.style.borderRadius = '6px';
      setTimeout(() => { target.style.outline = ''; }, 2500);
    }
  }, 80);
}

function openChatViewer(callIndex) {
  const c = parsedData.calls[callIndex];
  console.log('[openChatViewer] call:', c?.date, c?.time, 'rawContext len:', c?.rawContext?.length, 'rawText len:', rawText?.length);
  // אם אין rawText אבל יש rawContext — השתמש בו ישירות
  if (!rawText && c?.rawContext) { renderChatFromContext(c); return; }
  if (!rawText) { alert('לא נמצא קובץ שיחה'); return; }
  const lines = rawText.split('\n');
  const msgReIOS = /^\[(\d{1,2})\.(\d{1,2})\.(\d{4}), (\d{1,2}):(\d{2}):\d{2}\] ([^:]+): ([\s\S]*)/;
  const msgReAnd = /^(\d{1,2})\.(\d{1,2})\.(\d{4}), (\d{1,2}):(\d{2})\s*[-–]\s*([^:]+): ([\s\S]*)/;
  const allMsgs = [];
  let cur = null;
  for (const line of lines) {
    const m = msgReIOS.exec(line) || msgReAnd.exec(line);
    if (m) {
      if (cur) allMsgs.push(cur);
      cur = {
        dateStr:`${m[1].padStart(2,'0')}.${m[2].padStart(2,'0')}.${m[3]}`,
        timeStr:`${m[4].padStart(2,'0')}:${m[5]}`,
        sender:m[6].replace(/^~ /,'').trim(),
        body:m[7].trim()
      };
    } else if (cur) cur.body += '\n' + line;
  }
  if (cur) allMsgs.push(cur);

  // Find the call message — חיפוש גמיש: תאריך מדויק + שעה ±2 דקות
  const [callH, callM] = c.time.split(':').map(Number);
  const callMins = callH * 60 + callM;
  const callTotalMins = callH * 60 + callM;
  const CALL_MSG_RE = /^\*מוקד\s*(ארצי|מרחב|צפון|אצרצי)/i;
  const callMsgIdx = allMsgs.findIndex(m => {
    if (m.dateStr !== c.date) return false;
    const [mh, mm] = m.timeStr.split(':').map(Number);
    return Math.abs(mh * 60 + mm - callMins) <= 2;
  });
  if (callMsgIdx < 0) {
    // נסה rawContext מה-DB
    if (c.rawContext) {
      renderChatFromContext(c);
      return;
    }
    alert('לא נמצאה ההודעה בקובץ');
    return;
  }

  document.getElementById('chatModalTitle').textContent = `📍 ${c.location}`;
  document.getElementById('chatModalSub').textContent = `${c.date} · ${c.time} · מרחב ${c.region}`;

  // Render ALL messages (with date separators)
  let html = '';
  let lastDate = '';
  allMsgs.forEach((msg, idx) => {
    // Date separator
    if (msg.dateStr !== lastDate) {
      lastDate = msg.dateStr;
      html += `<div style="text-align:center;margin:10px 0;"><span style="background:rgba(0,0,0,0.12);color:#555;font-size:11px;padding:3px 10px;border-radius:10px;">${msg.dateStr}</span></div>`;
    }

    const isCallMsg = idx === callMsgIdx;
    const isBlueMsg = CALL_MSG_RE.test(msg.body.trim());

    // זיהוי הודעות מערכת
    const systemRe = /הסיר\/ה את|הצטרף|הצטרפה|עזב|עזבה|צירף\/ה את|שינה\/תה את|שינה את|שינתה את|added|removed|left|joined/i;
    const systemBodyRe = /^[\u200f\u200e~\s]*[^\s:]{2,}[\s\u200f\u200e]*(יצא\/ה|הצטרף\/ה|עזב\/ה|יצא$|יצאה$|הצטרף$|הצטרפה$|עזב$|עזבה$)/i;
    const isPhoneOnly = /^[\u202a\u202c+0-9\s-]{7,}$/.test(msg.sender.trim());
    const isSystemMsg = !msg.sender || isPhoneOnly || systemRe.test(msg.sender) || systemBodyRe.test(msg.body);

    if (isSystemMsg || isPhoneOnly) {
      const sysText = isPhoneOnly ? msg.body : (msg.sender + ': ' + msg.body);
      html += `<div style="text-align:center;margin:6px 0;"><span style="background:rgba(0,0,0,0.08);color:#666;font-size:11px;padding:2px 10px;border-radius:8px;">${sysText.replace(/\*/g,'')}</span></div>`;
      return;
    }

    const formatBody = (text) => text
      .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
      .replace(/התמונה הושמטה/g,'📷')
      .replace(/המדיה לא נכללה/g,'📷')
      .replace(/הודעה זו נמחקה/g,'🗑️ נמחק')
      .replace(/<ההודעה נערכה>/g,'<span style="color:#999;font-size:10px;"> ✏️</span>')
      .trim();

    const cleanBody = formatBody(msg.body);
    const senderClean = cleanName(msg.sender);
    const bubbleStyle = isBlueMsg
      ? 'background:#dbeeff;border-radius:10px 0 10px 10px;margin-right:auto;margin-left:20px;border-right:3px solid #1a73e8;'
      : 'background:white;border-radius:0 10px 10px 10px;margin-right:20px;margin-left:auto;';
    const align = isBlueMsg ? 'align-items:flex-start;' : 'align-items:flex-end;';
    const senderColor = isBlueMsg ? '#1a73e8' : 'var(--orange)';
    const senderPrefix = isCallMsg ? '📞 קריאה – ' : '';

    html += `<div id="chatmsg-${idx}" style="display:flex;flex-direction:column;margin-bottom:8px;${align}">
      <div style="max-width:80%;padding:8px 12px;${bubbleStyle}box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <div style="font-size:11px;font-weight:700;color:${senderColor};margin-bottom:3px;">${senderPrefix}${senderClean}</div>
        <div style="font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">${cleanBody}</div>
        <div style="font-size:10px;color:#999;text-align:left;margin-top:3px;">${msg.timeStr}</div>
      </div>
    </div>`;
  });

  document.getElementById('chatBody').innerHTML = html;
  document.getElementById('chatOverlay').classList.add('open');

  // Scroll to call message
  setTimeout(() => {
    const target = document.getElementById(`chatmsg-${callMsgIdx}`);
    if (target) {
      target.scrollIntoView({ block: 'center' });
      target.style.outline = '2px solid var(--orange)';
      target.style.borderRadius = '6px';
      setTimeout(() => { target.style.outline = ''; }, 2500);
    }
  }, 80);
}

function closeChatModal(e) {
  if(e&&e.target!==document.getElementById('chatOverlay')) return;
  document.getElementById('chatOverlay').classList.remove('open');
  onModalClose();
}

// iOS Safari scroll — handled via CSS (overscroll-behavior:contain + touch-action:pan-y)

