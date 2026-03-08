// ===================== PARSER =====================
function localDate(str) {
  if (!str) return null;
  const [y,m,d] = str.split('-').map(Number);
  return new Date(y, m-1, d);
}
function parseWhatsApp(text, startDate, endDate) {
  const lines = text.split('\n');
  const messages = [];

  // iOS format: [25.02.2026, 15:30:00] שם: הודעה
  const msgReIOS = /^\[(\d{1,2})\.(\d{1,2})\.(\d{4}), (\d{1,2}):(\d{2}):\d{2}\] ([^:]+): ([\s\S]*)/;
  // Android format: 25/02/2026, 15:30 - שם: הודעה (slash)
  const msgReAndroid = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}), (\d{1,2}):(\d{2})\s*[-–]\s*([^:]+): ([\s\S]*)/;
  // Android format: 25.02.2026, 15:30 - שם: הודעה (dots - Shai's format)
  // מקבל גם sender שמתחיל בתווי RTL (כמו ‏‪+972...‬‏) — ניקוי יהיה אחרי הפרסור
  const msgReAndroidDots = /^(\d{1,2})\.(\d{1,2})\.(\d{4}), (\d{1,2}):(\d{2})\s*[-–]\s*([^\u200f\u202a\u202c:‏‪‬][^:]*|[\u200f\u202a\u202c‏‪‬][^:]+): ([\s\S]*)/;

  let cur = null;
  for (const line of lines) {
    let m = msgReIOS.exec(line);
    let isAndroid = false;
    if (!m) { m = msgReAndroid.exec(line); isAndroid = !!m; }
    if (!m) { m = msgReAndroidDots.exec(line); isAndroid = !!m; }
    if (m) {
      if (cur) messages.push(cur);
      let y = parseInt(m[3]); if (isAndroid && y < 100) y += 2000;
      const date = new Date(y, parseInt(m[2])-1, parseInt(m[1]));
      cur = { date, dateStr:`${m[1].padStart(2,'0')}.${m[2].padStart(2,'0')}.${y}`, timeStr:`${m[4].padStart(2,'0')}:${m[5]}`, sender:m[6].replace(/^~ /,'').replace(/[\u200f\u200e\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\u206a-\u206f\uFEFF‏‪‬]/g,'').trim(), body:m[7].trim(), _lineIdx: lines.indexOf(line) };
    } else if (cur) cur.body += '\n' + line.trim();
  }
  if (cur) messages.push(cur);

  const filtered = messages.filter(msg => {
    if (startDate && msg.date < startDate) return false;
    if (endDate) { const e=new Date(endDate); e.setDate(e.getDate()+1); if(msg.date>=e) return false; }
    return true;
  });

  // Strict: only match dispatcher messages that have מוקד + (ארצי|מרחב) — real call format
  const CALL_RE = /מוקד\s*(ארצי\s+מרחב|ארצי|מרחב)\s*\S+/i;
  const CALL_REGION_RE = /מוקד.*?מרחב\s*(\S+)/i;

  function normalizeRegion(r) {
    r = r.replace(/[*_]/g,'').trim();
    if (/^(רמת|רמת.גולן|גולן)$/i.test(r)) return 'גולן';
    return r;
  }

  // SAB variants: ס.א.ב / סאב / ס א ב / סאבבה / סאל / חולץ / חולץ טלפוני / סיום
  const SAB_RE = /ס[\s.]?א[\s.]?ב|^סאב|^סאבבה|^סאל\b|^סיום\b|^חולץ\b|חולץ\s+טלפוני/im;

  // Transferred to district — special status
  const TRANSFER_RE = /נלקח במחוזי|הועבר למחוזי|טיפול מחוזי|נלקח ע"י מחוזי|עבר למחוזי/i;

  // External unit (not a Panther volunteer) — "חולץ ע"י גורם חיצוני"
  const EXTERNAL_UNIT_RE = /סגמ\s+\S+|סג"מ\s+\S+|מחוזי\s+חילץ|יחידת\s+\S+\s+חילצה/i;

  // Someone else helped
  const OTHER_HELPED_RE = /מישהו שם חילץ|מישהו עזר|חילץ אותו|חילצו אותו|מישהו פה עזר|עזרה מקומית/i;

  // End-of-call (cancelled/no credit)
  const END_RE = /הסתדר לבד|הסתדרו לבד|יצא לבד|יצאו לבד|חולץ ע["״]י חבר|חולץ ע["״]י מכונא|בוטל|ביטל|סיום באפליקציה|חזלש|חזרנו לשלום/i;

  // Intent patterns
  const INTENT_RE = /פרטים בבקשה|שלח פרטים|שלחי פרטים|^אני יכול|^אני לוקח|^אני בדרך|בדרך אליהם|^אני עולה|^אני מגיע|^שלח אני|^אני פה|^יוצא|^יוצאת/i;

  // Completion signals after intent
  const COMPLETE_RE = /^בחוץ\b|^יצאנו\b|^סיימנו\b|^הוצאנו\b|^חילצנו\b|^יצא\b|^יצאה\b/i;

  // Managers
  const MANAGERS_RE = /נתי|שי כלאף|נתי.*פנתרים|שי.*פנתר|דודו\s*צדוק|דודו.*מוקד/i;

  // "סאב של [שם]" / "סאב עם [שם]" — credits named person(s)
  const SAB_OF_RE = /ס["\u05f4]?[.״]?א["\u05f4]?[.]?ב(?:בה)?(?:\s+[^\n]{0,30}?)??\s*(של|עם)\s+([\s\S]+)/i;

  // "ואנוכי" / "ושלי" / "ושלנו" — writer also gets credit
  const AND_ME_RE = /ו(אנוכי|שלי|שלנו)\b/i;

  // "הבן היקר" / "הבן שלי" = יאיר כלאף (שי's son)
  const SON_RE = /הבן\s+(היקר|שלי)/i;
  const SON_NAME = 'יאיר כלאף';

  // Bystander rescue
  const BYSTANDER_RE = /חולצ[הו]\s+(על\s+ידי\s+|ע["״]י\s+)(עובר\s+אורח|מקומי|אזרח|בן\s+מקום)|עובר\s+אורח\s+עזר|מישהו\s+מקומי\s+עזר/i;

  // Late report patterns — "חוב מהעבר" / "שכח לכתוב סאב"
  const LATE_REPORT_RE = /חוב\s+(מה)?עבר|חוב\s+מאתמול|שכח\s+לכתוב\s+סאב/i;

  // "נלקח ע"י [שם]" — taken by someone, wait for SAB confirmation
  const TAKEN_BY_RE = /נלקח\s+ע["״]י\s+(.+)/i;

  const DISPATCHERS = /מוקד|שי כלאף|נתי\b|נתי.*פנתרים|נתי.*בר|ידידים דוד|מבצעי|גלעד.*ידידים|אחמ"ש|אחמש.*צפון|דודו.*מוקד/i;

  // Helper: extract credited names from SAB_OF match
  function extractCreditedNames(sabText, writerName) {
    let names = [];

    // עדיפות: @mentions עם תווי RTL — הכי מדויק
    const mentionRe = /@[\u2068\u2069\u200f\u200e~\u202f]*([^\u2069\u200f\n@\u202c]{2,50})[\u2069\u200f\u202c]/g;
    let mm;
    while ((mm = mentionRe.exec(sabText)) !== null) {
      let name = mm[1].replace(/[\u200f\u200e\u2068\u2069\u202c~]/g,'').replace(/^~\s*/,'').trim();
      if (name.length > 1) names.push(name);
    }

    // אם אין @mentions — קח שורה ראשונה ונקה
    if (names.length === 0) {
      let first = sabText.split('\n')[0];
      // הסר טקסט עודף אחרי השם
      first = first.replace(/\s+(שהגיע|שבא|שיצא|בדיוק|לסייע|לעזור).*/i,'');
      // הסר מילות שבח
      first = first.replace(/האלוף|הצדיק|המלך|היקר|הבן שלנו|חביב|בלבד/gi,'').trim();
      first.split(/\s+ו\s+|\s*\/\s*/).forEach(p => {
        p = p.replace(/[\u200f\u200e\u2068\u2069\u202c~]/g,'').trim();
        if (p.length > 1) names.push(p);
      });
    }

    // הבן היקר/שלי → יאיר כלאף
    if (SON_RE.test(sabText)) names.push(SON_NAME);
    // ואנוכי/ושלי/ושלנו → הוסף כותב
    if (AND_ME_RE.test(sabText)) names.push(cleanName(writerName));
    return names.filter(n => n.length > 1);
  }

  const calls = [], volunteers = {}, regions = {};

  for (let i=0; i<filtered.length; i++) {
    const msg = filtered[i];
    const body = msg.body.replace(/\*/g,'');
    if (!CALL_RE.exec(body)) continue;

    const regionMatch = body.match(CALL_REGION_RE);
    const region = regionMatch ? normalizeRegion(regionMatch[1]) : 'לא ידוע';

    const bodyLines = body.split('\n').map(l=>l.replace(/\*/g,'').trim()).filter(l=>l);
    let location='', vehicle='', callType='';
    for (const l of bodyLines) {
      if (l.match(/מוקד/i)) continue;
      if (!location && !l.match(/סיוע|משיכה|4x4|4×4/i) && l.length>3) location=l;
      else if (l.match(/סיוע|משיכה/i)) {
        const parts=l.split(/סיוע/i);
        if(parts[0].trim()) vehicle=parts[0].trim();
        callType='סיוע'+(parts[1]||'');
      }
    }
    if (!location) continue;

    // Find in global messages for cross-boundary look-ahead
    const globalIdx = messages.findIndex(m=>m.dateStr===msg.dateStr&&m.timeStr===msg.timeStr&&m.sender===msg.sender);

    let handler='', status='open', closingNote='', intentCandidate='', intentSender='', handlerIsSingle=false;
    // חלון זמן: עד 4 שעות משעת הקריאה
    const [callH, callM] = msg.timeStr.split(':').map(Number);
    const callMinsTotal = callH * 60 + callM;
    const lookEnd = messages.length;

    for (let j=globalIdx+1; j<lookEnd; j++) {
      const next = messages[j];
      const nb = next.body.replace(/\*/g,'').trim();

      // "סאב של/עם [שם]" — credits named person(s), highest priority
      const sabOfMatch = SAB_OF_RE.exec(nb);
      if (sabOfMatch) {
        const sabText = sabOfMatch[2] || '';
        const creditedNames = extractCreditedNames(sabText, next.sender);
        // Also add writer if "עם" (together with)
        if (sabOfMatch[1] === 'עם') creditedNames.push(cleanName(next.sender));
        status = 'sab';
        handler = creditedNames.length > 0 ? creditedNames.join('|') : (intentCandidate || next.sender);
        if (creditedNames.length > 1) handlerIsSingle = false;
        closingNote = nb.split('\n')[0].trim().substring(0, 60);
        break;
      }

      // Late report: "חוב מהעבר" + names — credits those names
      if (LATE_REPORT_RE.exec(nb)) {
        const creditedNames = extractCreditedNames(nb.replace(LATE_REPORT_RE,''), next.sender);
        if (creditedNames.length > 0) {
          status = 'sab';
          handler = creditedNames.join('|');
          if (creditedNames.length > 1) handlerIsSingle = false;
          closingNote = nb.split('\n')[0].trim().substring(0, 60);
          break;
        }
      }

      // Bystander rescue — cancelled
      if (BYSTANDER_RE.exec(nb)) {
        status = 'cancelled';
        closingNote = 'חולץ ע"י עובר אורח';
        handler = '';
        break;
      }

      // סיום באפליקציה — cancelled
      if (/סיום\s+באפליקציה/i.test(nb)) {
        status = 'cancelled';
        closingNote = 'סיום באפליקציה';
        handler = '';
        break;
      }

      // External unit (סגמ לביא etc.) — external credit
      const extMatch = EXTERNAL_UNIT_RE.exec(nb);
      if (extMatch && SAB_RE.exec(nb)) {
        status = 'cancelled';
        closingNote = 'חולץ ע"י גורם חיצוני: ' + extMatch[0].trim().substring(0,30);
        handler = '';
        break;
      }

      // עצור אם עברו 4 שעות משעת הקריאה
      const [nextH, nextM] = next.timeStr.split(':').map(Number);
      const nextMinsTotal = nextH * 60 + nextM;
      const diffMins = nextMinsTotal >= callMinsTotal
        ? nextMinsTotal - callMinsTotal
        : (nextMinsTotal + 1440) - callMinsTotal; // חצות
      if (next.dateStr !== msg.dateStr && diffMins > 240) break;
      if (next.dateStr === msg.dateStr && diffMins > 240) break;

      // Stop if new call begins (with grace period)
      if (j > globalIdx+3 && CALL_RE.exec(nb)) break;

      // Track intent candidate (first non-dispatcher who expressed willingness)
      if (!intentCandidate && INTENT_RE.exec(nb) && next.sender!==msg.sender && !DISPATCHERS.exec(next.sender)) {
        intentCandidate = next.sender;
        intentSender = next.sender;
      }

      // "נלקח ע"י [שם]" — update intent candidate
      const takenMatch = TAKEN_BY_RE.exec(nb);
      if (takenMatch && MANAGERS_RE.exec(next.sender)) {
        const takenName = takenMatch[1].replace(/^@[\u200f\u200e⁨⁩~]*/,'').replace(/[\u200f\u200e⁨⁩~]/g,'').trim();
        if (takenName.length > 1) intentCandidate = takenName;
      }

      // "Transferred to district"
      if (TRANSFER_RE.exec(nb)) {
        status = 'transferred';
        closingNote = 'הועבר למחוזי';
        handler = '';
        break;
      }

      // Someone else helped
      if (OTHER_HELPED_RE.exec(nb)) {
        status = 'cancelled';
        closingNote = nb.split('\n')[0].trim().substring(0, 60);
        handler = '';
        break;
      }

      // SAB written by volunteer themselves (or by anyone)
      if (SAB_RE.exec(nb)) {
        status = 'sab';
        const nbFirst = nb.split('\n')[0].trim();

        // Check if it contains a cancellation reason — then it's NOT a sab
        const mechRe = /חולץ\s+ע["״]י\s+מכונא|מכונאי\s+שהזמין/i;
        const selfRe = /הסתדר\s+לבד|יצא\s+לבד/i;
        if (mechRe.test(nb)) { status='cancelled'; closingNote='חולץ ע"י מכונאי'; handler=''; break; }
        if (selfRe.test(nb)) { status='cancelled'; closingNote='הסתדר לבד'; handler=''; break; }
        if (BYSTANDER_RE.test(nb)) { status='cancelled'; closingNote='חולץ ע"י עובר אורח'; handler=''; break; }
        if (/סיום באפליקציה/i.test(nb)) { status='cancelled'; closingNote='סיום באפליקציה'; handler=''; break; }

        if (!DISPATCHERS.exec(next.sender)) {
          // Volunteer wrote SAB/סיום/חולץ טלפוני — credit them
          handler = cleanName(next.sender);
          handlerIsSingle = true; // sender name — never split by comma
          // Check if they also mention others
          const sabOfInline = SAB_OF_RE.exec(nb);
          if (sabOfInline) {
            const creditedNames = extractCreditedNames(sabOfInline[2]||'', next.sender);
            if (sabOfInline[1] === 'עם') creditedNames.push(cleanName(next.sender));
            if (creditedNames.length > 0) { handler = creditedNames.join('|'); handlerIsSingle = false; }
          }
        } else if (intentCandidate) {
          handler = intentCandidate;
          handlerIsSingle = true;
        } else {
          handler = intentCandidate || cleanName(next.sender);
          handlerIsSingle = true;
        }
        closingNote = nbFirst.substring(0, 60);
        break;
      }

      // Completion word after intent
      if (COMPLETE_RE.exec(nb) && intentCandidate && next.sender === intentCandidate) {
        status = 'sab';
        handler = intentCandidate;
        closingNote = nb.split('\n')[0].trim().substring(0, 60);
        break;
      }

      // General end-of-call
      if (END_RE.exec(nb)) {
        status = 'cancelled';
        closingNote = nb.split('\n')[0].trim().substring(0, 60);
        handler = '';
        break;
      }
    }

    // Secondary pass: catch standalone סיום / חולץ patterns
    if (status==='open') {
      for (let j=globalIdx+1; j<Math.min(globalIdx+20,messages.length); j++) {
        const nb = messages[j].body.replace(/\*/g,'').trim();
        if (j > globalIdx+3 && CALL_RE.exec(nb)) break;
        if (TRANSFER_RE.exec(nb)) { status='transferred'; closingNote='הועבר למחוזי'; break; }
        if (/^סיום[\s\.]?$|^חולץ/.test(nb)) {
          status='cancelled';
          closingNote = nb.substring(0,60);
          break;
        }
      }
    }

    const callIndex = calls.length;
    const hClean = handler ? cleanName(handler) : '';
    calls.push({ index:callIndex, date:msg.dateStr, time:msg.timeStr, region, location:location, vehicle:vehicle, callType:callType||'סיוע משיכה', handler, handlerClean:hClean, handlerIsSingle, status, closingNote, dayName:dayHe(msg.date), origStatus:status, origHandlerClean:hClean });

    // Add all participants to vol database — from ENTIRE file (no date filter)
    [msg, ...messages.slice(globalIdx+1, Math.min(globalIdx+30,messages.length))].forEach(m => {
      const n = cleanName(m.sender);
      if (n && !DISPATCHERS.exec(m.sender) && n.length > 2) volDatabase.add(n);
    });

    if (status==='sab' && hClean) {
      if (!volunteers[hClean]) volunteers[hClean]={count:0,region,callIndices:[]};
      volunteers[hClean].count++;
      volunteers[hClean].callIndices.push(callIndex);
    }
    if (!regions[region]) regions[region]={total:0,sab:0};
    regions[region].total++;
    if (status==='sab') regions[region].sab++;
  }

  saveStorage();
  return { calls, volunteers, regions };
}

function cleanName(name) {
  if (!name) return '';
  return name
    .replace(/^~ /,'')
    .replace(/\[\d{1,2}:\d{2}:\d{2}\]\s*/,'')  // remove [12:37:31]
    .replace(/[-–]\s*(פנתר|ידידים|מוקד|סגן|מבצעי|יחידת|אחמ"ש|אחמש).*$/i,'')
    .replace(/\s+\d{3,}$/,'')
    .replace(/[\u200f\u200e⁨⁩]/g,'')
    .replace(/,/g,' ')          // נרמל פסיקים → רווח
    .replace(/\s{2,}/g,' ')    // דחוס רווחים כפולים
    .trim();
}

function isDispatcherName(name) {
  return /מוקד|גלעד.*ידידים|אחמ"ש|אחמש.*צפון|ידידים\s+סיוע\s+בדרכים/i.test(name);
}
function dayHe(d) { return ["יום א","יום ב","יום ג","יום ד","יום ה","יום ו","שבת"][d.getDay()]; }

