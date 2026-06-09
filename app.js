// ==========================================================================
// STATE MANAGEMENT & CONSTANTS
// ==========================================================================
const STATE = {
  sheetId: localStorage.getItem('masjid_sheet_id') || '',
  autoRefreshInterval: parseInt(localStorage.getItem('masjid_auto_refresh')) || 300000, // Default 5 mins
  activeTab: 'prayer-timings',
  activeSubtab: 'events-list',
  
  // Data Cache
  db: {
    'Prayer Timings': [],
    'Jumuah Katheeb': [],
    'Weekly Programs': [],
    'Monthly Programs': [],
    'Upcoming Events': [],
    'Past program history': [],
    'Reports': []
  },
  localData: null, // Loaded from local JSON
  isUsingFallback: true,
  
  // Pagination & Filtering for Past History
  pastFilters: {
    search: '',
    lecturer: '',
    page: 1,
    pageSize: 6
  },
  
  // Running Timers
  clockTimer: null,
  countdownTimer: null,
  refreshTimer: null
};

// Standard Sheet Names
const SHEET_NAMES = [
  'Prayer Timings',
  'Jumuah Katheeb',
  'Weekly Programs',
  'Monthly Programs',
  'Upcoming Events',
  'Past program history',
  'Reports'
];

// ==========================================================================
// APPLICATION INITIALIZATION
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initTabs();
  initSettingsModal();
  loadData();
});

