// ===================== STATE =====================
let parsedData = { calls: [], volunteers: {}, regions: {} };
let rawText = '';
let manualAssignments = {}; // callIndex -> volName
let manualStatuses = {};    // callIndex -> 'cancelled'|'open' (manual status override)
let manualNotes = {};       // callIndex -> closing note text
let volDatabase = new Set();
let assigningCallIndex = -1;
let acSelectedIdx = -1;

function loadStorage() {
  try {
    const saved = localStorage.getItem('yedidim_vols');
    if (saved) JSON.parse(saved).forEach(v => volDatabase.add(v));
    const savedAssign = localStorage.getItem('yedidim_assign');
    if (savedAssign) {
      const raw = JSON.parse(savedAssign);
      Object.entries(raw).forEach(([k, v]) => {
        if (v && v.includes(',') && !v.includes('|')) {
          raw[k] = v.split(',').map(s => s.trim()).filter(Boolean).join('|');
        }
      });
      manualAssignments = raw;
    }
    const savedStatus = localStorage.getItem('yedidim_statuses');
    if (savedStatus) manualStatuses = JSON.parse(savedStatus);
    const savedNotes = localStorage.getItem('yedidim_notes');
    if (savedNotes) manualNotes = JSON.parse(savedNotes);
  } catch(e) {}
}
function saveStorage() {
  try {
    localStorage.setItem('yedidim_vols', JSON.stringify([...volDatabase]));
    localStorage.setItem('yedidim_assign', JSON.stringify(manualAssignments));
    localStorage.setItem('yedidim_statuses', JSON.stringify(manualStatuses));
    localStorage.setItem('yedidim_notes', JSON.stringify(manualNotes));
  } catch(e) {}
}
loadStorage();

