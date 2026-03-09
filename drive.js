// ===================== GOOGLE DRIVE =====================
const DRIVE_CLIENT_ID = '616515156131-pglvg65fnlnd8d0m7coovpsoc1a40t7v.apps.googleusercontent.com';
const DRIVE_FOLDER_ID = '1e7pp43lBczBICozmu_c2MRLAAtW1IsYZ';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile';
const SOURCE_OF_TRUTH_EMAIL = 'shayhalaf@gmail.com'; // שי = מקור האמת למילון שמות

let driveAccessToken = null;
let driveTokenClient = null;
let currentUserName = localStorage.getItem('panther_username') || null;

let currentUserEmail = localStorage.getItem('panther_useremail') || null;

async function fetchUserName(token) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (data.name) {
      currentUserName = data.name;
      localStorage.setItem('panther_username', data.name);
    }
    if (data.email) {
      currentUserEmail = data.email;
      localStorage.setItem('panther_useremail', data.email);
    }
  } catch(e) { console.error('Could not fetch user name:', e); }
}

function isSourceOfTruth(fileName) {
  // מקור אמת לפי מייל
  if (currentUserEmail && currentUserEmail.toLowerCase() === SOURCE_OF_TRUTH_EMAIL.toLowerCase()) return true;
  // מקור אמת לפי שם קובץ (לצורכי בדיקה — קובץ של שי)
  if (fileName && fileName.includes('שי')) return true;
  return false;
}

let driveFileIds = {}; // cache: filename -> fileId
let phonebook = {};   // mobileNumber/name -> displayName

// ---- AUTH ----
function initDrive() {
  if (!window.google || !window.google.accounts) return;
  driveTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: DRIVE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: async (resp) => {
      if (resp.error) { console.error('Drive auth error:', resp.error); return; }
      driveAccessToken = resp.access_token;
      await fetchUserName(resp.access_token);
      updateDriveBtn(true);
      await onDriveConnected();
    }
  });
}

function driveLogin() {
  if (!driveTokenClient) { initDrive(); setTimeout(driveLogin, 800); return; }
  if (driveAccessToken) { updateDriveBtn(true); return; }
  driveTokenClient.requestAccessToken({ prompt: '' });
}

function updateDriveBtn(connected) {
  const btn = document.getElementById('btnDrive');
  if (btn) {
    if (connected) { btn.textContent = '✅ Drive'; btn.classList.add('connected'); }
    else { btn.textContent = '☁️ Drive'; btn.classList.remove('connected'); }
  }
  const notConnected = document.getElementById('driveNotConnected');
  const connectedNoData = document.getElementById('driveConnectedNoData');
  const connectedWithData = document.getElementById('driveConnectedWithData');
  const statusRow = document.getElementById('driveStatusRow');
  if (connected) {
    if (notConnected) notConnected.style.display = 'none';
    // Show "no data" while we check; showSmartUpload will switch to "with data" if found
    if (connectedNoData) connectedNoData.style.display = 'flex';
    if (connectedWithData) connectedWithData.style.display = 'none';
  } else {
    if (notConnected) notConnected.style.display = 'flex';
    if (connectedNoData) connectedNoData.style.display = 'none';
    if (connectedWithData) connectedWithData.style.display = 'none';
    if (statusRow) { statusRow.style.background = 'var(--bg)'; statusRow.style.borderColor = 'var(--bg2)'; }
  }
}

// ---- CORE DRIVE REQUESTS ----
async function driveReq(method, url, body, contentType) {
  if (!driveAccessToken) throw new Error('Not authenticated');
  const headers = { 'Authorization': 'Bearer ' + driveAccessToken };
  if (contentType) headers['Content-Type'] = contentType;
  const res = await fetch(url, { method, headers, body });
  if (res.status === 401) { driveAccessToken = null; updateDriveBtn(false); throw new Error('Token expired'); }
  if (!res.ok) throw new Error('Drive error: ' + res.status);
  const text = await res.text();
  try { return JSON.parse(text); } catch(e) { return text; }
}

async function findFile(name) {
  if (driveFileIds[name]) return driveFileIds[name];
  const q = encodeURIComponent(`name='${name}' and '${DRIVE_FOLDER_ID}' in parents and trashed=false`);
  const list = await driveReq('GET', `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)`);
  if (list.files && list.files.length > 0) {
    driveFileIds[name] = list.files[0].id;
    return list.files[0].id;
  }
  return null;
}

