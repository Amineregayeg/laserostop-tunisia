// ===== Configuration =====
const TUNIS_TZ = 'Africa/Tunis';

// Center detection from URL
const CURRENT_CENTER = window.location.pathname.includes('/sfax') ? 'sfax' : 'tunis';

// Supabase Configuration
const SUPABASE_URL = 'https://llhwtsklaakhfblxxoxn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsaHd0c2tsYWFraGZibHh4b3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxNTMzOTYsImV4cCI6MjA3NTcyOTM5Nn0.0pUq5TZHFp88qPAoyTK6sWS_d0_PU-gj8iLv1iTa78I';

const API = {
  WEEK: 'https://llhwtsklaakhfblxxoxn.functions.supabase.co/week',
  CREATE: 'https://llhwtsklaakhfblxxoxn.functions.supabase.co/create-booking',
  CANCEL: 'https://llhwtsklaakhfblxxoxn.functions.supabase.co/cancel-booking',
  STATS: 'https://llhwtsklaakhfblxxoxn.functions.supabase.co/stats',
  EXPORT: 'https://llhwtsklaakhfblxxoxn.functions.supabase.co/export',
  FINANCIAL: 'https://llhwtsklaakhfblxxoxn.functions.supabase.co/financial-summary'
};

const STRINGS = {
  CATEGORIES: {
    tabac: 'Arrêt du tabac',
    drogue: 'Sevrage drogue',
    drogue_dure: 'Sevrage drogues dures',
    drogue_douce: 'Sevrage drogues douces',
    renforcement: 'Renforcement (gratuit)'
  },
  STATUS: {
    booked: 'Confirmé',
    cancelled: 'Annulé',
    completed: 'Terminé'
  },
  ERRORS: {
    NETWORK_ERROR: 'Erreur de connexion',
    UNKNOWN_ERROR: 'Une erreur est survenue',
    EXPORT_ERROR: 'Erreur lors de l\'exportation'
  },
  SUCCESS: {
    EXPORT_SUCCESS: 'Export CSV téléchargé avec succès'
  }
};

// ===== Global State =====
let allBookings = [];
let filteredBookings = [];
let currentSort = { field: 'date', direction: 'desc' };
let currentCenter = CURRENT_CENTER;

// ===== Date Utilities =====
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('fr-TN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: TUNIS_TZ
  }).format(date);
}

function formatDateTime(utcStr) {
  const date = new Date(utcStr);
  return new Intl.DateTimeFormat('fr-TN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TUNIS_TZ
  }).format(date);
}

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function getWeekEnd(weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 5); // Saturday
  return weekEnd;
}

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
      throw new Error(STRINGS.ERRORS.NETWORK_ERROR);
    }
    throw error;
  }
}

async function loadStats(dateFrom, dateTo) {
  try {
    const params = new URLSearchParams();
    if (dateFrom) params.append('from', dateFrom);
    if (dateTo) params.append('to', dateTo);
    params.append('center', currentCenter || CURRENT_CENTER);

    const data = await apiCall(`${API.STATS}?${params}`);
    return data;
  } catch (error) {
    showToast(error.message || STRINGS.ERRORS.UNKNOWN_ERROR, 'error');
    return {
      weekly_bookings: 0,
      fill_rate: 0,
      total_bookings: 0,
      categories: { tabac: 0, drogue: 0, drogue_dure: 0, drogue_douce: 0, renforcement: 0 },
      bookings: []
    };
  }
}

async function loadFinancialData() {
  try {
    const data = await apiCall(`${API.FINANCIAL}?center=${currentCenter || CURRENT_CENTER}`);
    return data;
  } catch (error) {
    console.error('Financial data error:', error);
    return null;
  }
}

async function loadBookings(dateFrom, dateTo, category) {
  try {
    const params = new URLSearchParams();
    if (dateFrom) params.append('from', dateFrom);
    if (dateTo) params.append('to', dateTo);
    if (category) params.append('category', category);
    params.append('center', currentCenter || CURRENT_CENTER);

    const data = await apiCall(`${API.WEEK}?${params}`);
    return data.bookings || [];
  } catch (error) {
    showToast(error.message || STRINGS.ERRORS.UNKNOWN_ERROR, 'error');
    return [];
  }
}

function renderFinancialKPIs(financial) {
  const revenueEl = document.getElementById('confirmedRevenue');
  const expectedEl = document.getElementById('expectedRevenue');
  const pendingEl = document.getElementById('pendingSessions');

  if (!financial || !revenueEl) return;

  const today = financial.today || {};
  const weekly = financial.weekly || {};

  revenueEl.textContent = `${weekly.total_revenue || 0} DT`;
  expectedEl.textContent = `${weekly.expected_revenue || 0} DT`;
  pendingEl.textContent = today.pending_sessions || 0;
}

