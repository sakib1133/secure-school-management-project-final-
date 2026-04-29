/**
 * Simple Help Guide Chatbot for Student Dashboard
 * Provides directions only - no navigation, no data fetching
 */

class StudentHelpGuide {
    constructor() {
        this.isOpen = false;
        this.messages = [];
        
        // Check if user is authenticated (student only)
        if (!this.checkAuthentication()) {
            return; // Don't initialize if not logged in
        }
        
        // Help guide responses - directions only
        this.guideResponses = {
            'profile': 'Go to Dashboard → Profile',
            'attendance': 'Go to Dashboard → Attendance section',
            'results': 'Go to Dashboard → Results',
            'marks': 'Go to Dashboard → Results',
            'grades': 'Go to Dashboard → Results',
            'timetable': 'Go to Dashboard → Timetable',
            'schedule': 'Go to Dashboard → Timetable',
            'fees': 'Go to Dashboard → Fees section',
            'assignments': 'Go to Dashboard → Assignments',
            'homework': 'Go to Dashboard → Assignments',
            'forgot password': 'On the login page, click Forgot Password and follow instructions',
            'reset password': 'On the login page, click Forgot Password and follow instructions',
            'change password': 'Go to Dashboard → Profile → Change Password',
            'password': 'Go to Dashboard → Profile → Change Password',
            'notices': 'Go to Dashboard → Notices',
            'announcements': 'Go to Dashboard → Notices',
            'dashboard': 'You are already on the Dashboard',
            'home': 'You are already on the Dashboard'
        };
        
        this.init();
    }
    