// ==========================================================================
// DATE & CLOCK ENGINE
// ==========================================================================
function initClock() {
  const clockEl = document.getElementById('liveClock');
  const gregEl = document.getElementById('gregorianDate');
  const hijriEl = document.getElementById('hijriDate');

  function updateTime() {
    // Current Local Date & Time
    const now = new Date();
    
    // Format Clock: hh:mm:ss AM/PM
    let hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12
    const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} ${ampm}`;
    if (clockEl) clockEl.textContent = timeStr;

    // Gregorian Date: Tuesday, June 9, 2026
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = now.toLocaleDateString('en-US', options);
    if (gregEl) gregEl.textContent = dateStr;

    // Hijri Date: e.g. 24 Dhul-Qadah 1447 AH
    try {
      const hijriFormatter = new Intl.DateTimeFormat('en-US-u-ca-islamic-umalqura', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      const hijriParts = hijriFormatter.format(now);
      if (hijriEl) hijriEl.textContent = `${hijriParts} AH`;
    } catch (e) {
      if (hijriEl) hijriEl.textContent = "1447 Hijri";
    }
  }

  updateTime();
  STATE.clockTimer = setInterval(updateTime, 1000);
}

// ==========================================================================
// TABS NAVIGATION
// ==========================================================================
function initTabs() {
  // Main Navigation Tabs
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });

  // Events Sub-navigation Tabs
  const subtabButtons = document.querySelectorAll('.sub-tab-btn');
  subtabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetSubtab = btn.getAttribute('data-subtab');
      switchSubtab(targetSubtab);
    });
  });
}

function switchTab(tabId) {
  STATE.activeTab = tabId;
  
  // Update buttons active class
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });
  
  // Show active tab content
  document.querySelectorAll('.tab-content').forEach(section => {
    section.classList.toggle('active', section.id === `${tabId}-tab`);
  });

  // Special triggers per tab
  if (tabId === 'past-history') {
    renderPastHistory();
  }
}

function switchSubtab(subtabId) {
  STATE.activeSubtab = subtabId;
  
  document.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-subtab') === subtabId);
  });
  
  document.querySelectorAll('.sub-tab-content').forEach(section => {
    section.classList.toggle('active', section.id === `${subtabId}-subtab`);
  });
}

// ==========================================================================
// GOOGLE SHEETS DATA FETCH & NORMALIZATION
// ==========================================================================
async function loadData() {
  updateStatusIndicator('loading', 'Loading community data...');
  
  // 1. Load Local fallback database directly from memory (CORS-safe for file:// protocol)
  STATE.localData = getHardcodedMockData();

  // 2. Try fetching from Google Sheets if configured
  if (STATE.sheetId) {
    logDiagnostic(`Attempting to sync with Google Sheet ID: ${STATE.sheetId}`);
    const success = await fetchFromGoogleSheets(STATE.sheetId);
    if (success) {
      STATE.isUsingFallback = false;
      localStorage.setItem('masjid_sheet_id', STATE.sheetId);
      updateStatusIndicator('success', 'Sync Successful');
      document.getElementById('dataSourceFooter').textContent = "Data Source: Google Sheets (Live Sync)";
    } else {
      loadLocalFallback("Failed to connect to Google Sheets. Using offline cache.");
    }
  } else {
    loadLocalFallback("Offline Mode. Connect Google Sheet in settings.");
  }

  // 3. Render all UI sections with the active DB
  renderAllSections();
  startNextPrayerTimer();
  setupAutoRefresh();
}

function loadLocalFallback(reason) {
  STATE.isUsingFallback = true;
  STATE.db = JSON.parse(JSON.stringify(STATE.localData)); // Deep clone
  updateStatusIndicator('warning', 'Offline Mode');
  document.getElementById('dataSourceFooter').textContent = "Data Source: Local database (Offline Fallback)";
  logDiagnostic(`${reason}\nLoaded ${STATE.db['Prayer Timings'].length} prayer rows from local cache.`);
}

function updateStatusIndicator(type, text) {
  const statusEl = document.getElementById('connectionStatus');
  if (!statusEl) return;
  
  const dot = statusEl.querySelector('.status-dot');
  const textEl = statusEl.querySelector('.status-text');
  
  dot.className = 'status-dot';
  if (type === 'loading') {
    dot.classList.add('orange', 'animate-pulse');
  } else if (type === 'success') {
    dot.classList.add('green');
  } else if (type === 'warning') {
    dot.classList.add('orange');
  } else if (type === 'error') {
    dot.classList.add('red');
  }
  
  textEl.textContent = text;
}

// Parse a date string / Excel serial into a JS Date object.
// No automatic day/month swapping — the date is taken at face value.
function normalizeDate(val) {
  if (!val) return null;
  val = val.toString().trim();
  if (val === '') return null;

  let date = null;

  // Case 1: Excel Serial Number (e.g. 46181 or 46181.0)
  if (!isNaN(val) && parseFloat(val) > 30000) {
    const serial = parseFloat(val);
    date = new Date(1899, 11, 30);
    date.setDate(date.getDate() + Math.floor(serial));
  }
  // Case 2: DD-MM-YYYY or YYYY-MM-DD with - or /
  else if (val.includes('-') || val.includes('/')) {
    const sep = val.includes('-') ? '-' : '/';
    const parts = val.split(sep);
    if (parts[0].length === 4) {
      // YYYY-MM-DD
      date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    } else if (parts[2] && parts[2].length === 4) {
      // DD-MM-YYYY
      date = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    }
  }

  // Fallback to JS Date parser
  if (!date || isNaN(date.getTime())) {
    date = new Date(val);
  }

  return (date && !isNaN(date.getTime())) ? date : null;
}

// Convert Excel fractional time (e.g. 0.20833) or strings to clean AM/PM format
function normalizeTime(val) {
  if (!val) return '';
  val = val.toString().trim();
  if (val === '') return '';

  // If it's a fractional day float (Excel time format)
  if (!isNaN(val) && parseFloat(val) < 1.0) {
    const fval = parseFloat(val);
    const totalMinutes = Math.round(fval * 24 * 60);
    let hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const period = hours >= 12 ? 'PM' : 'AM';
    
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 -> 12
    return `${hours}:${minutes.toString().padStart(2, '0')} ${period}`;
  }

  return val; // Return raw string if already formatted
}

// ==========================================================================
// INDIAN DATE FORMAT HELPER
// Returns dates in Indian style: DD Mon YYYY  (e.g. 09 Jun 2026)
// Options:
//   { weekday: true }  → "Friday, 12 June 2026"
//   { short: true }    → "12 Jun" (no year)
//   { numeric: true }  → "12-06-2026"
// ==========================================================================
function formatDate(dateInput, opts = {}) {
  if (!dateInput) return '';
  const d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return dateInput.toString();

  const day   = d.getDate().toString().padStart(2, '0');
  const year  = d.getFullYear();
  const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTHS_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAYS_LONG    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const DAYS_SHORT   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const month = d.getMonth();

  if (opts.numeric) {
    // DD-MM-YYYY
    return `${day}-${(month + 1).toString().padStart(2, '0')}-${year}`;
  }
  if (opts.short) {
    // e.g. "12 Jun"
    return `${day} ${MONTHS_SHORT[month]}`;
  }
  if (opts.weekday) {
    // e.g. "Friday, 12 June 2026"
    return `${DAYS_LONG[d.getDay()]}, ${parseInt(day)} ${MONTHS_LONG[month]} ${year}`;
  }
  if (opts.weekdayShort) {
    // e.g. "Fri, 12 Jun 2026"
    return `${DAYS_SHORT[d.getDay()]}, ${parseInt(day)} ${MONTHS_SHORT[month]} ${year}`;
  }
  // Default: "12 Jun 2026"
  return `${parseInt(day)} ${MONTHS_SHORT[month]} ${year}`;
}

// Fetch Google Sheet data using GViz JSON endpoint
async function fetchFromGoogleSheets(spreadsheetId) {
  logDiagnostic(`Starting fetch sequence for all 7 sheets...`);
  
  // Helper to extract sheet ID from a full URL
  let id = spreadsheetId.trim();
  if (id.includes('/d/')) {
    const parts = id.split('/d/');
    if (parts[1]) {
      id = parts[1].split('/')[0];
    }
  }

  const fetchedDb = {};
  let errorsOccurred = false;

  for (const sheetName of SHEET_NAMES) {
    try {
      const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP Error Status: ${res.status}`);
      
      const text = await res.text();
      // Parse GViz response: google.visualization.Query.setResponse({ ...JSON... });
      const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*?)\);/);
      if (!match) {
        throw new Error("Invalid Google Sheets GViz response wrapper format.");
      }

      const json = JSON.parse(match[1]);
      if (json.status !== 'ok') {
        throw new Error(`Google API returned error: ${json.errors?.[0]?.detailed_message || json.status}`);
      }

      const cols = json.table.cols;
      const rows = json.table.rows;
      const headers = cols.map(c => (c.label || '').trim());
      
      const parsedRows = rows.map((r, rIdx) => {
        const obj = {};
        headers.forEach((h, cIdx) => {
          const cell = r.c[cIdx];
          let val = '';
          if (cell) {
            // Prefer formatted value (f) for strings, fall back to raw value (v)
            val = cell.f !== undefined ? cell.f : (cell.v !== undefined ? cell.v : '');
          }
          const propName = h || `Column_${cIdx + 1}`;
          
          // Apply normalization to dates and times inside sheet columns
          if (sheetName === 'Prayer Timings') {
            if (propName === 'Week Start') {
              // Need ISO date string for sorting/comparison — parse it
              const dt = normalizeDate(cell?.v ?? val);
              val = dt ? dt.toISOString().split('T')[0] : val;
            } else if (['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].includes(propName)) {
              val = normalizeTime(cell?.v); // Decode float time representation if available
            }
          } else if (['Jumuah Katheeb', 'Upcoming Events', 'Past program history', 'Reports'].includes(sheetName)) {
            if (propName === 'Date') {
              // Use the sheet's own formatted date string (cell.f) when available.
              // This shows exactly what the user typed / formatted in Google Sheets.
              // Only fall back to re-parsing the raw value (v) when f is absent.
              if (cell && cell.f) {
                val = cell.f; // e.g. "12/06/2026" or "12 Jun 2026" — sheet's own format
              } else if (cell && cell.v) {
                // Raw value from GViz is often a JS Date constructor string for date cells
                const dt = normalizeDate(cell.v);
                val = dt ? dt.toISOString().split('T')[0] : val;
              }
            }
          }
          
          obj[propName] = val;
        });
        return obj;
      });

      fetchedDb[sheetName] = parsedRows;
      logDiagnostic(`Sheet [${sheetName}]: Successfully loaded ${parsedRows.length} rows.`);
    } catch (e) {
      logDiagnostic(`Sheet [${sheetName}] Sync Error: ${e.message}`);
      errorsOccurred = true;
    }
  }

  // Update State DB for successfully fetched sheets, keeping fallbacks for failed ones
  let successCount = 0;
  SHEET_NAMES.forEach(name => {
    if (fetchedDb[name]) {
      STATE.db[name] = fetchedDb[name];
      successCount++;
    }
  });

  if (successCount === 0) {
    logDiagnostic("Sync Failed: None of the sheets could be retrieved. Ensure sheet is public.");
    return false;
  }

  logDiagnostic(`Sync Partial Success: Updated ${successCount} of ${SHEET_NAMES.length} sheets.`);
  return true;
}

