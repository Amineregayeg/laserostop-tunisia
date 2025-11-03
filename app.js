// ===== Configuration =====
const TUNIS_TZ = 'Africa/Tunis';

// Supabase Configuration
const SUPABASE_URL = 'https://llhwtsklaakhfblxxoxn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsaHd0c2tsYWFraGZibHh4b3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxNTMzOTYsImV4cCI6MjA3NTcyOTM5Nn0.0pUq5TZHFp88qPAoyTK6sWS_d0_PU-gj8iLv1iTa78I';

const API = {
  WEEK: 'https://llhwtsklaakhfblxxoxn.functions.supabase.co/week',
  CREATE: 'https://llhwtsklaakhfblxxoxn.functions.supabase.co/create-booking',
  CANCEL: 'https://llhwtsklaakhfblxxoxn.functions.supabase.co/cancel-booking',
  MOVE: 'https://llhwtsklaakhfblxxoxn.functions.supabase.co/move-booking',
  UPDATE: 'https://llhwtsklaakhfblxxoxn.functions.supabase.co/update-booking',
  STATS: 'https://llhwtsklaakhfblxxoxn.functions.supabase.co/stats',
  EXPORT: 'https://llhwtsklaakhfblxxoxn.functions.supabase.co/export'
};

const STRINGS = {
  DAYS: ['Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
  CATEGORIES: {
    tabac: 'Arrêt du tabac',
    drogue: 'Sevrage drogue',
    drogue_dure: 'Sevrage drogues dures',
    drogue_douce: 'Sevrage drogues douces',
    renforcement: 'Renforcement (gratuit)'
  },
  ERRORS: {
    REQUIRED_FIELDS: 'Veuillez remplir tous les champs obligatoires',
    PHONE_FORMAT: 'Format de téléphone invalide',
    SLOT_TAKEN: 'Créneau déjà réservé',
    NETWORK_ERROR: 'Erreur de connexion',
    UNKNOWN_ERROR: 'Une erreur est survenue'
  },
  SUCCESS: {
    BOOKING_CREATED: 'Rendez-vous créé avec succès',
    BOOKING_CANCELLED: 'Rendez-vous annulé avec succès'
  },
  CONFIRM: {
    CANCEL_BOOKING: 'Êtes-vous sûr de vouloir annuler ce rendez-vous ?'
  }
};

// ===== Time Slots Configuration =====
function generateTimeSlots() {
  const slots = {
    mardi: [],
    mercredi: [],
    jeudi: [],
    vendredi: [],
    samedi: []
  };

  // Generate 30-minute slots for each day
  // Tuesday, Wednesday, Thursday: 10:00 → 19:00
  ['mardi', 'mercredi', 'jeudi'].forEach(day => {
    for (let hour = 10; hour < 19; hour++) {
      slots[day].push(`${hour.toString().padStart(2, '0')}:00-${hour.toString().padStart(2, '0')}:30`);
      slots[day].push(`${hour.toString().padStart(2, '0')}:30-${(hour + 1).toString().padStart(2, '0')}:00`);
    }
  });

  // Friday: 10:00 → 15:30
  for (let hour = 10; hour < 15; hour++) {
    slots.vendredi.push(`${hour.toString().padStart(2, '0')}:00-${hour.toString().padStart(2, '0')}:30`);
    slots.vendredi.push(`${hour.toString().padStart(2, '0')}:30-${(hour + 1).toString().padStart(2, '0')}:00`);
  }
  slots.vendredi.push('15:00-15:30');

  // Saturday: 10:00 → 18:00
  for (let hour = 10; hour < 18; hour++) {
    slots.samedi.push(`${hour.toString().padStart(2, '0')}:00-${hour.toString().padStart(2, '0')}:30`);
    slots.samedi.push(`${hour.toString().padStart(2, '0')}:30-${(hour + 1).toString().padStart(2, '0')}:00`);
  }

  return slots;
}

const TIME_SLOTS = generateTimeSlots();

// ===== Global State =====
let currentWeekStart = null;
let currentBookings = [];
let isSubmitting = false;
let draggedBooking = null;
let draggedElement = null;
let pendingDuplicateData = null;

// ===== Date Utilities =====
function getTunisTime() {
  return new Date().toLocaleString('en-CA', { timeZone: TUNIS_TZ });
}

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d.setDate(diff));
  
  // Move to Tuesday (start of our work week)
  const tuesday = new Date(monday);
  tuesday.setDate(monday.getDate() + 1);
  
  return tuesday;
}

function formatDate(date) {
  return new Intl.DateTimeFormat('fr-TN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: TUNIS_TZ
  }).format(date);
}

function formatTime(time) {
  return time;
}

function localToUTC(localDateStr, timeStr) {
  const [startTime] = timeStr.split('-');
  const dateTimeStr = `${localDateStr}T${startTime}:00`;
  const localDate = new Date(dateTimeStr);
  
  // Convert from Tunis time to UTC
  const tunisDate = new Date(localDate.toLocaleString('sv-SE', { timeZone: TUNIS_TZ }));
  const utcDate = new Date(localDate.getTime() + (localDate.getTimezoneOffset() * 60000));
  
  return utcDate.toISOString();
}

function utcToLocal(utcStr) {
  const utcDate = new Date(utcStr);
  return new Intl.DateTimeFormat('fr-TN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TUNIS_TZ
  }).format(utcDate);
}

function isSlotInPast(date, timeSlot) {
  const now = new Date();
  const [startTime] = timeSlot.split('-');
  const [hours, minutes] = startTime.split(':');
  
  const slotDate = new Date(date);
  slotDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
  
  // Convert current time to Tunis timezone for comparison
  const nowInTunis = new Date(now.toLocaleString('sv-SE', { timeZone: TUNIS_TZ }));
  
  return slotDate < nowInTunis;
}

// ===== Calendar Generation =====
function generateWeekDates(weekStart) {
  const dates = [];
  for (let i = 0; i < 5; i++) {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + i);
    dates.push(date);
  }
  return dates;
}

