import QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';

let qrScanner = null;

/**
 * Generates a QR Code in a target element
 * @param {string} elementId - ID of the container element
 * @param {string} text - Text to encode in the QR code (SDP offer / Connection Room ID)
 */
export function generateQRCode(elementId, text) {
  const container = document.getElementById(elementId);
  if (!container) return;
  
  container.innerHTML = ''; // Clear previous contents
  
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  
  QRCode.toCanvas(canvas, text, {
    width: 240,
    margin: 2,
    color: {
      dark: '#0a0a14',    // Very dark background
      light: '#ffffff'    // High contrast white boundary
    }
  }, (error) => {
    if (error) console.error('QR code generation failed:', error);
  });
}

/**
 * Starts the QR Code scanning process using the system camera
 * @param {Function} onSuccess - Callback when a QR code is scanned successfully
 */
export function startQRScanner(onSuccess) {
  const containerId = 'scanner-container';
  const statusText = document.getElementById('scanner-status-text');
  
  if (statusText) statusText.textContent = 'Accessing camera...';
  
  // If scanner already exists, clean it up
  if (qrScanner) {
    stopQRScanner().then(() => {
      startQRScanner(onSuccess);
    });
    return;
  }
  
  qrScanner = new Html5Qrcode(containerId);
  
  const config = {
    fps: 10,
    qrbox: { width: 220, height: 220 }
  };
  
  qrScanner.start(
    { facingMode: 'environment' }, // Back camera preferred on phones
    config,
    (decodedText) => {
      console.log('QR Code scanned successfully:', decodedText);
      onSuccess(decodedText);
      stopQRScanner();
      
      // Close the modal
      const modal = document.getElementById('scanner-modal');
      if (modal) modal.classList.add('hidden');
    },
    (errorMessage) => {
      // Quiet errors on frame analysis failures
    }
  ).then(() => {
    if (statusText) statusText.textContent = 'Align QR code within the frame.';
  }).catch((err) => {
    console.error('Camera initialization error:', err);
    if (statusText) statusText.textContent = 'Camera access denied or unavailable.';
  });
}

/**
 * Stops the camera and clears the QR scanner
 */
export async function stopQRScanner() {
  if (qrScanner) {
    try {
      if (qrScanner.isScanning) {
        await qrScanner.stop();
      }
    } catch (e) {
      console.error('Failed to stop camera stream:', e);
    } finally {
      qrScanner = null;
      const statusText = document.getElementById('scanner-status-text');
      if (statusText) statusText.textContent = 'Scanner idle.';
    }
  }
}