// ===================== FILE =====================
document.getElementById('fileInput').addEventListener('change', e => { if(e.target.files[0]) loadFile(e.target.files[0]); });
const dz = document.getElementById('dropZone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); if(e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });

function isPantherGroup(text) {
  // בדיקה שהקובץ הוא מקבוצת "ידידים פנתר - מבצעי"
  // מחפש מילים מאפיינות בשורות הראשונות (500 תווים) ובכל הטקסט
  const sample = text.slice(0, 2000);
  return /פנתר|ידידים|מבצעי|מרחב/i.test(sample) ||
         /שי כלאף|נתי.*בר זוהר|מוקד.*פנתר/i.test(sample);
}

function loadFile(file) {
  const name = file.name.toLowerCase();
  // Detect ZIP by extension or MIME type
  const isZip = name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
  if (isZip) {
    loadZipFile(file);
  } else {
    // Accept any text file regardless of name
    const r = new FileReader();
    r.onload = async e => {
      const text = e.target.result;
      // Validate it looks like a WhatsApp export (iOS or Android format)
      const looksLikeWA = /\[\d{1,2}\.\d{1,2}\.\d{4},/.test(text) || // iOS: [25.02.2026,
                          /\d{1,2}\/\d{1,2}\/\d{2,4},\s*\d{1,2}:\d{2}/.test(text) || // Android slash
                          /\d{1,2}\.\d{1,2}\.\d{4},\s*\d{1,2}:\d{2}\s*-/.test(text); // Android dots
      if (!looksLikeWA) {
        alert('הקובץ לא נראה כמו ייצוא וואטסאפ.\nוודא שייצאת את הצ\'אט מהאפליקציה.');
        return;
      }
      if (!isPantherGroup(text)) {
        alert('⚠️ הקובץ לא נראה כייצוא של קבוצת "ידידים פנתר - מבצעי".\nיש להעלות יצוא רק מקבוצה זו.');
        return;
      }
      await processText(text, file.name, file.size);
    };
    r.readAsText(file, 'utf-8');
  }
}

async function loadZipFile(file) {
  document.getElementById('dzSub').textContent = '⏳ מחלץ מהקובץ...';
  try {
    const JSZip = window.JSZip;
    if (!JSZip) { alert('שגיאה: ספריית ZIP לא נטענה'); return; }
    const zip = await JSZip.loadAsync(file);
    // Find any .txt file — prefer _chat.txt or WhatsApp*.txt, fall back to any txt
    let txtFile = null, fallback = null;
    zip.forEach((path, f) => {
      if (f.dir) return;
      const p = path.toLowerCase();
      if (p.endsWith('.txt')) {
        if (p.includes('_chat') || p.includes('whatsapp')) txtFile = f;
        else if (!fallback) fallback = f;
      }
    });
    txtFile = txtFile || fallback;
    if (!txtFile) { alert('לא נמצא קובץ טקסט בתוך ה-ZIP'); return; }
    const text = await txtFile.async('string');
    if (!isPantherGroup(text)) {
      alert('⚠️ הקובץ לא נראה כייצוא של קבוצת "ידידים פנתר - מבצעי".\nיש להעלות יצוא רק מקבוצה זו.');
      return;
    }
    await processText(text, file.name, file.size);
  } catch(err) {
    alert('שגיאה בפתיחת קובץ ZIP: ' + err.message);
  }
}

async function processText(text, fileName, fileSize) {
  console.log('[processText] start, length:', text.length);
  rawText = text;
  document.getElementById('dzSub').textContent = `✓ נטען: ${fileName} (${(fileSize/1024).toFixed(0)} KB)`;
  document.getElementById('analyzeBtn').disabled = false;
  // בנה/עדכן DB אם מחובר ל-Drive
  if (driveAccessToken) {
    try {
      console.log('[processText] saving to Drive...');
      document.getElementById('dzSub').textContent = `⏳ מעבד ושומר ב-Drive...`;
      await saveChatToDrive(text, fileName);
      console.log('[processText] saved. pantherDB calls:', pantherDB?.calls?.length);
      document.getElementById('dzSub').textContent = `✅ ${fileName} — נשמר ב-Drive`;
    } catch(e) { console.error('processText save error:', e); }
  } else {
    console.log('[processText] no driveAccessToken');
  }
  const dates = extractDates(rawText).sort((a,b)=>a-b);
  if (dates.length) {
    const last = dates[dates.length-1];
    const weekStart = getWeekStartSunday(last);
    const weekEnd = getWeekEndSaturday(last);
    document.getElementById('weekStart').value = fmtDate(weekStart);
    document.getElementById('weekEnd').value = fmtDate(weekEnd);
    // sync native date inputs on upload screen
    const us=document.getElementById('uploadStartDate'); if(us) us.value=fmtDate(weekStart);
    const ue=document.getElementById('uploadEndDate'); if(ue) ue.value=fmtDate(weekEnd);
    // sync header datepicker buttons
    ['btnUploadStart','btnStart'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='📅 '+formatDisplayDate(weekStart);});
    ['btnUploadEnd','btnEnd'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='📅 '+formatDisplayDate(weekEnd);});
    const ms=document.getElementById('mobileStartDate'); if(ms) ms.value=fmtDate(weekStart);
    const me=document.getElementById('mobileEndDate'); if(me) me.value=fmtDate(weekEnd);
  }
  // אם מחובר ל-Drive — שמור את הקובץ החדש בשקט (בלי לקפוץ למסך הקריאות)
  if (driveAccessToken) {
    saveChatToDrive(rawText).then(() => {
      // מצא את התאריך האחרון בקובץ ועדכן את התצוגה
      const lines = rawText.split('\n');
      const msgRe = /^\[(\d{1,2}\.\d{1,2}\.\d{4})|^(\d{1,2}\.\d{1,2}\.\d{4}),\s*\d{1,2}:\d{2}\s*-/;
      let lastDate = '';
      for (let i = lines.length - 1; i >= 0; i--) {
        const m = msgRe.exec(lines[i]);
        if (m) { lastDate = m[1]; break; }
      }
      showSmartUpload(pantherDB ? (pantherDB.meta?.lastDate || lastDate) : lastDate, pantherDB ? pantherDB.calls.length : lines.length);
      document.getElementById('dzSub').textContent = `✓ מאגר עודכן ב-Drive`;
    });
  }
}

function extractDates(text) {
  const dates = [];
  // iOS format: [25.02.2026,
  const reIOS = /\[(\d{1,2})\.(\d{1,2})\.(\d{4}),/g;
  let m;
  while((m=reIOS.exec(text))!==null) dates.push(new Date(m[3],m[2]-1,m[1]));
  // Android format: 25/02/2026, or 25/02/26,
  const reAndroid = /(\d{1,2})\/(\d{1,2})\/(\d{2,4}),/g;
  while((m=reAndroid.exec(text))!==null) {
    let y = parseInt(m[3]); if (y < 100) y += 2000;
    dates.push(new Date(y,m[2]-1,m[1]));
  }
  return dates;
}
function fmtDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }


// ===================== ANALYZE =====================
async function analyze() {
  // אם יש DB בזיכרון — השתמש בו ישירות
  if (pantherDB && pantherDB.calls && pantherDB.calls.length > 0) {
    let s=document.getElementById('weekStart').value, e=document.getElementById('weekEnd').value;
    if (!s || !e) {
      // ברירת מחדל: שבוע אחרון לפי תאריך אחרון ב-DB
      const lastDateStr = pantherDB.meta?.lastDate;
      if (lastDateStr) {
        const [d,mo,y] = lastDateStr.split('.');
        const last = new Date(y, mo-1, d);
        s = fmtDate(getWeekStartSunday(last));
        e = fmtDate(getWeekEndSaturday(last));
        document.getElementById('weekStart').value = s;
        document.getElementById('weekEnd').value = e;
      }
    }
    if(s) { calState.selectedStart=new Date(s); document.getElementById('btnStart').textContent='📅 '+formatDisplayDate(new Date(s)); }
    if(e) { calState.selectedEnd=new Date(e); document.getElementById('btnEnd').textContent='📅 '+formatDisplayDate(new Date(e)); }
    loadParsedFromDB(pantherDB, s, e);
    document.getElementById('uploadScreen').style.display='none';
    document.getElementById('dashboard').style.display='block';
    renderVolDb();
    startLiveSync();
    return;
  }

  // אין DB — עבוד עם TXT
  if (!rawText && driveAccessToken) {
    const chatText = await readFile('panther-chat.txt');
    if (chatText) {
      rawText = chatText;
      document.getElementById('dzSub').textContent = '✅ נטען מ-Drive';
    } else {
      alert('לא נמצא קובץ ב-Drive — אנא גרור קובץ וואטסאפ');
      return;
    }
  }
  if (!rawText) { alert('אנא גרור קובץ וואטסאפ'); return; }

  let s=document.getElementById('weekStart').value, e=document.getElementById('weekEnd').value;
  if (!s || !e) {
    const dates = extractDates(rawText).sort((a,b)=>a-b);
    if (dates.length) {
      const last = dates[dates.length-1];
      s = fmtDate(getWeekStartSunday(last));
      e = fmtDate(getWeekEndSaturday(last));
      document.getElementById('weekStart').value = s;
      document.getElementById('weekEnd').value = e;
    }
  }
  if(s) { calState.selectedStart=new Date(s); document.getElementById('btnStart').textContent='📅 '+formatDisplayDate(new Date(s)); }
  if(e) { calState.selectedEnd=new Date(e); document.getElementById('btnEnd').textContent='📅 '+formatDisplayDate(new Date(e)); }
  parsedData = parseWhatsApp(rawText, s?localDate(s):null, e?localDate(e):null);
  renderDashboard(s,e);
  document.getElementById('uploadScreen').style.display='none';
  document.getElementById('dashboard').style.display='block';
  renderVolDb();
  if (driveAccessToken) {
    saveChatToDrive(rawText);
    savePhonebookToDrive();
    startLiveSync();
  }
}


// ===================== RENDER DASHBOARD =====================
function renderDashboard(s,e) {
  // הפעל סנכרון חי אם עדיין לא פעיל
  if (driveAccessToken && !liveSyncInterval) startLiveSync();
  const {calls, regions} = parsedData;
  // We rebuild volunteers fresh every render to correctly handle additions AND removals
  const volunteers = {};

  // Sync mobile date inputs
  const ms = document.getElementById('mobileStartDate');
  const me = document.getElementById('mobileEndDate');
  if (ms && s) ms.value = s;
  if (me && e) me.value = e;

  // Apply manual assignments and rebuild volunteer counts from scratch
  calls.forEach(c => {
    // Always reset to original parsed values first
    c.status = c.origStatus;
    c.handlerClean = c.origHandlerClean;

    if (manualAssignments[c.index] !== undefined) {
      const assignment = manualAssignments[c.index];
      c.handlerClean = assignment;
      if (!assignment) {
        c.status = c.origStatus;
      } else {
        c.status = 'sab';
      }
    }

    // Apply manual status override (e.g. cancelled manually)
    if (manualStatuses[c.index] !== undefined) {
      c.status = manualStatuses[c.index];
      if (c.status !== 'sab') c.handlerClean = '';
    }

    // Apply manual closing note
    if (manualNotes[c.index] !== undefined) {
      c.closingNote = manualNotes[c.index];
    }
    // Count volunteers — split by pipe only (comma is part of names)
    if (c.status === 'sab' && c.handlerClean) {
      const names = c.handlerClean.split('|').map(n => n.trim()).filter(n => n.length >= 3);
      names.forEach(name => {
        // נרמול שמות: מצא מפתח קיים שחולק 2 מילים ראשונות זהות
        const nameParts = name.split(/\s+/);
        const nameKey2 = nameParts.slice(0,2).join(' '); // שם + משפחה
        const existingKey = Object.keys(volunteers).find(k => {
          const kParts = k.split(/\s+/);
          return kParts.slice(0,2).join(' ') === nameKey2;
        });
        const key = existingKey || name;
        // אם השם החדש ארוך יותר — הוא המועמד הטוב יותר; השתמש בארוך יותר כמפתח
        // (שי כמקור אמת — השם המעודכן ביותר יהיה הארוך/המדויק ביותר)
        const canonicalKey = existingKey && existingKey.length >= name.length ? existingKey : name;
        if (existingKey && existingKey !== canonicalKey) {
          // שנה מפתח לשם הקנוני (ארוך יותר)
          volunteers[canonicalKey] = volunteers[existingKey];
          delete volunteers[existingKey];
        }
        if (!volunteers[canonicalKey]) volunteers[canonicalKey] = {count:0, region:c.region, callIndices:[]};
        if (!volunteers[canonicalKey].callIndices.includes(c.index)) {
          volunteers[canonicalKey].count++;
          volunteers[canonicalKey].callIndices.push(c.index);
        }
      });
    }
  });

  const sab=calls.filter(c=>c.status==='sab');
  const cancelled=calls.filter(c=>c.status==='cancelled');
  const successfulRescueCount = Object.values(volunteers).reduce((sum, v) => sum + (v.count || 0), 0);

  // Dynamic section title based on date range
  const daysDiff = (s && e) ? Math.round((new Date(e)-new Date(s))/(1000*60*60*24))+1 : 0;
  let sectionTitle = 'קריאות';
  if (daysDiff <= 7) sectionTitle = 'קריאות השבוע';
  else if (daysDiff <= 31) sectionTitle = 'קריאות החודש';
  else sectionTitle = `קריאות התקופה`;
  if (s && e) sectionTitle += ` · ${s.split('-').reverse().join('.')}–${e.split('-').reverse().join('.')}`;
  const titleEl = document.getElementById('callsSectionTitle');
  if (titleEl) titleEl.textContent = sectionTitle;

  document.getElementById('statsRow').innerHTML=`
    <div class="stat-card" style="animation-delay:0s"><div class="stat-num">${calls.length}</div><div class="stat-label">סה"כ קריאות</div><div class="stat-emoji">📞</div></div>
    <div class="stat-card green" style="animation-delay:0.07s"><div class="stat-num">${sab.length}</div><div class="stat-label">חולצו בהצלחה (סא"ב)</div><div class="stat-emoji">✅</div></div>
    <div class="stat-card purple" style="animation-delay:0.14s"><div class="stat-num">${Object.keys(volunteers).length}</div><div class="stat-label">כוננים פעילים</div><div class="stat-emoji">👥</div></div>`;

  document.getElementById('callsBadge').textContent=`${calls.length} קריאות`;
  document.getElementById('callsList').innerHTML = calls.length
    ? calls.map((c,i)=>callRowHtml(c,i)).join('')
    : '<div class="empty-msg">לא נמצאו קריאות</div>';

  const vs=Object.entries(volunteers).sort((a,b)=>b[1].count-a[1].count);
  document.getElementById('volBadge').textContent=`${vs.length} כוננים`;
  // Assign medals based on count — shared medal for tied counts
  // Only give medals if count > 1 (avoid everyone getting gold with 1 call)
  const counts = [...new Set(vs.map(([,d])=>d.count))].sort((a,b)=>b-a);
  const [top, second, third] = counts;
  const getMedal = (count) => {
    if (count < 2) return null; // תנאי סף: מדליה רק אם יותר מקריאה אחת
    if (count === top) return 'gold';
    if (count === second) return 'silver';
    if (count === third) return 'bronze';
    return null;
  };
  document.getElementById('volList').innerHTML=vs.length?vs.map(([name,data],i)=>{
    const medal = getMedal(data.count);
    const rankNum = i+1;
    const shortName = name;
    const medalClass = medal==='gold'?'medal-gold':medal==='silver'?'medal-silver':medal==='bronze'?'medal-bronze':'medal-plain';
    const medalEmoji = medal==='gold' ? '🥇' : medal==='silver' ? '🥈' : medal==='bronze' ? '🥉' : '';
    const rankDisplay = medalEmoji
      ? `<span style="font-size:34px;line-height:1;flex-shrink:0;display:flex;align-items:center;">${medalEmoji}</span>`
      : `<div class="vol-rank">${rankNum}</div>`;
    return `<div class="vol-row" onclick="showVolCalls('${name.replace(/'/g,"\\'")}',${JSON.stringify(data.callIndices)})">
      ${rankDisplay}
      <div class="vol-info"><div class="vol-name" title="${name}">${shortName}</div><div class="vol-sub">${data.count} קריאות · לחץ לצפייה</div></div>
      <div class="vol-count">${data.count}</div>
    </div>`;
  }).join(''):'<div class="empty-msg">לא זוהו כוננים</div>';

  const maxT=Math.max(...Object.values(regions).map(r=>r.total),1);
  document.getElementById('regionBadge').textContent=`${Object.keys(regions).length} אזורים`;
  document.getElementById('regionsGrid').innerHTML=Object.entries(regions).sort((a,b)=>b[1].total-a[1].total).map(([n,d],i)=>`
    <div class="region-card">
      <div class="region-name">מרחב ${n}</div>
      <div class="region-bar-wrap"><div class="region-bar rc${i%5}" style="width:${Math.round(d.total/maxT*100)}%"></div></div>
      <div class="region-nums"><strong>${d.total}</strong> קריאות · <strong>${d.sab}</strong> חולצו</div>
    </div>`).join('');

  // Populate search region dropdown
  const sel=document.getElementById('searchRegion');
  sel.innerHTML='<option value="">כל האזורים</option>'+Object.keys(regions).sort().map(r=>`<option value="${r}">מרחב ${r}</option>`).join('');
}

function callRowHtml(c,i) {
  const cancelReason = (manualNotes[c.index] !== undefined ? manualNotes[c.index] : (c.closingNote ? formatCancelReason(c.closingNote) : ''));

  const statusBadge = c.status==='sab'
    ? '<span class="status-sab">סא"ב ✓</span>'
    : c.status==='cancelled'
      ? '<span class="status-cancelled">בוטל</span>'
      : c.status==='transferred'
        ? '<span class="status-transferred">📋 הועבר למחוזי</span>'
        : '<span class="status-open">⚠ לא שוייך לכונן</span>';

  const cancelLine = (c.status==='cancelled' || c.status==='transferred') && cancelReason
    ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
        ↩ <span class="cancel-reason-text" onclick="event.stopPropagation();editCancelReason(${c.index})" title="לחץ לעריכה" style="cursor:pointer;border-bottom:1px dashed var(--text-muted);">${cancelReason}</span>
        <span style="font-size:10px;opacity:0.5;margin-right:2px;">✏️</span>
      </div>`
    : c.status==='cancelled'
      ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
          <span class="cancel-reason-text" onclick="event.stopPropagation();editCancelReason(${c.index})" title="לחץ להוספת סיבה" style="cursor:pointer;border-bottom:1px dashed var(--text-muted);">+ הוסף סיבה</span>
         </div>`
      : '';

  const handlerLine = c.handlerClean
    ? `<div class="handler-name">
        🙋 טיפל בקריאה:
        <button class="handler-edit-btn" onclick="event.stopPropagation();openAssign(${c.index})"><strong>${c.handlerClean.split('|').map(n=>n.trim()).join(', ')}</strong></button>
        <span class="handler-edit-hint">· לחץ לשינוי</span>
      </div>`
    : `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <button class="btn-assign" onclick="event.stopPropagation();openAssign(${c.index})">+ שייך כונן</button>
        ${c.status==='open' ? `<button class="btn-cancel-manual" onclick="event.stopPropagation();manualCancel(${c.index})">✕ סמן כבוטל</button>` : ''}
        ${c.status==='cancelled' && manualStatuses[c.index]==='cancelled' ? `<button class="btn-cancel-manual" onclick="event.stopPropagation();manualUncancel(${c.index})" style="background:rgba(39,174,96,0.12);color:var(--green);">↩ פתח מחדש</button>` : ''}
      </div>`;

  const isMuted = c.status==='cancelled' || c.status==='transferred';
  const rowClass = isMuted ? 'call-row is-cancelled' : 'call-row';

  return `<div class="${rowClass}" id="call-${c.index}" ondblclick="openChatViewer(${c.index})" title="לחץ פעמיים לצפייה בשיחה">
    <div class="call-idx">${i+1}</div>
    <div style="flex:1;min-width:0;overflow-wrap:anywhere;word-break:break-word;">
      <div class="call-loc">📍 ${c.location}</div>
      <div class="call-meta">
        <span>מרחב ${c.region}</span>
        ${c.vehicle?`<span>${c.vehicle}</span>`:''}
      </div>
      ${handlerLine}
      ${cancelLine}
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:4px;">
        <button class="btn-chat-view" onclick="event.stopPropagation();openChatViewer(${c.index})">💬 צפה בשיחה</button>
        ${c.handlerClean ? `<button class="btn-add-handler" onclick="event.stopPropagation();openAssign(${c.index})">+ כונן</button>` : ''}
        ${manualChangelog[c.index] && manualChangelog[c.index].length > 0 ? `<button class="btn-changelog" onclick="event.stopPropagation();showChangelog(${c.index})" title="היסטוריית שינויים"><svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" style="color:var(--blue-mid);"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><line x1="8" y1="9" x2="13" y2="9" stroke="currentColor" stroke-width="0.8" stroke-linecap="round"/><line x1="8" y1="11.5" x2="16" y2="11.5" stroke="currentColor" stroke-width="0.8" stroke-linecap="round"/><g fill="currentColor" stroke="none" opacity="0.8"><circle cx="9.5" cy="15.5" r="0.8"/><circle cx="11" cy="14" r="0.8"/><circle cx="13" cy="14" r="0.8"/><circle cx="14.5" cy="15.5" r="0.8"/><path d="M12 17c-1.5 0-2.5.6-2.8 1.4-.3.8 1 2 2.8 2s3.1-1.2 2.8-2c-.3-.8-1.3-1.4-2.8-1.4z"/></g></svg></button>` : ''}
      </div>
    </div>
    <div class="call-right">
      <div class="call-date">${c.date}</div>
      <div class="call-time">${c.dayName}׳ ${c.time}</div>
      ${statusBadge}
    </div>
  </div>`;
}

function formatCancelReason(note) {
  const n = note.trim();
  if (/הועבר למחוזי|נלקח במחוזי|מחוזי/i.test(n)) return 'הועבר למחוזי';
  if (/מישהו שם חילץ|מישהו עזר|חילצו אותו|עזרה מקומית/i.test(n)) return 'חולץ ע"י אחר';
  if (/עובר אורח/i.test(n)) return 'חולץ ע"י עובר אורח';
  if (/הסתדר לבד|הסתדרו לבד/i.test(n)) return 'הסתדרו לבד';
  if (/יצא לבד|יצאו לבד/i.test(n)) return 'יצא לבד';
  if (/חולץ.*טלפונית/i.test(n)) return 'חולץ טלפונית';
  if (/חולץ.*חבר/i.test(n)) return 'חולץ ע"י חבר';
  if (/חולץ.*מכונא/i.test(n)) return 'חולץ ע"י מכונאי';
  if (/סיום/i.test(n)) return 'סיום';
  if (/בוטל|ביטל/i.test(n)) return 'בוטל';
  return n.substring(0, 30);
}

// ===================== SEARCH =====================
function switchTab(tab) {
  ['dash','search','vols'].forEach(t=>{
    document.getElementById('tab'+t.charAt(0).toUpperCase()+t.slice(1)).style.display=t===tab?'block':'none';
    document.getElementById('tab-'+t).classList.toggle('active',t===tab);
  });
  if(tab==='search') doSearch();
  if(tab==='vols') renderVolDb();
}
// Fix tab IDs
function switchTab(tab) {
  document.getElementById('tabDash').style.display=tab==='dash'?'block':'none';
  document.getElementById('tabSearch').style.display=tab==='search'?'block':'none';
  document.getElementById('tabVols').style.display=tab==='vols'?'block':'none';
  document.getElementById('tab-dash').classList.toggle('active',tab==='dash');
  document.getElementById('tab-search').classList.toggle('active',tab==='search');
  document.getElementById('tab-vols').classList.toggle('active',tab==='vols');
  if(tab==='search') doSearch();
  if(tab==='vols') renderVolDb();
}

function doSearch() {
  const {calls}=parsedData;
  const q=(document.getElementById('searchText').value||'').toLowerCase().trim();
  const rf=document.getElementById('searchRegion').value;
  const sf=document.getElementById('searchStatus').value;
  const res=calls.filter(c=>{
    if(rf&&c.region!==rf) return false;
    if(sf&&c.status!==sf) return false;
    if(q&&!`${c.location} ${c.vehicle} ${c.handlerClean} ${c.region} ${c.date}`.toLowerCase().includes(q)) return false;
    return true;
  });
  document.getElementById('searchCount').textContent=`נמצאו ${res.length} קריאות`;
  document.getElementById('searchResults').innerHTML=res.length
    ? res.map((c,i)=>callRowHtml(c,i)).join('')
    : '<div class="empty-msg">לא נמצאו תוצאות</div>';
}

// ===================== VOLUNTEERS DB =====================
function renderVolDb() {
  const q=(document.getElementById('volDbSearch')||{value:''}).value.toLowerCase();
  const vols=[...volDatabase].filter(v=>!q||v.toLowerCase().includes(q)).sort();
  const badge=document.getElementById('volDbBadge');
  const list=document.getElementById('volDbList');
  if(badge) badge.textContent=`${volDatabase.size} כוננים`;
  if(!list) return;
  list.innerHTML=vols.length?vols.map(v=>`
    <div style="padding:12px 20px;border-bottom:1px solid var(--bg);display:flex;align-items:center;">
      <div style="font-size:14px;font-weight:600">🙋 ${v}</div>
    </div>`).join(''):'<div class="empty-msg">אין כוננים במאגר</div>';
}

function addVolManual() {
  const name=prompt('שם הכונן:');
  if(name&&name.trim()) { volDatabase.add(name.trim()); saveAll(); renderVolDb(); }
}
function removeVol(name) {
  volDatabase.delete(name); saveAll(); renderVolDb();
}

// ===================== ASSIGN =====================
let pendingHandlers = []; // array of names for current assignment
let originalHandlers = []; // snapshot when modal opened

function markDirty() {
  const isDirty = JSON.stringify(pendingHandlers) !== JSON.stringify(originalHandlers)
    || document.getElementById('assignInput').value.trim() !== '';
  document.getElementById('assignActions').style.display = isDirty ? 'flex' : 'none';
  document.getElementById('assignNoChanges').style.display = isDirty ? 'none' : 'block';
}

function editCancelReason(callIndex) {
  const c = parsedData.calls[callIndex];
  const current = manualNotes[callIndex] || c.closingNote || '';
  const newNote = prompt('עריכת סיבת סיום:', current);
  if (newNote === null) return; // cancelled
  const oldNote = manualNotes[callIndex];
  manualNotes[callIndex] = newNote.trim();
  if (oldNote !== newNote.trim()) addChangeLog(callIndex, 'עריכת הערה: ' + (newNote.trim() || '(נמחק)'));
  saveAll();
  showSyncNotice();
  const s=document.getElementById('weekStart').value, e=document.getElementById('weekEnd').value;
  renderDashboard(s,e);
}

function manualCancel(callIndex) {
  manualStatuses[callIndex] = 'cancelled';
  manualNotes[callIndex] = manualNotes[callIndex] || 'בוטל ידנית';
  delete manualAssignments[callIndex];
  addChangeLog(callIndex, 'ביטול קריאה');
  saveAll();
  showSyncNotice();
  const s=document.getElementById('weekStart').value, e=document.getElementById('weekEnd').value;
  if (rawText) {
    parsedData = parseWhatsApp(rawText, s ? localDate(s) : null, e ? localDate(e) : null);
  }
  renderDashboard(s,e);
}

function manualUncancel(callIndex) {
  delete manualStatuses[callIndex];
  addChangeLog(callIndex, 'שחרור ביטול');
  saveAll();
  showSyncNotice();
  const s=document.getElementById('weekStart').value, e=document.getElementById('weekEnd').value;
  if (rawText) {
    parsedData = parseWhatsApp(rawText, s ? localDate(s) : null, e ? localDate(e) : null);
  }
  renderDashboard(s,e);
}

function openAssign(callIndex) {
  assigningCallIndex = callIndex;
  const c = parsedData.calls[callIndex];
  document.getElementById('assignCallInfo').innerHTML = `<strong>📍 ${c.location}</strong><br>מרחב ${c.region} · ${c.date} ${c.time}`;
  document.getElementById('assignInput').value = '';
  acSelectedIdx = -1;
  const existing = manualAssignments[callIndex] || c.handlerClean || '';
  pendingHandlers = existing ? existing.split('|').map(s=>s.trim()).filter(Boolean) : [];
  originalHandlers = [...pendingHandlers];
  renderHandlerTags();
  updateAcList('');
  markDirty();

  document.getElementById('assignOverlay').classList.add('open');
  setTimeout(()=>document.getElementById('assignInput').focus(), 100);
}

async function clearAssignOverride() {
  if (!confirm('למחוק את השיוך הידני ולחזור לפרסינג האוטומטי?')) return;
  delete manualAssignments[assigningCallIndex];
  saveAll();
  closeAssign();
  const s = document.getElementById('weekStart').value;
  const e = document.getElementById('weekEnd').value;
  parsedData = parseWhatsApp(rawText, s ? localDate(s) : null, e ? localDate(e) : null);
  renderDashboard(s, e);
}

function renderHandlerTags() {
  document.getElementById('handlerTags').innerHTML = pendingHandlers.length
    ? pendingHandlers.map((name,i) =>
        `<div class="handler-tag">🙋 ${name} <button type="button" onclick="removeHandlerTag(${i});return false;">×</button></div>`
      ).join('')
    : '<span style="font-size:13px;color:var(--text-muted)">אין כוננים משויכים</span>';
}

function removeHandlerTag(i) {
  pendingHandlers.splice(i, 1);
  renderHandlerTags();
  markDirty();
}

function selectVol(name) {
  if (!pendingHandlers.includes(name)) {
    pendingHandlers.push(name);
    renderHandlerTags();
  }
  document.getElementById('assignInput').value = '';
  document.getElementById('assignList').innerHTML = '';
  acSelectedIdx = -1;
  markDirty();
  document.getElementById('assignInput').focus();
}

function onAssignInput() {
  updateAcList(document.getElementById('assignInput').value);
  markDirty();
}

function updateAcList(q) {
  const lq = q.toLowerCase();
  const matches=[...volDatabase].filter(v=>v.toLowerCase().includes(lq)).sort().slice(0,8);
  document.getElementById('assignList').innerHTML=matches.map((v,i)=>`
    <div class="autocomplete-item${i===acSelectedIdx?' selected':''}" onmousedown="selectVol('${v.replace(/'/g,"\\'")}')">${v}</div>`).join('');
  document.getElementById('assignList').style.display=matches.length?'block':'none';
}