// ==========================================================================
// DYNAMIC DOM RENDERING ENGINE
// ==========================================================================
function renderAllSections() {
  renderStatsPanel();
  renderPrayerTimings();
  renderWeeklyPrograms();
  renderUpcomingEvents();
  renderReports();
}

// Render the 3 simple statistics cards
function renderStatsPanel() {
  // Stats Card 2: Weekly count
  const weeklyCount = STATE.db['Weekly Programs']?.length || 0;
  document.getElementById('statsWeeklyCount').textContent = weeklyCount;

  // Stats Card 3: Jumuah Khateeb this week
  const today = new Date();
  const nextFriday = getNextFriday(today);
  const nextFridayStr = nextFriday.toISOString().split('T')[0];

  const jumuahData = STATE.db['Jumuah Katheeb'] || [];
  // Find a sermon closest to this Friday or a planned one
  let activeJumuah = null;
  
  // Sort sermons by date
  const sortedJumuah = [...jumuahData].filter(j => j.Date).sort((a,b) => new Date(a.Date) - new Date(b.Date));
  
  // Find the closest future or today Friday
  activeJumuah = sortedJumuah.find(j => {
    const jd = new Date(j.Date);
    // Compare date parts only
    return jd.toDateString() === nextFriday.toDateString() || jd >= today;
  });

  // Fallback to last sermon if none in future
  if (!activeJumuah && sortedJumuah.length > 0) {
    activeJumuah = sortedJumuah[sortedJumuah.length - 1];
  }

  const statusEl = document.getElementById('statsJumuahStatus');
  const khateebEl = document.getElementById('statsJumuahKhateeb');
  const dateEl = document.getElementById('statsJumuahDate');

  if (activeJumuah) {
    const dateObj = new Date(activeJumuah.Date);
    const dateDisplay = formatDate(dateObj, { short: true });
    
    statusEl.textContent = activeJumuah.Status || 'Planned';
    // Color code based on status
    statusEl.className = 'stat-value';
    if (activeJumuah.Status?.toLowerCase().includes('complete')) {
      statusEl.style.color = 'var(--success)';
    } else {
      statusEl.style.color = 'var(--info)';
    }
    
    khateebEl.textContent = activeJumuah['Name of the Khateeb'] || 'TBD';
    dateEl.textContent = `Friday Sermon: ${dateDisplay}`;
  } else {
    statusEl.textContent = "Planned";
    khateebEl.textContent = "Guest Scholar";
    dateEl.textContent = `This Friday: ${formatDate(nextFriday, { short: true })}`;
  }

  // Stats Card 4: Upcoming Events count
  const eventCount = STATE.db['Upcoming Events']?.length || 0;
  document.getElementById('statsEventsCount').textContent = eventCount;
}

// helper to get the upcoming Friday's date
function getNextFriday(date) {
  const resultDate = new Date(date.getTime());
  const day = resultDate.getDay();
  // 5 represents Friday. (5 - day + 7) % 7 will find the days to add.
  // If today is Friday, it will return today. If we want next Friday if today is Friday, handle it.
  const daysToAdd = (5 - day + 7) % 7;
  resultDate.setDate(resultDate.getDate() + (daysToAdd === 0 ? 0 : daysToAdd));
  return resultDate;
}

