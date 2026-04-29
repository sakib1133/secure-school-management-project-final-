/**
 * Navigation Chatbot Service for School Management System
 * Intent-Based Smart Navigation Assistant
 * Does NOT display data - only guides users to correct modules
 */

class NavigationChatbotService {
    constructor(db) {
        this.db = db;
        this.intents = this.loadNavigationIntents();
    }

    /**
     * Load navigation intents - maps user queries to system modules
     */
    loadNavigationIntents() {
        return {
            // Password management
            forgot_password: {
                patterns: [
                    /\b(forgot\s+password|reset\s+password|password\s+reset|recover\s+password|lost\s+password)\b/i,
                    /\b(can'?t\s+login|password\s+help|change\s+my\s+password)\b/i
                ],
                action: 'navigate',
                target: '/change_password.html',
                message: 'I can help you reset your password. Let me take you to the password reset page.',
                roles: ['student', 'teacher', 'admin']
            },
            
            change_password: {
                patterns: [
                    /\b(change\s+password|update\s+password|modify\s+password|new\s+password)\b/i,
                    /\b(password\s+change|update\s+my\s+password)\b/i
                ],
                action: 'navigate',
                target: '/change_password.html',
                message: 'I\'ll help you change your password. Redirecting to the password change page...',
                roles: ['student', 'teacher', 'admin']
            },
            
            // Profile management
            profile: {
                patterns: [
                    /\b(profile|my\s+profile|user\s+profile|account\s+profile)\b/i,
                    /\b(view\s+profile|edit\s+profile|profile\s+settings)\b/i,
                    /\b(account\s+info|my\s+account|personal\s+info)\b/i
                ],
                action: 'navigate',
                target: '/profile.html',
                message: 'I\'ll take you to your profile page where you can view and edit your account information.',
                roles: ['student', 'teacher', 'admin']
            },
            
            // Attendance
            attendance: {
                patterns: [
                    /\b(attendance|my\s+attendance|attendance\s+record|attendance\s+report)\b/i,
                    /\b(check\s+attendance|view\s+attendance|attendance\s+status)\b/i,
                    /\b(classes?\s+attended|present|absent)\b/i
                ],
                action: 'navigate',
                target: '/attendance.html',
                message: 'I\'ll take you to the Attendance section where you can view your attendance records.',
                roles: ['student', 'teacher', 'admin']
            },
            
            // Grades/Results
            marks: {
                patterns: [
                    /\b(marks?|grades?|results?|scores?|exam\s+results?)\b/i,
                    /\b(my\s+marks?|my\s+grades?|academic\s+results?)\b/i,
                    /\b(performance|academic\s+performance|test\s+scores?)\b/i
                ],
                action: 'navigate',
                target: '/results.html',
                message: 'I\'ll redirect you to the Results page where you can view your grades and exam results.',
                roles: ['student', 'teacher', 'admin']
            },
            
            // Timetable/Schedule
            timetable: {
                patterns: [
                    /\b(timetable|schedule|class\s+schedule|time\s+table)\b/i,
                    /\b(my\s+timetable|my\s+schedule|today'?s?\s+classes?)\b/i,
                    /\b(what\s+classes?|when\s+is|class\s+timings?)\b/i
                ],
                action: 'navigate',
                target: '/timetable.html',
                message: 'I\'ll take you to the Timetable section where you can view your class schedule.',
                roles: ['student', 'teacher', 'admin']
            },
            
            // Assignments
            assignments: {
                patterns: [
                    /\b(assignments?|homework|tasks?|projects?)\b/i,
                    /\b(my\s+assignments?|pending\s+assignments?|due\s+assignments?)\b/i,
                    /\b(assignment\s+deadlines?|submissions?)\b/i
                ],
                action: 'navigate',
                target: '/assignments.html',
                message: 'I\'ll redirect you to the Assignments section where you can view and manage your assignments.',
                roles: ['student', 'teacher', 'admin']
            },
            
            // Fees (students and admin)
            fees: {
                patterns: [
                    /\b(fees?|payment|tuition|fee\s+status|fee\s+payment)\b/i,
                    /\b(my\s+fees?|check\s+fees?|outstanding\s+fees?)\b/i,
                    /\b(pending\s+payment|due\s+amount)\b/i
                ],
                action: 'navigate',
                target: '/fees.html',
                message: 'I\'ll take you to the Fees section where you can view and manage fee payments.',
                roles: ['student', 'admin']
            },
            
            // Notices/Announcements
            notices: {
                patterns: [
                    /\b(notices?|announcements?|news|updates?)\b/i,
                    /\b(latest\s+notices?|school\s+notices?|announcement)\b/i,
                    /\b(what'?s\s+new|recent\s+updates?)\b/i
                ],
                action: 'navigate',
                target: '/notices.html',
                message: 'I\'ll redirect you to the Notices section where you can view school announcements and updates.',
                roles: ['student', 'teacher', 'admin']
            },
            
            // Dashboard
            dashboard: {
                patterns: [
                    /\b(dashboard|home|main\s+page|overview)\b/i,
                    /\b(go\s+home|back\s+to\s+dashboard|main\s+dashboard)\b/i
                ],
                action: 'navigate',
                target: this.getDashboardPath.bind(this),
                message: 'I\'ll take you back to your dashboard.',
                roles: ['student', 'teacher', 'admin']
            },
            
            // Security information (safe to answer directly)
            security: {
                patterns: [
                    /\b(security|secure|safety|privacy|data\s+protection)\b/i,
                    /\b(how\s+secure|is\s+it\s+safe|security\s+features?)\b/i,
                    /\b(encryption|https|ssl|protection)\b/i
                ],
                action: 'inform',
                message: 'This system uses multiple layers of security: HTTPS encryption, password hashing, session management, brute-force protection, and regular security monitoring. Your data is protected with industry-standard security practices.',
                roles: ['student', 'teacher', 'admin']
            },
            
            // Help
            help: {
                patterns: [
                    /\b(help|assistance|support|guide|how\s+to|what\s+can\s+you\s+do)\b/i,
                    /\b(menu|options|available\s+features?)\b/i
                ],
                action: 'inform',
                message: this.getHelpMessage.bind(this),
                roles: ['student', 'teacher', 'admin']
            },
            
            // Logout
            logout: {
                patterns: [
                    /\b(logout|sign\s+out|log\s+out|exit)\b/i,
                    /\b(close\s+session|end\s+session)\b/i
                ],
                action: 'navigate',
                target: '/logout',
                message: 'I\'ll help you logout. Redirecting...',
                roles: ['student', 'teacher', 'admin']
            }
        };
    }

    /**
     * Get dashboard path based on user role
     */
    getDashboardPath(userRole) {
        const dashboards = {
            student: '/student/student_dashboard.html',
            teacher: '/teacher/teacher_dashboard.html',
            admin: '/dashboard.html'
        };
        return dashboards[userRole] || '/dashboard.html';
    }

    /**
     * Get help message based on user role
     */
    getHelpMessage(userRole) {
        const helpMessages = {
            student: `I can help you navigate to:
• **Profile** - View and edit your account
• **Attendance** - Check your attendance records
• **Results** - View your grades and exam results
• **Timetable** - See your class schedule
• **Assignments** - View and submit assignments
• **Fees** - Check fee status and payments
• **Notices** - Read school announcements
• **Security** - Learn about system security

Just ask me to take you to any of these sections!`,
            
            teacher: `I can help you navigate to:
• **Profile** - Manage your account settings
• **Attendance** - View and manage class attendance
• **Results** - Grade management and results
• **Timetable** - View teaching schedule
• **Assignments** - Create and manage assignments
• **Notices** - School announcements
• **Security** - System security information

Just ask me to take you to any of these sections!`,
            
            admin: `I can help you navigate to:
• **Profile** - Account management
• **Dashboard** - System overview
• **Attendance** - Attendance reports
• **Results** - Grade management
• **Fees** - Fee management
• **Notices** - Manage announcements
• **Security** - Security monitoring
• **User Management** - Manage users

Just ask me to take you to any of these sections!`
        };
        
        return helpMessages[userRole] || helpMessages.student;
    }

    /**
     * Recognize user intent from message
     */
    recognizeIntent(message, userRole) {
        for (const [intentName, intentData] of Object.entries(this.intents)) {
            // Check if user role has access
            if (!intentData.roles.includes(userRole)) {
                continue;
            }

            // Check if message matches any pattern
            for (const pattern of intentData.patterns) {
                if (pattern.test(message)) {
                    return intentName;
                }
            }
        }
        return 'unknown';
    }

    /**
     * Process message and return navigation instruction
     */
    async processMessage(message, userRole, userId, sessionId) {
        try {
            // Recognize intent
            const intent = this.recognizeIntent(message, userRole);
            
            if (intent === 'unknown') {
                return {
                    action: 'suggest',
                    message: this.getSuggestionMessage(userRole),
                    intent: 'unknown'
                };
            }
            
            const intentData = this.intents[intent];
            
            // Get target path (handle function targets)
            let target = intentData.target;
            if (typeof target === 'function') {
                target = target(userRole);
            }
            
            // Get message (handle function messages)
            let responseMessage = intentData.message;
            if (typeof responseMessage === 'function') {
                responseMessage = responseMessage(userRole);
            }
            
            return {
                action: intentData.action,
                target: target,
                message: responseMessage,
                intent: intent
            };
            
        } catch (error) {
            console.error('[NavigationChatbot] Processing error:', error);
            return {
                action: 'suggest',
                message: this.getSuggestionMessage(userRole),
                intent: 'error'
            };
        }
    }

    /**
     * Get suggestion message for unknown queries
     */
    getSuggestionMessage(userRole) {
        const suggestions = {
            student: `I'm not sure what you're looking for. Here are some things I can help you with:
• **Profile** - Account settings
• **Attendance** - Attendance records
• **Results** - Grades and exam results
• **Timetable** - Class schedule
• **Assignments** - View assignments
• **Fees** - Fee information
• **Notices** - School announcements

Try asking: "Take me to attendance" or "Show me my profile"`,
            
            teacher: `I'm not sure what you need. I can help you navigate to:
• **Profile** - Account management
• **Attendance** - Class attendance
• **Results** - Grade management
• **Timetable** - Teaching schedule
• **Assignments** - Assignment management
• **Notices** - Announcements

Try asking: "Go to attendance" or "Open profile"`,
            
            admin: `I'm not sure what you're looking for. I can help you navigate to:
• **Dashboard** - System overview
• **Profile** - Account settings
• **Attendance** - Attendance reports
• **Results** - Grade management
• **Fees** - Fee management
• **Notices** - Manage announcements

Try asking: "Take me to dashboard" or "Show attendance"`
        };
        
        return suggestions[userRole] || suggestions.student;
    }
}

module.exports = NavigationChatbotService;