function onAssignKey(e) {
  const items=document.querySelectorAll('.autocomplete-item');
  if(e.key==='ArrowDown'){acSelectedIdx=Math.min(acSelectedIdx+1,items.length-1);updateAcList(document.getElementById('assignInput').value);}
  else if(e.key==='ArrowUp'){acSelectedIdx=Math.max(acSelectedIdx-1,-1);updateAcList(document.getElementById('assignInput').value);}
  else if(e.key==='Enter'){if(acSelectedIdx>=0&&items[acSelectedIdx]){selectVol(items[acSelectedIdx].textContent);}else{confirmAssign();}}
  else if(e.key==='Escape'){closeAssign();}
}

async function confirmAssign() {
  const typed = document.getElementById('assignInput').value.trim();
  if (typed && !pendingHandlers.includes(typed)) pendingHandlers.push(typed);
  const combined = pendingHandlers.join(' | ');
  const prevAssign = manualAssignments[assigningCallIndex];
  manualAssignments[assigningCallIndex] = combined || undefined;
  pendingHandlers.forEach(n => volDatabase.add(n));
  if (combined !== (prevAssign || '')) {
    const prevList = prevAssign ? prevAssign.split('|').map(n=>n.trim()) : [];
    const newList = pendingHandlers;
    const added = newList.filter(n => !prevList.includes(n));
    const removed = prevList.filter(n => !newList.includes(n));
    if (added.length) addChangeLog(assigningCallIndex, 'נוסף כונן: ' + added.join(', '));
    if (removed.length) addChangeLog(assigningCallIndex, 'הוסר כונן: ' + removed.join(', '));
    if (!added.length && !removed.length && combined) addChangeLog(assigningCallIndex, 'עודכן שיוך כונן');
  }
  // לוגיקת סטטוס אוטומטית
  if (combined) {
    manualStatuses[assigningCallIndex] = 'sab';
  } else if (prevAssign) {
    manualStatuses[assigningCallIndex] = 'cancelled';
    if (manualNotes[assigningCallIndex] === undefined) manualNotes[assigningCallIndex] = '';
  }
  saveStorage(); // always save locally
  closeAssign();
  const s=document.getElementById('weekStart').value, e=document.getElementById('weekEnd').value;
  renderDashboard(s,e);
  // Save to Drive — ensure token is fresh
  if (!driveAccessToken && driveTokenClient) {
    driveTokenClient.requestAccessToken({ prompt: '' });
    await new Promise(r => setTimeout(r, 2000));
  }
  if (driveAccessToken) {
    await saveOverridesToDrive();
    showSyncNotice();
  }
}