async function createFile(name, mimeType) {
  const meta = { name, parents: [DRIVE_FOLDER_ID], mimeType };
  const created = await driveReq('POST', 'https://www.googleapis.com/drive/v3/files', JSON.stringify(meta), 'application/json');
  driveFileIds[name] = created.id;
  return created.id;
}

async function readFile(name) {
  const fileId = await findFile(name);
  if (!fileId) return null;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { 'Authorization': 'Bearer ' + driveAccessToken }
  });
  if (!res.ok) return null;
  return await res.text();
}

async function writeFile(name, content, mimeType) {
  if (!driveAccessToken) return;
  try {
    let fileId = await findFile(name);
    if (!fileId) fileId = await createFile(name, mimeType || 'application/octet-stream');
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + driveAccessToken, 'Content-Type': mimeType || 'text/plain' },
      body: content
    });
  } catch(e) { console.error('Drive write error:', e); }
}

// ---- ON DRIVE CONNECTED ----
async function onDriveConnected() {
  // Show loading message in drive status row
  const notConn = document.getElementById('driveNotConnected');
  const connNoData = document.getElementById('driveConnectedNoData');
  if (notConn) notConn.style.display = 'none';
  if (connNoData) {
    connNoData.style.display = 'flex';
    const existing = connNoData.querySelector('div div');
    if (existing) existing.textContent = '⏳ טוען מאגר... יש להמתין';
  }
  // Load overrides
  await loadOverridesFromDrive();
  isInitialLoad = false;
  // Load phonebook
  await loadPhonebookFromDrive();
  // Check if chat data exists in Drive
  await checkExistingData();
}

async function checkExistingData() {
  try {
    // נסה לטעון מ-panther-database.json קודם
    const dbRaw = await readFile('panther-database.json');
    if (dbRaw) {
      pantherDB = JSON.parse(dbRaw);
      const meta = pantherDB.meta || {};
      const lastDate = meta.lastDate || meta.lastMerge?.substring(0,10).split('-').reverse().join('.') || '—';
      showSmartUpload(lastDate, pantherDB.calls.length);
      return;
    }
    // fallback ל-panther-meta.json (גרסה ישנה)
    const metaRaw = await readFile('panther-meta.json');
    if (!metaRaw) { showUploadReady(); return; }
    const info = JSON.parse(metaRaw);
    showSmartUpload(info.lastDate, info.messageCount);
  } catch(e) {
    showUploadReady();
  }
}

function showUploadReady() {
  const hint = document.getElementById('driveHint');
  if (hint) hint.style.display = 'none';
  document.getElementById('analyzeBtn').disabled = !rawText;
}

function showSmartUpload(lastDate, count) {
  const notConnected = document.getElementById('driveNotConnected');
  const connectedNoData = document.getElementById('driveConnectedNoData');
  const connectedWithData = document.getElementById('driveConnectedWithData');
  const infoEl = document.getElementById('driveDataInfo');
  const statusRow = document.getElementById('driveStatusRow');
  if (notConnected) notConnected.style.display = 'none';
  if (connectedNoData) connectedNoData.style.display = 'none';
  if (connectedWithData) connectedWithData.style.display = 'flex';
  if (infoEl) infoEl.textContent = 'מתאריך: ' + lastDate;
  if (statusRow) { statusRow.style.background = '#f0faf4'; statusRow.style.borderColor = '#27ae60'; }
  // Enable analyze — it will auto-load from Drive
  document.getElementById('analyzeBtn').disabled = false;
}


