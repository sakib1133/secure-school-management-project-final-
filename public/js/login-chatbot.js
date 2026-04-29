/**
 * Advanced AI-Powered Chatbot for School Management System Login Page
 * Features: NLP, sentiment analysis, multi-language, smart suggestions, contextual learning
 */

class LoginChatbot {
    constructor() {
        this.isOpen = false;
        this.messageHistory = [];
        this.requestCount = 0;
        this.lastRequestTime = 0;
        this.rateLimitWindow = 60000; // 1 minute
        this.maxRequestsPerWindow = 10;
        
        // Enhanced context tracking
        this.conversationContext = {
            lastTopic: null,
            lastIntent: null,
            topicCount: {},
            inGuidedFlow: false,
            guidedFlowData: null,
            userRole: null,
            awaitingRoleConfirmation: false,
            lastAnswer: null,
            answerVariations: {},
            sentiment: 'neutral', // Track conversation sentiment
            language: 'en', // Track detected language
            userPreferences: {}, // Store user preferences
            sessionStart: Date.now(),
            interactionCount: 0
        };
        
        // AI Features
        this.aiFeatures = {
            nlpEnabled: true,
            sentimentAnalysis: true,
            multiLanguage: true,
            smartSuggestions: true,
            contextualLearning: true,
            personalityAdaptation: true
        };
        
        // Language support - English and Hindi only
        this.languages = {
            'en': {
                name: 'English',
                greetings: ['hello', 'hi', 'hey', 'greetings'],
                thanks: ['thank you', 'thanks', 'thx'],
                goodbye: ['bye', 'goodbye', 'see you'],
                help: ['help', 'assist', 'support']
            },
            'hi': {
                name: 'हिंदी',
                greetings: ['नमस्ते', 'हेलो', 'नमस्कार'],
                thanks: ['धन्यवाद', 'शुक्रिया'],
                goodbye: ['अलविदा', 'बाय'],
                help: ['मदद', 'सहायता']
            }
        };
        
        // Personality profiles
        this.personalities = {
            'professional': {
                tone: 'formal',
                emojiUsage: 'minimal',
                responseStyle: 'concise',
                greeting: 'Hello! How may I assist you today?'
            },
            'friendly': {
                tone: 'casual',
                emojiUsage: 'moderate',
                responseStyle: 'detailed',
                greeting: "Hey there! 👋 I'm here to help you with login-related questions!"
            },
            'technical': {
                tone: 'technical',
                emojiUsage: 'minimal',
                responseStyle: 'detailed',
                greeting: 'Greetings. I can provide technical assistance for login procedures.'
            }
        };
        
        this.currentPersonality = 'friendly';
        this.welcomeShown = false;
        
        // Enhanced Intent Groups with AI features
        this.intentGroups = {
            'forgot_password': {
                intent: 'forgot_password',
                keywords: ['forgot', 'forgot password', 'forgot pass', 'reset password', 'reset', 'recover password', 'lost password', 'can\'t login', 'password help', 'password issue', 'login problem', 'account locked'],
                answer: "To reset your password, please contact your system administrator. They can help you recover your account. For security reasons, password resets must be done through authorized personnel.",
                shortAnswer: "Contact your administrator for password reset assistance.",
                followUp: "Are you a student, teacher, or administrator? I can provide more specific guidance.",
                guidedFlow: true,
                priority: 'high',
                category: 'account'
            },
            'login_help': {
                intent: 'login_help',
                keywords: ['how to login', 'login help', 'login instructions', 'how do i login', 'login guide', 'login', 'how login', 'sign in help', 'access account', 'login process'],
                answer: "To login: 1) Select your role (Student, Teacher, or Admin), 2) Enter your username, 3) Enter your password, 4) Click the Login button. Make sure you have valid credentials from your administrator.",
                shortAnswer: "Select your role, enter username and password, then click Login.",
                roleBasedAnswer: {
                    student: "To login as a student: 1) Select 'Student' role, 2) Enter your student username and password, 3) Click Login. Your credentials are provided by your school.",
                    teacher: "To login as a teacher: 1) Select 'Teacher' role, 2) Enter your teacher username and password, 3) Click Login. Contact administration if you need credentials.",
                    admin: "To login as an administrator: 1) Select 'Admin' role, 2) Enter your admin username and password, 3) Click Login. Admin access requires special authorization."
                },
                repeatedAnswer: {
                    student: "You're logging in as a Student. Want me to repeat the steps or help with password recovery?",
                    teacher: "You're logging in as a Teacher. Need the steps again or help with something else?",
                    admin: "You're logging in as an Admin. Should I repeat the login steps or assist with something else?"
                },
                followUp: null,
                askRoleFirst: true,
                priority: 'high',
                category: 'login'
            },
            'login_student': {
                intent: 'login_student',
                keywords: ['login as student', 'student login', 'student access', 'how to login as student', 'student', 'i am student', 'i\'m a student'],
                answer: "To login as a student: 1) Select 'Student' role, 2) Enter your student username and password provided by your school, 3) Click Login.",
                shortAnswer: "Select 'Student' role and enter your credentials.",
                followUp: null,
                confirmsRole: 'student',
                priority: 'medium',
                category: 'login'
            },
            'login_teacher': {
                intent: 'login_teacher',
                keywords: ['login as teacher', 'teacher login', 'teacher access', 'how to login as teacher', 'teacher', 'i am teacher', 'i\'m a teacher'],
                answer: "To login as a teacher: 1) Select 'Teacher' role, 2) Enter your teacher username and password provided by the administration, 3) Click Login.",
                shortAnswer: "Select 'Teacher' role and enter your credentials.",
                followUp: null,
                confirmsRole: 'teacher',
                priority: 'medium',
                category: 'login'
            },
            'login_admin': {
                intent: 'login_admin',
                keywords: ['login as admin', 'admin login', 'administrator login', 'admin access', 'how to login as admin', 'admin', 'administrator', 'i am admin', 'i\'m an admin'],
                answer: "To login as an administrator: 1) Select 'Admin' role, 2) Enter your admin username and password, 3) Click Login. Admin access requires special authorization.",
                shortAnswer: "Select 'Admin' role and enter your admin credentials.",
                followUp: null,
                confirmsRole: 'admin',
                priority: 'medium',
                category: 'login'
            },
            'admission': {
                intent: 'admission',
                keywords: ['admission', 'admission enquiry', 'admission process', 'how to apply', 'enrollment', 'enrolment', 'admission info', 'new admission', 'join school'],
                answer: "For admission enquiries, please contact the school administration office during working hours (Monday-Friday, 9:00 AM - 5:00 PM). You can also visit the school's main office or call the admission helpline.",
                shortAnswer: "Contact the school office during working hours for admission information.",
                followUp: null,
                priority: 'low',
                category: 'general'
            },
            'contact_admin': {
                intent: 'contact_admin',
                keywords: ['contact admin', 'contact administrator', 'admin contact', 'reach admin', 'admin help', 'contact', 'support', 'help desk'],
                answer: "To contact the administrator, please visit the school's main office during working hours or send an email to the administration. For urgent matters, you can call the school's main contact number.",
                shortAnswer: "Visit the school office or email the administration during working hours.",
                followUp: null,
                priority: 'low',
                category: 'general'
            },
            'working_hours': {
                intent: 'working_hours',
                keywords: ['working hours', 'office hours', 'system hours', 'when is it open', 'availability', 'hours', 'timing', 'schedule'],
                answer: "The school management system is available 24/7 for online access. However, administrative support and office services are available Monday through Friday, 9:00 AM to 5:00 PM.",
                shortAnswer: "System: 24/7 online. Office support: Monday-Friday, 9 AM - 5 PM.",
                followUp: null,
                priority: 'low',
                category: 'general'
            },
            'security': {
                intent: 'security',
                keywords: ['security', 'secure', 'safe', 'encryption', 'https', 'privacy', 'data protection', 'password protection', 'session safety', 'brute force', 'protection', 'cybersecurity'],
                answer: "This login page is highly secure! 🔒 We use HTTPS encryption to protect all data in transit. Your password is encrypted and never stored in plain text. We have brute-force protection that blocks suspicious login attempts. Sessions automatically expire for security. Your data privacy is our top priority - we follow industry-standard security practices.",
                shortAnswer: "The system uses HTTPS encryption, password hashing, brute-force protection, and secure sessions.",
                followUp: "Would you like to know more about any specific security feature?",
                securityDetails: {
                    'https': "HTTPS (SSL/TLS) encrypts all communication between your browser and our server, ensuring no one can intercept your login credentials.",
                    'password': "Your password is hashed using industry-standard bcrypt encryption. Even administrators cannot see your actual password.",
                    'session': "Sessions automatically expire after inactivity. Admin sessions: 1 hour, Teacher: 45 min, Student: 30 min.",
                    'brute force': "Our system automatically blocks IP addresses after 3 failed login attempts for 10 minutes to prevent brute-force attacks.",
                    'privacy': "All personal data is encrypted at rest in our database. We follow strict data privacy regulations."
                },
                priority: 'medium',
                category: 'security'
            },
            'password_protection': {
                intent: 'password_protection',
                keywords: ['password protection', 'password security', 'password safe', 'is my password safe', 'password encryption'],
                answer: "Your password is protected with multiple layers of security: 1) It's hashed using bcrypt (industry-standard encryption), 2) Never stored in plain text, 3) Protected by HTTPS during transmission, 4) Brute-force protection prevents unauthorized access attempts.",
                shortAnswer: "Your password is encrypted and protected with multiple security layers.",
                followUp: null,
                priority: 'medium',
                category: 'security'
            },
            'session_safety': {
                intent: 'session_safety',
                keywords: ['session safety', 'session security', 'auto logout', 'session timeout', 'session management'],
                answer: "Sessions are automatically secured: 1) Auto-expire after inactivity (Admin: 1 hour, Teacher: 45 min, Student: 30 min), 2) Warning shown 5 minutes before expiry, 3) Secure token-based authentication, 4) Automatic logout on suspicious activity.",
                shortAnswer: "Sessions auto-expire for security. You'll get a warning before expiry.",
                followUp: null,
                priority: 'medium',
                category: 'security'
            },
            'data_privacy': {
                intent: 'data_privacy',
                keywords: ['data privacy', 'privacy', 'data protection', 'my data safe', 'personal information', 'gdpr'],
                answer: "Your data privacy is guaranteed: 1) All personal information is encrypted at rest, 2) Access is role-based and logged, 3) We follow strict data protection regulations, 4) No data is shared with third parties, 5) You can request your data at any time.",
                shortAnswer: "All your data is encrypted and protected. We follow strict privacy regulations.",
                followUp: null,
                priority: 'medium',
                category: 'security'
            },
            'help': {
                intent: 'help',
                keywords: ['help', 'assistance', 'support', 'what can you do', 'options', 'menu', 'capabilities', 'features'],
                answer: "I can help you with: Forgot password, Login instructions, Admission enquiries, Contacting administrators, System working hours, and Security information. I also support multiple languages and can adapt to your preferences! What would you like to know?",
                shortAnswer: "I can help with login, password recovery, admission, contact info, hours, and security.",
                followUp: null,
                priority: 'low',
                category: 'general'
            },
            'greeting': {
                intent: 'greeting',
                keywords: ['hello', 'hi', 'hey', 'greetings', 'good morning', 'good afternoon', 'good evening', 'नमस्ते', 'नमस्कार'],
                answer: "Hello! I'm your AI-powered login assistant. I can help you in multiple languages and adapt to your preferences. How can I assist you today?",
                shortAnswer: "Hi! What can I help you with?",
                followUp: null,
                priority: 'low',
                category: 'social'
            },
            'thanks': {
                intent: 'thanks',
                keywords: ['thank you', 'thanks', 'thx', 'धन्यवाद', 'शुक्रिया', 'appreciate'],
                answer: "You're welcome! I'm here to help. Is there anything else you'd like to know about logging in or the school system?",
                shortAnswer: "You're welcome! Anything else I can help with?",
                followUp: null,
                priority: 'low',
                category: 'social'
            },
            'back': {
                intent: 'back',
                keywords: ['back', 'menu', 'main menu', 'start over', 'reset', 'clear', 'forget', 'restart'],
                answer: "Sure! I've reset our conversation. How can I help you?",
                shortAnswer: "How can I help?",
                followUp: null,
                resetsContext: true,
                priority: 'low',
                category: 'navigation'
            },
            'technical_issue': {
                intent: 'technical_issue',
                keywords: ['error', 'problem', 'issue', 'bug', 'not working', 'broken', 'technical', 'system down'],
                answer: "I'm sorry you're experiencing technical issues. Try these steps: 1) Refresh the page, 2) Clear browser cache, 3) Check internet connection, 4) Try a different browser. If issues persist, contact technical support.",
                shortAnswer: "Try refreshing the page or contact technical support if issues persist.",
                followUp: "What specific error are you seeing?",
                priority: 'high',
                category: 'technical'
            },
            'browser_compatibility': {
                intent: 'browser_compatibility',
                keywords: ['browser', 'chrome', 'firefox', 'safari', 'edge', 'compatible', 'supported'],
                answer: "This login system works best with modern browsers: Chrome (version 90+), Firefox (version 88+), Safari (version 14+), or Edge (version 90+). Make sure JavaScript is enabled and cookies are allowed.",
                shortAnswer: "Use Chrome, Firefox, Safari, or Edge with JavaScript enabled.",
                followUp: null,
                priority: 'medium',
                category: 'technical'
            }
        };
        
        // Enhanced suggestions with AI
        this.suggestions = {
            'forgot_password': ['Forgot password', 'Login help', 'Contact admin', 'Password not working'],
            'login_help': ['How to login', 'Login as student', 'Login as teacher', 'Can\'t access account'],
            'admission': ['Admission enquiry', 'Contact admin', 'Working hours', 'Application process'],
            'security': ['Page security', 'Password protection', 'Data privacy', 'Is it safe?'],
            'technical_issue': ['Page not loading', 'Login button not working', 'Error messages', 'Browser issues'],
            'default': ['Forgot password', 'How to login', 'Admission enquiry', 'Contact admin', 'Security information', 'Technical help']
        };
        
        // Smart learning patterns
        this.learningPatterns = {
            commonIssues: {},
            userSatisfaction: {},
            responseEffectiveness: {}
        };
        
        this.init();
    }
    