async function exportBookings() {
  try {
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;
    const category = document.getElementById('categoryFilter').value;
    
    const params = new URLSearchParams();
    if (dateFrom) params.append('from', dateFrom);
    if (dateTo) params.append('to', dateTo);
    if (category) params.append('category', category);
    params.append('center', currentCenter || CURRENT_CENTER);

    const response = await fetch(`${API.EXPORT}?${params}`);
    
    if (!response.ok) {
      throw new Error('Export failed');
    }
    
    // Check if response is CSV or JSON
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('text/csv')) {
      // Direct CSV download
      const blob = await response.blob();
      downloadFile(blob, 'bookings.csv', 'text/csv');
    } else {
      // JSON response - convert to CSV client-side
      const data = await response.json();
      const csv = convertToCSV(data.bookings || filteredBookings);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      downloadFile(blob, 'bookings.csv', 'text/csv');
    }
    
    showToast(STRINGS.SUCCESS.EXPORT_SUCCESS, 'success');
  } catch (error) {
    showToast(STRINGS.ERRORS.EXPORT_ERROR, 'error');
  }
}

function downloadFile(blob, filename, mimeType) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function convertToCSV(bookings) {
  const headers = [
    'Date',
    'Heure début',
    'Heure fin',
    'Nom',
    'Téléphone',
    'Catégorie',
    'Statut',
    'Notes',
    'Créé le'
  ];
  
  const rows = bookings.map(booking => [
    formatDate(booking.slot_start_utc),
    new Date(booking.slot_start_utc).toLocaleTimeString('fr-TN', { timeZone: TUNIS_TZ, hour12: false }),
    new Date(booking.slot_end_utc).toLocaleTimeString('fr-TN', { timeZone: TUNIS_TZ, hour12: false }),
    `"${booking.client_name}"`,
    booking.phone,
    STRINGS.CATEGORIES[booking.category] || booking.category,
    STRINGS.STATUS[booking.status] || booking.status,
    `"${booking.notes || ''}"`,
    formatDateTime(booking.created_at)
  ]);
  
  const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  return '\ufeff' + csvContent; // BOM for Excel compatibility
}

// ===== Dashboard Rendering =====
function renderKPIs(stats) {
  document.getElementById('weeklyBookings').textContent = stats.weekly_bookings || 0;
  document.getElementById('fillRate').textContent = `${(stats.fill_rate || 0).toFixed(1)}%`;
  document.getElementById('totalBookings').textContent = stats.total_bookings || 0;
}

function renderCategoryChart(categories) {
  const total = Object.values(categories).reduce((sum, count) => sum + count, 0);
  
  Object.entries(categories).forEach(([category, count]) => {
    const percentage = total > 0 ? (count / total) * 100 : 0;
    const bar = document.querySelector(`.bar[data-category="${category}"]`);
    const countElement = document.getElementById(`${category}Count`);
    
    if (bar) {
      bar.style.width = `${percentage}%`;
    }
    if (countElement) {
      countElement.textContent = count;
    }
  });
}