function closeAssign() {
  document.getElementById('assignOverlay').classList.remove('open');
  onModalClose();
  document.getElementById('assignList').style.display='none';
}

// ===================== VOL CALLS MODAL =====================
function showVolCalls(name, indices) {
  const {calls} = parsedData;
  const volCalls = indices.map(idx => calls[idx]);
  const sabCount = volCalls.filter(c => c.status==='sab').length;
  const regions = [...new Set(volCalls.map(c => c.region))].join(', ');

  document.getElementById('volModalTitle').innerHTML = `🙋 ${name}`;
  document.getElementById('volModalSummary').innerHTML = `
    <div style="flex:1;text-align:center;background:white;border-radius:10px;padding:10px;box-shadow:var(--shadow)">
      <div style="font-size:24px;font-weight:700;color:var(--orange)">${indices.length}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:2px">קריאות</div>
    </div>
    <div style="flex:1;text-align:center;background:white;border-radius:10px;padding:10px;box-shadow:var(--shadow)">
      <div style="font-size:24px;font-weight:700;color:var(--green)">${sabCount}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:2px">סא"ב</div>
    </div>
    <div style="flex:1;text-align:center;background:white;border-radius:10px;padding:10px;box-shadow:var(--shadow)">
      <div style="font-size:13px;font-weight:600;color:var(--blue-mid);line-height:1.3">${regions||'—'}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:2px">אזור</div>
    </div>
  `;

  document.getElementById('volModalBody').innerHTML = volCalls.map((c, i) => {
    const statusBadge = c.status==='sab'
      ? `<span style="font-size:11px;font-weight:700;color:var(--green);background:rgba(39,174,96,0.1);padding:2px 8px;border-radius:5px">סא"ב ✓</span>`
      : c.status==='transferred'
      ? `<span style="font-size:11px;font-weight:700;color:var(--purple);background:rgba(155,89,182,0.1);padding:2px 8px;border-radius:5px">מחוזי</span>`
      : `<span style="font-size:11px;font-weight:700;color:var(--text-muted);background:var(--bg);padding:2px 8px;border-radius:5px">בוטל</span>`;
    return `<div class="modal-call-row" onclick="event.stopPropagation();scrollToCall(${indices[i]})">
      <div class="modal-num">${i+1}</div>
      <div>
        <div class="modal-loc">📍 ${c.location}</div>
        <div class="modal-meta">מרחב ${c.region}${c.vehicle?' · '+c.vehicle:''} · ${c.date} ${c.time}</div>
        <div style="margin-top:4px">${statusBadge}</div>
      </div>
      <div class="modal-time" style="font-size:11px;color:var(--text-muted);text-align:left;white-space:nowrap">${c.dayName}<br>${c.time}</div>
    </div>`;
  }).join('');
  document.getElementById('volOverlay').classList.add('open');
}