// Render Prayer Timings (Section 1)
function renderPrayerTimings() {
  const list = STATE.db['Prayer Timings'] || [];
  const tbody = document.getElementById('prayerTableBody');
  if (!tbody) return;
  
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-placeholder">No prayer timings available. Connect sheet.</td></tr>`;
    return;
  }

  // Update the week range description badge in header
  const weekStartDates = list.map(p => p['Week Start']).filter(Boolean);
  if (weekStartDates.length > 0) {
    const sorted = weekStartDates.sort();
    const startDisplay = formatDate(new Date(sorted[0]));
    const endDisplay = formatDate(new Date(sorted[sorted.length - 1]));
    const badge = document.querySelector('#prayer-timings-tab .info-badge');
    if (badge) {
      badge.innerHTML = `<i class="fa-solid fa-calendar-alt gold-text"></i> Week Scope: ${startDisplay} to ${endDisplay}`;
    }
  }

  tbody.innerHTML = '';
  
  const today = new Date();
  const todayDateStr = today.toISOString().split('T')[0];

  list.forEach(row => {
    const tr = document.createElement('tr');
    
    // Check if this row is "Today"
    const rowDateStr = row['Week Start'];
    const isToday = rowDateStr === todayDateStr;
    if (isToday) {
      tr.className = 'today-row';
      // Render Today's summary card on left
      document.getElementById('todayDayName').textContent = (row['Day'] || '').toUpperCase();
      document.getElementById('todayDateStr').textContent = formatDate(new Date(rowDateStr), { weekday: true }).replace(/^\w+, /, '');
    }

    // Days column
    const dayCell = document.createElement('td');
    dayCell.textContent = row['Day'] || '';
    dayCell.setAttribute('data-label', 'Day');
    tr.appendChild(dayCell);

    // Dates column
    const dateCell = document.createElement('td');
    dateCell.textContent = rowDateStr ? formatDate(new Date(rowDateStr), { short: true }) : '';
    dateCell.setAttribute('data-label', 'Date');
    tr.appendChild(dateCell);

    // Prayers columns
    const prayers = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
    prayers.forEach(p => {
      const td = document.createElement('td');
      td.textContent = row[p] || '--:--';
      td.setAttribute('data-label', p);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

// Render Weekly Jumuah & Programs (Section 2)
function renderWeeklyPrograms() {
  // 1. Jumuah Schedule
  const jumuahListEl = document.getElementById('jumuahList');
  const jumuahData = STATE.db['Jumuah Katheeb'] || [];
  
  if (jumuahListEl) {
    if (jumuahData.length === 0) {
      jumuahListEl.innerHTML = `<p class="loading-placeholder">No Jumuah Khateeb schedule available.</p>`;
    } else {
      // Sort Jumuah from oldest to newest or keep as is? Let's sort by date descending so the nearest Jumuah shows at the top!
      const sortedJumuah = [...jumuahData].filter(j => j.Date).sort((a,b) => new Date(b.Date) - new Date(a.Date));
      
      const todayStr = new Date().toISOString().split('T')[0];
      
      jumuahListEl.innerHTML = sortedJumuah.map(item => {
        const itemDateStr = item.Date;
        const itemDate = new Date(itemDateStr);
        const dateDisplay = formatDate(itemDate, { weekday: true });
        
        // Find if this is the current week Jumuah
        // (If the date is >= Monday of this week and <= Sunday of this week)
        const d = new Date();
        const currentDay = d.getDay();
        const diffToMonday = d.getDate() - currentDay + (currentDay === 0 ? -6 : 1);
        const startOfWeek = new Date(d.setDate(diffToMonday));
        startOfWeek.setHours(0,0,0,0);
        
        const endOfWeek = new Date(startOfWeek.getTime());
        endOfWeek.setDate(endOfWeek.getDate() + 6);
        endOfWeek.setHours(23,59,59,999);
        
        const isCurrentWeek = itemDate >= startOfWeek && itemDate <= endOfWeek;
        const cardClass = isCurrentWeek ? 'jumuah-item current-week' : 'jumuah-item';

        const name = item['Name of the Khateeb'] || 'Guest Scholar';
        const about = item['About Khateeb'] ? `(${item['About Khateeb']})` : '';
        const status = item['Status'] || '';
        
        let statusHtml = '';
        if (status) {
          const statusLower = status.toLowerCase();
          if (statusLower.includes('complete')) {
            statusHtml = `<span class="status-pill completed"><i class="fa-solid fa-circle-check"></i> ${status}</span>`;
          } else if (statusLower.includes('plan')) {
            statusHtml = `<span class="status-pill planned"><i class="fa-solid fa-clock"></i> ${status}</span>`;
          } else {
            statusHtml = `<span class="status-pill none">${status}</span>`;
          }
        }

        return `
          <div class="${cardClass}">
            <div class="jumuah-date">
              ${dateDisplay} ${isCurrentWeek ? '<span class="tag gold-tag" style="margin-left: 0.5rem; font-size: 0.55rem; padding: 0.1rem 0.3rem;">This Week</span>' : ''}
            </div>
            <div class="jumuah-title">${name}</div>
            <div class="jumuah-desc">${about}</div>
            <div class="jumuah-status">${statusHtml}</div>
          </div>
        `;
      }).join('');
    }
  }

  // 2. Weekly educational classes
  const classesListEl = document.getElementById('weeklyClassesList');
  const classesData = STATE.db['Weekly Programs'] || [];

  if (classesListEl) {
    if (classesData.length === 0) {
      classesListEl.innerHTML = `<p class="loading-placeholder">No weekly classes listed.</p>`;
    } else {
      classesListEl.innerHTML = classesData.map(item => {
        let audClass = 'tag';
        const aud = (item['Audiance'] || '').toLowerCase();
        if (aud.includes('women') && aud.includes('men')) {
          audClass += ' info-tag';
        } else if (aud.includes('women')) {
          audClass += ' danger-tag'; // Soft pinkish
        } else {
          audClass += ' gold-tag';
        }

        return `
          <div class="class-card">
            <div class="class-icon-box"><i class="fa-solid fa-graduation-cap"></i></div>
            <div class="class-details">
              <div class="class-meta">
                <span>${item['Day'] || 'Weekly'}</span>
                <span>${item['Time'] || ''}</span>
              </div>
              <h5 class="class-title">${item['Program Title'] || 'Islamic Lecture'}</h5>
              <div class="class-speaker"><i class="fa-solid fa-user-tie"></i> ${item['Lecturer'] || 'Scholars'}</div>
              <div class="class-footer">
                <span><i class="fa-solid fa-location-dot gold-text"></i> ${item['Location'] || 'Masjid'}</span>
                <span><i class="fa-solid fa-hourglass-half gold-text"></i> ${item['Duration'] || '1 hour'}</span>
                <span class="${audClass}" style="margin-left:auto; font-size: 0.65rem;">${item['Audiance'] || 'General'}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

// Render Upcoming Events & Monthly Events (Section 3)
function renderUpcomingEvents() {
  const eventsListEl = document.getElementById('upcomingEventsList');
  const eventsData = STATE.db['Upcoming Events'] || [];

  if (eventsListEl) {
    if (eventsData.length === 0) {
      eventsListEl.innerHTML = `
        <div class="no-events">
          <i class="fa-solid fa-calendar-xmark"></i>
          <h4>No Upcoming Events Scheduled</h4>
          <p>Please check back later or view our weekly program schedule.</p>
        </div>
      `;
    } else {
      // Sort upcoming events by nearest date (ascending)
      const sortedEvents = [...eventsData].filter(e => e.Date).sort((a,b) => new Date(a.Date) - new Date(b.Date));
      
      eventsListEl.innerHTML = sortedEvents.map(e => {
        const eventDate = new Date(e.Date);
        const dateStr = formatDate(eventDate, { weekdayShort: true });
        
        return `
          <div class="event-card">
            <div>
              <div class="event-date-badge">${dateStr}</div>
              <h4 class="event-title">${e['Program Title'] || 'Special Program'}</h4>
              <div class="event-speaker"><i class="fa-solid fa-user-graduate"></i> ${e['Lecturer'] || 'Guest Scholar'}</div>
              
              <div class="event-info-list">
                <span><i class="fa-solid fa-clock"></i> ${e['Time'] || ''} (${e['Duration'] || ''})</span>
                <span><i class="fa-solid fa-map-pin"></i> ${e['Location'] || 'Masjid Main Hall'}</span>
              </div>
            </div>
            
            <div class="event-audience-tag">
              <i class="fa-solid fa-users"></i> Target Audience: ${e['Audiance'] || 'Open to All'}
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Monthly Recurring Programs
  const monthlyListEl = document.getElementById('monthlyProgramsList');
  const monthlyData = STATE.db['Monthly Programs'] || [];

  if (monthlyListEl) {
    if (monthlyData.length === 0) {
      monthlyListEl.innerHTML = `
        <div class="no-events">
          <i class="fa-solid fa-calendar-xmark"></i>
          <h4>No Monthly Programs Listed</h4>
          <p>Check the Google Sheets connect status.</p>
        </div>
      `;
    } else {
      monthlyListEl.innerHTML = monthlyData.map(m => {
        return `
          <div class="event-card" style="border-top-color: var(--accent);">
            <div>
              <div class="event-date-badge" style="background-color: var(--accent-glass); color: var(--accent);">
                ${m['Schedule'] || 'Monthly'}
              </div>
              <h4 class="event-title">${m['Program Title'] || 'Monthly Halaqah'}</h4>
              <div class="event-speaker"><i class="fa-solid fa-user-tie"></i> ${m['Lecturer'] || 'Scholars'}</div>
              
              <div class="event-info-list">
                <span><i class="fa-solid fa-clock"></i> ${m['Time'] || ''} (${m['Duration'] || ''})</span>
                <span><i class="fa-solid fa-location-dot"></i> ${m['Location'] || 'Masjid'}</span>
              </div>
            </div>
            
            <div class="event-audience-tag" style="background-color: var(--accent-glass); color: var(--accent);">
              <i class="fa-solid fa-users"></i> Target Audience: ${m['Audiance'] || 'Open to All'}
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

// Render Past program history (Section 4)
function renderPastHistory() {
  const tbody = document.getElementById('pastTableBody');
  const searchInput = document.getElementById('pastSearchInput');
  const lecturerSelect = document.getElementById('pastLecturerFilter');
  const downloadBtn = document.getElementById('downloadCsvBtn');
  
  if (!tbody) return;

  const rawData = STATE.db['Past program history'] || [];
  
  // 1. Populate lecturer dropdown if not already populated
  const uniqueLecturers = [...new Set(rawData.map(item => item.Lecturer).filter(Boolean))].sort();
  if (lecturerSelect && lecturerSelect.options.length <= 1) {
    uniqueLecturers.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l;
      opt.textContent = l;
      lecturerSelect.appendChild(opt);
    });
  }

  // Event Listeners for Filters
  if (searchInput && !searchInput.dataset.listening) {
    searchInput.dataset.listening = "true";
    searchInput.addEventListener('input', () => {
      STATE.pastFilters.search = searchInput.value;
      STATE.pastFilters.page = 1;
      renderPastHistoryTable();
    });
  }
  
  if (lecturerSelect && !lecturerSelect.dataset.listening) {
    lecturerSelect.dataset.listening = "true";
    lecturerSelect.addEventListener('change', () => {
      STATE.pastFilters.lecturer = lecturerSelect.value;
      STATE.pastFilters.page = 1;
      renderPastHistoryTable();
    });
  }

  if (downloadBtn && !downloadBtn.dataset.listening) {
    downloadBtn.dataset.listening = "true";
    downloadBtn.addEventListener('click', downloadPastHistoryCSV);
  }

  renderPastHistoryTable();
}

function renderPastHistoryTable() {
  const tbody = document.getElementById('pastTableBody');
  const rawData = STATE.db['Past program history'] || [];
  
  // Apply Search and Filters
  let filtered = rawData.filter(item => {
    // Search filter
    const query = STATE.pastFilters.search.toLowerCase();
    const matchesSearch = !query || 
      (item['Program Title'] || '').toLowerCase().includes(query) ||
      (item['Lecturer'] || '').toLowerCase().includes(query) ||
      (item['Comments'] || '').toLowerCase().includes(query) ||
      (item['Date'] || '').toLowerCase().includes(query);

    // Lecturer filter
    const matchLecturer = !STATE.pastFilters.lecturer || item.Lecturer === STATE.pastFilters.lecturer;

    return matchesSearch && matchLecturer;
  });

  // Sort by date descending (most recent first)
  filtered.sort((a,b) => new Date(b.Date) - new Date(a.Date));

  // Pagination Logic
  const totalItems = filtered.length;
  const totalPages = Math.ceil(totalItems / STATE.pastFilters.pageSize) || 1;
  
  // Bound check
  if (STATE.pastFilters.page > totalPages) STATE.pastFilters.page = totalPages;
  if (STATE.pastFilters.page < 1) STATE.pastFilters.page = 1;

  const startIdx = (STATE.pastFilters.page - 1) * STATE.pastFilters.pageSize;
  const paginated = filtered.slice(startIdx, startIdx + STATE.pastFilters.pageSize);

  // Update Pagination Controls
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  const infoSpan = document.getElementById('paginationInfo');

  if (infoSpan) {
    if (totalItems === 0) {
      infoSpan.textContent = "Showing 0 of 0 entries";
    } else {
      const endIdx = Math.min(startIdx + STATE.pastFilters.pageSize, totalItems);
      infoSpan.textContent = `Showing ${startIdx + 1} to ${endIdx} of ${totalItems} entries (Filtered from ${rawData.length})`;
    }
  }

  if (prevBtn) {
    prevBtn.disabled = STATE.pastFilters.page <= 1;
    if (!prevBtn.dataset.clicked) {
      prevBtn.dataset.clicked = "true";
      prevBtn.onclick = () => {
        STATE.pastFilters.page--;
        renderPastHistoryTable();
      };
    }
  }

  if (nextBtn) {
    nextBtn.disabled = STATE.pastFilters.page >= totalPages;
    if (!nextBtn.dataset.clicked) {
      nextBtn.dataset.clicked = "true";
      nextBtn.onclick = () => {
        STATE.pastFilters.page++;
        renderPastHistoryTable();
      };
    }
  }

  // Render Table rows
  if (paginated.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-placeholder">No matching past programs found.</td></tr>`;
    return;
  }

  tbody.innerHTML = paginated.map(item => {
    const dStr = item.Date ? formatDate(new Date(item.Date)) : '';
    
    return `
      <tr>
        <td data-label="Date">${dStr}</td>
        <td data-label="Program Title" style="font-weight: 700; color: var(--primary);">${item['Program Title'] || ''}</td>
        <td data-label="Lecturer">${item['Lecturer'] || ''}</td>
        <td data-label="Attendance"><span class="badge" style="background-color: var(--primary-glass); color: var(--primary); padding: 0.2rem 0.5rem; font-weight:700;">${item['Attendance'] || '0'}</span></td>
        <td data-label="Comments / Notes" style="font-size:0.8rem; color:var(--text-muted); font-weight: 500;">${item['Comments'] || ''}</td>
      </tr>
    `;
  }).join('');
}

// Download filtered past history as CSV
function downloadPastHistoryCSV() {
  const rawData = STATE.db['Past program history'] || [];
  
  // Re-apply filters to export what is currently filtered
  let filtered = rawData.filter(item => {
    const query = STATE.pastFilters.search.toLowerCase();
    const matchesSearch = !query || 
      (item['Program Title'] || '').toLowerCase().includes(query) ||
      (item['Lecturer'] || '').toLowerCase().includes(query) ||
      (item['Comments'] || '').toLowerCase().includes(query) ||
      (item['Date'] || '').toLowerCase().includes(query);

    const matchLecturer = !STATE.pastFilters.lecturer || item.Lecturer === STATE.pastFilters.lecturer;
    return matchesSearch && matchLecturer;
  });

  filtered.sort((a,b) => new Date(b.Date) - new Date(a.Date));

  // CSV Construction
  const headers = ['Date', 'Program Title', 'Lecturer', 'Attendance', 'Comments'];
  const csvRows = [headers.join(',')];

  filtered.forEach(item => {
    const row = [
      `"${(item.Date || '').replace(/"/g, '""')}"`,
      `"${(item['Program Title'] || '').replace(/"/g, '""')}"`,
      `"${(item.Lecturer || '').replace(/"/g, '""')}"`,
      `"${(item.Attendance || '0').replace(/"/g, '""')}"`,
      `"${(item.Comments || '').replace(/"/g, '""')}"`
    ];
    csvRows.push(row.join(','));
  });

  const csvContent = "data:text/csv;charset=utf-8," + csvRows.join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `masjid_program_history_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link); // Required for FF
  link.click();
  document.body.removeChild(link);
}

// Render Reports (Section 5)
function renderReports() {
  const listEl = document.getElementById('reportsList');
  const reportsData = STATE.db['Reports'] || [];

  if (listEl) {
    if (reportsData.length === 0) {
      listEl.innerHTML = `<p class="loading-placeholder">No documents or reports published.</p>`;
      return;
    }

    listEl.innerHTML = reportsData.map(r => {
      let icon = 'fa-file-lines';
      let iconColorClass = 'project';
      const cat = (r['Category'] || '').toLowerCase();
      
      if (cat.includes('finance') || cat.includes('money') || cat.includes('audit')) {
        icon = 'fa-file-invoice-dollar';
        iconColorClass = 'finance';
      } else if (cat.includes('charity') || cat.includes('welfare') || cat.includes('zakat')) {
        icon = 'fa-hand-holding-heart';
        iconColorClass = 'charity';
      } else if (cat.includes('renovation') || cat.includes('project') || cat.includes('construct')) {
        icon = 'fa-trowel-bricks';
        iconColorClass = 'project';
      }

      const dateStr = r.Date ? new Date(r.Date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

      return `
        <div class="report-card">
          <div class="report-icon-wrapper ${iconColorClass}"><i class="fa-solid ${icon}"></i></div>
          <div class="report-content">
            <div class="report-meta">
              <span>${r['Category'] || 'Report'}</span>
              <span>${dateStr}</span>
            </div>
            <h5 class="report-title">${r['Title'] || 'Community Document'}</h5>
            <p class="report-summary">${r['Summary'] || ''}</p>
            <a href="${r['Link'] || '#'}" class="btn-read-report"><i class="fa-solid fa-file-pdf"></i> Read Document</a>
          </div>
        </div>
      `;
    }).join('');
  }
}

// ==========================================================================
// REAL-TIME NEXT PRAYER & TIMER ENGINE
// ==========================================================================
function startNextPrayerTimer() {
  if (STATE.countdownTimer) clearInterval(STATE.countdownTimer);

  const countdownEl = document.getElementById('countdownTimer');
  const nextPrayerNameEl = document.getElementById('nextPrayerName');
  const progressEl = document.getElementById('prayerProgressBar');
  const subtextEl = document.getElementById('prayerSubtext');
  const todayActiveNameEl = document.getElementById('todayCurrentPrayerName');
  const todayActiveTimeEl = document.getElementById('todayCurrentPrayerTime');

  const list = STATE.db['Prayer Timings'] || [];
  if (list.length === 0) return;

  function calculateCountdown() {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    
    // Find today's row
    const todayRow = list.find(row => row['Week Start'] === todayStr);
    if (!todayRow) {
      if (nextPrayerNameEl) nextPrayerNameEl.textContent = "Weekly Sheet Ended";
      if (subtextEl) subtextEl.textContent = "Please check Sheets ID or sync data.";
      return;
    }

    const prayers = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
    
    // Build array of today's prayer times
    const prayerTimes = [];
    prayers.forEach(name => {
      const timeStr = todayRow[name];
      if (timeStr) {
        const fullDate = parseTimeStringToDate(now, timeStr);
        prayerTimes.push({ name, date: fullDate, timeStr });
      }
    });

    if (prayerTimes.length === 0) return;

    // Find the next prayer
    let nextIndex = prayerTimes.findIndex(p => p.date > now);
    let nextPrayer = null;
    let prevPrayer = null;

    if (nextIndex !== -1) {
      nextPrayer = prayerTimes[nextIndex];
      // Previous prayer is either the previous one in list, or Isha of yesterday (treat as Fajr-to-Isha wrapping)
      prevPrayer = nextIndex > 0 ? prayerTimes[nextIndex - 1] : null;
    } else {
      // All prayers for today have passed. Next prayer is tomorrow's Fajr!
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      const tomorrowRow = list.find(row => row['Week Start'] === tomorrowStr);
      
      if (tomorrowRow && tomorrowRow['Fajr']) {
        nextPrayer = {
          name: 'Fajr (Tomorrow)',
          date: parseTimeStringToDate(tomorrow, tomorrowRow['Fajr']),
          timeStr: tomorrowRow['Fajr']
        };
      } else {
        // Fallback if tomorrow isn't in the sheet
        nextPrayer = {
          name: 'Fajr (Tomorrow)',
          date: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 5, 0, 0), // 5:00 AM default
          timeStr: '5:00 AM'
        };
      }
      prevPrayer = prayerTimes[prayerTimes.length - 1]; // Today's Isha
    }

    // Determine currently active prayer (which is the prevPrayer)
    let currentPrayerName = 'Isha';
    let currentPrayerTime = '--:--';

    if (prevPrayer) {
      currentPrayerName = prevPrayer.name;
      currentPrayerTime = prevPrayer.timeStr;
    } else {
      // If no prevPrayer (meaning it's before Fajr today), active is yesterday's Isha
      currentPrayerName = 'Isha (Yesterday)';
      // Try to find yesterday's row or just show Isha
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      const yesterdayRow = list.find(row => row['Week Start'] === yesterdayStr);
      currentPrayerTime = yesterdayRow ? yesterdayRow['Isha'] : '8:15 PM';
    }

    // Update active box in left panel
    if (todayActiveNameEl) todayActiveNameEl.textContent = currentPrayerName;
    if (todayActiveTimeEl) todayActiveTimeEl.textContent = currentPrayerTime;

    // Countdown math
    const diff = nextPrayer.date - now; // ms
    
    if (diff <= 0) {
      // If we just hit a prayer, force recalculation immediately
      setTimeout(calculateCountdown, 100);
      return;
    }

    const diffSecs = Math.floor(diff / 1000);
    const h = Math.floor(diffSecs / 3600);
    const m = Math.floor((diffSecs % 3600) / 60);
    const s = diffSecs % 60;
    
    const formattedCountdown = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    if (countdownEl) countdownEl.textContent = formattedCountdown;
    if (nextPrayerNameEl) nextPrayerNameEl.textContent = `${nextPrayer.name.toUpperCase()} AT ${nextPrayer.timeStr}`;

    // Progress bar percent
    // If we have both prev and next, calculate percent elapsed
    let pct = 0;
    if (prevPrayer) {
      const totalTime = nextPrayer.date - prevPrayer.date;
      const elapsedTime = now - prevPrayer.date;
      pct = (elapsedTime / totalTime) * 100;
    } else {
      // Before Fajr, we estimate from midnight
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const totalTime = nextPrayer.date - midnight;
      const elapsedTime = now - midnight;
      pct = (elapsedTime / totalTime) * 100;
    }
    
    pct = Math.max(0, Math.min(100, pct));
    if (progressEl) progressEl.style.width = `${pct}%`;

    // Subtext description
    if (subtextEl) {
      subtextEl.textContent = `Today's prayers: Fajr (${todayRow.Fajr}), Dhuhr (${todayRow.Dhuhr}), Asr (${todayRow.Asr}), Maghrib (${todayRow.Maghrib}), Isha (${todayRow.Isha})`;
    }
  }

  // Helper to parse time string (e.g. "5:00 AM", "6:36 PM") and apply to a date object
  function parseTimeStringToDate(baseDate, timeStr) {
    const cleanStr = timeStr.replace(/\s+/g, ' ').trim().toUpperCase();
    const parts = cleanStr.match(/^(\d+):(\d+)\s*(AM|PM)$/);
    if (!parts) {
      // Default fallback
      return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 12, 0, 0);
    }
    
    let hours = parseInt(parts[1]);
    const minutes = parseInt(parts[2]);
    const period = parts[3];
    
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    
    return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hours, minutes, 0, 0);
  }

  calculateCountdown();
  STATE.countdownTimer = setInterval(calculateCountdown, 1000);
}

// ==========================================================================
// ADMIN CONFIGURATION & SYNC SETTINGS MODAL
// ==========================================================================
function initSettingsModal() {
  const modal = document.getElementById('settingsModal');
  const openBtn = document.getElementById('openSettingsBtn');
  const closeBtnX = document.getElementById('closeSettingsBtnX');
  const cancelBtn = document.getElementById('cancelSettingsBtn');
  const saveBtn = document.getElementById('saveSettingsBtn');
  const resetBtn = document.getElementById('resetDefaultBtn');
  const syncNowBtn = document.getElementById('syncNowBtn');
  
  const idInput = document.getElementById('spreadsheetIdInput');
  const refreshSelect = document.getElementById('autoRefreshSelect');

  // Load current config to input elements
  if (idInput) idInput.value = STATE.sheetId;
  if (refreshSelect) refreshSelect.value = STATE.autoRefreshInterval.toString();

  // Open modal
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      // Update inputs to match active state
      idInput.value = STATE.sheetId;
      refreshSelect.value = STATE.autoRefreshInterval.toString();
      modal.classList.add('active');
    });
  }

  // Close modal
  const closeModal = () => modal.classList.remove('active');
  if (closeBtnX) closeBtnX.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  // Close on background click
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  // Reset to default settings
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (confirm("Are you sure you want to disconnect Google Sheets and reset to local offline data?")) {
        idInput.value = '';
        refreshSelect.value = '300000';
        logDiagnostic("Fields reset. Click Save to apply changes.");
      }
    });
  }

  // Save Settings
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Saving...`;
      
      const newId = idInput.value.trim();
      const newRefresh = parseInt(refreshSelect.value);

      STATE.sheetId = newId;
      STATE.autoRefreshInterval = newRefresh;
      
      localStorage.setItem('masjid_sheet_id', newId);
      localStorage.setItem('masjid_auto_refresh', newRefresh.toString());

      logDiagnostic("Configuration saved to browser storage.");
      
      // Reload Data
      await loadData();
      
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i class="fa-solid fa-save"></i> Save & Connect`;
      
      closeModal();
    });
  }

  // Manual Sync Now button
  if (syncNowBtn) {
    syncNowBtn.addEventListener('click', async () => {
      const icon = syncNowBtn.querySelector('i');
      icon.classList.add('animate-spin');
      syncNowBtn.disabled = true;
      
      await loadData();
      
      setTimeout(() => {
        icon.classList.remove('animate-spin');
        syncNowBtn.disabled = false;
      }, 1000);
    });
  }
}