function loadParsedFromDB(db, startDate, endDate) {
  // המר DB חזרה לפורמט parsedData שרenderDashboard מצפה לו
  const nameDict = db.nameDict || {};
  const calls = [];
  const volunteers = {};
  const regions = {};

  // סנן לפי תאריכים
  const sDate = startDate ? localDate(startDate) : null;
  const eDate = endDate ? (() => { const d = localDate(endDate); d.setDate(d.getDate()+1); return d; })() : null;

  db.calls.forEach((dbCall, i) => {
    // סינון תאריכים
    if (sDate || eDate) {
      const [dd, mm, yy] = dbCall.date.split('.');
      const callDate = new Date(yy, mm-1, dd);
      if (sDate && callDate < sDate) return;
      if (eDate && callDate >= eDate) return;
    }
    const callIndex = calls.length; // index = מיקום במערך המסונן
    // פתור שם כונן לפי מילון
    const rawHandler = dbCall.rawSender || '';
    const resolvedHandler = resolveHandler(rawHandler, nameDict);

    // החל overrides
    const assignment = manualAssignments[i];
    const hClean = assignment
      ? assignment.replace(/\|/g, ', ')
      : resolvedHandler;

    const origStatus = dbCall.status || 'open';
    let status = manualStatuses[i] !== undefined ? manualStatuses[i] : origStatus;
    const closingNote = manualNotes[i] !== undefined ? manualNotes[i] : (dbCall.closingNote || '');

    const call = {
      index: callIndex,
      date: dbCall.date,
      time: dbCall.time,
      dayName: dbCall.dayName || '',
      region: dbCall.region,
      location: dbCall.location,
      vehicle: dbCall.vehicle || '',
      callType: dbCall.callType || 'סיוע משיכה',
      handler: hClean,
      handlerClean: hClean,
      handlerIsSingle: true,
      status,
      closingNote,
      origStatus,
      origHandlerClean: resolvedHandler,
      rawContext: dbCall.rawContext || ''
    };
    calls.push(call);

    // בנה volunteers
    if (status === 'sab' && hClean) {
      const names = hClean.split('|').map(n => n.trim()).filter(n => n.length >= 2);
      names.forEach(name => {
        if (!volunteers[name]) volunteers[name] = { count: 0, callIndices: [] };
        volunteers[name].count++;
        volunteers[name].callIndices.push(callIndex);
      });
    }

    // בנה regions
    if (!regions[call.region]) regions[call.region] = { total: 0, sab: 0 };
    regions[call.region].total++;
    if (status === 'sab') regions[call.region].sab++;
  });

  parsedData = { calls, volunteers, regions };

  // רענן תצוגה
  const s = document.getElementById('weekStart').value;
  const e = document.getElementById('weekEnd').value;
  if (s && e) renderDashboard(s, e);
}

async function loadFromDrive() {
  const startDate = document.getElementById('weekStart')?.value || null;
  const endDate = document.getElementById('weekEnd')?.value || null;

  // תמיד נסה לטעון גם את קובץ הצ'אט המלא כדי ש-"צפה בשיחה" יעבוד עם כל ההיסטוריה
  let chatText = null;
  try {
    chatText = await readFile('panther-chat.txt');
    if (chatText) rawText = chatText;
  } catch (e) {
    console.warn('Could not load panther-chat.txt from Drive:', e);
  }

  // אם יש DB — טען ממנו את הדשבורד, אבל rawText כבר זמין לצפייה בשיחה מלאה
  if (pantherDB && pantherDB.calls && pantherDB.calls.length > 0) {
    document.getElementById('analyzeBtn').disabled = false;
    document.getElementById('dzSub').textContent = chatText
      ? '✅ נטען מ-Drive בהצלחה'
      : '✅ נטען מ-Drive (ללא קובץ צ׳אט מלא)';
    loadParsedFromDB(pantherDB, startDate, endDate);
    startLiveSync();
    return;
  }

  // fallback — אם אין DB, טען TXT ונתח
  if (!chatText) { alert('לא נמצא קובץ צ׳אט ב-Drive'); return; }
  document.getElementById('analyzeBtn').disabled = false;
  document.getElementById('dzSub').textContent = '✅ נטען מ-Drive בהצלחה';
  document.getElementById('analyzeBtn').click();
  startLiveSync();
}