function renderCalendar() {
  const calendar = document.getElementById('calendar');
  const weekDates = generateWeekDates(currentWeekStart);
  
  // Clear calendar
  calendar.innerHTML = '';
  
  // Check if mobile view
  const isMobile = window.innerWidth <= 768;
  
  if (isMobile) {
    renderMobileCalendar(calendar, weekDates);
  } else {
    renderDesktopCalendar(calendar, weekDates);
  }
}

function renderDesktopCalendar(calendar, weekDates) {
  calendar.className = 'calendar';
  
  // Header row
  const headerHour = document.createElement('div');
  headerHour.className = 'calendar-header';
  headerHour.textContent = 'Heures';
  calendar.appendChild(headerHour);
  
  weekDates.forEach((date, dayIndex) => {
    const headerDay = document.createElement('div');
    headerDay.className = 'calendar-header';
    headerDay.textContent = `${STRINGS.DAYS[dayIndex]} ${formatDate(date)}`;
    calendar.appendChild(headerDay);
  });
  
  // Get all unique time slots
  const allSlots = [...new Set(Object.values(TIME_SLOTS).flat())].sort();
  
  // Time slots rows
  allSlots.forEach(timeSlot => {
    // Hour label
    const hourCell = document.createElement('div');
    hourCell.className = 'calendar-hour';
    hourCell.textContent = timeSlot;
    calendar.appendChild(hourCell);
    
    // Day cells
    weekDates.forEach((date, dayIndex) => {
      const dayKey = STRINGS.DAYS[dayIndex].toLowerCase();
      const daySlots = TIME_SLOTS[dayKey] || [];
      
      const cell = document.createElement('div');
      cell.className = 'calendar-cell';
      
      if (daySlots.includes(timeSlot)) {
        const dateStr = date.toISOString().split('T')[0];
        const isPast = isSlotInPast(date, timeSlot);
        const booking = findBookingForSlot(dateStr, timeSlot);
        
        if (isPast) {
          cell.className += ' cell--past';
          cell.setAttribute('aria-label', `${STRINGS.DAYS[dayIndex]} ${formatDate(date)} ${timeSlot}, passé`);
        } else if (booking) {
          cell.className += ' cell--booked calendar-cell--draggable';
          cell.setAttribute('aria-label', `${STRINGS.DAYS[dayIndex]} ${formatDate(date)} ${timeSlot}, réservé par ${booking.client_name}`);
          cell.setAttribute('draggable', 'true');
          cell.dataset.bookingId = booking.id;
          
          // Check if this is the first slot of the booking
          const bookingStartTime = new Date(booking.slot_start_utc).toLocaleTimeString('en-GB', { 
            timeZone: TUNIS_TZ, 
            hour12: false, 
            hour: '2-digit', 
            minute: '2-digit' 
          });
          const [slotStartTime] = timeSlot.split('-');
          const isFirstSlot = bookingStartTime === slotStartTime;
          
          if (isFirstSlot) {
            // Show full booking info in the first slot
            cell.innerHTML = `
              <div class="booking-info">
                <div>${booking.client_name}</div>
                <div class="session-duration">${booking.session_duration || 60} min</div>
                <div class="session-type">${booking.session_type || 'solo'}</div>
                <span class="category-badge category-badge--${booking.category}">${STRINGS.CATEGORIES[booking.category]}</span>
              </div>
            `;
          } else {
            // Show continuation indicator in subsequent slots
            cell.innerHTML = `
              <div class="booking-info booking-continuation">
                <div>↳ ${booking.client_name}</div>
                <small>Suite</small>
              </div>
            `;
          }
          
          cell.addEventListener('click', () => showBookingDetails(booking));
          setupDragEvents(cell, booking, dateStr, timeSlot);
          setupEditShortcuts(cell, booking);
        } else {
          cell.className += ' cell--free';
          cell.setAttribute('aria-label', `${STRINGS.DAYS[dayIndex]} ${formatDate(date)} ${timeSlot}, disponible`);
          cell.textContent = 'Libre';
          cell.addEventListener('click', () => openBookingModal(dateStr, timeSlot));
        }
        
        cell.setAttribute('tabindex', isPast ? '-1' : '0');
        if (!isPast) {
          cell.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              cell.click();
            }
          });
        }
      } else {
        cell.style.background = '#f8f9fa';
        cell.style.cursor = 'not-allowed';
      }
      
      calendar.appendChild(cell);
    });
  });
}

function renderMobileCalendar(calendar, weekDates) {
  calendar.className = 'calendar mobile';
  
  weekDates.forEach((date, dayIndex) => {
    const dayKey = STRINGS.DAYS[dayIndex].toLowerCase();
    const daySlots = TIME_SLOTS[dayKey] || [];
    
    const dayContainer = document.createElement('div');
    dayContainer.className = 'mobile-day';
    
    const dayHeader = document.createElement('div');
    dayHeader.className = 'mobile-day-header';
    dayHeader.textContent = `${STRINGS.DAYS[dayIndex]} ${formatDate(date)}`;
    dayContainer.appendChild(dayHeader);
    
    const slotsContainer = document.createElement('div');
    slotsContainer.className = 'mobile-slots';
    
    daySlots.forEach(timeSlot => {
      const dateStr = date.toISOString().split('T')[0];
      const isPast = isSlotInPast(date, timeSlot);
      const booking = findBookingForSlot(dateStr, timeSlot);
      
      const slot = document.createElement('div');
      slot.className = 'mobile-slot';
      
      if (isPast) {
        slot.className += ' cell--past';
      } else if (booking) {
        slot.className += ' cell--booked calendar-cell--draggable';
        slot.setAttribute('draggable', 'true');
        slot.dataset.bookingId = booking.id;
        
        // Check if this is the first slot of the booking
        const bookingStartTime = new Date(booking.slot_start_utc).toLocaleTimeString('en-GB', { 
          timeZone: TUNIS_TZ, 
          hour12: false, 
          hour: '2-digit', 
          minute: '2-digit' 
        });
        const [slotStartTime] = timeSlot.split('-');
        const isFirstSlot = bookingStartTime === slotStartTime;
        
        if (isFirstSlot) {
          slot.innerHTML = `
            <div class="booking-info">
              <div>${timeSlot}</div>
              <div>${booking.client_name}</div>
              <div class="session-duration">${booking.session_duration || 60} min</div>
              <div class="session-type">${booking.session_type || 'solo'}</div>
              <span class="category-badge category-badge--${booking.category}">${STRINGS.CATEGORIES[booking.category]}</span>
            </div>
          `;
        } else {
          slot.innerHTML = `
            <div class="booking-info booking-continuation">
              <div>${timeSlot}</div>
              <div>↳ ${booking.client_name}</div>
              <small>Suite</small>
            </div>
          `;
        }
        
        slot.addEventListener('click', () => showBookingDetails(booking));
        setupDragEvents(slot, booking, dateStr, timeSlot);
        setupEditShortcuts(slot, booking);
      } else {
        slot.className += ' cell--free';
        slot.innerHTML = `<div>${timeSlot}</div><div>Libre</div>`;
        slot.addEventListener('click', () => openBookingModal(dateStr, timeSlot));
      }
      
      slotsContainer.appendChild(slot);
    });
    
    dayContainer.appendChild(slotsContainer);
    calendar.appendChild(dayContainer);
  });
}

