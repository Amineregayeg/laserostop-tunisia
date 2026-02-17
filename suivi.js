// ===== Configuration =====
const TUNIS_TZ = 'Africa/Tunis';

// Center detection from URL
const CURRENT_CENTER = window.location.pathname.includes('/sfax') ? 'sfax' : 'tunis';

// Supabase Configuration
const SUPABASE_URL = 'https://llhwtsklaakhfblxxoxn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsaHd0c2tsYWFraGZibHh4b3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxNTMzOTYsImV4cCI6MjA3NTcyOTM5Nn0.0pUq5TZHFp88qPAoyTK6sWS_d0_PU-gj8iLv1iTa78I';

const API = {
  PENDING_SESSIONS: 'https://llhwtsklaakhfblxxoxn.functions.supabase.co/pending-sessions',
  UPDATE_SESSION: 'https://llhwtsklaakhfblxxoxn.functions.supabase.co/update-session',
  FINANCIAL_SUMMARY: 'https://llhwtsklaakhfblxxoxn.functions.supabase.co/financial-summary',
  BATCH_CONFIRM: 'https://llhwtsklaakhfblxxoxn.functions.supabase.co/batch-confirm'
};

const STRINGS = {
  CATEGORIES: {
    tabac: 'Arrêt du tabac',
    drogue: 'Sevrage drogue',
    drogue_dure: 'Sevrage drogues dures',
    drogue_douce: 'Sevrage drogues douces',
    renforcement: 'Renforcement (gratuit)'
  },
  STANDARD_PRICES: {
    tabac: 500,
    drogue: 750,
    drogue_dure: 1000,
    drogue_douce: 600,
    renforcement: 0
  },
  ATTENDANCE_STATUS: {
    present: { icon: '✅', text: 'Présent', color: '#28A745' },
    absent: { icon: '❌', text: 'Absent', color: '#DC3545' },
    rescheduled: { icon: '⏰', text: 'Reporté', color: '#FFC107' }
  }
};

// ===== Global State =====
let currentSessions = [];
let isSubmitting = false;
let selectedSession = null;

// ===== API Calls =====
async function apiCall(url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
        ...options.headers
      },
      ...options
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Erreur de connexion');
    }
    throw error;
  }
}

// ===== Data Loading =====
async function loadPendingSessions() {
  try {
    const dateFilter = document.getElementById('dateFilter').value;
    const categoryFilter = document.getElementById('categoryFilter').value;
    
    const params = new URLSearchParams({
      date_filter: dateFilter,
      ...(categoryFilter && { category: categoryFilter }),
      center: CURRENT_CENTER
    });

    const data = await apiCall(`${API.PENDING_SESSIONS}?${params}`);
    currentSessions = data.sessions || [];
    renderSessionsList();
    updateQuickStats();
  } catch (error) {
    showToast(error.message || 'Erreur lors du chargement', 'error');
    document.getElementById('sessionsList').innerHTML = `
      <div class="loading" style="color: var(--danger);">
        Erreur: ${error.message}
      </div>
    `;
  }
}

async function loadFinancialSummary() {
  try {
    const data = await apiCall(`${API.FINANCIAL_SUMMARY}?center=${CURRENT_CENTER}`);
    updateFinancialSummary(data);
  } catch (error) {
    console.error('Financial summary error:', error);
    showToast('Erreur lors du chargement du résumé financier', 'error');
  }
}