function closeVolModal(e) {
  if(e&&e.target!==document.getElementById('volOverlay')) return;
  document.getElementById('volOverlay').classList.remove('open');
  onModalClose();
}

function scrollToCall(idx) {
  
  const call = parsedData && parsedData.calls ? parsedData.calls.find(c => c.index === idx) : null;
  
  document.getElementById('volOverlay').classList.remove('open');
  onModalClose();

  // Expand date range if needed to include this call
  if (call && call.date) {
    const [d,m,y] = call.date.split('.');
    const callDateStr = `${y}-${m}-${d}`;
    const curStart = document.getElementById('weekStart').value;
    const curEnd = document.getElementById('weekEnd').value;
    let newStart = curStart;
    let newEnd = curEnd;
    if (callDateStr < curStart) newStart = callDateStr;
    if (callDateStr > curEnd)   newEnd = callDateStr;
    // Always re-render to make sure call-${idx} is in DOM
    document.getElementById('weekStart').value = newStart;
    document.getElementById('weekEnd').value = newEnd;
    renderDashboard(newStart, newEnd);
  }

  // Scroll with enough delay for render + paint
  setTimeout(() => {
    const el = document.getElementById(`call-${idx}`);
    
    if (el) {
      el.scrollIntoView({behavior:'smooth', block:'center'});
      el.style.background = 'rgba(232,115,42,0.22)';
      el.style.transition = 'background 1.5s';
      setTimeout(() => { el.style.background = ''; }, 2500);
    }
  }, 400);
}