function findBookingForSlot(date, timeSlot) {
  const [slotStartTime, slotEndTime] = timeSlot.split('-');
  
  return currentBookings.find(booking => {
    if (booking.status !== 'booked') return false;
    
    const bookingDate = new Date(booking.slot_start_utc).toLocaleDateString('sv-SE', { timeZone: TUNIS_TZ });
    if (bookingDate !== date) return false;
    
    const bookingStartTime = new Date(booking.slot_start_utc).toLocaleTimeString('en-GB', { 
      timeZone: TUNIS_TZ, 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    const bookingEndTime = new Date(booking.slot_end_utc).toLocaleTimeString('en-GB', { 
      timeZone: TUNIS_TZ, 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    // Check if this booking overlaps with the current slot
    // Convert times to minutes for easier comparison
    const slotStart = timeToMinutes(slotStartTime);
    const slotEnd = timeToMinutes(slotEndTime);
    const bookingStart = timeToMinutes(bookingStartTime);
    const bookingEnd = timeToMinutes(bookingEndTime);
    
    // Check for overlap: booking starts before slot ends AND booking ends after slot starts
    return bookingStart < slotEnd && bookingEnd > slotStart;
  });
}

function timeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

// ===== Week Navigation =====
function updateWeekTitle() {
  const weekEnd = new Date(currentWeekStart);
  weekEnd.setDate(currentWeekStart.getDate() + 4); // Saturday
  
  const title = `Planning LaserOstop — Semaine du ${formatDate(currentWeekStart)} au ${formatDate(weekEnd)}`;
  document.getElementById('weekTitle').textContent = title;
}

function navigateWeek(direction) {
  const newWeekStart = new Date(currentWeekStart);
  newWeekStart.setDate(currentWeekStart.getDate() + (direction * 7));
  currentWeekStart = newWeekStart;
  
  updateWeekTitle();
  loadWeekBookings();
}

function goToCurrentWeek() {
  currentWeekStart = getWeekStart();
  updateWeekTitle();
  loadWeekBookings();
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

    // Handle 409 Conflict (duplicate client) specially
    if (response.status === 409) {
      const conflictData = await response.json();
      return { conflict: true, ...conflictData };
    }

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

async function loadWeekBookings() {
  try {
    const startDate = currentWeekStart.toISOString().split('T')[0];
    const data = await apiCall(`${API.WEEK}?start=${startDate}`);
    currentBookings = data.bookings || [];
    renderCalendar();
  } catch (error) {
    showToast(error.message || STRINGS.ERRORS.UNKNOWN_ERROR, 'error');
    renderCalendar(); // Render empty calendar
  }
}

async function createBooking(bookingData) {
  const data = await apiCall(API.CREATE, {
    method: 'POST',
    body: JSON.stringify(bookingData)
  });

  // Handle duplicate client conflict
  if (data.conflict === 'duplicate_client') {
    return data; // Return conflict data to be handled by caller
  }

  if (data.success) {
    currentBookings.push(data.booking);
    renderCalendar();
    return data;
  } else {
    throw new Error(data.message || STRINGS.ERRORS.UNKNOWN_ERROR);
  }
}

async function cancelBooking(bookingId) {
  const data = await apiCall(API.CANCEL, {
    method: 'POST',
    body: JSON.stringify({ id: bookingId })
  });
  
  if (data.success) {
    const bookingIndex = currentBookings.findIndex(b => b.id === bookingId);
    if (bookingIndex !== -1) {
      currentBookings[bookingIndex].status = 'cancelled';
    }
    renderCalendar();
    return data;
  } else {
    throw new Error(data.message || STRINGS.ERRORS.UNKNOWN_ERROR);
  }
}

// ===== Modal Management =====
function openBookingModal(date, timeSlot) {
  const modal = document.getElementById('bookingModal');
  const form = document.getElementById('bookingForm');
  const slotInfo = document.getElementById('slotInfo');
  
  // Reset form
  form.reset();
  updateCharCount();
  
  // Set slot info
  const dateObj = new Date(date);
  const dayName = STRINGS.DAYS[dateObj.getDay() - 2]; // Adjust for Tuesday=0
  const formattedDate = formatDate(dateObj);
  slotInfo.textContent = `${dayName} ${formattedDate} de ${timeSlot}`;
  
  // Store slot data
  form.dataset.date = date;
  form.dataset.timeSlot = timeSlot;
  
  modal.showModal();
  document.getElementById('clientName').focus();
}

function closeBookingModal() {
  document.getElementById('bookingModal').close();
}

function showBookingDetails(booking) {
  const modal = document.getElementById('detailsModal');
  const details = document.getElementById('bookingDetails');
  
  const startTime = new Date(booking.slot_start_utc).toLocaleTimeString('fr-TN', {
    timeZone: TUNIS_TZ,
    hour: '2-digit',
    minute: '2-digit'
  });
  const endTime = new Date(booking.slot_end_utc).toLocaleTimeString('fr-TN', {
    timeZone: TUNIS_TZ,
    hour: '2-digit',
    minute: '2-digit'
  });
  const date = new Date(booking.slot_start_utc).toLocaleDateString('fr-TN', {
    timeZone: TUNIS_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  
  details.innerHTML = `
    <dl>
      <dt>Date et heure :</dt>
      <dd>${date} de ${startTime} à ${endTime}</dd>
      <dt>Nom :</dt>
      <dd>${booking.client_name}</dd>
      <dt>Téléphone :</dt>
      <dd>${booking.phone}</dd>
      <dt>Catégorie :</dt>
      <dd><span class="category-badge category-badge--${booking.category}">${STRINGS.CATEGORIES[booking.category]}</span></dd>
      ${booking.notes ? `<dt>Notes :</dt><dd>${booking.notes}</dd>` : ''}
      <dt>Statut :</dt>
      <dd><span class="status-badge status-badge--${booking.status}">${booking.status === 'booked' ? 'Confirmé' : 'Annulé'}</span></dd>
    </dl>
  `;
  
  // Store booking ID for cancellation
  document.getElementById('cancelBookingBtn').dataset.bookingId = booking.id;
  
  modal.showModal();
}

function closeDetailsModal() {
  document.getElementById('detailsModal').close();
}

// ===== Form Validation =====
function validateBookingForm(formData) {
  const errors = [];
  
  if (!formData.client_name.trim()) {
    errors.push('Le nom est obligatoire');
  }
  
  if (!formData.phone.trim()) {
    errors.push('Le téléphone est obligatoire');
  }
  // No phone format validation - accept any input
  
  if (!formData.category) {
    errors.push('La catégorie est obligatoire');
  }
  
  return errors;
}

// ===== Form Submission =====
async function handleBookingSubmit(event) {
  event.preventDefault();
  
  if (isSubmitting) return;
  isSubmitting = true;
  
  const form = event.target;
  const submitBtn = document.getElementById('submitBooking');
  const originalText = submitBtn.textContent;
  
  try {
    submitBtn.textContent = 'Création...';
    submitBtn.disabled = true;
    
    const formData = new FormData(form);
    const [startTime, endTime] = form.dataset.timeSlot.split('-');
    
    const duration = parseInt(formData.get('sessionDuration'));
    const sessionType = formData.get('sessionType');
    
    // Calculate actual end time based on duration
    const [startHour, startMin] = startTime.split(':');
    const startDate = new Date();
    startDate.setHours(parseInt(startHour), parseInt(startMin), 0, 0);
    
    const endDate = new Date(startDate.getTime() + (duration * 60000)); // Add duration in minutes
    const calculatedEndTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;

    const bookingData = {
      client_name: formData.get('clientName').trim(),
      phone: formData.get('phone').trim(),
      category: formData.get('category'),
      notes: formData.get('notes')?.trim() || '',
      session_duration: duration,
      session_type: sessionType,
      slot_start_local: `${form.dataset.date}T${startTime}:00`,
      slot_end_local: `${form.dataset.date}T${calculatedEndTime}:00`
    };
    
    const errors = validateBookingForm(bookingData);
    if (errors.length > 0) {
      showToast(errors.join(', '), 'error');
      return;
    }

    const result = await createBooking(bookingData);

    // Handle duplicate client conflict
    if (result.conflict === 'duplicate_client') {
      pendingDuplicateData = {
        bookingData: bookingData,
        existingBooking: result.existing_booking,
        matchBy: result.match_by
      };
      closeBookingModal();
      showDuplicateModal(result);
      return;
    }

    closeBookingModal();
    showToast(STRINGS.SUCCESS.BOOKING_CREATED, 'success');
    
  } catch (error) {
    showToast(error.message || STRINGS.ERRORS.UNKNOWN_ERROR, 'error');
  } finally {
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
    isSubmitting = false;
  }
}

// ===== Booking Cancellation =====
function showCancelConfirmation(bookingId) {
  const modal = document.getElementById('confirmModal');
  const message = document.getElementById('confirmMessage');
  
  message.textContent = STRINGS.CONFIRM.CANCEL_BOOKING;
  document.getElementById('confirmYes').dataset.bookingId = bookingId;
  
  modal.showModal();
}

async function handleBookingCancellation(bookingId) {
  try {
    await cancelBooking(bookingId);
    closeDetailsModal();
    document.getElementById('confirmModal').close();
    showToast(STRINGS.SUCCESS.BOOKING_CANCELLED, 'success');
  } catch (error) {
    showToast(error.message || STRINGS.ERRORS.UNKNOWN_ERROR, 'error');
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

// ===== Character Counter =====
function updateCharCount() {
  const notes = document.getElementById('notes');
  const counter = document.querySelector('.char-count');
  const count = notes.value.length;
  counter.textContent = `${count}/140`;
  
  if (count > 140) {
    counter.style.color = 'var(--danger)';
  } else {
    counter.style.color = 'var(--gray-500)';
  }
}

// ===== Phone Input Formatting =====
function formatPhoneInput(input) {
  // No formatting - let user type whatever they want
  // The input value remains exactly as typed
}

// ===== Drag and Drop Functionality =====
function setupDragEvents(element, booking, dateStr, timeSlot) {
  element.addEventListener('dragstart', (e) => {
    draggedBooking = booking;
    draggedElement = element;
    element.classList.add('calendar-cell--dragging');
    
    // Set drag data
    e.dataTransfer.setData('text/plain', booking.id);
    e.dataTransfer.effectAllowed = 'move';
    
    // Add visual feedback to all valid drop targets
    setTimeout(() => {
      document.querySelectorAll('.calendar-cell.cell--free').forEach(cell => {
        cell.classList.add('calendar-cell--drop-target');
        setupDropEvents(cell);
      });
    }, 0);
  });

  element.addEventListener('dragend', (e) => {
    element.classList.remove('calendar-cell--dragging');
    
    // Remove drop target styling from all cells
    document.querySelectorAll('.calendar-cell--drop-target').forEach(cell => {
      cell.classList.remove('calendar-cell--drop-target');
      removeDropEvents(cell);
    });
    
    draggedBooking = null;
    draggedElement = null;
  });
}

// ===== Edit Shortcuts: Long-Press (Mobile) & Right-Click (Desktop) =====
function setupEditShortcuts(element, booking) {
  let pressTimer;

  // Mobile: Long-press to edit (500ms)
  element.addEventListener('touchstart', (e) => {
    pressTimer = setTimeout(() => {
      e.preventDefault();
      showEditModal(booking);
    }, 500);
  });

  element.addEventListener('touchend', () => {
    clearTimeout(pressTimer);
  });

  element.addEventListener('touchmove', () => {
    clearTimeout(pressTimer); // Cancel if user scrolls
  });

  // Desktop: Right-click to edit
  element.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showEditModal(booking);
  });
}

function setupDropEvents(element) {
  element.addEventListener('dragover', handleDragOver);
  element.addEventListener('drop', handleDrop);
  element.addEventListener('dragenter', handleDragEnter);
  element.addEventListener('dragleave', handleDragLeave);
}

function removeDropEvents(element) {
  element.removeEventListener('dragover', handleDragOver);
  element.removeEventListener('drop', handleDrop);
  element.removeEventListener('dragenter', handleDragEnter);
  element.removeEventListener('dragleave', handleDragLeave);
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
  e.preventDefault();
  this.style.backgroundColor = 'rgba(12, 154, 166, 0.2)';
}

function handleDragLeave(e) {
  this.style.backgroundColor = '';
}

function handleDrop(e) {
  e.preventDefault();
  this.style.backgroundColor = '';
  
  if (!draggedBooking) return;
  
  // Get drop target information
  const targetDate = getDateFromCalendarCell(this);
  const targetTimeSlot = getTimeSlotFromCalendarCell(this);
  
  if (!targetDate || !targetTimeSlot) {
    showToast('Impossible de déterminer le créneau de destination', 'error');
    return;
  }
  
  // Check for conflicts
  const conflictingBooking = findBookingForSlot(targetDate, targetTimeSlot);
  
  if (conflictingBooking) {
    showConflictResolutionModal(draggedBooking, conflictingBooking, targetDate, targetTimeSlot);
  } else {
    // No conflict, proceed with move
    moveBooking(draggedBooking, targetDate, targetTimeSlot);
  }
}

function getDateFromCalendarCell(cell) {
  // Find the column index of this cell in the grid
  const calendar = document.getElementById('calendar');
  const allCells = Array.from(calendar.children);
  const cellIndex = allCells.indexOf(cell);
  
  if (cellIndex === -1) return null;
  
  // Calculate which day column this cell is in (skip time column)
  const gridCols = 6; // 1 time column + 5 day columns
  const colIndex = cellIndex % gridCols;
  
  if (colIndex === 0) return null; // Time column
  
  const dayIndex = colIndex - 1; // Adjust for time column
  const weekDates = generateWeekDates(currentWeekStart);
  
  return weekDates[dayIndex]?.toISOString().split('T')[0];
}

function getTimeSlotFromCalendarCell(cell) {
  // Find the row of this cell to determine the time slot
  const calendar = document.getElementById('calendar');
  const allCells = Array.from(calendar.children);
  const cellIndex = allCells.indexOf(cell);
  
  if (cellIndex === -1) return null;
  
  const gridCols = 6; // 1 time column + 5 day columns
  const rowIndex = Math.floor(cellIndex / gridCols);
  
  if (rowIndex === 0) return null; // Header row
  
  // Get all unique time slots and find the one for this row
  const allSlots = [...new Set(Object.values(TIME_SLOTS).flat())].sort();
  const slotIndex = rowIndex - 1; // Adjust for header row
  
  return allSlots[slotIndex];
}

function showConflictResolutionModal(movingBooking, conflictingBooking, targetDate, targetTimeSlot) {
  const modal = document.getElementById('conflictModal');
  const description = document.getElementById('conflictDescription');
  const movingSession = document.getElementById('movingSession');
  const conflictingSession = document.getElementById('conflictingSession');
  
  // Format the conflict description
  const targetDateObj = new Date(targetDate);
  const dayName = STRINGS.DAYS[targetDateObj.getDay() - 2];
  const formattedDate = formatDate(targetDateObj);
  
  description.textContent = `Vous tentez de déplacer la séance de ${movingBooking.client_name} vers ${dayName} ${formattedDate} ${targetTimeSlot}, mais ce créneau est déjà occupé par ${conflictingBooking.client_name}.`;
  
  // Show session previews
  movingSession.innerHTML = `
    <strong>${movingBooking.client_name}</strong><br>
    <small>${movingBooking.session_duration || 60} min • ${movingBooking.session_type || 'solo'}</small><br>
    <span class="category-badge category-badge--${movingBooking.category}">${STRINGS.CATEGORIES[movingBooking.category]}</span>
  `;
  
  conflictingSession.innerHTML = `
    <strong>${conflictingBooking.client_name}</strong><br>
    <small>${conflictingBooking.session_duration || 60} min • ${conflictingBooking.session_type || 'solo'}</small><br>
    <span class="category-badge category-badge--${conflictingBooking.category}">${STRINGS.CATEGORIES[conflictingBooking.category]}</span>
  `;
  
  // Store resolution data
  modal.dataset.movingBookingId = movingBooking.id;
  modal.dataset.conflictingBookingId = conflictingBooking.id;
  modal.dataset.targetDate = targetDate;
  modal.dataset.targetTimeSlot = targetTimeSlot;
  
  modal.showModal();
}

async function moveBooking(booking, targetDate, targetTimeSlot) {
  try {
    const [startTime, endTime] = targetTimeSlot.split('-');
    const duration = booking.session_duration || 60;
    
    // Calculate actual end time based on duration
    const [startHour, startMin] = startTime.split(':');
    const startDate = new Date();
    startDate.setHours(parseInt(startHour), parseInt(startMin), 0, 0);
    
    const endDate = new Date(startDate.getTime() + (duration * 60000));
    const calculatedEndTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;
    
    console.log('Moving booking:', {
      original: booking,
      targetDate,
      targetTimeSlot,
      calculatedEndTime,
      duration
    });
    
    // Create new booking data
    const newBookingData = {
      client_name: booking.client_name,
      phone: booking.phone,
      category: booking.category,
      notes: booking.notes || '',
      session_duration: duration,
      session_type: booking.session_type || 'solo',
      slot_start_local: `${targetDate}T${startTime}:00`,
      slot_end_local: `${targetDate}T${calculatedEndTime}:00`
    };
    
    console.log('New booking data:', newBookingData);

    // Use the move-booking API endpoint (not create-booking to avoid duplicate detection)
    const moveResponse = await apiCall(API.MOVE, {
      method: 'POST',
      body: JSON.stringify({
        booking_id: booking.id,
        new_slot_start_local: `${targetDate}T${startTime}:00`,
        new_slot_end_local: `${targetDate}T${calculatedEndTime}:00`
      })
    });

    if (moveResponse.success) {
      showToast('Séance déplacée avec succès', 'success');
      await loadWeekBookings();
    } else {
      throw new Error(moveResponse.message || 'Échec du déplacement du rendez-vous');
    }
  } catch (error) {
    console.error('Move booking error:', error);
    showToast(`Erreur lors du déplacement: ${error.message}`, 'error');
    // Reload calendar to restore original state in case of error
    loadWeekBookings();
  }
}

async function handleConflictResolution(resolution) {
  const modal = document.getElementById('conflictModal');
  const movingBookingId = modal.dataset.movingBookingId;
  const conflictingBookingId = modal.dataset.conflictingBookingId;
  const targetDate = modal.dataset.targetDate;
  const targetTimeSlot = modal.dataset.targetTimeSlot;
  
  const movingBooking = currentBookings.find(b => b.id === movingBookingId);
  const conflictingBooking = currentBookings.find(b => b.id === conflictingBookingId);
  
  if (!movingBooking || !conflictingBooking) {
    showToast('Erreur: séances introuvables', 'error');
    modal.close();
    return;
  }
  
  try {
    switch (resolution) {
      case 'share':
        await handleShareTime(movingBooking, conflictingBooking, targetDate, targetTimeSlot);
        break;
      case 'moveDown':
        await handleMoveDown(movingBooking, conflictingBooking, targetDate, targetTimeSlot);
        break;
      case 'replace':
        await handleReplace(movingBooking, conflictingBooking, targetDate, targetTimeSlot);
        break;
    }
    
    modal.close();
    renderCalendar();
  } catch (error) {
    showToast(`Erreur lors de la résolution: ${error.message}`, 'error');
  }
}

async function handleShareTime(movingBooking, conflictingBooking, targetDate, targetTimeSlot) {
  // For share time, we'll allow both bookings in the same slot
  // This is useful for duo sessions or when sessions can overlap
  showToast('Partage de temps non encore implémenté', 'info');
  
  // Move the booking to the target slot anyway
  await moveBooking(movingBooking, targetDate, targetTimeSlot);
}

async function handleMoveDown(movingBooking, conflictingBooking, targetDate, targetTimeSlot) {
  // Find the next available slot after the target slot
  const [targetStartTime] = targetTimeSlot.split('-');
  const targetDateObj = new Date(targetDate);
  const dayKey = STRINGS.DAYS[targetDateObj.getDay() - 2].toLowerCase();
  const daySlots = TIME_SLOTS[dayKey] || [];
  
  const targetSlotIndex = daySlots.indexOf(targetTimeSlot);
  
  if (targetSlotIndex === -1) {
    throw new Error('Créneau cible introuvable');
  }
  
  // Find next available slots for the conflicting booking
  let nextAvailableSlot = null;
  for (let i = targetSlotIndex + 1; i < daySlots.length; i++) {
    const checkSlot = daySlots[i];
    const existingBooking = findBookingForSlot(targetDate, checkSlot);
    
    if (!existingBooking) {
      nextAvailableSlot = checkSlot;
      break;
    }
  }
  
  if (!nextAvailableSlot) {
    throw new Error('Aucun créneau disponible pour déplacer l\'autre séance');
  }
  
  // Move the conflicting booking to the next available slot
  await moveBooking(conflictingBooking, targetDate, nextAvailableSlot);
  
  // Then move the original booking to the target slot
  await moveBooking(movingBooking, targetDate, targetTimeSlot);
  
  showToast(`Séances déplacées avec succès. ${conflictingBooking.client_name} déplacé vers ${nextAvailableSlot}`, 'success');
}

async function handleReplace(movingBooking, conflictingBooking, targetDate, targetTimeSlot) {
  // Cancel the conflicting booking and move the new one
  await cancelBooking(conflictingBooking.id);
  await moveBooking(movingBooking, targetDate, targetTimeSlot);
  
  showToast(`Séance de ${conflictingBooking.client_name} annulée et ${movingBooking.client_name} déplacé`, 'success');
}

// ===== Switch Functionality =====
function initializeSwitches() {
  // Duration switches
  document.querySelectorAll('.duration-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Check if renforcement is selected
      const selectedCategory = document.querySelector('input[name="category"]:checked')?.value;
      if (selectedCategory === 'renforcement' && e.target.dataset.duration !== '30') {
        showToast('Le renforcement doit être de 30 minutes', 'error');
        return;
      }

      // Remove active from all duration buttons
      document.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('active'));
      // Add active to clicked button
      e.target.classList.add('active');
      // Update hidden input
      document.getElementById('sessionDuration').value = e.target.dataset.duration;

      // Auto-update available slots based on duration
      updateAvailableSlots();
    });
  });

  // Type switches
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Remove active from all type buttons
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      // Add active to clicked button
      e.target.classList.add('active');
      // Update hidden input
      document.getElementById('sessionType').value = e.target.dataset.type;

      // Auto-set duration to 90min for duo
      if (e.target.dataset.type === 'duo') {
        document.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-duration="90"]').classList.add('active');
        document.getElementById('sessionDuration').value = '90';
      }

      // Update available slots
      updateAvailableSlots();
    });
  });

  // Category radio buttons - enforce renforcement = 30 min
  document.querySelectorAll('input[name="category"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'renforcement') {
        // Force 30 minutes
        document.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('active'));
        const btn30 = document.querySelector('[data-duration="30"]');
        if (btn30) {
          btn30.classList.add('active');
          document.getElementById('sessionDuration').value = '30';
        }
        showToast('Renforcement: séance gratuite de 30 minutes', 'info');
      }
    });
  });
}