// ---- SAVE CHAT TO DRIVE ----
async function saveChatToDrive(text, fileName) {
  if (!driveAccessToken) return;
  // שמור טקסט גולמי לגיבוי
  await writeFile('panther-chat.txt', text, 'text/plain');
  // Save meta
  const lines = text.split('\n');
  const msgReIOS2 = /^\[(\d{1,2})\.(\d{1,2})\.(\d{4})/;
  const msgReAnd2 = /^(\d{1,2})\.(\d{1,2})\.(\d{4}),\s*\d{1,2}:\d{2}\s*[-–]/;
  let lastDate = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    let m = msgReIOS2.exec(lines[i]);
    if (m) { lastDate = `${m[1].padStart(2,'0')}.${m[2].padStart(2,'0')}.${m[3]}`; break; }
    m = msgReAnd2.exec(lines[i]);
    if (m) { lastDate = `${m[1].padStart(2,'0')}.${m[2].padStart(2,'0')}.${m[3]}`; break; }
  }
  const meta = { lastDate, messageCount: lines.length, savedAt: new Date().toISOString() };
  await writeFile('panther-meta.json', JSON.stringify(meta), 'application/json');

  // מזג ל-panther-database.json
  try {
    const parsed = parseWhatsApp(text, null, null);
    // בנה index של שורות לכל הודעה
    const allLines = text.split('\n');
    const iosRe = /^\[(\d{1,2})\.(\d{1,2})\.(\d{4}), (\d{1,2}):(\d{2}):\d{2}\]/;
    const andRe = /^(\d{1,2})\.(\d{1,2})\.(\d{4}), (\d{1,2}):(\d{2})\s*[-–]/;
    const msgLineIndices = [];
    allLines.forEach((line, i) => { if (iosRe.test(line) || andRe.test(line)) msgLineIndices.push(i); });

    const newCalls = parsed.calls.map(c => {
      // מצא את שורת הקריאה בטקסט
      let contextLines = [];
      // חפש את שורת הקריאה — נסה כמה וריאציות של תאריך/שעה
      const dateVariants = [
        c.date,                                    // 10.02.2026
        c.date.replace(/^0/,'').replace(/\.0/,'.'), // 10.2.2026
        c.date.replace(/\.(0)(\d)\./,'.$2.')        // 10.2.2026 via regex
      ];
      const timeVariants = [c.time, c.time.replace(/^0/,'')];
      const lineIdx = allLines.findIndex((line) => {
        if (!iosRe.test(line) && !andRe.test(line)) return false;
        return dateVariants.some(d => line.includes(d)) &&
               timeVariants.some(t => line.includes(t));
      });
      if (lineIdx >= 0) {
        contextLines = allLines.slice(lineIdx, lineIdx + 35);
      }
      return {
        id: makeCallId(c.date, c.time, c.region, c.location),
        date: c.date,
        time: c.time,
        dayName: c.dayName,
        region: c.region,
        location: c.location,
        vehicle: c.vehicle,
        callType: c.callType,
        status: c.origStatus || c.status || 'open',
        closingNote: c.closingNote || '',
        rawSender: c.handlerClean || '',
        rawContext: contextLines.join('\n')
      };
    });
    const db = await loadDatabase() || { calls: [], nameDict: {}, meta: {} };
    console.log('[saveChatToDrive] newCalls:', newCalls.length, 'isSourceOfTruth:', isSourceOfTruth(fileName), 'fileName:', fileName);
    console.log('[saveChatToDrive] sample rawContext:', newCalls[0]?.rawContext?.substring(0,80));
    const { db: mergedDb, added } = await mergeCallsIntoDB(newCalls, db, isSourceOfTruth(fileName));
    await saveDatabase(mergedDb);
    pantherDB = mergedDb; // עדכן זיכרון
    console.log(`DB: נוספו ${added} קריאות חדשות, סה"כ ${mergedDb.calls.length}`);
  } catch(e) { console.error('DB merge error:', e); }
}

// ---- OVERRIDES ----
async function loadOverridesFromDrive() {
  try {
    const data = await readFile('panther-overrides.json');
    if (!data) return;
    const obj = JSON.parse(data);
    if (obj.assignments) {
      // נרמל assignments ישנים שנשמרו עם פסיק → המר ל-|
      const normalized = {};
      Object.entries(obj.assignments).forEach(([k, v]) => {
        if (v && v.includes(',') && !v.includes('|')) {
          normalized[k] = v.split(',').map(s => s.trim()).filter(Boolean).join('|');
        } else {
          normalized[k] = v;
        }
      });
      manualAssignments = { ...manualAssignments, ...normalized };
    }
    if (obj.statuses) manualStatuses = { ...manualStatuses, ...obj.statuses };
    if (obj.notes) manualNotes = { ...manualNotes, ...obj.notes };
    if (obj.changelog) manualChangelog = { ...obj.changelog, ...manualChangelog };
    saveStorage();
  } catch(e) { console.error('Overrides load error:', e); }
}