// ===== Rendering =====
function renderSessionsList() {
  const container = document.getElementById('sessionsList');
  
  if (currentSessions.length === 0) {
    container.innerHTML = `
      <div class="loading">
        Aucune séance à confirmer pour cette période.
      </div>
    `;
    return;
  }
  
  container.innerHTML = currentSessions.map(session => {
    const startTime = new Date(session.slot_start_utc).toLocaleString('fr-TN', {
      timeZone: TUNIS_TZ,
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const duration = session.session_duration || 60;
    const sessionType = session.session_type || 'solo';
    const standardPrice = STRINGS.STANDARD_PRICES[session.category] || 0;
    const urgencyClass = session.urgency_status || '';
    
    return `
      <div class="session-card ${urgencyClass}" data-session-id="${session.id}">
        <div class="session-header">
          <div>
            <h3 class="client-name">${session.client_name}</h3>
            <p class="session-time">${startTime}</p>
          </div>
          ${urgencyClass === 'overdue' ? '<span style="color: var(--danger); font-weight: bold;">En retard</span>' : ''}
          ${urgencyClass === 'current' ? '<span style="color: var(--warning); font-weight: bold;">En cours</span>' : ''}
        </div>
        
        <div class="session-details">
          <span class="session-meta">${duration} min • ${sessionType}</span>
          <span class="category-badge category-badge--${session.category}">
            ${STRINGS.CATEGORIES[session.category]}
          </span>
          <span class="price-display">Prix standard: ${standardPrice} DT</span>
        </div>
        
        ${session.notes ? `<p class="session-meta">Notes: ${session.notes}</p>` : ''}
        
        <div class="session-actions">
          <button class="btn btn-primary confirm-session-btn" data-session-id="${session.id}">
            Confirmer
          </button>
          <div class="status-buttons">
            <button class="status-btn status-btn--present" 
                    onclick="quickConfirm('${session.id}', 'present', ${standardPrice})">
              ✅ Présent
            </button>
            <button class="status-btn status-btn--absent" 
                    onclick="quickConfirm('${session.id}', 'absent', 0)">
              ❌ Absent
            </button>
            <button class="status-btn status-btn--reschedule" 
                    onclick="quickConfirm('${session.id}', 'rescheduled', 0)">
              ⏰ Reporté
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  // Add event listeners for confirm buttons
  document.querySelectorAll('.confirm-session-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const sessionId = e.target.dataset.sessionId;
      openSessionModal(sessionId);
    });
  });
}

function updateQuickStats() {
  const pendingCount = currentSessions.length;
  const dailyRevenue = currentSessions
    .filter(s => {
      const sessionDate = new Date(s.slot_start_utc).toDateString();
      const today = new Date().toDateString();
      return sessionDate === today;
    })
    .reduce((sum, s) => sum + (STRINGS.STANDARD_PRICES[s.category] || 0), 0);
  
  document.getElementById('pendingCount').textContent = pendingCount;
  document.getElementById('dailyRevenue').textContent = `${dailyRevenue.toLocaleString()} DT`;
}

function updateFinancialSummary(data) {
  const today = data.today || {};
  const weekly = data.weekly || {};
  
  document.getElementById('todayConfirmed').textContent =
    `${today.confirmed_sessions || 0} séances • ${(today.confirmed_revenue || 0).toLocaleString()} DT`;

  document.getElementById('todayPending').textContent =
    `${today.pending_sessions || 0} séances (non traitées)`;

  document.getElementById('todayAbsent').textContent =
    `${today.absent_sessions || 0} séances • 0 DT`;
  
  document.getElementById('weeklyTotal').textContent = 
    `${(weekly.total_revenue || 0).toLocaleString()} DT`;
  
  document.getElementById('weeklyAverage').textContent = 
    `${(weekly.avg_session_price || 0).toLocaleString()} DT`;
  
  // Simple chart placeholder
  renderWeeklyChart(weekly.daily_data || []);
}

function renderWeeklyChart(dailyData) {
  const canvas = document.getElementById('weeklyChart');
  const ctx = canvas.getContext('2d');
  
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (!dailyData.length) {
    ctx.fillStyle = '#6C757D';
    ctx.font = '14px var(--font-family)';
    ctx.textAlign = 'center';
    ctx.fillText('Aucune donnée', canvas.width / 2, canvas.height / 2);
    return;
  }
  
  // Simple bar chart
  const maxRevenue = Math.max(...dailyData.map(d => d.revenue));
  const barWidth = canvas.width / dailyData.length - 10;
  
  dailyData.forEach((day, index) => {
    const barHeight = (day.revenue / maxRevenue) * (canvas.height - 40);
    const x = index * (barWidth + 10) + 5;
    const y = canvas.height - barHeight - 20;
    
    ctx.fillStyle = '#0C9AA6';
    ctx.fillRect(x, y, barWidth, barHeight);
    
    // Day label
    ctx.fillStyle = '#6C757D';
    ctx.font = '10px var(--font-family)';
    ctx.textAlign = 'center';
    ctx.fillText(day.day, x + barWidth / 2, canvas.height - 5);
  });
}

// ===== Session Confirmation =====
function openSessionModal(sessionId) {
  const session = currentSessions.find(s => s.id === sessionId);
  if (!session) return;
  
  selectedSession = session;
  const modal = document.getElementById('sessionModal');
  const form = document.getElementById('sessionForm');
  
  // Reset form
  form.reset();
  
  // Populate session info
  const startTime = new Date(session.slot_start_utc).toLocaleString('fr-TN', {
    timeZone: TUNIS_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit'
  });
  
  const standardPrice = STRINGS.STANDARD_PRICES[session.category] || 0;
  
  document.getElementById('sessionClientInfo').innerHTML = `
    <h4>${session.client_name}</h4>
    <p><strong>📅 Date:</strong> ${startTime}</p>
    <p><strong>⏱️ Durée:</strong> ${session.session_duration || 60} minutes • ${session.session_type || 'solo'}</p>
    <p><strong>🏷️ Catégorie:</strong> ${STRINGS.CATEGORIES[session.category]}</p>
    <p><strong>📞 Téléphone:</strong> ${session.phone}</p>
    ${session.notes ? `<p><strong>📝 Notes:</strong> ${session.notes}</p>` : ''}
  `;
  
  // Set standard price
  document.getElementById('standardPriceValue').textContent = standardPrice;
  document.getElementById('actualPrice').value = standardPrice;
  document.getElementById('sessionId').value = sessionId;
  
  // Select standard price by default
  document.querySelectorAll('.price-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById('standardPriceBtn').classList.add('active');
  
  modal.showModal();
}

async function quickConfirm(sessionId, attendanceStatus, price) {
  try {
    const updateData = {
      session_id: sessionId,
      attendance_status: attendanceStatus,
      actual_price: price,
      price_notes: attendanceStatus === 'absent' ? 'Client absent' : 
                   attendanceStatus === 'rescheduled' ? 'Séance reportée' : '',
      follow_up_notes: `Confirmation rapide: ${STRINGS.ATTENDANCE_STATUS[attendanceStatus].text}`
    };
    
    const response = await apiCall(API.UPDATE_SESSION, {
      method: 'POST',
      body: JSON.stringify(updateData)
    });
    
    if (response.success) {
      showToast(`Séance marquée comme ${STRINGS.ATTENDANCE_STATUS[attendanceStatus].text.toLowerCase()}`, 'success');
      loadPendingSessions();
      loadFinancialSummary();
    }
  } catch (error) {
    showToast(`Erreur: ${error.message}`, 'error');
  }
}

async function handleSessionSubmit(event) {
  event.preventDefault();
  
  if (isSubmitting) return;
  isSubmitting = true;
  
  const form = event.target;
  const submitBtn = document.getElementById('confirmSession');
  const originalText = submitBtn.textContent;
  
  try {
    submitBtn.textContent = 'Confirmation...';
    submitBtn.disabled = true;
    
    const formData = new FormData(form);
    const updateData = {
      session_id: formData.get('sessionId'),
      attendance_status: formData.get('attendanceStatus'),
      actual_price: parseFloat(formData.get('actualPrice')),
      price_notes: formData.get('priceNotes') || '',
      follow_up_notes: formData.get('followUpNotes') || ''
    };
    
    const response = await apiCall(API.UPDATE_SESSION, {
      method: 'POST',
      body: JSON.stringify(updateData)
    });
    
    if (response.success) {
      document.getElementById('sessionModal').close();
      showToast('Séance confirmée avec succès', 'success');
      loadPendingSessions();
      loadFinancialSummary();
    }
  } catch (error) {
    showToast(`Erreur: ${error.message}`, 'error');
  } finally {
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
    isSubmitting = false;
  }
}

// ===== Batch Operations =====
async function handleBatchConfirm() {
  const todaySessions = currentSessions.filter(session => {
    const sessionDate = new Date(session.slot_start_utc).toDateString();
    const today = new Date().toDateString();
    return sessionDate === today;
  });
  
  if (todaySessions.length === 0) {
    showToast('Aucune séance à confirmer pour aujourd\'hui', 'info');
    return;
  }
  
  const modal = document.getElementById('batchModal');
  const preview = document.getElementById('batchPreview');
  
  preview.innerHTML = todaySessions.map(session => {
    const standardPrice = STRINGS.STANDARD_PRICES[session.category] || 0;
    return `
      <div class="batch-item">
        <span class="batch-client">${session.client_name}</span>
        <span class="batch-price">${standardPrice} DT</span>
      </div>
    `;
  }).join('');
  
  modal.showModal();
}

async function confirmBatchSessions() {
  try {
    const todaySessions = currentSessions.filter(session => {
      const sessionDate = new Date(session.slot_start_utc).toDateString();
      const today = new Date().toDateString();
      return sessionDate === today;
    });
    
    const response = await apiCall(API.BATCH_CONFIRM, {
      method: 'POST',
      body: JSON.stringify({
        session_ids: todaySessions.map(s => s.id),
        attendance_status: 'present',
        use_standard_prices: true
      })
    });
    
    if (response.success) {
      document.getElementById('batchModal').close();
      showToast(`${response.updated_count} séances confirmées`, 'success');
      loadPendingSessions();
      loadFinancialSummary();
    }
  } catch (error) {
    showToast(`Erreur: ${error.message}`, 'error');
  }
}

// ===== Price Management =====
function setupPriceButtons() {
  const standardBtn = document.getElementById('standardPriceBtn');
  const freeBtn = document.getElementById('freePriceBtn');
  const customBtn = document.getElementById('customPriceBtn');
  const priceInput = document.getElementById('actualPrice');
  
  standardBtn.addEventListener('click', () => {
    const standardPrice = selectedSession ? STRINGS.STANDARD_PRICES[selectedSession.category] : 500;
    priceInput.value = standardPrice;
    updatePriceButtonState('standard');
  });
  
  freeBtn.addEventListener('click', () => {
    priceInput.value = 0;
    updatePriceButtonState('free');
  });
  
  customBtn.addEventListener('click', () => {
    priceInput.focus();
    updatePriceButtonState('custom');
  });
  
  priceInput.addEventListener('input', () => {
    updatePriceButtonState('custom');
  });
}

function updatePriceButtonState(activeType) {
  document.querySelectorAll('.price-btn').forEach(btn => btn.classList.remove('active'));
  
  if (activeType === 'standard') {
    document.getElementById('standardPriceBtn').classList.add('active');
  } else if (activeType === 'free') {
    document.getElementById('freePriceBtn').classList.add('active');
  } else if (activeType === 'custom') {
    document.getElementById('customPriceBtn').classList.add('active');
  }
}

// ===== Export Functions =====
async function exportFinancialData() {
  try {
    const data = await apiCall(`${API.FINANCIAL_SUMMARY}?export=true`);
    
    // Create CSV content
    const csvContent = [
      ['Date', 'Client', 'Catégorie', 'Durée', 'Prix Standard', 'Prix Réel', 'Statut', 'Notes'].join(','),
      ...data.export_data.map(row => [
        row.date,
        `"${row.client_name}"`,
        row.category,
        row.duration,
        row.standard_price,
        row.actual_price,
        row.attendance_status,
        `"${row.notes || ''}"`
      ].join(','))
    ].join('\n');
    
    // Download file
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `laserostop-finances-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    
    showToast('Export téléchargé avec succès', 'success');
  } catch (error) {
    showToast(`Erreur d'export: ${error.message}`, 'error');
  }
}

// ===== Toast Notifications =====
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  
  // Force reflow
  toast.offsetHeight;
  
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

// ===== Event Listeners =====
function initializeEventListeners() {
  // Filter changes
  document.getElementById('dateFilter').addEventListener('change', loadPendingSessions);
  document.getElementById('categoryFilter').addEventListener('change', loadPendingSessions);
  document.getElementById('refreshBtn').addEventListener('click', () => {
    loadPendingSessions();
    loadFinancialSummary();
  });
  
  // Session form
  document.getElementById('sessionForm').addEventListener('submit', handleSessionSubmit);
  
  // Modal controls
  document.getElementById('closeSessionModal').addEventListener('click', () => {
    document.getElementById('sessionModal').close();
  });
  
  document.getElementById('cancelSession').addEventListener('click', () => {
    document.getElementById('sessionModal').close();
  });
  
  // Batch operations
  document.getElementById('markAllConfirmedBtn').addEventListener('click', handleBatchConfirm);
  document.getElementById('confirmBatch').addEventListener('click', confirmBatchSessions);
  document.getElementById('cancelBatch').addEventListener('click', () => {
    document.getElementById('batchModal').close();
  });
  document.getElementById('closeBatchModal').addEventListener('click', () => {
    document.getElementById('batchModal').close();
  });
  
  // Quick actions
  document.getElementById('exportFinancesBtn').addEventListener('click', exportFinancialData);
  document.getElementById('dailyReportBtn').addEventListener('click', () => {
    showToast('Fonctionnalité de rapport en développement', 'info');
  });
  
  // Price management
  setupPriceButtons();
  
  // Close modals on backdrop click
  [document.getElementById('sessionModal'), document.getElementById('batchModal')].forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.close();
      }
    });
  });
  
  // Escape key to close modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('dialog[open]').forEach(modal => modal.close());
    }
  });
}

