/**
 * Professional Logout Confirmation Modal (no browser confirm popup)
 * Usage:
 *   window.showLogoutConfirm({
 *     title: 'Confirm Logout',
 *     message: 'Do you want to logout from your account?',
 *     confirmText: 'Logout',
 *     cancelText: 'Cancel',
 *     onConfirm: () => { ... },
 *     onCancel: () => { ... }
 *   })
 *
 * Notes:
 * - Beginner-friendly, no external libraries
 * - Safe: Does not execute arbitrary HTML from inputs
 */
(function () {
  // Prevent double-registration
  if (window.showLogoutConfirm) return;

  function ensureStyles() {
    if (document.getElementById('logout-modal-styles')) return;

    const style = document.createElement('style');
    style.id = 'logout-modal-styles';
    style.textContent = `
      .logout-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 20000;
        padding: 16px;
      }
      .logout-modal {
        width: 100%;
        max-width: 420px;
        background: #ffffff;
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.35);
        overflow: hidden;
        transform: translateY(8px);
        opacity: 0;
        animation: logoutModalIn 180ms ease-out forwards;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      }
      @keyframes logoutModalIn {
        to { transform: translateY(0); opacity: 1; }
      }
      .logout-modal-header {
        padding: 16px 18px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid #eef2f7;
        background: linear-gradient(135deg, #111827, #0f172a);
        color: #fff;
      }
      .logout-modal-title {
        font-size: 16px;
        font-weight: 700;
        margin: 0;
      }
      .logout-modal-close {
        border: 0;
        background: rgba(255,255,255,0.1);
        color: #fff;
        width: 34px;
        height: 34px;
        border-radius: 10px;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
      }
      .logout-modal-close:hover { background: rgba(255,255,255,0.18); }
      .logout-modal-body {
        padding: 18px;
        color: #111827;
        background: #fff;
      }
      .logout-modal-message {
        margin: 0;
        color: #374151;
        line-height: 1.5;
        font-size: 14px;
      }
      .logout-modal-footer {
        padding: 14px 18px 18px;
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        background: #fff;
      }
      .logout-btn-cancel {
        border: 1px solid #d1d5db;
        background: #fff;
        color: #111827;
        border-radius: 12px;
        padding: 10px 14px;
        cursor: pointer;
        font-weight: 600;
      }
      .logout-btn-cancel:hover { background: #f9fafb; }
      .logout-btn-confirm {
        border: 0;
        background: linear-gradient(135deg, #ef4444, #dc2626);
        color: #fff;
        border-radius: 12px;
        padding: 10px 14px;
        cursor: pointer;
        font-weight: 700;
      }
      .logout-btn-confirm:hover { filter: brightness(1.05); }
    `;
    document.head.appendChild(style);
  }

  function removeExisting() {
    const existing = document.getElementById('logout-modal-overlay');
    if (existing) existing.remove();
  }

  window.showLogoutConfirm = function showLogoutConfirm(options) {
    ensureStyles();
    removeExisting();

    const {
      title = 'Confirm Logout',
      message = 'Do you want to logout from your account?',
      confirmText = 'Logout',
      cancelText = 'Cancel',
      onConfirm = () => {},
      onCancel = () => {}
    } = options || {};

    const overlay = document.createElement('div');
    overlay.id = 'logout-modal-overlay';
    overlay.className = 'logout-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const modal = document.createElement('div');
    modal.className = 'logout-modal';

    const header = document.createElement('div');
    header.className = 'logout-modal-header';

    const h3 = document.createElement('h3');
    h3.className = 'logout-modal-title';
    h3.textContent = title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'logout-modal-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';

    header.appendChild(h3);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'logout-modal-body';

    const p = document.createElement('p');
    p.className = 'logout-modal-message';
    p.textContent = message;

    body.appendChild(p);

    const footer = document.createElement('div');
    footer.className = 'logout-modal-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'logout-btn-cancel';
    cancelBtn.type = 'button';
    cancelBtn.textContent = cancelText;

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'logout-btn-confirm';
    confirmBtn.type = 'button';
    confirmBtn.textContent = confirmText;

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function close(reason) {
      overlay.remove();
      if (reason === 'confirm') onConfirm();
      if (reason === 'cancel') onCancel();
    }

    // Click outside closes (cancel)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close('cancel');
    });

    closeBtn.addEventListener('click', () => close('cancel'));
    cancelBtn.addEventListener('click', () => close('cancel'));
    confirmBtn.addEventListener('click', () => close('confirm'));

    // ESC closes
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        if (document.getElementById('logout-modal-overlay')) close('cancel');
      }
    });

    // Focus confirm for keyboard users
    setTimeout(() => confirmBtn.focus(), 0);
  };
})();