function logDiagnostic(msg) {
  const diagEl = document.getElementById('diagnosticOutput');
  if (!diagEl) return;
  
  const timestamp = new Date().toLocaleTimeString();
  diagEl.textContent += `\n[${timestamp}] ${msg}`;
  diagEl.scrollTop = diagEl.scrollHeight; // Auto-scroll to bottom
}

// ==========================================================================
// BACKGROUND REFRESH TIMER
// ==========================================================================
function setupAutoRefresh() {
  if (STATE.refreshTimer) clearInterval(STATE.refreshTimer);
  
  const interval = STATE.autoRefreshInterval;
  if (interval === 0) {
    logDiagnostic("Background auto-refresh is disabled.");
    return;
  }

  logDiagnostic(`Background auto-refresh scheduled every ${interval / 1000 / 60} minute(s).`);
  
  STATE.refreshTimer = setInterval(async () => {
    logDiagnostic("Background auto-sync triggered...");
    if (STATE.sheetId) {
      updateStatusIndicator('loading', 'Syncing in background...');
      const success = await fetchFromGoogleSheets(STATE.sheetId);
      if (success) {
        STATE.isUsingFallback = false;
        updateStatusIndicator('success', 'Sync Successful');
        renderAllSections();
        startNextPrayerTimer();
      } else {
        updateStatusIndicator('warning', 'Background Sync Failed');
      }
    }
  }, interval);
}