function renderBookingsTable(bookings) {
  const tbody = document.getElementById('bookingsTableBody');
  
  if (!bookings || bookings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">Aucune réservation trouvée</td></tr>';
    return;
  }
  
  tbody.innerHTML = bookings.map(booking => {
    const startDate = new Date(booking.slot_start_utc);
    const startTime = startDate.toLocaleTimeString('fr-TN', {
      timeZone: TUNIS_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    return `
      <tr>
        <td>${formatDate(booking.slot_start_utc)}</td>
        <td>${startTime}</td>
        <td>${booking.client_name}</td>
        <td>${booking.phone}</td>
        <td><span class="category-badge category-badge--${booking.category}">${STRINGS.CATEGORIES[booking.category] || booking.category}</span></td>
        <td><span class="status-badge status-badge--${booking.status}">${STRINGS.STATUS[booking.status] || booking.status}</span></td>
        <td>${booking.notes || '-'}</td>
      </tr>
    `;
  }).join('');
}

// ===== Filtering and Sorting =====
async function applyFilters() {
  const dateFrom = document.getElementById('dateFrom').value;
  const dateTo = document.getElementById('dateTo').value;
  const category = document.getElementById('categoryFilter').value;

  // Re-fetch stats and bookings for the new date range
  const [stats, bookings] = await Promise.all([
    loadStats(dateFrom, dateTo),
    loadBookings(dateFrom, dateTo, category)
  ]);

  renderKPIs(stats);
  renderCategoryChart(stats.categories || {});

  allBookings = bookings;
  filteredBookings = [...allBookings];

  if (category) {
    filteredBookings = filteredBookings.filter(b => b.category === category);
  }

  sortBookings(currentSort.field, currentSort.direction);
  renderBookingsTable(filteredBookings);
}

function resetFilters() {
  document.getElementById('dateFrom').value = '';
  document.getElementById('dateTo').value = '';
  document.getElementById('categoryFilter').value = '';

  loadDashboardData();
}

function sortBookings(field, direction = 'asc') {
  const sortMultiplier = direction === 'asc' ? 1 : -1;
  
  filteredBookings.sort((a, b) => {
    let aValue, bValue;
    
    switch (field) {
      case 'date':
        aValue = new Date(a.slot_start_utc);
        bValue = new Date(b.slot_start_utc);
        break;
      case 'time':
        aValue = new Date(a.slot_start_utc);
        bValue = new Date(b.slot_start_utc);
        break;
      case 'name':
        aValue = a.client_name.toLowerCase();
        bValue = b.client_name.toLowerCase();
        break;
      case 'phone':
        aValue = a.phone;
        bValue = b.phone;
        break;
      case 'category':
        aValue = a.category;
        bValue = b.category;
        break;
      case 'status':
        aValue = a.status;
        bValue = b.status;
        break;
      default:
        return 0;
    }
    
    if (aValue < bValue) return -1 * sortMultiplier;
    if (aValue > bValue) return 1 * sortMultiplier;
    return 0;
  });
  
  currentSort = { field, direction };
  updateSortIndicators();
}

function updateSortIndicators() {
  // Reset all sort indicators
  document.querySelectorAll('.bookings-table th').forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
  });
  
  // Set current sort indicator
  const currentTh = document.querySelector(`[data-sort="${currentSort.field}"]`);
  if (currentTh) {
    currentTh.classList.add(`sorted-${currentSort.direction}`);
  }
}

function handleTableHeaderClick(event) {
  const th = event.target.closest('th[data-sort]');
  if (!th) return;
  
  const field = th.dataset.sort;
  const newDirection = currentSort.field === field && currentSort.direction === 'asc' ? 'desc' : 'asc';
  
  sortBookings(field, newDirection);
  renderBookingsTable(filteredBookings);
}

// ===== Email Configuration =====
async function updateNotificationEmail() {
  const emailInput = document.getElementById('notificationEmail');
  const updateBtn = document.getElementById('updateEmailBtn');
  const newEmail = emailInput.value.trim();
  
  // Validate email
  if (!newEmail) {
    showToast('Veuillez saisir une adresse email', 'error');
    return;
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(newEmail)) {
    showToast('Format d\'email invalide', 'error');
    return;
  }
  
  try {
    updateBtn.textContent = 'Mise à jour...';
    updateBtn.disabled = true;
    
    // Update via direct database call
    const response = await fetch(`${SUPABASE_URL}/rest/v1/settings?id=eq.notification_email`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ value: newEmail })
    });
    
    if (!response.ok) {
      throw new Error('Erreur lors de la mise à jour');
    }
    
    showToast('Email de notification mis à jour avec succès', 'success');
    
  } catch (error) {
    console.error('Error updating email:', error);
    showToast('Erreur lors de la mise à jour de l\'email', 'error');
  } finally {
    updateBtn.textContent = 'Mettre à jour';
    updateBtn.disabled = false;
  }
}