    /**
     * Initialize the chatbot UI and AI features
     */
    init() {
        this.createChatbotHTML();
        this.attachEventListeners();
        
        // Load learning patterns from previous sessions
        this.loadLearningPatterns();
        
        // Detect user preferences and adapt personality
        this.detectUserPreferences();
        
        // Don't show welcome message immediately - only on first open
    }
    
    /**
     * Detect user preferences and adapt chatbot personality
     */
    detectUserPreferences() {
        // Check time of day for personality adaptation
        const hour = new Date().getHours();
        
        if (hour >= 9 && hour <= 17) {
            // Business hours - more professional
            this.currentPersonality = 'professional';
        } else if (hour >= 18 || hour <= 6) {
            // Evening/night - more friendly
            this.currentPersonality = 'friendly';
        }
        
        // Check if user prefers less animation (reduced motion)
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            // Disable typing animation for accessibility
            this.conversationContext.userPreferences.reducedMotion = true;
        }
        
        // Check user's language preference - English and Hindi only
        const browserLang = navigator.language.toLowerCase();
        if (browserLang.startsWith('hi')) {
            this.conversationContext.language = 'hi';
        } else {
            // Default to English for all other languages
            this.conversationContext.language = 'en';
        }
    }
    
    /**
     * Create chatbot HTML structure
     */
    createChatbotHTML() {
        const chatbotHTML = `
            <div id="login-chatbot-container" class="login-chatbot-container">
                <!-- Floating Chat Button -->
                <button id="login-chatbot-toggle" class="login-chatbot-toggle" aria-label="Open chat">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                </button>
                
                <!-- Chat Modal -->
                <div id="login-chatbot-modal" class="login-chatbot-modal" style="display: none;">
                    <!-- Modal Header -->
                    <div class="login-chatbot-header">
                        <div class="login-chatbot-title">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                            </svg>
                            <span>Login Help Assistant</span>
                        </div>
                        <button id="login-chatbot-close" class="login-chatbot-close" aria-label="Close chat">×</button>
                    </div>
                    
                    <!-- Messages Container -->
                    <div id="login-chatbot-messages" class="login-chatbot-messages"></div>
                    
                    <!-- Quick Actions -->
                    <div class="login-chatbot-quick-actions">
                        <button class="quick-action-btn" data-query="forgot password">Forgot Password</button>
                        <button class="quick-action-btn" data-query="how to login">Login Help</button>
                        <button class="quick-action-btn" data-query="admission enquiry">Admission</button>
                        <button class="quick-action-btn" data-query="security">Security Info</button>
                    </div>
                    
                    <!-- Input Area -->
                    <div class="login-chatbot-input-area">
                        <input 
                            type="text" 
                            id="login-chatbot-input" 
                            placeholder="Ask a question..."
                            maxlength="200"
                            aria-label="Chat input"
                        >
                        <button id="login-chatbot-send" class="login-chatbot-send-btn" aria-label="Send message">
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
        const toggle = document.getElementById('login-chatbot-toggle');
        const close = document.getElementById('login-chatbot-close');
        const input = document.getElementById('login-chatbot-input');
        const send = document.getElementById('login-chatbot-send');
        const quickActions = document.querySelectorAll('.quick-action-btn');
        
        // Toggle chat
        if (toggle) {
            toggle.addEventListener('click', () => this.toggleChat());
        }
        
        // Close chat
        if (close) {
            close.addEventListener('click', () => this.closeChat());
        }
        
        // Send message on button click
        if (send) {
            send.addEventListener('click', () => this.handleSend());
        }
        
        // Send message on Enter key
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.handleSend();
                }
            });
        }
        
        // Quick action buttons
        quickActions.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const query = e.target.getAttribute('data-query');
                if (query) {
                    this.sendMessage(query);
                }
            });
        });
    }
    
    /**
     * Toggle chat modal
     */
    toggleChat() {
        const modal = document.getElementById('login-chatbot-modal');
        if (!modal) return;
        
        this.isOpen = !this.isOpen;
        modal.style.display = this.isOpen ? 'flex' : 'none';
        
        if (this.isOpen) {
            // Show welcome message only once
            if (!this.welcomeShown) {
                this.addWelcomeMessage();
                this.welcomeShown = true;
            }
            
            // Focus input when opening
            setTimeout(() => {
                const input = document.getElementById('login-chatbot-input');
                if (input) input.focus();
            }, 100);
        }
    }
    
    /**
     * Close chat modal
     */
    closeChat() {
        const modal = document.getElementById('login-chatbot-modal');
        if (modal) {
            modal.style.display = 'none';
            this.isOpen = false;
        }
    }
    
    /**
     * Add welcome message (only shown once)
     */
    addWelcomeMessage() {
        const welcomeMsg = "Hello! I'm here to help you with login-related questions. What would you like to know?";
        this.addMessage('bot', welcomeMsg, false);
    }
    
    /**
     * Handle send button click
     */
    handleSend() {
        const input = document.getElementById('login-chatbot-input');
        if (!input) return;
        
        const message = this.sanitizeInput(input.value.trim());
        if (message) {
            // Handle special commands
            if (this.handleSpecialCommands(message)) {
                input.value = '';
                return;
            }
            
            this.sendMessage(message);
            input.value = '';
        }
    }
    
    /**
     * Handle special commands (back, menu, etc.)
     * @param {string} message - User's message
     * @returns {boolean} - True if command was handled
     */
    handleSpecialCommands(message) {
        const normalized = message.toLowerCase().trim();
        
        if (normalized === 'back' || normalized === 'menu' || normalized === 'main menu' || normalized === 'start over' || normalized === 'reset' || normalized === 'clear' || normalized === 'forget') {
            // Reset conversation context
            this.conversationContext.inGuidedFlow = false;
            this.conversationContext.guidedFlowData = null;
            this.conversationContext.userRole = null;
            this.conversationContext.awaitingRoleConfirmation = false;
            this.conversationContext.lastAnswer = null;
            this.addMessage('bot', "Sure! I've reset our conversation. How can I help you?", false);
            return true;
        }
        
        return false;
    }
    
    /**
     * Send message and get response with enhanced AI features
     * @param {string} message - User's message
     */
    async sendMessage(message) {
        // Check rate limiting
        if (!this.checkRateLimit()) {
            this.addMessage('bot', 'Too many requests. Please wait a moment before asking another question.', false);
            return;
        }
        
        // Update interaction count
        this.conversationContext.interactionCount++;
        
        // Add user message to chat
        this.addMessage('user', message, false);
        
        // Detect intent with enhanced NLP
        const intentResult = this.detectIntent(message);
        
        // Show typing indicator with realistic delay
        this.showTypingIndicator();
        
        // Simulate typing delay (longer for better UX)
        const typingDelay = 800 + Math.random() * 400; // 800-1200ms
        
        setTimeout(() => {
            this.hideTypingIndicator();
            
            // Generate enhanced response based on intent and context
            const response = this.generateEnhancedResponse(intentResult, message);
            
            this.addMessage('bot', response.text, false);
            
            // Add follow-up if available
            if (response.followUp) {
                setTimeout(() => {
                    this.addMessage('bot', response.followUp, false);
                }, 500);
            }
            
            // Add suggestions if available
            if (response.suggestions && response.suggestions.length > 0) {
                setTimeout(() => {
                    this.addSuggestions(response.suggestions);
                }, 800);
            }
            
            // Update context
            this.updateContext(intentResult.intent);
            
            // Log query for admin with enhanced data
            this.logQuery(message, response.text, {
                intent: intentResult.intent,
                confidence: intentResult.confidence || 0,
                sentiment: this.conversationContext.sentiment,
                language: this.conversationContext.language,
                personality: this.currentPersonality,
                interactionCount: this.conversationContext.interactionCount
            });
        }, typingDelay);
    }
    
    /**
     * Detect user intent using enhanced NLP techniques
     * @param {string} query - User's query
     * @returns {object} - Intent result with confidence
     */
    detectIntent(query) {
        const normalizedQuery = query.toLowerCase().trim();
        const words = normalizedQuery.split(/\s+/);
        
        // Detect language first
        this.detectLanguage(normalizedQuery);
        
        // Analyze sentiment
        this.analyzeSentiment(normalizedQuery);
        
        let bestMatch = null;
        let bestScore = 0;
        
        // Check each intent group with enhanced scoring
        for (const [key, intentData] of Object.entries(this.intentGroups)) {
            let score = 0;
            
            // Exact keyword matching
            for (const keyword of intentData.keywords) {
                const keywordLower = keyword.toLowerCase();
                
                // Exact match gets highest score
                if (normalizedQuery === keywordLower) {
                    score = 100;
                    break;
                }
                
                // Contains keyword
                if (normalizedQuery.includes(keywordLower)) {
                    score += 50;
                }
                
                // Partial word matching with fuzzy logic
                for (const word of words) {
                    if (this.fuzzyMatch(word, keywordLower)) {
                        score += 25;
                    }
                }
            }
            
            // Contextual scoring based on conversation history
            if (this.conversationContext.lastTopic === intentData.intent) {
                score += 10; // Boost if continuing same topic
            }
            
            // Priority-based scoring
            if (intentData.priority === 'high') {
                score += 15;
            } else if (intentData.priority === 'medium') {
                score += 5;
            }
            
            // Language-specific scoring
            if (this.conversationContext.language !== 'en') {
                // Boost for multi-language support
                score += 10;
            }
            
            if (score > bestScore) {
                bestScore = score;
                bestMatch = {
                    intent: intentData.intent,
                    intentData: intentData,
                    score: score,
                    confidence: this.calculateConfidence(score)
                };
            }
        }
        
        // If no good match found, return unknown
        if (!bestMatch || bestScore < 20) {
            return {
                intent: 'unknown',
                intentData: null,
                score: 0,
                confidence: 0
            };
        }
        
        return bestMatch;
    }
    
    /**
     * Fuzzy string matching for better intent detection
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @returns {boolean} - True if strings are similar
     */
    fuzzyMatch(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1.0;
        
        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length > 0.6;
    }
    
    /**
     * Calculate Levenshtein distance between two strings
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @returns {number} - Edit distance
     */
    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }
    
    /**
     * Calculate confidence score for intent detection
     * @param {number} score - Raw score
     * @returns {number} - Confidence percentage
     */
    calculateConfidence(score) {
        if (score >= 90) return 0.95;
        if (score >= 80) return 0.85;
        if (score >= 70) return 0.75;
        if (score >= 60) return 0.65;
        if (score >= 50) return 0.55;
        if (score >= 40) return 0.45;
        if (score >= 30) return 0.35;
        if (score >= 20) return 0.25;
        return 0.15;
    }
    
    /**
     * Detect language from user input
     * @param {string} text - User input text
     */
    detectLanguage(text) {
        for (const [langCode, langData] of Object.entries(this.languages)) {
            for (const keyword of langData.greetings) {
                if (text.includes(keyword)) {
                    this.conversationContext.language = langCode;
                    return;
                }
            }
        }
        // Default to English if no language detected
        this.conversationContext.language = 'en';
    }
    
    /**
     * Analyze sentiment of user input
     * @param {string} text - User input text
     */
    analyzeSentiment(text) {
        const positiveWords = ['good', 'great', 'excellent', 'helpful', 'thanks', 'thank', 'awesome', 'perfect', 'love', 'amazing', 'wonderful'];
        const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'useless', 'stupid', 'broken', 'wrong', 'error', 'problem', 'issue'];
        
        let positiveScore = 0;
        let negativeScore = 0;
        
        const words = text.toLowerCase().split(/\s+/);
        
        for (const word of words) {
            if (positiveWords.includes(word)) positiveScore++;
            if (negativeWords.includes(word)) negativeScore++;
        }
        
        if (positiveScore > negativeScore) {
            this.conversationContext.sentiment = 'positive';
        } else if (negativeScore > positiveScore) {
            this.conversationContext.sentiment = 'negative';
        } else {
            this.conversationContext.sentiment = 'neutral';
        }
    }
    
    /**
     * Generate smart suggestions based on context and learning
     * @param {string} lastIntent - Last detected intent
     * @returns {array} - Array of smart suggestions
     */
    generateSmartSuggestions(lastIntent) {
        // Base suggestions
        let suggestions = this.suggestions.default;
        
        // Context-aware suggestions
        if (lastIntent && this.suggestions[lastIntent]) {
            suggestions = this.suggestions[lastIntent];
        }
        
        // Learning-based suggestions
        if (this.aiFeatures.contextualLearning && this.conversationContext.interactionCount > 3) {
            // Add personalized suggestions based on user behavior
            if (this.conversationContext.userRole) {
                const roleSpecificSuggestions = [
                    `${this.capitalizeFirst(this.conversationContext.userRole)} dashboard help`,
                    `${this.capitalizeFirst(this.conversationContext.userRole)} account settings`,
                    `${this.capitalizeFirst(this.conversationContext.userRole)} support`
                ];
                suggestions = [...suggestions, ...roleSpecificSuggestions];
            }
        }
        
        // Sentiment-based suggestions
        if (this.conversationContext.sentiment === 'negative') {
            suggestions.push('Contact technical support', 'Report an issue');
        }
        
        // Remove duplicates and limit to 6 suggestions
        return [...new Set(suggestions)].slice(0, 6);
    }
    
    /**
     * Adapt response based on detected personality and sentiment
     * @param {string} response - Original response
     * @returns {string} - Adapted response
     */
    adaptResponse(response) {
        const personality = this.personalities[this.currentPersonality];
        let adaptedResponse = response;
        
        // Adjust tone based on personality
        if (personality.tone === 'formal') {
            adaptedResponse = response.replace(/hey/gi, 'Hello')
                                 .replace(/awesome/gi, 'excellent')
                                 .replace(/cool/gi, 'helpful');
        } else if (personality.tone === 'casual') {
            adaptedResponse = response.replace(/Hello/gi, 'Hey there')
                                 .replace(/assistance/gi, 'help');
        }
        
        // Adjust emoji usage
        if (personality.emojiUsage === 'minimal') {
            adaptedResponse = adaptedResponse.replace(/[🎉👋😊🔒]/g, '');
        } else if (personality.emojiUsage === 'moderate') {
            // Keep some emojis, add where appropriate
            if (!adaptedResponse.includes('👋') && adaptedResponse.includes('Hello')) {
                adaptedResponse = adaptedResponse.replace('Hello', 'Hello 👋');
            }
        }
        
        // Adjust for sentiment
        if (this.conversationContext.sentiment === 'negative') {
            adaptedResponse = "I understand your frustration. " + adaptedResponse;
        } else if (this.conversationContext.sentiment === 'positive') {
            adaptedResponse = adaptedResponse + " 😊";
        }
        
        return adaptedResponse;
    }
    
    /**
     * Enhanced response generation with AI features
     * @param {object} intentResult - Detected intent
     * @param {string} originalQuery - Original user query
     * @returns {object} - Enhanced response object
     */
    generateEnhancedResponse(intentResult, originalQuery) {
        const { intent, intentData } = intentResult;
        
        // Get base response
        let baseResponse = this.generateResponse(intentResult, originalQuery);
        
        // Apply personality adaptation
        if (this.aiFeatures.personalityAdaptation) {
            baseResponse.text = this.adaptResponse(baseResponse.text);
            if (baseResponse.followUp) {
                baseResponse.followUp = this.adaptResponse(baseResponse.followUp);
            }
        }
        
        // Generate smart suggestions
        if (this.aiFeatures.smartSuggestions) {
            baseResponse.suggestions = this.generateSmartSuggestions(intent);
        }
        
        // Add learning data
        if (this.aiFeatures.contextualLearning) {
            this.updateLearningPatterns(intent, baseResponse.text);
        }
        
        // Add multi-language support
        if (this.conversationContext.language !== 'en' && this.aiFeatures.multiLanguage) {
            baseResponse.text = this.translateResponse(baseResponse.text, this.conversationContext.language);
        }
        
        return baseResponse;
    }
    
    /**
     * Simple translation for supported languages
     * @param {string} text - Text to translate
     * @param {string} language - Target language code
     * @returns {string} - Translated text
     */
    translateResponse(text, language) {
        const translations = {
            'hi': {
                'Hello': 'नमस्ते',
                'Thank you': 'धन्यवाद',
                'Welcome': 'स्वागत है',
                'Help': 'मदद',
                'Login': 'लॉगिन',
                'Password': 'पासवर्ड',
                'Student': 'छात्र',
                'Teacher': 'शिक्षक',
                'Admin': 'व्यवस्थापक'
            }
        };
        
        if (translations[language]) {
            for (const [english, translated] of Object.entries(translations[language])) {
                text = text.replace(new RegExp(english, 'gi'), translated);
            }
        }
        
        return text;
    }
    
    /**
     * Update learning patterns based on interactions
     * @param {string} intent - Detected intent
     * @param {string} response - Bot response
     */
    updateLearningPatterns(intent, response) {
        // Track common issues
        if (!this.learningPatterns.commonIssues[intent]) {
            this.learningPatterns.commonIssues[intent] = 0;
        }
        this.learningPatterns.commonIssues[intent]++;
        
        // Track user satisfaction (simplified)
        if (this.conversationContext.sentiment === 'positive') {
            if (!this.learningPatterns.userSatisfaction[intent]) {
                this.learningPatterns.userSatisfaction[intent] = 0;
            }
            this.learningPatterns.userSatisfaction[intent]++;
        }
        
        // Store in localStorage for persistence
        try {
            localStorage.setItem('chatbotLearning', JSON.stringify(this.learningPatterns));
        } catch (e) {
            // Silently fail if localStorage is not available
        }
    }
    
    /**
     * Load learning patterns from storage
     */
    loadLearningPatterns() {
        try {
            const stored = localStorage.getItem('chatbotLearning');
            if (stored) {
                this.learningPatterns = JSON.parse(stored);
            }
        } catch (e) {
            // Silently fail if localStorage is not available
        }
    }
    
    /**
     * Generate response based on intent and conversation context
     * @param {object} intentResult - Detected intent
     * @param {string} originalQuery - Original user query
     * @returns {object} - Response object with text, followUp, and suggestions
     */
    generateResponse(intentResult, originalQuery) {
        const { intent, intentData } = intentResult;
        
        // Handle context reset
        if (intentData.resetsContext) {
            this.conversationContext.userRole = null;
            this.conversationContext.awaitingRoleConfirmation = false;
            this.conversationContext.inGuidedFlow = false;
            this.conversationContext.guidedFlowData = null;
            this.conversationContext.lastAnswer = null;
        }
        
        // Handle role confirmation
        if (intentData.confirmsRole) {
            this.conversationContext.userRole = intentData.confirmsRole;
            this.conversationContext.awaitingRoleConfirmation = false;
            // Use role-specific answer if available
            if (intentData.answer) {
                return {
                    text: intentData.answer,
                    followUp: intentData.followUp || null,
                    suggestions: null
                };
            }
        }
        
        // Handle login_help intent with role confirmation flow
        if (intent === 'login_help' && intentData.askRoleFirst) {
            // If we're awaiting role confirmation, check if user provided role
            if (this.conversationContext.awaitingRoleConfirmation) {
                // User might have provided role in their response
                const roleIntent = this.detectRoleFromQuery(originalQuery);
                if (roleIntent) {
                    this.conversationContext.userRole = roleIntent;
                    this.conversationContext.awaitingRoleConfirmation = false;
                    const roleData = this.intentGroups[`login_${roleIntent}`];
                    if (roleData) {
                        return {
                            text: roleData.answer,
                            followUp: roleData.followUp || null,
                            suggestions: null
                        };
                    }
                }
            }
            
            // If role is already known, use role-specific response
            if (this.conversationContext.userRole) {
                const topicCount = this.conversationContext.topicCount[intent] || 0;
                
                // If repeated question, use variation
                if (topicCount > 0 && intentData.repeatedAnswer && intentData.repeatedAnswer[this.conversationContext.userRole]) {
                    return {
                        text: intentData.repeatedAnswer[this.conversationContext.userRole],
                        followUp: null,
                        suggestions: ['Repeat steps', 'Password recovery', 'Contact admin']
                    };
                }
                
                // First time with known role - use role-based answer
                if (intentData.roleBasedAnswer && intentData.roleBasedAnswer[this.conversationContext.userRole]) {
                    return {
                        text: intentData.roleBasedAnswer[this.conversationContext.userRole],
                        followUp: null,
                        suggestions: null
                    };
                }
            }
            
            // No role known yet - ask for role
            if (!this.conversationContext.userRole) {
                this.conversationContext.awaitingRoleConfirmation = true;
                return {
                    text: "Sure 🙂 Are you logging in as a Student, Teacher, or Admin?",
                    followUp: null,
                    suggestions: ['Student', 'Teacher', 'Admin']
                };
            }
        }
        
        // Handle unknown intent
        if (intent === 'unknown') {
            // Check if we're awaiting role confirmation
            if (this.conversationContext.awaitingRoleConfirmation) {
                const roleIntent = this.detectRoleFromQuery(originalQuery);
                if (roleIntent) {
                    this.conversationContext.userRole = roleIntent;
                    this.conversationContext.awaitingRoleConfirmation = false;
                    const roleData = this.intentGroups[`login_${roleIntent}`];
                    if (roleData) {
                        return {
                            text: roleData.answer,
                            followUp: roleData.followUp || null,
                            suggestions: null
                        };
                    }
                } else {
                    // Still don't know role, ask again
                    return {
                        text: "Please let me know if you're a Student, Teacher, or Admin so I can help you better.",
                        followUp: null,
                        suggestions: ['Student', 'Teacher', 'Admin']
                    };
                }
            }
            return this.generateFallbackResponse(originalQuery);
        }
        
        // Check if this topic was discussed before
        const topicCount = this.conversationContext.topicCount[intent] || 0;
        const isRepeat = topicCount > 0;
        
        // Prevent exact answer repeats
        let answer;
        if (isRepeat && intentData.shortAnswer) {
            // Use short answer for repeat questions
            answer = intentData.shortAnswer;
        } else {
            // Use full answer for first time
            answer = intentData.answer;
        }
        
        // Check if this exact answer was just given
        if (this.conversationContext.lastAnswer === answer && isRepeat) {
            // Vary the response
            if (intentData.repeatedAnswer && this.conversationContext.userRole && intentData.repeatedAnswer[this.conversationContext.userRole]) {
                answer = intentData.repeatedAnswer[this.conversationContext.userRole];
            } else if (intent === 'login_help' && this.conversationContext.userRole) {
                // Custom variation for login help
                const variations = [
                    `You're logging in as a ${this.capitalizeFirst(this.conversationContext.userRole)}. Want me to repeat the steps or help with password recovery?`,
                    `Since you're a ${this.capitalizeFirst(this.conversationContext.userRole)}, here's a quick reminder: Select your role, enter credentials, and click Login. Need help with something else?`,
                    `For ${this.capitalizeFirst(this.conversationContext.userRole)} login: Select role → Enter credentials → Click Login. Anything else I can help with?`
                ];
                const variationIndex = (topicCount - 1) % variations.length;
                answer = variations[variationIndex];
            }
        }
        
        // Handle guided flows
        if (intentData.guidedFlow && intent === 'forgot_password' && !this.conversationContext.inGuidedFlow) {
            this.conversationContext.inGuidedFlow = true;
            this.conversationContext.guidedFlowData = { intent: 'forgot_password' };
            return {
                text: answer,
                followUp: intentData.followUp,
                suggestions: null
            };
        }
        
        // Handle security follow-ups
        if (intent === 'security' && intentData.followUp) {
            return {
                text: answer,
                followUp: intentData.followUp,
                suggestions: ['HTTPS encryption', 'Password protection', 'Session safety', 'Data privacy']
            };
        }
        
        // Store last answer to prevent repeats
        this.conversationContext.lastAnswer = answer;
        
        // Standard response
        return {
            text: answer,
            followUp: intentData.followUp || null,
            suggestions: null
        };
    }
    
    /**
     * Detect role from user query
     * @param {string} query - User's query
     * @returns {string|null} - Detected role (student, teacher, admin) or null
     */
    detectRoleFromQuery(query) {
        const normalized = query.toLowerCase().trim();
        
        // Check for student
        if (normalized.includes('student') || normalized === 'student' || normalized === 's') {
            return 'student';
        }
        
        // Check for teacher
        if (normalized.includes('teacher') || normalized === 'teacher' || normalized === 't') {
            return 'teacher';
        }
        
        // Check for admin
        if (normalized.includes('admin') || normalized.includes('administrator') || normalized === 'admin' || normalized === 'a') {
            return 'admin';
        }
        
        return null;
    }
    
    /**
     * Capitalize first letter
     * @param {string} str - String to capitalize
     * @returns {string} - Capitalized string
     */
    capitalizeFirst(str) {
        if (!str) return str;
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
    
    /**
     * Generate smart fallback response with suggestions
     * @param {string} query - User's query
     * @returns {object} - Fallback response
     */
    generateFallbackResponse(query) {
        // Try to find related suggestions based on query words
        const words = query.toLowerCase().split(/\s+/);
        let suggestions = this.suggestions.default;
        
        // Try to match suggestions to query
        for (const word of words) {
            if (word.includes('password') || word.includes('forgot') || word.includes('reset')) {
                suggestions = this.suggestions.forgot_password;
                break;
            } else if (word.includes('login') || word.includes('sign')) {
                suggestions = this.suggestions.login_help;
                break;
            } else if (word.includes('admission') || word.includes('apply')) {
                suggestions = this.suggestions.admission;
                break;
            } else if (word.includes('security') || word.includes('safe') || word.includes('secure')) {
                suggestions = this.suggestions.security;
                break;
            }
        }
        
        // Log unrecognized query for admin review
        console.log('[Chatbot] Unrecognized query:', query);
        
        return {
            text: "I'm not sure I understand that. Here are some topics I can help with:",
            followUp: null,
            suggestions: suggestions
        };
    }
    
    /**
     * Add suggestion buttons
     * @param {array} suggestions - Array of suggestion strings
     */
    addSuggestions(suggestions) {
        const messagesContainer = document.getElementById('login-chatbot-messages');
        if (!messagesContainer || !suggestions || suggestions.length === 0) return;
        
        const suggestionsDiv = document.createElement('div');
        suggestionsDiv.className = 'login-chatbot-suggestions';
        
        suggestions.forEach(suggestion => {
            const btn = document.createElement('button');
            btn.className = 'suggestion-btn';
            btn.textContent = suggestion;
            btn.addEventListener('click', () => {
                this.sendMessage(suggestion);
                suggestionsDiv.remove();
            });
            suggestionsDiv.appendChild(btn);
        });
        
        messagesContainer.appendChild(suggestionsDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    /**
     * Update conversation context
     * @param {string} intent - Detected intent
     */
    updateContext(intent) {
        if (intent && intent !== 'unknown') {
            this.conversationContext.lastTopic = intent;
            this.conversationContext.lastIntent = intent;
            this.conversationContext.topicCount[intent] = (this.conversationContext.topicCount[intent] || 0) + 1;
            
            // If role was confirmed, update context
            const intentData = this.intentGroups[`login_${intent}`];
            if (intentData && intentData.confirmsRole) {
                this.conversationContext.userRole = intentData.confirmsRole;
                this.conversationContext.awaitingRoleConfirmation = false;
            }
        }
    }
    
    /**
     * Add message to chat with typing effect
     * @param {string} sender - 'user' or 'bot'
     * @param {string} text - Message text
     * @param {boolean} useTypingEffect - Whether to use typing effect
     */
    addMessage(sender, text, useTypingEffect = true) {
        const messagesContainer = document.getElementById('login-chatbot-messages');
        if (!messagesContainer) return;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `login-chatbot-message ${sender}-message`;
        
        const timestamp = new Date().toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        if (useTypingEffect && sender === 'bot') {
            // Add typing effect for bot messages
            messageDiv.innerHTML = `
                <div class="message-content">
                    <div class="message-text typing-effect">${this.escapeHtml(text)}</div>
                    <div class="message-time">${timestamp}</div>
                </div>
            `;
        } else {
            messageDiv.innerHTML = `
                <div class="message-content">
                    <div class="message-text">${this.escapeHtml(text)}</div>
                    <div class="message-time">${timestamp}</div>
                </div>
            `;
        }
        
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Store in history
        this.messageHistory.push({ sender, text, timestamp: new Date().toISOString() });
        
        // Trigger typing effect animation if enabled
        if (useTypingEffect && sender === 'bot') {
            const textElement = messageDiv.querySelector('.typing-effect');
            if (textElement) {
                this.animateTyping(textElement, text);
            }
        }
    }
    
    /**
     * Animate typing effect for bot messages
     * @param {HTMLElement} element - Text element
     * @param {string} fullText - Complete text to display
     */
    animateTyping(element, fullText) {
        element.textContent = '';
        let index = 0;
        const speed = 20; // Characters per second
        
        const typeInterval = setInterval(() => {
            if (index < fullText.length) {
                element.textContent += fullText.charAt(index);
                index++;
                
                // Scroll to bottom as text types
                const messagesContainer = document.getElementById('login-chatbot-messages');
                if (messagesContainer) {
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }
            } else {
                clearInterval(typeInterval);
                // Remove typing-effect class after animation
                element.classList.remove('typing-effect');
            }
        }, 1000 / speed);
    }
    
    /**
     * Show typing indicator
     */
    showTypingIndicator() {
        const messagesContainer = document.getElementById('login-chatbot-messages');
        if (!messagesContainer) return;
        
        const typingDiv = document.createElement('div');
        typingDiv.id = 'login-chatbot-typing';
        typingDiv.className = 'login-chatbot-message bot-message typing-indicator';
        typingDiv.innerHTML = `
            <div class="message-content">
                <div class="typing-dots">
                    <span></span><span></span><span></span>
                </div>
                <div class="typing-text">Bot is typing...</div>
            </div>
        `;
        
        messagesContainer.appendChild(typingDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    /**
     * Hide typing indicator
     */
    hideTypingIndicator() {
        const typing = document.getElementById('login-chatbot-typing');
        if (typing) {
            typing.remove();
        }
    }
    
    /**
     * Rate limiting check
     * @returns {boolean} - True if request is allowed
     */
    checkRateLimit() {
        const now = Date.now();
        
        // Reset counter if window expired
        if (now - this.lastRequestTime > this.rateLimitWindow) {
            this.requestCount = 0;
            this.lastRequestTime = now;
        }
        
        // Check if limit exceeded
        if (this.requestCount >= this.maxRequestsPerWindow) {
            return false;
        }
        
        // Increment counter
        this.requestCount++;
        this.lastRequestTime = now;
        
        return true;
    }
    
    /**
     * Sanitize user input to prevent XSS and injection attacks
     * @param {string} input - Raw user input
     * @returns {string} - Sanitized input
     */
    sanitizeInput(input) {
        if (!input || typeof input !== 'string') return '';
        
        // Remove potential script tags and event handlers
        let sanitized = input
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
            .replace(/javascript:/gi, '')
            .replace(/data:text\/html/gi, '')
            .replace(/eval\s*\(/gi, '')
            .replace(/expression\s*\(/gi, '');
        
        // Limit length
        sanitized = sanitized.substring(0, 200);
        
        // Remove excessive whitespace
        sanitized = sanitized.trim().replace(/\s+/g, ' ');
        
        return sanitized;
    }
    
    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} - Escaped text
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * Enhanced logging with AI analytics for admin review
     * @param {string} query - User's query
     * @param {string} response - Bot's response
     * @param {object} metadata - Additional AI metadata
     */
    async logQuery(query, response, metadata = {}) {
        try {
            // Enhanced logging data
            const logData = {
                query: this.sanitizeInput(query),
                response: this.sanitizeInput(response),
                timestamp: new Date().toISOString(),
                page: 'login',
                userAgent: navigator.userAgent,
                intent: metadata.intent || this.conversationContext.lastIntent || 'unknown',
                confidence: metadata.confidence || 0,
                sentiment: metadata.sentiment || this.conversationContext.sentiment,
                language: metadata.language || this.conversationContext.language,
                personality: metadata.personality || this.currentPersonality,
                interactionCount: metadata.interactionCount || this.conversationContext.interactionCount,
                sessionDuration: Date.now() - this.conversationContext.sessionStart,
                userRole: this.conversationContext.userRole,
                aiFeatures: {
                    nlpEnabled: this.aiFeatures.nlpEnabled,
                    sentimentAnalysis: this.aiFeatures.sentimentAnalysis,
                    multiLanguage: this.aiFeatures.multiLanguage,
                    smartSuggestions: this.aiFeatures.smartSuggestions,
                    contextualLearning: this.aiFeatures.contextualLearning,
                    personalityAdaptation: this.aiFeatures.personalityAdaptation
                },
                learningPatterns: this.learningPatterns,
                conversationContext: {
                    lastTopic: this.conversationContext.lastTopic,
                    topicCount: this.conversationContext.topicCount,
                    inGuidedFlow: this.conversationContext.inGuidedFlow
                }
            };
            
            // Send to backend for logging (if endpoint exists)
            await fetch('/api/chatbot/log', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(logData)
            }).catch(() => {
                // Silently fail if endpoint doesn't exist
                // This allows chatbot to work without backend
            });
            
            // Also log to console for debugging (in development)
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                console.log('[AI Chatbot] Enhanced Query Log:', logData);
            }
            
        } catch (error) {
            // Silently fail - chatbot works offline
            console.debug('Chatbot enhanced logging failed (expected if backend unavailable)');
        }
    }
}

// Initialize chatbot when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    window.loginChatbot = new LoginChatbot();
});