function goBack() {
  document.getElementById('dashboard').style.display='none';
  document.getElementById('uploadScreen').style.display='flex';
}

// Sunday = first day of week helper
function getWeekStartSunday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - day);
  return d;
}
function getWeekEndSaturday(date) {
  const d = getWeekStartSunday(date);
  d.setDate(d.getDate() + 6);
  return d;
}

// Default dates — snap to current week Sun–Sat
const today=new Date();
const defStart = getWeekStartSunday(today);
const defEnd = getWeekEndSaturday(today);
document.getElementById('weekEnd').value=fmtDate(defEnd);
document.getElementById('weekStart').value=fmtDate(defStart);

// ===================== CUSTOM CALENDAR =====================
function capitalize(s) { return s.charAt(0).toUpperCase()+s.slice(1); }

// State
let calState = {
  which: null,          // 'start' | 'end'
  viewYear: 0,
  viewMonth: 0,
  selectedStart: null,  // Date
  selectedEnd: null,    // Date
};

const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const HE_DAYS = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳']; // Sun=0 → א׳

function toggleCal(which) {
  const popupId = 'cal'+capitalize(which);
  const popup = document.getElementById(popupId);
  const btnId = 'btn'+capitalize(which);
  if (!popup) return;
  const isOpen = popup.classList.contains('open');
  closeAllCals();
  if (isOpen) return;
  calState.which = which;
  const ref = which==='end'
    ? (calState.selectedEnd || calState.selectedStart || new Date())
    : (calState.selectedStart || new Date());
  const base = ref;
  calState.viewYear = base.getFullYear();
  calState.viewMonth = base.getMonth();
  renderCal(which, popupId, btnId);
  popup.classList.add('open');
  if (window.innerWidth <= 640) showCalBackdrop();
}