async function loadNotificationEmail() {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/settings?id=eq.notification_email&select=value`, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data && data.length > 0) {
        document.getElementById('notificationEmail').value = data[0].value;
      }
    }
  } catch (error) {
    console.error('Error loading notification email:', error);
  }
}

// ===== PWA Installation =====
let deferredPrompt;

function initializePWAInstall() {
  const installBtn = document.getElementById('installAppBtn');
  const instructions = document.getElementById('installInstructions');
  
  // Listen for the beforeinstallprompt event
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later
    deferredPrompt = e;
    // Show the install button
    installBtn.style.display = 'block';
    instructions.style.display = 'none';
  });
  
  // Handle install button click
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) {
      showToast('Installation non disponible sur cet appareil', 'error');
      return;
    }
    
    // Show the install prompt
    deferredPrompt.prompt();
    
    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      showToast('Application installée avec succès!', 'success');
    } else {
      showToast('Installation annulée', 'info');
    }
    
    // Clear the deferredPrompt
    deferredPrompt = null;
    installBtn.style.display = 'none';
    instructions.style.display = 'block';
  });
  
  // Listen for app installed event
  window.addEventListener('appinstalled', () => {
    showToast('LaserOstop Planning installé sur votre appareil!', 'success');
    installBtn.style.display = 'none';
    instructions.style.display = 'block';
  });
  
  // Check if app is already installed (standalone mode)
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
    instructions.innerHTML = '<p><strong>✅ Application déjà installée!</strong> Vous utilisez la version installée de LaserOstop Planning.</p>';
  }
}

// ===== Initialization Functions =====
async function loadDashboardData() {
  // Set default date range to current week
  const weekStart = getWeekStart();
  const weekEnd = getWeekEnd(weekStart);

  const dateFromInput = document.getElementById('dateFrom');
  const dateToInput = document.getElementById('dateTo');

  if (!dateFromInput.value) dateFromInput.value = weekStart.toISOString().split('T')[0];
  if (!dateToInput.value) dateToInput.value = weekEnd.toISOString().split('T')[0];

  const dateFrom = dateFromInput.value;
  const dateTo = dateToInput.value;

  // Load stats, bookings, and financial data in parallel
  const [stats, bookings, financial] = await Promise.all([
    loadStats(dateFrom, dateTo),
    loadBookings(dateFrom, dateTo),
    loadFinancialData()
  ]);

  // Update UI
  renderKPIs(stats);
  renderCategoryChart(stats.categories || {});
  renderFinancialKPIs(financial);

  allBookings = bookings;
  filteredBookings = [...allBookings];

  // Initial sort by date (newest first)
  sortBookings('date', 'desc');
  renderBookingsTable(filteredBookings);
}

function initializeEventListeners() {
  // Filter controls
  document.getElementById('applyFilters').addEventListener('click', applyFilters);
  document.getElementById('resetFilters').addEventListener('click', resetFilters);
  
  // Export button
  document.getElementById('exportBtn').addEventListener('click', exportBookings);
  
  // Table sorting
  document.getElementById('bookingsTable').addEventListener('click', handleTableHeaderClick);
  
  // Auto-apply filters on date change
  document.getElementById('dateFrom').addEventListener('change', applyFilters);
  document.getElementById('dateTo').addEventListener('change', applyFilters);
  document.getElementById('categoryFilter').addEventListener('change', applyFilters);
  
  // Email configuration
  document.getElementById('updateEmailBtn').addEventListener('click', updateNotificationEmail);
  
  // PWA Installation
  initializePWAInstall();
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

// ===== Supabase Client =====
let supabaseClient = null;

function initializeSupabase() {
  if (typeof window.supabase !== 'undefined') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
}

// ===== Realtime Updates =====
function setupRealtimeUpdates() {
  if (!supabaseClient) {
    console.warn('Supabase client not initialized, skipping Realtime');
    return;
  }

  const channel = supabaseClient.channel('dashboard-bookings')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'bookings' },
      (payload) => {
        console.log('Realtime update:', payload);
        // Reload dashboard data on any booking change
        loadDashboardData();
      }
    )
    .subscribe();

  console.log('Dashboard Realtime updates enabled');
}

// ===== Authentication =====
function checkAuth() {
  const authKey = 'laserostop_dashboard_auth';
  const savedAuth = localStorage.getItem(authKey);
  
  if (savedAuth === 'authenticated') {
    return true;
  }
  
  // Show PIN prompt
  const userPin = prompt('Code PIN du tableau de bord:');
  
  if (userPin === '20252025') {
    localStorage.setItem(authKey, 'authenticated');
    return true;
  } else if (userPin === null) {
    // User cancelled
    window.location.href = 'index.html';
    return false;
  } else {
    alert('Code PIN incorrect');
    window.location.href = 'index.html';
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
    centerSelect.value = currentCenter;
    centerSelect.addEventListener('change', (e) => {
      currentCenter = e.target.value;
      // For 'all', stay on same page; for tunis/sfax, can navigate or just reload data
      if (currentCenter === 'all') {
        loadDashboardData();
      } else if (currentCenter === 'sfax' && !window.location.pathname.includes('/sfax')) {
        window.location.href = '/sfax/dashboard';
      } else if (currentCenter === 'tunis' && window.location.pathname.includes('/sfax')) {
        window.location.href = '/dashboard';
      } else {
        loadDashboardData();
      }
    });
  }

  // Initialize Supabase client
  initializeSupabase();

  // Setup Realtime updates
  setupRealtimeUpdates();

  // Initialize event listeners
  initializeEventListeners();

  // Load notification email
  loadNotificationEmail();

  // Load dashboard data
  loadDashboardData();
}

// Start the application
document.addEventListener('DOMContentLoaded', init);