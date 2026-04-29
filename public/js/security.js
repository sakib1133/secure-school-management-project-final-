// Security-aware frontend utilities
class SecurityManager {
    constructor() {
        this.sessionWarningThreshold = 5 * 60 * 1000; // 5 minutes in milliseconds
        this.sessionCheckInterval = 30 * 1000; // Check every 30 seconds
        this.warningShown = false;
        this.sessionTimer = null;
        this.warningTimer = null;
        
        this.init();
    }

    init() {
        this.startSessionMonitoring();
        this.addSecurityHeaders();
        this.validatePageSecurity();
        this.setupCSRFProtection();
    }

    // Session expiry warning system
    startSessionMonitoring() {
        // Only start monitoring if user is logged in
        const token = localStorage.getItem('token');
        if (!token) return;

        // Parse JWT to get expiry time
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const expiryTime = payload.exp * 1000; // Convert to milliseconds
            const currentTime = Date.now();
            const timeUntilExpiry = expiryTime - currentTime;

            if (timeUntilExpiry > 0) {
                // Set timer for warning (5 minutes before expiry)
                const warningTime = Math.max(0, timeUntilExpiry - this.sessionWarningThreshold);
                
                this.warningTimer = setTimeout(() => {
                    this.showSessionWarning(Math.floor((expiryTime - Date.now()) / 1000 / 60));
                }, warningTime);

                // Set timer for automatic logout
                this.sessionTimer = setTimeout(() => {
                    this.handleSessionExpiry();
                }, timeUntilExpiry);
            } else {
                // Token already expired
                this.handleSessionExpiry();
            }
        } catch (error) {
            console.error('Error parsing JWT token:', error);
        }
    }

    showSessionWarning(minutesLeft) {
        const warningElement = document.getElementById('sessionWarning');
        const timeElement = document.getElementById('warningTime');
        
        if (warningElement && timeElement) {
            timeElement.textContent = minutesLeft;
            warningElement.classList.add('show');
            this.warningShown = true;

            // Update countdown every minute
            const countdownInterval = setInterval(() => {
                minutesLeft--;
                if (minutesLeft <= 0) {
                    clearInterval(countdownInterval);
                    this.handleSessionExpiry();
                } else {
                    timeElement.textContent = minutesLeft;
                }
            }, 60000);

            // Auto-hide warning after 10 seconds if user doesn't interact
            setTimeout(() => {
                if (warningElement.classList.contains('show')) {
                    warningElement.classList.remove('show');
                }
            }, 10000);
        }
    }

    handleSessionExpiry() {
        // Clear all timers
        if (this.sessionTimer) clearTimeout(this.sessionTimer);
        if (this.warningTimer) clearTimeout(this.warningTimer);

        // Clear stored data
        localStorage.removeItem('token');
        localStorage.removeItem('userRole');
        localStorage.removeItem('username');

        // Show expiry message (professional toast, no browser popup)
        this.showSecurityAlert('Your session has expired. Please log in again.', 'warning');

        // Redirect to login after a short delay so user can see the message
        setTimeout(() => {
            window.location.href = '/login.html';
        }, 1200);
    }

    // Add security headers to requests
    addSecurityHeaders() {
        // Override fetch to add security headers
        const originalFetch = window.fetch;
        window.fetch = function(url, options = {}) {
            options.headers = options.headers || {};
            
            // Add app signature headers for cloning protection
            options.headers['X-App-Signature'] = 'SchoolMgmt-Auth-Token';
            options.headers['X-App-Version'] = '1.0.0';
            options.headers['X-App-Build'] = 'prod-2025-001';
            
            // Add session ID if available
            const sessionId = localStorage.getItem('sessionId');
            if (sessionId) {
                options.headers['X-Session-Id'] = sessionId;
            }

            // Add authorization token
            const token = localStorage.getItem('token');
            if (token) {
                options.headers['Authorization'] = `Bearer ${token}`;
            }

            return originalFetch(url, options);
        };
    }

    // Validate page security indicators
    validatePageSecurity() {
        // Check if page is served over HTTPS
        if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
            this.showSecurityAlert('Warning: This page is not served over HTTPS. Your data may not be secure.');
        }

        // Validate domain
        const allowedDomains = ['localhost', '127.0.0.1'];
        const currentDomain = location.hostname;
        
        if (!allowedDomains.includes(currentDomain) && !currentDomain.endsWith('.school.edu')) {
            this.showSecurityAlert('Warning: You may be on a phishing site. Verify the URL before entering credentials.');
        }

        // Check for mixed content
        if (location.protocol === 'https:' && document.querySelectorAll('script[src^="http:"], link[href^="http:"]').length > 0) {
            this.showSecurityAlert('Warning: This page contains insecure content.');
        }
    }

    // Setup CSRF protection
    setupCSRFProtection() {
        // Generate and store CSRF token
        if (!localStorage.getItem('csrfToken')) {
            const csrfToken = this.generateSecureToken();
            localStorage.setItem('csrfToken', csrfToken);
        }

        // Add CSRF token to all forms
        document.addEventListener('DOMContentLoaded', () => {
            const forms = document.querySelectorAll('form');
            forms.forEach(form => {
                const csrfInput = document.createElement('input');
                csrfInput.type = 'hidden';
                csrfInput.name = 'csrfToken';
                csrfInput.value = localStorage.getItem('csrfToken');
                form.appendChild(csrfInput);
            });
        });
    }

    // Generate secure random token
    generateSecureToken() {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    // Show security alerts
    showSecurityAlert(message, type = 'warning') {
        // Treat message as plain text (prevents XSS)
        const safeMessage = (typeof message === 'string') ? message : String(message);
        const safeType = (typeof type === 'string') ? type : 'warning';

        // Create container once
        let container = document.getElementById('app-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'app-toast-container';
            container.setAttribute('aria-live', 'polite');
            container.setAttribute('aria-relevant', 'additions');
            document.body.appendChild(container);
        }

        // Add styles once
        if (!document.getElementById('app-toast-styles')) {
            const styles = document.createElement('style');
            styles.id = 'app-toast-styles';
            styles.textContent = `
                #app-toast-container {
                    position: fixed;
                    top: 18px;
                    right: 18px;
                    z-index: 10000;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    width: 360px;
                    max-width: calc(100vw - 36px);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
                }
                .app-toast {
                    background: #0b1220;
                    border: 1px solid rgba(255,255,255,0.10);
                    border-left: 4px solid #3b82f6;
                    color: #e5e7eb;
                    border-radius: 14px;
                    box-shadow: 0 14px 40px rgba(0,0,0,0.35);
                    overflow: hidden;
                    transform: translateX(12px);
                    opacity: 0;
                    animation: appToastIn 180ms ease-out forwards;
                }
                @keyframes appToastIn {
                    to { transform: translateX(0); opacity: 1; }
                }
                .app-toast-inner {
                    padding: 12px 12px 12px 14px;
                    display: grid;
                    grid-template-columns: 18px 1fr 28px;
                    gap: 10px;
                    align-items: start;
                }
                .app-toast-title {
                    font-size: 13px;
                    font-weight: 700;
                    margin: 0 0 3px 0;
                    color: #f9fafb;
                }
                .app-toast-message {
                    font-size: 13px;
                    line-height: 1.4;
                    margin: 0;
                    color: #cbd5e1;
                }
                .app-toast-close {
                    width: 28px;
                    height: 28px;
                    border-radius: 10px;
                    border: 0;
                    cursor: pointer;
                    background: rgba(255,255,255,0.06);
                    color: #e5e7eb;
                    font-size: 16px;
                    line-height: 1;
                }
                .app-toast-close:hover { background: rgba(255,255,255,0.10); }
                .app-toast-icon {
                    width: 18px;
                    height: 18px;
                    margin-top: 2px;
                    opacity: 0.95;
                }
                /* Types */
                .app-toast-info { border-left-color: #3b82f6; }
                .app-toast-warning { border-left-color: #f59e0b; }
                .app-toast-success { border-left-color: #22c55e; }
                .app-toast-error { border-left-color: #ef4444; }
            `;
            document.head.appendChild(styles);
        }

        // De-duplicate: if same message+type is already visible, do nothing
        const existingToasts = container.querySelectorAll('.app-toast');
        for (const t of existingToasts) {
            if (t.getAttribute('data-toast-message') === safeMessage && t.getAttribute('data-toast-type') === safeType) {
                return;
            }
        }

        // Build toast safely (no innerHTML for message)
        const toast = document.createElement('div');
        toast.className = `app-toast app-toast-${safeType}`;
        toast.setAttribute('role', 'status');
        toast.setAttribute('data-toast-message', safeMessage);
        toast.setAttribute('data-toast-type', safeType);

        const inner = document.createElement('div');
        inner.className = 'app-toast-inner';

        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('fill', 'none');
        icon.setAttribute('class', 'app-toast-icon');
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 6.2a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm-1.2 4.2h2.4v6h-2.4v-6Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

        const iconColor = ({
            info: '#60a5fa',
            warning: '#fbbf24',
            success: '#34d399',
            error: '#fb7185'
        }[safeType] || '#60a5fa');
        icon.style.color = iconColor;

        const content = document.createElement('div');

        const title = document.createElement('div');
        title.className = 'app-toast-title';
        title.textContent = ({
            info: 'Information',
            warning: 'Warning',
            success: 'Success',
            error: 'Error'
        }[safeType] || 'Information');

        const msg = document.createElement('p');
        msg.className = 'app-toast-message';
        msg.textContent = safeMessage;

        content.appendChild(title);
        content.appendChild(msg);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'app-toast-close';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => toast.remove());

        inner.appendChild(icon);
        inner.appendChild(content);
        inner.appendChild(closeBtn);
        toast.appendChild(inner);
        container.appendChild(toast);

        // Auto-dismiss (different durations by type)
        const durationMs = ({
            success: 2200,
            info: 2400,
            warning: 4200,
            error: 5200
        }[safeType] || 3000);

        setTimeout(() => {
            if (toast && toast.parentElement) toast.remove();
        }, durationMs);
    }

    // Refresh session token
    async refreshSession() {
        try {
            const response = await fetch('/api/refresh-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('token', data.token);
                
                // Restart session monitoring with new token
                if (this.sessionTimer) clearTimeout(this.sessionTimer);
                if (this.warningTimer) clearTimeout(this.warningTimer);
                this.startSessionMonitoring();
                
                this.showSecurityAlert('Session refreshed successfully', 'info');
                return true;
            } else {
                throw new Error('Failed to refresh session');
            }
        } catch (error) {
            console.error('Session refresh failed:', error);
            this.handleSessionExpiry();
            return false;
        }
    }

    // Check if user is authenticated
    isAuthenticated() {
        const token = localStorage.getItem('token');
        if (!token) return false;

        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const expiryTime = payload.exp * 1000;
            return Date.now() < expiryTime;
        } catch (error) {
            return false;
        }
    }

    // Get user role from token
    getUserRole() {
        const token = localStorage.getItem('token');
        if (!token) return null;

        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            return payload.role;
        } catch (error) {
            return null;
        }
    }

    // Logout user
    logout() {
        // Clear timers
        if (this.sessionTimer) clearTimeout(this.sessionTimer);
        if (this.warningTimer) clearTimeout(this.warningTimer);

        // Clear storage
        localStorage.removeItem('token');
        localStorage.removeItem('userRole');
        localStorage.removeItem('username');
        localStorage.removeItem('sessionId');

        // Redirect to login
        window.location.href = '/login.html';
    }

    // Initialize security for dashboard pages
    initDashboardSecurity() {
        // Check authentication
        if (!this.isAuthenticated()) {
            this.logout();
            return;
        }

        // Add logout button functionality
        const logoutButtons = document.querySelectorAll('[data-logout]');
        logoutButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                // Prefer professional modal if available (no browser confirm popup)
                if (window.showLogoutConfirm) {
                    window.showLogoutConfirm({
                        title: 'Confirm Logout',
                        message: 'Do you want to logout from your account?',
                        confirmText: 'Logout',
                        cancelText: 'Cancel',
                        onConfirm: () => this.logout()
                    });
                    return;
                }

                // Fallback (should rarely be needed)
                this.logout();
            });
        });

        // Add session refresh button functionality
        const refreshButtons = document.querySelectorAll('[data-refresh-session]');
        refreshButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                this.refreshSession();
            });
        });

        // Show session info
        this.displaySessionInfo();
    }

    // Display session information
    displaySessionInfo() {
        const sessionInfoElement = document.getElementById('sessionInfo');
        if (!sessionInfoElement) return;

        const token = localStorage.getItem('token');
        if (!token) return;

        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const expiryTime = new Date(payload.exp * 1000);
            const timeLeft = Math.max(0, Math.floor((expiryTime - Date.now()) / 1000 / 60));

            sessionInfoElement.innerHTML = `
                <div class="session-info">
                    <span class="session-user">👤 ${payload.username} (${payload.role})</span>
                    <span class="session-time">⏱️ ${timeLeft}min left</span>
                </div>
            `;
        } catch (error) {
            console.error('Error displaying session info:', error);
        }
    }
}

// Initialize security manager
const securityManager = new SecurityManager();

// Export for use in other scripts
window.SecurityManager = SecurityManager;
window.securityManager = securityManager;