function updateAvailableSlots() {
  // This will update the calendar to show only compatible slots
  // For now, we'll just update the current view
  const duration = document.getElementById('sessionDuration').value;
  const type = document.getElementById('sessionType').value;
  
  // Could add logic here to filter slots based on duration
  // For example, 90-minute sessions might need consecutive 30-min slots
}

// ===== Event Listeners =====
function initializeEventListeners() {
  // Week navigation
  document.getElementById('prevWeek').addEventListener('click', () => navigateWeek(-1));
  document.getElementById('nextWeek').addEventListener('click', () => navigateWeek(1));
  document.getElementById('currentWeek').addEventListener('click', goToCurrentWeek);
  
  // PWA Installation
  initializePWAInstall();
  
  // Duration and Type switches
  initializeSwitches();
  
  // Modal controls
  document.getElementById('closeModal').addEventListener('click', closeBookingModal);
  document.getElementById('cancelBooking').addEventListener('click', closeBookingModal);
  document.getElementById('closeDetailsModal').addEventListener('click', closeDetailsModal);
  document.getElementById('closeDetails').addEventListener('click', closeDetailsModal);
  
  // Form submission
  document.getElementById('bookingForm').addEventListener('submit', handleBookingSubmit);
  
  // Character counter
  document.getElementById('notes').addEventListener('input', updateCharCount);
  
  // Phone input (no formatting needed)
  
  // Booking cancellation
  document.getElementById('cancelBookingBtn').addEventListener('click', (e) => {
    const bookingId = e.target.dataset.bookingId;
    showCancelConfirmation(bookingId);
  });
  
  // Confirmation modal
  document.getElementById('confirmNo').addEventListener('click', () => {
    document.getElementById('confirmModal').close();
  });
  
  document.getElementById('confirmYes').addEventListener('click', (e) => {
    const bookingId = e.target.dataset.bookingId;
    handleBookingCancellation(bookingId);
  });
  
  // Conflict resolution modal
  document.getElementById('closeConflictModal').addEventListener('click', () => {
    document.getElementById('conflictModal').close();
  });

  document.getElementById('shareTimeBtn').addEventListener('click', () => {
    handleConflictResolution('share');
  });

  document.getElementById('moveDownBtn').addEventListener('click', () => {
    handleConflictResolution('moveDown');
  });

  document.getElementById('replaceBtn').addEventListener('click', () => {
    handleConflictResolution('replace');
  });

  document.getElementById('cancelMoveBtn').addEventListener('click', () => {
    document.getElementById('conflictModal').close();
  });

  // Duplicate client modal
  document.getElementById('closeDuplicateModal').addEventListener('click', closeDuplicateModal);
  document.getElementById('cancelDuplicateBtn').addEventListener('click', closeDuplicateModal);
  document.getElementById('moveOldBtn').addEventListener('click', handleMoveOld);
  document.getElementById('keepBothBtn').addEventListener('click', handleKeepBoth);

  // Edit booking modal
  document.getElementById('editBookingBtn').addEventListener('click', () => {
    const bookingId = document.getElementById('cancelBookingBtn').dataset.bookingId;
    const booking = currentBookings.find(b => b.id === bookingId);
    if (booking) {
      closeDetailsModal();
      showEditModal(booking);
    }
  });

  document.getElementById('closeEditModal').addEventListener('click', closeEditModal);
  document.getElementById('cancelEdit').addEventListener('click', closeEditModal);
  document.getElementById('editForm').addEventListener('submit', handleEditSubmit);

  // Initialize edit modal switches
  initializeEditSwitches();

  // Close modals on backdrop click
  [document.getElementById('bookingModal'), document.getElementById('detailsModal'), document.getElementById('confirmModal'), document.getElementById('conflictModal')].forEach(modal => {
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
  
  // Responsive calendar re-render
  window.addEventListener('resize', () => {
    clearTimeout(window.resizeTimeout);
    window.resizeTimeout = setTimeout(renderCalendar, 250);
  });
}

// ===== PWA Registration =====
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('pwa/service-worker.js')
        .then(registration => {
          console.log('SW registered: ', registration);
        })
        .catch(registrationError => {
          console.log('SW registration failed: ', registrationError);
        });
    });
  }
}