    /**
     * Check if user is authenticated (student)
     */
    checkAuthentication() {
        const token = localStorage.getItem('token');
        if (!token) return false;
        
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            return payload.role === 'student';
        } catch (e) {
            return false;
        }
    }
    
    /**
     * Initialize chatbot
     */
    init() {
        this.createChatbotHTML();
        this.attachEventListeners();
        this.addWelcomeMessage();
    }
    
    /**
     * Create chatbot HTML
     */
    createChatbotHTML() {
        const chatbotHTML = `
            <div id="student-help-guide-container" class="student-help-guide-container">
                <!-- Floating Button -->
                <button id="student-help-guide-toggle" class="student-help-guide-toggle" aria-label="Open help guide">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                </button>
                
                <!-- Chat Modal -->
                <div id="student-help-guide-modal" class="student-help-guide-modal" style="display: none;">
                    <!-- Header -->
                    <div class="student-help-guide-header">
                        <div class="student-help-guide-title">Help Guide</div>
                        <button id="student-help-guide-close" class="student-help-guide-close" aria-label="Close">×</button>
                    </div>
                    
                    <!-- Messages -->
                    <div id="student-help-guide-messages" class="student-help-guide-messages"></div>
                    
                    <!-- Quick Actions -->
                    <div class="student-help-guide-quick-actions">
                        <button class="help-quick-btn" data-query="profile">Profile</button>
                        <button class="help-quick-btn" data-query="attendance">Attendance</button>
                        <button class="help-quick-btn" data-query="results">Results</button>
                        <button class="help-quick-btn" data-query="timetable">Timetable</button>
                        <button class="help-quick-btn" data-query="fees">Fees</button>
                        <button class="help-quick-btn" data-query="forgot password">Forgot Password</button>
                    </div>
                    
                    <!-- Input -->
                    <div class="student-help-guide-input-area">
                        <input 
                            type="text" 
                            id="student-help-guide-input" 
                            placeholder="Ask for directions..."
                            maxlength="100"
                        >
                        <button id="student-help-guide-send" class="student-help-guide-send-btn" aria-label="Send">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="22" y1="2" x2="11" y2="13"></line>
                                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', chatbotHTML);
    }
    
    /**
     * Attach event listeners
     */
    attachEventListeners() {
        const toggle = document.getElementById('student-help-guide-toggle');
        const close = document.getElementById('student-help-guide-close');
        const input = document.getElementById('student-help-guide-input');
        const send = document.getElementById('student-help-guide-send');
        const quickBtns = document.querySelectorAll('.help-quick-btn');
        
        if (toggle) {
            toggle.addEventListener('click', () => this.toggleChat());
        }
        
        if (close) {
            close.addEventListener('click', () => this.closeChat());
        }
        
        if (send) {
            send.addEventListener('click', () => this.handleSend());
        }
        
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.handleSend();
                }
            });
        }
        
        quickBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const query = e.target.getAttribute('data-query');
                if (query) {
                    this.processMessage(query);
                }
            });
        });
    }
    
    /**
     * Toggle chat
     */
    toggleChat() {
        const modal = document.getElementById('student-help-guide-modal');
        if (!modal) return;
        
        this.isOpen = !this.isOpen;
        modal.style.display = this.isOpen ? 'flex' : 'none';
        
        if (this.isOpen) {
            setTimeout(() => {
                const input = document.getElementById('student-help-guide-input');
                if (input) input.focus();
            }, 100);
        }
    }
    
    /**
     * Close chat
     */
    closeChat() {
        const modal = document.getElementById('student-help-guide-modal');
        if (modal) {
            modal.style.display = 'none';
            this.isOpen = false;
        }
    }
    
    /**
     * Add welcome message
     */
    addWelcomeMessage() {
        this.addMessage('bot', 'Hi\nI can guide you to different sections.\nType: profile, attendance, results, timetable, fees, or forgot password.');
    }
    
    /**
     * Handle send
     */
    handleSend() {
        const input = document.getElementById('student-help-guide-input');
        if (!input) return;
        
        const message = input.value.trim();
        if (message) {
            this.processMessage(message);
            input.value = '';
        }
    }
    
    /**
     * Process user message and provide directions
     */
    processMessage(message) {
        // Add user message
        this.addMessage('user', message);
        
        // Detect intent (simple keyword matching)
        const normalized = message.toLowerCase().trim();
        let response = null;
        
        // Check for exact matches first
        for (const [key, guideResponse] of Object.entries(this.guideResponses)) {
            if (normalized === key || normalized.includes(key)) {
                response = guideResponse;
                break;
            }
        }
        
        // If no exact match, check for partial matches
        if (!response) {
            for (const [key, guideResponse] of Object.entries(this.guideResponses)) {
                const keyWords = key.split(' ');
                const messageWords = normalized.split(' ');
                
                // Check if any key word appears in message
                for (const keyWord of keyWords) {
                    if (messageWords.some(msgWord => msgWord.includes(keyWord) || keyWord.includes(msgWord))) {
                        response = guideResponse;
                        break;
                    }
                }
                if (response) break;
            }
        }
        
        // Handle recognized command
        if (response) {
            this.addMessage('bot', response);
        } else {
            // Unknown command - show available options
            this.addMessage('bot', 'I can guide you to Profile, Attendance, Results, Timetable, Fees.');
        }
    }
    
    /**
     * Add message to chat
     */
    addMessage(sender, text) {
        const messagesContainer = document.getElementById('student-help-guide-messages');
        if (!messagesContainer) return;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `student-help-guide-message ${sender}-message`;
        
        const timestamp = new Date().toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        // Format text (preserve line breaks)
        const formattedText = text.replace(/\n/g, '<br>');
        
        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="message-text">${formattedText}</div>
                <div class="message-time">${timestamp}</div>
            </div>
        `;
        
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Store message
        this.messages.push({ sender, text, timestamp });
    }
}

// Initialize when DOM is ready (only on student dashboard)
document.addEventListener('DOMContentLoaded', function() {
    // Only initialize on student dashboard
    if (window.location.pathname.includes('student_dashboard')) {
        window.studentHelpGuide = new StudentHelpGuide();
    }
});