function toggleUploadCal(which) {
  const popupId = 'calUpload'+capitalize(which);
  const popup = document.getElementById(popupId);
  const btnId = 'btnUpload'+capitalize(which);
  const btn = document.getElementById(btnId);
  if (!popup || !btn) return;
  const isOpen = popup.classList.contains('open');
  closeAllCals();
  if (isOpen) return;
  calState.which = 'upload-'+which;
  const ref = which==='end'
    ? (calState.selectedEnd || calState.selectedStart || new Date())
    : (calState.selectedStart || new Date());
  const base = ref;
  calState.viewYear = base.getFullYear();
  calState.viewMonth = base.getMonth();
  renderCal('upload-'+which, popupId, btnId);
  // Position using fixed coordinates relative to button
  const rect = btn.getBoundingClientRect();
  popup.style.top = (rect.bottom + 6) + 'px';
  popup.style.right = (window.innerWidth - rect.right) + 'px';
  popup.style.left = 'auto';
  popup.classList.add('open');
  if (window.innerWidth <= 640) showCalBackdrop();
}

function showCalBackdrop() {
  let bd = document.getElementById('calBackdrop');
  if (!bd) {
    bd = document.createElement('div');
    bd.id = 'calBackdrop';
    bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:1100;';
    bd.addEventListener('mousedown', () => closeAllCals());
    bd.addEventListener('touchstart', () => closeAllCals());
    document.body.appendChild(bd);
  }
  bd.style.display = 'block';
}

function closeAllCals() {
  document.querySelectorAll('.cal-popup').forEach(p => p.classList.remove('open'));
  const bd = document.getElementById('calBackdrop');
  if (bd) bd.style.display = 'none';
}

// Close on outside click — use mousedown to beat the click event
document.addEventListener('mousedown', e => {
  document.querySelectorAll('.cal-popup.open').forEach(popup => {
    if (!popup.contains(e.target) && !e.target.classList.contains('datepicker-display')) {
      closeAllCals();
    }
  });
});

function renderCal(which, popupId, btnId) {
  const popup = document.getElementById(popupId);
  const y = calState.viewYear, m = calState.viewMonth;
  const baseWhich = which.replace('upload-','');

  let html = `<div class="cal-nav">
    <button onclick="calNav(-1,'${which}','${popupId}','${btnId}')">‹</button>
    <span class="cal-month-label">${HE_MONTHS[m]} ${y}</span>
    <button onclick="calNav(1,'${which}','${popupId}','${btnId}')">›</button>
  </div>
  <div class="cal-grid">`;

  HE_DAYS.forEach(d => { html += `<div class="cal-day-name">${d}</div>`; });

  const firstDay = new Date(y, m, 1).getDay();
  for (let i=0; i<firstDay; i++) html += `<div class="cal-day empty"></div>`;

  const daysInMonth = new Date(y, m+1, 0).getDate();
  const todayStr = fmtDate(new Date());

  for (let d=1; d<=daysInMonth; d++) {
    const dateObj = new Date(y, m, d);
    const dateStr = fmtDate(dateObj);
    const isToday = dateStr === todayStr;
    const isStart = calState.selectedStart && fmtDate(calState.selectedStart)===dateStr;
    const isEnd = calState.selectedEnd && fmtDate(calState.selectedEnd)===dateStr;
    const inRange = calState.selectedStart && calState.selectedEnd &&
      dateObj > calState.selectedStart && dateObj < calState.selectedEnd;

    let cls = 'cal-day';
    if (isStart || isEnd) cls += ' selected';
    else if (inRange) cls += ' in-range';
    if (isToday) cls += ' today';

    html += `<div class="${cls}" onclick="calSelectDay(${y},${m},${d},'${which}','${popupId}','${btnId}')">${d}</div>`;
  }

  html += `</div>
  <div class="cal-footer">
    <button class="cal-btn-today" onclick="calSelectDay(${new Date().getFullYear()},${new Date().getMonth()},${new Date().getDate()},'${which}','${popupId}','${btnId}')">היום</button>
    <button class="cal-btn-clear" onclick="calClear('${which}','${popupId}','${btnId}')">נקה</button>
  </div>`;

  popup.innerHTML = html;
}

function calNav(dir, which, popupId, btnId) {
  calState.viewMonth += dir;
  if (calState.viewMonth > 11) { calState.viewMonth=0; calState.viewYear++; }
  if (calState.viewMonth < 0)  { calState.viewMonth=11; calState.viewYear--; }
  renderCal(which, popupId, btnId);
}

function toggleCalMobile(which) {
  const popupId = 'cal'+capitalize(which)+'Mobile';
  const popup = document.getElementById(popupId);
  const btnId = 'btn'+capitalize(which)+'Mobile';
  if (!popup) return;
  const isOpen = popup.classList.contains('open');
  closeAllCals();
  if (isOpen) return;
  calState.which = 'mobile-'+which;
  const ref = which==='end'
    ? (calState.selectedEnd || calState.selectedStart || new Date())
    : (calState.selectedStart || new Date());
  const base = ref;
  calState.viewYear = base.getFullYear();
  calState.viewMonth = base.getMonth();
  renderCal('mobile-'+which, popupId, btnId);
  popup.classList.add('open');
  showCalBackdrop();
}

function calSelectDay(y, m, d, which, popupId, btnId) {
  const date = new Date(y, m, d);
  const baseWhich = which.replace('upload-','').replace('mobile-','');
  const isUpload = which.startsWith('upload-');
  const isMobile = which.startsWith('mobile-');
  const fmt = '📅 ' + formatDisplayDate(date);

  if (baseWhich==='start') {
    calState.selectedStart = date;
    document.getElementById('weekStart').value = fmtDate(date);
    document.getElementById(btnId).textContent = fmt;
    closeAllCals();
    // Auto-open end — תמיד קפוץ לחודש של start
    calState.selectedEnd = null;
    document.getElementById('weekEnd').value = '';
    ['btnEnd','btnUploadEnd','btnEndMobile'].forEach(id => {
      const el = document.getElementById(id); if(el) el.textContent = '📅 —';
    });
    setTimeout(() => {
      if (isUpload) toggleUploadCal('end');
      else if (isMobile) toggleCalMobile('end');
      else toggleCal('end');
    }, 150);
  } else {
    calState.selectedEnd = date;
    document.getElementById('weekEnd').value = fmtDate(date);
    document.getElementById(btnId).textContent = fmt;
    closeAllCals();
  }

  // Sync ALL date buttons
  ['btnStart','btnUploadStart','btnStartMobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el && baseWhich==='start') el.textContent = fmt;
  });
  ['btnEnd','btnUploadEnd','btnEndMobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el && baseWhich==='end') el.textContent = fmt;
  });

  reanalyze();
}