// ===== PWA Installation =====
let deferredPrompt;

function initializePWAInstall() {
  const installBtn = document.getElementById('installAppBtn');
  
  // Listen for the beforeinstallprompt event
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later
    deferredPrompt = e;
    // Show the install button
    installBtn.style.display = 'block';
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
  });
  
  // Listen for app installed event
  window.addEventListener('appinstalled', () => {
    showToast('LaserOstop Planning installé sur votre appareil!', 'success');
    installBtn.style.display = 'none';
  });
  
  // Hide install button if app is already installed
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
    installBtn.style.display = 'none';
  }
}

// ===== Duplicate Client Modal =====
function showDuplicateModal(conflictData) {
  const modal = document.getElementById('duplicateModal');
  const description = document.getElementById('duplicateDescription');
  const existingInfo = document.getElementById('existingBookingInfo');

  const matchType = conflictData.match_by === 'phone' ? 'numéro de téléphone' : 'nom';
  description.textContent = `Ce client existe déjà (correspondance par ${matchType}).`;

  const existing = conflictData.existing_booking;
  const startDate = new Date(existing.slot_start_utc);
  const startLocal = startDate.toLocaleString('fr-TN', {
    timeZone: TUNIS_TZ,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  existingInfo.innerHTML = `
    <div><strong>${existing.client_name}</strong></div>
    <div>${existing.phone}</div>
    <div>${startLocal}</div>
  `;

  modal.showModal();
}

function closeDuplicateModal() {
  document.getElementById('duplicateModal').close();
  pendingDuplicateData = null;
}

async function handleMoveOld() {
  if (!pendingDuplicateData) return;

  try {
    const { bookingData, existingBooking } = pendingDuplicateData;

    // Move the existing booking to the new slot
    const moveResult = await apiCall(API.MOVE, {
      method: 'POST',
      body: JSON.stringify({
        booking_id: existingBooking.id,
        new_slot_start_local: bookingData.slot_start_local,
        new_slot_end_local: bookingData.slot_end_local
      })
    });

    if (moveResult.success) {
      closeDuplicateModal();
      showToast('Rendez-vous existant déplacé avec succès', 'success');
      loadWeekBookings();
    } else {
      throw new Error(moveResult.message || 'Erreur lors du déplacement');
    }
  } catch (error) {
    showToast(error.message || STRINGS.ERRORS.UNKNOWN_ERROR, 'error');
  }
}

async function handleKeepBoth() {
  if (!pendingDuplicateData) return;

  try {
    const { bookingData } = pendingDuplicateData;

    // Create new booking with force_create flag
    const result = await createBooking({ ...bookingData, force_create: true });

    if (result.success) {
      closeDuplicateModal();
      showToast('Deuxième rendez-vous créé avec succès', 'success');
    } else {
      throw new Error(result.message || 'Erreur lors de la création');
    }
  } catch (error) {
    showToast(error.message || STRINGS.ERRORS.UNKNOWN_ERROR, 'error');
  }
}

// ===== Edit Booking Modal =====
function showEditModal(booking) {
  const modal = document.getElementById('editModal');

  // Populate form fields
  document.getElementById('editClientName').value = booking.client_name;
  document.getElementById('editPhone').value = booking.phone;
  document.getElementById('editSessionDuration').value = booking.session_duration || 60;
  document.getElementById('editSessionType').value = booking.session_type || 'solo';
  document.getElementById('editNotes').value = booking.notes || '';
  document.getElementById('editBookingId').value = booking.id;

  // Set active duration button
  document.querySelectorAll('.edit-duration-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.duration === String(booking.session_duration || 60));
  });

  // Set active type button
  document.querySelectorAll('.edit-type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === (booking.session_type || 'solo'));
  });

  // Set category radio
  const categoryRadio = document.querySelector(`input[name="editCategory"][value="${booking.category}"]`);
  if (categoryRadio) {
    categoryRadio.checked = true;
  }

  // Update char count
  const charCount = document.querySelector('.edit-char-count');
  if (charCount) {
    charCount.textContent = `${(booking.notes || '').length}/140`;
  }

  modal.showModal();
}