// ==========================================================================
// HARDCODED FALLBACK DATABASE (Double fallback backup)
// ==========================================================================
function getHardcodedMockData() {
  return {
    "Prayer Timings": [
      { "Week Start": "2026-06-08", "Day": "Monday", "Fajr": "5:00 AM", "Dhuhr": "1:00 PM", "Asr": "4:15 PM", "Maghrib": "6:35 PM", "Isha": "8:15 PM" },
      { "Week Start": "2026-06-09", "Day": "Tuesday", "Fajr": "5:00 AM", "Dhuhr": "1:00 PM", "Asr": "4:15 PM", "Maghrib": "6:35 PM", "Isha": "8:15 PM" },
      { "Week Start": "2026-06-10", "Day": "Wednesday", "Fajr": "5:00 AM", "Dhuhr": "1:00 PM", "Asr": "4:15 PM", "Maghrib": "6:36 PM", "Isha": "8:15 PM" },
      { "Week Start": "2026-06-11", "Day": "Thursday", "Fajr": "5:00 AM", "Dhuhr": "1:00 PM", "Asr": "4:15 PM", "Maghrib": "6:36 PM", "Isha": "8:15 PM" },
      { "Week Start": "2026-06-12", "Day": "Friday", "Fajr": "5:00 AM", "Dhuhr": "1:00 PM", "Asr": "4:15 PM", "Maghrib": "6:36 PM", "Isha": "8:15 PM" },
      { "Week Start": "2026-06-13", "Day": "Saturday", "Fajr": "5:00 AM", "Dhuhr": "1:00 PM", "Asr": "4:15 PM", "Maghrib": "6:36 PM", "Isha": "8:15 PM" },
      { "Week Start": "2026-06-14", "Day": "Sunday", "Fajr": "5:00 AM", "Dhuhr": "1:00 PM", "Asr": "4:15 PM", "Maghrib": "6:36 PM", "Isha": "8:15 PM" }
    ],
    "Jumuah Katheeb": [
      { "Date": "2026-05-06", "Name of the Khateeb": "Sheikh Dhiya", "Status": "Completed Alhamdulillah" },
      { "Date": "2026-06-12", "Name of the Khateeb": "Sheikh Abdur Rahman", "Status": "Planned" },
      { "Date": "19-06-2026", "Name of the Khateeb": "Sheikh Riyaz Baqavi", "Status": "Planned" },
      { "Date": "26-06-2026", "Name of the Khateeb": "Sheikh Ghouse Khan", "About Khateeb": "Umari", "Status": "Planned" },
      { "Date": "2026-03-07", "Status": "" },
      { "Date": "2026-10-07", "Status": "" },
      { "Date": "17-07-2026", "Name of the Khateeb": "Sheikh Aashiqh ", "About Khateeb": "Madani, Asphire College lecturer", "Status": "Planned" },
      { "Date": "24-07-2026", "Status": "" },
      { "Date": "31-07-2026", "Status": "" }
    ],
    "Weekly Programs": [
      { "Day": "Saturday", "Time": "Magrib to Isha", "Location": "Main Hall (G + 1)", "Program Title": "Weekly Quran Tafseer", "Lecturer": "Sheikh Riyaz Baqavi", "Duration": "1 hour", "Audiance": "Men & Women" },
      { "Day": "Wednesday", "Time": "10:30 AM to 12:00 PM", "Location": "First Floor", "Program Title": "Ladies Tajweed Class", "Lecturer": "Sister Sumayya", "Duration": "1.5 hours", "Audiance": "Only Women" },
      { "Day": "Sunday", "Time": "10:00 AM to 1:00 PM", "Location": "G + 1 Classrooms", "Program Title": "Sunday Islamic School for Kids", "Lecturer": "Multiple Teachers", "Duration": "3 hours", "Audiance": "Children (Boys & Girls)" }
    ],
    "Monthly Programs": [
      { "Schedule": "1st Sunday of every month", "Time": "After Asr", "Location": "Main Hall", "Program Title": "Monthly Youth Halaqah", "Lecturer": "Various Guest Speakers", "Duration": "1.5 hours", "Audiance": "Youth" },
      { "Schedule": "Last Saturday of every month", "Time": "Isha to 10:00 PM", "Location": "Masjid Main Lawn", "Program Title": "Family Get-Together & Lecture", "Lecturer": "Invited Scholars", "Duration": "1.5 hours", "Audiance": "Families (All Welcome)" }
    ],
    "Upcoming Events": [
      { "Date": "2026-06-14", "Time": "After Isha (8:30 PM)", "Location": "Main Hall", "Program Title": "Preparation for Dhul Hijjah & Udhiyah", "Lecturer": "Sheikh Ghouse Khan Umari", "Duration": "1.5 hours", "Audiance": "Men & Women" },
      { "Date": "2026-06-21", "Time": "After Maghrib (6:40 PM)", "Location": "First Floor", "Program Title": "Parenting in the Light of Sunnah", "Lecturer": "Sheikh Aashiqh Madani", "Duration": "1.5 hours", "Audiance": "Men & Women" }
    ],
    "Past program history": [
      { "Date": "2026-05-15", "Program Title": "Ramadan Preparation Seminar", "Lecturer": "Sheikh Ghouse Khan", "Attendance": "250", "Comments": "Very engaging, Q&A session went long" },
      { "Date": "2026-05-24", "Program Title": "EID Milan Community Dinner", "Lecturer": "Masjid Committee", "Attendance": "500", "Comments": "Eid celebration dinner for families" },
      { "Date": "2026-04-18", "Program Title": "Parenting in Islam Workshop", "Lecturer": "Sheikh Aashiqh Madani", "Attendance": "120", "Comments": "Focus on raising kids in the modern era" },
      { "Date": "2026-04-01", "Program Title": "Basic Arabic Grammar Short Course", "Lecturer": "Ustadh Abdur Rahman", "Attendance": "45", "Comments": "4-week crash course, certificates distributed" }
    ],
    "Reports": [
      { "Category": "Finance", "Date": "2026-06-01", "Title": "Monthly Financial Statement - May 2026", "Summary": "Total Collections: ₹4,50,000, Total Expenses: ₹3,80,000. Surplus: ₹70,000. Construction fund updated.", "Link": "#" },
      { "Category": "Project", "Date": "2026-05-10", "Title": "Masjid Renovation Progress Report", "Summary": "Second floor roofing completed. Painting started. Estimated completion: August 2026.", "Link": "#" },
      { "Category": "Charity", "Date": "2026-05-28", "Title": "Community Welfare Distribution Report", "Summary": "Ration kits distributed to 150 needy families in local area. Total expenditure: ₹1,50,000.", "Link": "#" }
    ]
  };
}