function calClear(which, popupId, btnId) {
  const baseWhich = which.replace('upload-','').replace('mobile-','');
  if (baseWhich==='start') {
    calState.selectedStart = null;
    document.getElementById('weekStart').value = '';
    ['btnStart','btnUploadStart','btnStartMobile'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '📅 התחלה';
    });
  } else {
    calState.selectedEnd = null;
    document.getElementById('weekEnd').value = '';
    ['btnEnd','btnUploadEnd','btnEndMobile'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '📅 סיום';
    });
  }
  closeAllCals();
}

function formatDisplayDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

// Initialize all calendar buttons with default dates
calState.selectedStart = defStart;
calState.selectedEnd = defEnd;
['btnStart','btnUploadStart','btnStartMobile'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.textContent = '📅 ' + formatDisplayDate(defStart);
});
['btnEnd','btnUploadEnd','btnEndMobile'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.textContent = '📅 ' + formatDisplayDate(defEnd);
});

function onMobileDateChange() {
  const s = document.getElementById('mobileStartDate').value;
  const e = document.getElementById('mobileEndDate').value;
  if (!s || !e) return;
  document.getElementById('weekStart').value = s;
  document.getElementById('weekEnd').value = e;
  // sync desktop pickers
  calState.selectedStart = new Date(s);
  calState.selectedEnd = new Date(e);
  const fmt = d => `📅 ${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
  ['btnStart','btnUploadStart'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=fmt(calState.selectedStart); });
  ['btnEnd','btnUploadEnd'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=fmt(calState.selectedEnd); });
  reanalyze();
}

function onUploadDateChange() {
  const s = document.getElementById('uploadStartDate').value;
  const e = document.getElementById('uploadEndDate').value;
  if (s) document.getElementById('weekStart').value = s;
  if (e) document.getElementById('weekEnd').value = e;
  if (s && e) {
    calState.selectedStart = new Date(s);
    calState.selectedEnd = new Date(e);
  }
}

function reanalyze() {
  const s=document.getElementById('weekStart').value;
  const e=document.getElementById('weekEnd').value;
  if(!s||!e) return;
  if (pantherDB && pantherDB.calls && pantherDB.calls.length > 0) {
    loadParsedFromDB(pantherDB, s, e);
  } else if (rawText) {
    parsedData = parseWhatsApp(rawText, localDate(s), localDate(e));
    renderDashboard(s,e);
  }
}


// ===================== DATABASE (panther-database.json) =====================

let pantherDB = null; // { calls: [...], nameDict: {...}, meta: {...} }

function makeCallId(dateStr, timeStr, region, location) {
  // ID גמיש: תאריך + שעה (5 דקות סובלנות) + מרחב + 15 תווים ראשונים של מיקום
  const [h, m] = timeStr.split(':').map(Number);
  const slot = Math.floor((h * 60 + m) / 5); // חלון 5 דקות
  const locKey = (location || '').replace(/[^\u05d0-\u05ea]/g, '').substring(0, 12);
  const regKey = (region || '').replace(/[*_\s]/g, '').substring(0, 6);
  return `${dateStr}_${slot}_${regKey}_${locKey}`;
}

async function loadDatabase() {
  if (!driveAccessToken) return null;
  try {
    const raw = await readFile('panther-database.json');
    if (!raw) return { calls: [], nameDict: {}, meta: { version: 1 } };
    return JSON.parse(raw);
  } catch(e) {
    console.error('loadDatabase error:', e);
    return { calls: [], nameDict: {}, meta: { version: 1 } };
  }
}

async function saveDatabase(db) {
  if (!driveAccessToken) return;
  try {
    await writeFile('panther-database.json', JSON.stringify(db), 'application/json');
    // עדכן etag אחרי כתיבה — המכשיר שמעלה לא יקבל באנר "נתונים חדשים"
    getFileEtag('panther-database.json').then(etag => { if (etag) lastDbEtag = etag; });
  } catch(e) { console.error('saveDatabase error:', e); }
}

function buildNameDict(calls) {
  // בנה מילון שמות מהקריאות: sender -> cleaned name
  const dict = {};
  for (const c of calls) {
    if (!c.rawSender) continue;
    const raw = c.rawSender;
    // נקה תווים מיוחדים
    const clean = raw.replace(/^~ /, '').replace(/[\u200f\u202a\u202c\u202b]/g, '').trim();
    if (clean && clean !== raw) dict[raw] = clean;
  }
  return dict;
}

function resolveHandler(rawHandler, nameDict) {
  if (!rawHandler) return '';
  if (!nameDict) return rawHandler;
  // נסה למצוא בדיוק
  if (nameDict[rawHandler]) return nameDict[rawHandler];
  // נסה חיפוש חלקי - 3 מילים ראשונות
  const words = rawHandler.split(/\s+/).slice(0, 3).join(' ');
  for (const [k, v] of Object.entries(nameDict)) {
    if (k.startsWith(words) || v.startsWith(words)) return v;
  }
  return rawHandler;
}

async function mergeCallsIntoDB(newCalls, db, updateNameDict) {
  const existing = db.calls;
  // בנה map לפי id לחיפוש מהיר
  const existingMap = new Map(existing.map(c => [c.id, c]));
  let added = 0;

  for (const call of newCalls) {
    const id = makeCallId(call.date, call.time, call.region, call.location);
    call.id = id;

    // בדוק כפילות עם סובלנות זמן (±5 דקות = אותו slot)
    const [h, m] = call.time.split(':').map(Number);
    const slot = Math.floor((h * 60 + m) / 5);
    const locKey = (call.location || '').replace(/[^\u05d0-\u05ea]/g, '').substring(0, 12);
    const regKey = (call.region || '').replace(/[*_\s]/g, '').substring(0, 6);
    const altId1 = `${call.date}_${slot-1}_${regKey}_${locKey}`;
    const altId2 = `${call.date}_${slot+1}_${regKey}_${locKey}`;

    const matchId = existingMap.has(id) ? id
                  : existingMap.has(altId1) ? altId1
                  : existingMap.has(altId2) ? altId2
                  : null;

    if (matchId) {
      // קריאה קיימת — אם מקור האמת: עדכן שמות ו-rawContext
      // אבל לעולם אל תדרוס עריכות ידניות
      if (updateNameDict) {
        const ex = existingMap.get(matchId);
        ex.handlerClean = call.handlerClean;
        ex.rawSender    = call.rawSender;
        ex.rawContext   = call.rawContext || ex.rawContext;
        // שמור: ex.manualAssignment, ex.manualStatus, ex.manualNote — לא נגענו בהם
      }
    } else {
      // קריאה חדשה — הוסף
      existing.push(call);
      existingMap.set(id, call);
      added++;
    }
  }

  db.meta = db.meta || {};
  db.meta.lastMerge = new Date().toISOString();
    db.meta.lastDate = newCalls.length > 0 ? newCalls[newCalls.length-1].date : (db.meta.lastDate || '');
  db.meta.totalCalls = existing.length;

  // מיין לפי תאריך
  existing.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.time.localeCompare(b.time);
  });

  return { db, added };
}