// ===== Authentication =====
function checkAuth() {
  const authKey = 'laserostop_app_auth';
  const savedAuth = localStorage.getItem(authKey);
  
  if (savedAuth === 'authenticated') {
    return true;
  }
  
  // Show PIN prompt
  const userPin = prompt('Code PIN d\'accès:');
  
  if (userPin === '20252025') {
    localStorage.setItem(authKey, 'authenticated');
    return true;
  } else if (userPin === null) {
    // User cancelled
    document.body.innerHTML = '<div style="text-align: center; margin-top: 50vh; font-family: system-ui;"><h2>Accès refusé</h2><p>Code PIN requis pour accéder à l\'application.</p></div>';
    return false;
  } else {
    alert('Code PIN incorrect');
    document.body.innerHTML = '<div style="text-align: center; margin-top: 50vh; font-family: system-ui;"><h2>Accès refusé</h2><p>Code PIN incorrect.</p></div>';
    return false;
  }
}

// ===== Initialization =====
function init() {
  // Check authentication (required)
  if (!checkAuth()) return;

  // Set center dropdown
  const centerSelect = document.getElementById('centerSelect');
  if (centerSelect) {
    centerSelect.value = CURRENT_CENTER;
    centerSelect.addEventListener('change', (e) => {
      const newCenter = e.target.value;
      if (newCenter === 'sfax') {
        window.location.href = '/sfax/suivi';
      } else {
        window.location.href = '/suivi';
      }
    });
  }

  // Initialize UI
  initializeEventListeners();
  
  // Load initial data
  loadPendingSessions();
  loadFinancialSummary();
}

// Start the application
document.addEventListener('DOMContentLoaded', init);