function closeEditModal() {
  document.getElementById('editModal').close();
}

async function handleEditSubmit(event) {
  event.preventDefault();

  const form = event.target;
  const formData = new FormData(form);
  const bookingId = document.getElementById('editBookingId').value;

  const updateData = {
    booking_id: bookingId,
    client_name: formData.get('editClientName').trim(),
    phone: formData.get('editPhone').trim(),
    category: formData.get('editCategory'),
    notes: formData.get('editNotes')?.trim() || '',
    session_duration: parseInt(document.getElementById('editSessionDuration').value),
    session_type: document.getElementById('editSessionType').value
  };

  try {
    const result = await apiCall(API.UPDATE, {
      method: 'POST',
      body: JSON.stringify(updateData)
    });

    if (result.success) {
      closeEditModal();
      closeDetailsModal();
      showToast('Rendez-vous modifié avec succès', 'success');
      loadWeekBookings();
    } else {
      throw new Error(result.message || 'Erreur lors de la modification');
    }
  } catch (error) {
    showToast(error.message || STRINGS.ERRORS.UNKNOWN_ERROR, 'error');
  }
}

// Initialize edit modal switches
function initializeEditSwitches() {
  // Duration switches for edit modal
  document.querySelectorAll('.edit-duration-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const selectedCategory = document.querySelector('input[name="editCategory"]:checked')?.value;
      if (selectedCategory === 'renforcement' && e.target.dataset.duration !== '30') {
        showToast('Le renforcement doit être de 30 minutes', 'error');
        return;
      }

      document.querySelectorAll('.edit-duration-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      document.getElementById('editSessionDuration').value = e.target.dataset.duration;
    });
  });

  // Type switches for edit modal
  document.querySelectorAll('.edit-type-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.edit-type-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      document.getElementById('editSessionType').value = e.target.dataset.type;

      if (e.target.dataset.type === 'duo') {
        document.querySelectorAll('.edit-duration-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.edit-duration-btn[data-duration="90"]')?.classList.add('active');
        document.getElementById('editSessionDuration').value = '90';
      }
    });
  });

  // Category radio buttons for edit modal
  document.querySelectorAll('input[name="editCategory"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'renforcement') {
        document.querySelectorAll('.edit-duration-btn').forEach(b => b.classList.remove('active'));
        const btn30 = document.querySelector('.edit-duration-btn[data-duration="30"]');
        if (btn30) {
          btn30.classList.add('active');
          document.getElementById('editSessionDuration').value = '30';
        }
        showToast('Renforcement: séance gratuite de 30 minutes', 'info');
      }
    });
  });

  // Char counter for edit notes
  const editNotes = document.getElementById('editNotes');
  if (editNotes) {
    editNotes.addEventListener('input', (e) => {
      const charCount = document.querySelector('.edit-char-count');
      if (charCount) {
        charCount.textContent = `${e.target.value.length}/140`;
      }
    });
  }
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
  
  // Set initial week
  currentWeekStart = getWeekStart();
  
  // Initialize UI
  updateWeekTitle();
  initializeEventListeners();
  
  // Load data
  loadWeekBookings();
  
  // Register PWA
  registerServiceWorker();
}

// Start the application
document.addEventListener('DOMContentLoaded', init);