async function saveOverridesToDrive() {
  if (!driveAccessToken) return;
  const obj = { assignments: manualAssignments, statuses: manualStatuses, notes: manualNotes, changelog: manualChangelog, savedAt: new Date().toISOString() };
  await writeFile('panther-overrides.json', JSON.stringify(obj), 'application/json');
  // עדכן etag כדי שהמכשיר הזה לא יזהה את עצמו כ"שינוי חדש"
  getFileEtag('panther-overrides.json').then(etag => { lastOverridesEtag = etag; });
}

// ---- PHONEBOOK ----
async function loadPhonebookFromDrive() {
  try {
    const data = await readFile('panther-phonebook.json');
    if (!data) return;
    const saved = JSON.parse(data);
    // Merge — Drive phonebook enriches local, never overwrites
    phonebook = { ...saved };
    // Add Drive names to volDatabase
    Object.values(phonebook).forEach(name => { if (name && name.length > 1) volDatabase.add(name); });
    renderVolDb();
  } catch(e) { console.error('Phonebook load error:', e); }
}

async function savePhonebookToDrive() {
  if (!driveAccessToken) return;
  // Merge volDatabase into phonebook
  volDatabase.forEach(name => { if (!phonebook[name]) phonebook[name] = name; });
  await writeFile('panther-phonebook.json', JSON.stringify(phonebook, null, 2), 'application/json');
}

// ---- AUTO-SAVE OVERRIDES (called after every manual change) ----
function saveAll() {
  saveStorage();
  // Fire-and-forget Drive save with token refresh if needed
  (async () => {
    if (!driveAccessToken && driveTokenClient) {
      driveTokenClient.requestAccessToken({ prompt: '' });
      await new Promise(r => setTimeout(r, 2000));
    }
    if (driveAccessToken) await saveOverridesToDrive();
  })();
}

