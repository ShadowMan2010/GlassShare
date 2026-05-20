// Screen Wake Lock API handler

let wakeLock = null;
let wakeLockEnabled = true;

// Update wake lock status badge
function updateWakeLockBadge(isActive, errorMsg = null) {
  const badge = document.getElementById('wakelock-status-badge');
  if (!badge) return;

  const icon = badge.querySelector('.status-icon');
  const text = badge.querySelector('span');

  if (isActive) {
    badge.className = 'wakelock-indicator active';
    icon.className = 'status-icon text-success';
    icon.setAttribute('data-lucide', 'shield-check');
    text.textContent = 'Wake Lock: Active';
  } else {
    badge.className = 'wakelock-indicator';
    icon.className = 'status-icon text-warning';
    icon.setAttribute('data-lucide', 'shield-alert');
    text.textContent = errorMsg ? `Wake Lock: ${errorMsg}` : 'Wake Lock: Off';
  }
  
  // Re-run Lucide icons render
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Request Screen Wake Lock
export async function requestWakeLock() {
  if (!wakeLockEnabled) return;
  if (!('wakeLock' in navigator)) {
    console.warn('Wake Lock is not supported on this browser/platform.');
    updateWakeLockBadge(false, 'Unsupported');
    return;
  }

  try {
    // Release existing lock if active
    if (wakeLock) {
      await releaseWakeLock();
    }
    
    wakeLock = await navigator.wakeLock.request('screen');
    console.log('Screen Wake Lock acquired successfully');
    updateWakeLockBadge(true);

    wakeLock.addEventListener('release', () => {
      console.log('Screen Wake Lock released');
      // If released by OS, try to re-acquire when document becomes visible again
      updateWakeLockBadge(false);
    });
  } catch (err) {
    console.error(`Failed to acquire Wake Lock: ${err.message}`);
    updateWakeLockBadge(false, 'Failed');
  }
}

// Release Screen Wake Lock
export async function releaseWakeLock() {
  if (wakeLock) {
    await wakeLock.release();
    wakeLock = null;
    updateWakeLockBadge(false);
  }
}

// Re-acquire lock on focus/visibility change (mobile requirement)
document.addEventListener('visibilitychange', async () => {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    await requestWakeLock();
  }
});

// Configure wake lock behavior
export function setupWakeLockControls() {
  const toggle = document.getElementById('wakelock-toggle');
  const dimBtn = document.getElementById('dim-screen-btn');
  const undimBtn = document.getElementById('undim-btn');
  const dimOverlay = document.getElementById('dim-overlay');

  if (toggle) {
    toggle.addEventListener('change', (e) => {
      wakeLockEnabled = e.target.checked;
      if (wakeLockEnabled) {
        requestWakeLock();
      } else {
        releaseWakeLock();
      }
    });
  }

  // Dim Screen handlers for simulated screen-off transfers
  const toggleDim = (dim) => {
    if (dim) {
      dimOverlay.classList.remove('hidden');
      requestWakeLock(); // Always force wake lock when dimming
    } else {
      dimOverlay.classList.add('hidden');
    }
  };

  if (dimBtn) {
    dimBtn.addEventListener('click', () => toggleDim(true));
  }
  if (undimBtn) {
    undimBtn.addEventListener('click', () => toggleDim(false));
  }
}