// ---- CSV EXPORT ----
function exportCSV() {
  if (!parsedData || !parsedData.calls || parsedData.calls.length === 0) {
    alert('אין נתונים לייצוא — נתח קובץ תחילה');
    return;
  }
  const statusHe = { sab: 'סאב', open: 'לא שוייך לכונן', cancelled: 'בוטל', transferred: 'הועבר למחוזי' };
  const headers = ['מספר', 'תאריך', 'יום', 'שעה', 'מרחב', 'מיקום', 'רכב', 'כונן', 'סטטוס', 'הערה'];
  const rows = parsedData.calls.map((c, i) => {
    const handler = manualAssignments[c.index]
      ? manualAssignments[c.index].replace(/\|/g, ', ')
      : (c.handlerClean || '');
    const status = manualStatuses[c.index] || c.origStatus || c.status;
    const rawNote = manualNotes[c.index] !== undefined ? manualNotes[c.index] : (c.closingNote || '');
    // הערה רק לביטול או "לא שוייך לכונן" — לא לסאב
    const note = (status === 'cancelled' || status === 'open') ? rawNote : '';
    return [i + 1, c.date, c.dayName, c.time, c.region, c.location, c.vehicle,
      handler, statusHe[status] || status, note];
  });
  const csvContent = '\uFEFF' + [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const s = document.getElementById('weekStart').value;
  const e = document.getElementById('weekEnd').value;
  const fileName = `panther-${s||'all'}-to-${e||'all'}.csv`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
  if (driveAccessToken) writeFile(fileName, csvContent, 'text/csv');
}

// ---- PHONEBOOK EXPORT ----
function exportPhonebook() {
  const rows = [...volDatabase].sort().map((name, i) => [i+1, name]);
  const csvContent = '\uFEFF' + [['מספר', 'שם כונן'], ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'panther-phonebook.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ---- INIT ----
window.addEventListener('load', () => {
  setTimeout(() => {
    initDrive();
    setTimeout(() => {
      if (!driveTokenClient) return;
      // First try silent (works if token cached in browser)
      driveTokenClient.requestAccessToken({ prompt: '' });
      // If no token after 2.5s — open Google login automatically
      setTimeout(() => {
        if (!driveAccessToken) {
          driveTokenClient.requestAccessToken({ prompt: 'select_account' });
        }
      }, 2500);
    }, 1200);
  }, 1500);
});

function showDriveConnectBanner() {
  const notConn = document.getElementById("driveNotConnected");
  if (!notConn) return;
  notConn.innerHTML = `<div style="display:flex;align-items:center;gap:9px;flex:1;"><svg width="18" height="16" viewBox="0 0 87.3 78"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 27h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg><div><div style="font-size:13px;font-weight:600;color:var(--text-muted);">נדרש חיבור ל-Google Drive</div><div style="font-size:12px;color:var(--text-muted);opacity:0.7;margin-top:1px;">לחץ התחבר — יפתח חלון Google</div></div></div><button onclick="driveLogin()" style="padding:8px 16px;background:var(--blue-dark);color:white;border:none;border-radius:8px;font-family:Rubik,sans-serif;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0;">התחבר</button>`;
}

function scrollToUpload() {
  const el = document.getElementById('dropZone');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


// ===================== LIVE SYNC =====================
let lastOverridesEtag = null;
let lastDbEtag = null;
let liveSyncInterval = null;
let dbPendingUpdate = false;
let isInitialLoad = true;
let manualChangelog = {}; // callIndex -> [{user, action, time}]

async function getFileEtag(filename) {
  if (!driveAccessToken) return null;
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='${filename}' and trashed=false&fields=files(id,md5Checksum,modifiedTime,lastModifyingUser)`,
      { headers: { Authorization: 'Bearer ' + driveAccessToken } }
    );
    const data = await res.json();
    if (data.files && data.files.length > 0) {
      const f = data.files[0];
      // שמור uploader לשימוש בבאנר
      const email = f.lastModifyingUser?.emailAddress || '';
      let uploaderName = '';
      if (email === 'motiyair@gmail.com') uploaderName = 'מוטי';
      else if (email === 'shayhalaf@gmail.com') uploaderName = 'שי';
      else if (email.includes('nati') || email.includes('natabar')) uploaderName = 'נתי';
      else if (f.lastModifyingUser?.displayName) uploaderName = f.lastModifyingUser.displayName;
      window._lastDbUploader = uploaderName;
      return f.md5Checksum || f.modifiedTime;
    }
    return null;
  } catch(e) { return null; }
}

async function checkAndSyncOverrides() {
  if (!driveAccessToken) return;
  const etag = await getFileEtag('panther-overrides.json');
  if (!etag) return;
  if (lastOverridesEtag === null) { lastOverridesEtag = etag; return; }
  if (etag === lastOverridesEtag) return;
  // השתנה! טען מחדש
  lastOverridesEtag = etag;
  const data = await readFile('panther-overrides.json');
  if (!data) return;
  try {
    const obj = JSON.parse(data);
    if (obj.assignments) {
      const normalized = {};
      Object.entries(obj.assignments).forEach(([k, v]) => {
        normalized[k] = (v && v.includes(',') && !v.includes('|'))
          ? v.split(',').map(s => s.trim()).filter(Boolean).join('|')
          : v;
      });
      manualAssignments = { ...normalized };
    }
    if (obj.statuses) manualStatuses = { ...obj.statuses };
    if (obj.notes) manualNotes = { ...obj.notes };
    if (obj.changelog) manualChangelog = { ...obj.changelog };
    // רענן תצוגה בשקט
    if (parsedData) {
      const s = document.getElementById('weekStart').value;
      const e = document.getElementById('weekEnd').value;
      renderDashboard(s, e);
      showSyncNotice();
    }
  } catch(e) { console.error('Live sync error:', e); }
}



function showChangelog(callIndex) {
  const log = manualChangelog[callIndex] || [];
  const body = document.getElementById('changelogBody');
  if (!log.length) {
    body.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:20px;">אין שינויים רשומים</div>';
  } else {
    body.innerHTML = log.slice().reverse().map(entry => `
      <div style="padding:10px 0;border-bottom:1px solid var(--divider);display:flex;flex-direction:column;gap:3px;">
        <div style="font-size:13px;font-weight:700;color:var(--blue-dark);">${entry.user}</div>
        <div style="font-size:13px;color:var(--text);">${entry.action}</div>
        <div style="font-size:11px;color:var(--text-muted);">${entry.date} · ${entry.time}</div>
      </div>
    `).join('');
  }
  document.getElementById('changelogOverlay').classList.add('open');
}

function closeChangelog() {
  document.getElementById('changelogOverlay').classList.remove('open');
}

function addChangeLog(callIndex, action) {
  if (!manualChangelog[callIndex]) manualChangelog[callIndex] = [];
  const entry = {
    user: currentUserName || 'משתמש',
    action: action,
    time: new Date().toLocaleTimeString('he-IL', {hour:'2-digit', minute:'2-digit'}),
    date: new Date().toLocaleDateString('he-IL', {day:'2-digit', month:'2-digit'})
  };
  manualChangelog[callIndex].push(entry);
}

function clearChangeLog(callIndex) {
  delete manualChangelog[callIndex];
}

function showSyncNotice() {
  const now = new Date();
  const hh = now.getHours().toString().padStart(2,'0');
  const mm = now.getMinutes().toString().padStart(2,'0');
  const banner = document.getElementById('syncBanner');
  if (banner) {
    banner.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 87.3 78" style="width:18px;height:16px;vertical-align:middle;margin-left:4px;display:inline-block;"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg> <span>עודכן ב-${hh}:${mm}</span>`;
    banner.style.display = 'block';
  }
}

// בדוק אם המאגר הראשי השתנה — אם כן, הצג התראה
async function checkDbUpdate() {
  if (!driveAccessToken) return;
  const etag = await getFileEtag('panther-database.json');
  if (!etag) return;
  if (lastDbEtag === null) { lastDbEtag = etag; return; }
  if (etag === lastDbEtag) return;
  // DB השתנה!
  lastDbEtag = etag;
  dbPendingUpdate = true;
  showDbUpdateBanner();
}

// האם מסך הדאשבורד הראשי פתוח (ולא מודל/עריכה)
function isMainScreenActive() {
  const overlays = ['assignOverlay','volOverlay','chatOverlay'];
  for (const id of overlays) {
    const el = document.getElementById(id);
    if (el && el.classList.contains('open')) return false;
  }
  return true;
}

function showDbUpdateBanner() {
  if (!dbPendingUpdate) return;
  if (!isMainScreenActive()) return; // לא מציג בזמן עריכה
  const banner = document.getElementById('dbUpdateBanner');
  if (banner) {
    const uploader = window._lastDbUploader;
    const textEl = document.getElementById('dbUpdateBannerText');
    if (textEl) textEl.textContent = uploader
      ? `נתונים חדשים התקבלו מ${uploader}`
      : 'התקבלו נתונים חדשים למאגר';
    banner.style.display = 'block';
  }
}

function hideDbUpdateBanner() {
  const banner = document.getElementById('dbUpdateBanner');
  if (banner) banner.style.display = 'none';
}

// נקרא כשמודל נסגר — בדוק אם יש עדכון ממתין
function onModalClose() {
  if (dbPendingUpdate) showDbUpdateBanner();
}

// טען מחדש את ה-DB
async function reloadDB() {
  hideDbUpdateBanner();
  dbPendingUpdate = false;
  try {
    const data = await readFile('panther-database.json');
    if (!data) return;
    pantherDB = JSON.parse(data);
    lastDbEtag = await getFileEtag('panther-database.json');
    renderDashboard();
    showSyncNotice();
  } catch(e) { console.error('reloadDB error:', e); }
}

function startLiveSync() {
  if (liveSyncInterval) clearInterval(liveSyncInterval);
  liveSyncInterval = setInterval(() => {
    checkAndSyncOverrides();
    checkDbUpdate();
  }, 30000);
  // overrides etag — תמיד עדכן
  getFileEtag('panther-overrides.json').then(etag => { lastOverridesEtag = etag; });
  // DB etag — קבע רק אם עדיין לא נקבע (מונע איפוס בקריאות חוזרות ל-startLiveSync)
  if (lastDbEtag === null) {
    setTimeout(() => {
      getFileEtag('panther-database.json').then(etag => { lastDbEtag = etag; });
    }, 3000);
  }
}

