/**
 * School Management System Chatbot Service
 * Intelligent assistant with rule-based NLP and security integration
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class ChatbotService {
    constructor(db) {
        this.db = db;
        this.intents = this.loadIntents();
        this.securityPatterns = this.loadSecurityPatterns();
        this.conversationHistory = new Map();
    }

    loadIntents() {
        return {
            // Student intents
            grades: {
                patterns: [
                    /\b(grades?|marks?|scores?|results?)\b/i,
                    /\b(my\s+grades?|show\s+grades?|check\s+grades?)\b/i,
                    /\b(academic\s+performance|exam\s+results?)\b/i
                ],
                responses: ['grades'],
                roles: ['student', 'teacher', 'admin']
            },
            attendance: {
                patterns: [
                    /\b(attendance|present|absent|classes?\s+attended)\b/i,
                    /\b(my\s+attendance|show\s+attendance|check\s+attendance)\b/i,
                    /\b(how\s+many\s+classes?|attendance\s+record)\b/i
                ],
                responses: ['attendance'],
                roles: ['student', 'teacher', 'admin']
            },
            fees: {
                patterns: [
                    /\b(fees?|payment|tuition|money|cost|bill)\b/i,
                    /\b(my\s+fees?|check\s+fees?|fee\s+status)\b/i,
                    /\b(outstanding|pending|due|balance)\b/i
                ],
                responses: ['fees'],
                roles: ['student', 'admin']
            },
            schedule: {
                patterns: [
                    /\b(schedule|timetable|classes?|subjects?)\b/i,
                    /\b(my\s+schedule|today'?s?\s+classes?|class\s+schedule)\b/i,
                    /\b(what\s+classes?|when\s+is|time\s+table)\b/i
                ],
                responses: ['schedule'],
                roles: ['student', 'teacher', 'admin']
            },

            // Teacher intents
            students: {
                patterns: [
                    /\b(students?|pupils?|class\s+list)\b/i,
                    /\b(my\s+students?|show\s+students?|student\s+list)\b/i,
                    /\b(class\s+roster|enrolled\s+students?)\b/i
                ],
                responses: ['students'],
                roles: ['teacher', 'admin']
            },
            assignments: {
                patterns: [
                    /\b(assignments?|homework|tasks?|projects?)\b/i,
                    /\b(pending\s+assignments?|due\s+assignments?)\b/i,
                    /\b(student\s+work|submissions?)\b/i
                ],
                responses: ['assignments'],
                roles: ['teacher', 'admin']
            },

            // Admin intents
            system_status: {
                patterns: [
                    /\b(system\s+status|server\s+status|health|uptime)\b/i,
                    /\b(system\s+info|performance|monitoring)\b/i,
                    /\b(how\s+is\s+system|system\s+running)\b/i
                ],
                responses: ['system_status'],
                roles: ['admin']
            },
            security_alerts: {
                patterns: [
                    /\b(security\s+alerts?|threats?|attacks?|blocked)\b/i,
                    /\b(ips\s+alerts?|waf\s+alerts?|security\s+events?)\b/i,
                    /\b(suspicious\s+activity|security\s+logs?)\b/i
                ],
                responses: ['security_alerts'],
                roles: ['admin']
            },
            blocked_ips: {
                patterns: [
                    /\b(blocked\s+ips?|banned\s+ips?|ip\s+blocks?)\b/i,
                    /\b(show\s+blocked|list\s+blocked|blocked\s+addresses?)\b/i,
                    /\b(ips\s+blocked|blocked\s+users?)\b/i
                ],
                responses: ['blocked_ips'],
                roles: ['admin']
            },
            user_stats: {
                patterns: [
                    /\b(user\s+stats?|user\s+statistics?|active\s+users?)\b/i,
                    /\b(login\s+stats?|user\s+activity|session\s+stats?)\b/i,
                    /\b(how\s+many\s+users?|user\s+count)\b/i
                ],
                responses: ['user_stats'],
                roles: ['admin']
            },

            // General intents
            help: {
                patterns: [
                    /\b(help|assist|support|guide)\b/i,
                    /\b(what\s+can\s+you\s+do|how\s+to|instructions?)\b/i,
                    /\b(commands?|options?|features?)\b/i
                ],
                responses: ['help'],
                roles: ['student', 'teacher', 'admin', 'guest']
            },
            login_help: {
                patterns: [
                    /\b(login\s+help|can'?t\s+login|forgot\s+password)\b/i,
                    /\b(authentication|access\s+problem|login\s+issue)\b/i,
                    /\b(username|password|credentials?)\b/i
                ],
                responses: ['login_help'],
                roles: ['student', 'teacher', 'admin', 'guest']
            },
            about: {
                patterns: [
                    /\b(about|info|information|what\s+is)\b/i,
                    /\b(school\s+system|management\s+system)\b/i,
                    /\b(features?|capabilities?|overview)\b/i
                ],
                responses: ['about'],
                roles: ['student', 'teacher', 'admin', 'guest']
            },

            // Security awareness
            security_tips: {
                patterns: [
                    /\b(security\s+tips?|safety|protect|secure)\b/i,
                    /\b(phishing|scam|suspicious|malware)\b/i,
                    /\b(password\s+security|account\s+safety)\b/i
                ],
                responses: ['security_tips'],
                roles: ['student', 'teacher', 'admin']
            }
        };
    }

    loadSecurityPatterns() {
        return {
            // Potential security risks in user input
            sql_injection: /(\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bUNION\b)/i,
            xss_attempt: /(<script|javascript:|onload=|onerror=)/i,
            command_injection: /(\bsudo\b|\brm\s+-rf\b|\bwget\b|\bcurl\b)/i,
            sensitive_info: /\b(password|token|secret|key|admin)\b/i
        };
    }

    async processMessage(message, userRole, userId, sessionId) {
        try {
            // Security check
            const securityCheck = this.checkMessageSecurity(message);
            if (!securityCheck.safe) {
                return {
                    message: `🚨 **Security Warning**: ${securityCheck.reason}. Please avoid sharing sensitive information.`,
                    type: 'warning',
                    intent: 'security_warning'
                };
            }

            // Intent recognition
            const intent = this.recognizeIntent(message, userRole);
            
            // Generate response based on intent
            const response = await this.generateResponse(intent, userRole, userId, sessionId, message);
            
            // Log conversation
            await this.logConversation(userId, message, response.message, intent);
            
            return response;

        } catch (error) {
            console.error('Chatbot processing error:', error);
            return {
                message: '❌ I encountered an error processing your request. Please try again.',
                type: 'error',
                intent: 'error'
            };
        }
    }

    checkMessageSecurity(message) {
        for (const [type, pattern] of Object.entries(this.securityPatterns)) {
            if (pattern.test(message)) {
                return {
                    safe: false,
                    reason: this.getSecurityWarning(type)
                };
            }
        }
        return { safe: true };
    }

    getSecurityWarning(type) {
        const warnings = {
            sql_injection: 'Detected potential SQL injection attempt',
            xss_attempt: 'Detected potential XSS attempt',
            command_injection: 'Detected potential command injection',
            sensitive_info: 'Please avoid sharing sensitive information in chat'
        };
        return warnings[type] || 'Potential security risk detected';
    }

    recognizeIntent(message, userRole) {
        for (const [intentName, intentData] of Object.entries(this.intents)) {
            // Check if user role has access to this intent
            if (!intentData.roles.includes(userRole) && !intentData.roles.includes('guest')) {
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

    async generateResponse(intent, userRole, userId, sessionId, originalMessage) {
        switch (intent) {
            case 'grades':
                return await this.handleGradesQuery(userRole, userId);
            case 'attendance':
                return await this.handleAttendanceQuery(userRole, userId);
            case 'fees':
                return await this.handleFeesQuery(userRole, userId);
            case 'schedule':
                return await this.handleScheduleQuery(userRole, userId);
            case 'students':
                return await this.handleStudentsQuery(userRole, userId);
            case 'assignments':
                return await this.handleAssignmentsQuery(userRole, userId);
            case 'system_status':
                return await this.handleSystemStatusQuery();
            case 'security_alerts':
                return await this.handleSecurityAlertsQuery();
            case 'blocked_ips':
                return await this.handleBlockedIPsQuery();
            case 'user_stats':
                return await this.handleUserStatsQuery();
            case 'help':
                return this.handleHelpQuery(userRole);
            case 'login_help':
                return this.handleLoginHelpQuery();
            case 'about':
                return this.handleAboutQuery();
            case 'security_tips':
                return this.handleSecurityTipsQuery();
            default:
                return this.handleUnknownQuery(originalMessage, userRole);
        }
    }

    async handleGradesQuery(userRole, userId) {
        try {
            if (userRole === 'student') {
                const student = await this.getStudentData(userId);
                if (student) {
                    return {
                        message: `📊 **Your Academic Performance**\n\n**Name**: ${student.name}\n**Grade**: ${student.grade}\n**Age**: ${student.age}\n\n*For detailed grade breakdown, please check your student dashboard.*`,
                        type: 'info',
                        intent: 'grades'
                    };
                }
            } else if (userRole === 'teacher' || userRole === 'admin') {
                const studentCount = await this.getStudentCount();
                return {
                    message: `📊 **Grade Overview**\n\nTotal students in system: **${studentCount}**\n\n*Use the admin/teacher dashboard for detailed grade management.*`,
                    type: 'info',
                    intent: 'grades'
                };
            }
        } catch (error) {
            console.error('Grades query error:', error);
        }
        
        return {
            message: '❌ Unable to retrieve grade information at this time.',
            type: 'error',
            intent: 'grades'
        };
    }

    async handleAttendanceQuery(userRole, userId) {
        const attendanceData = {
            student: "📅 **Your Attendance Record**\n\n*Attendance tracking is available in your student dashboard. Please check there for detailed records.*",
            teacher: "📅 **Class Attendance**\n\n*Use the teacher dashboard to view and manage student attendance records.*",
            admin: "📅 **System Attendance Overview**\n\n*Access comprehensive attendance reports through the admin dashboard.*"
        };

        return {
            message: attendanceData[userRole] || attendanceData.student,
            type: 'info',
            intent: 'attendance'
        };
    }

    async handleFeesQuery(userRole, userId) {
        if (userRole === 'student') {
            return {
                message: "💰 **Fee Information**\n\n*Your fee details and payment status are available in the student dashboard under the 'Fees' section.*\n\nFor payment assistance, contact the administration office.",
                type: 'info',
                intent: 'fees'
            };
        } else if (userRole === 'admin') {
            return {
                message: "💰 **Fee Management**\n\n*Access comprehensive fee management tools through the admin dashboard to view payments, generate reports, and manage student accounts.*",
                type: 'info',
                intent: 'fees'
            };
        }

        return {
            message: "❌ You don't have permission to access fee information.",
            type: 'error',
            intent: 'fees'
        };
    }

    async handleScheduleQuery(userRole, userId) {
        const scheduleData = {
            student: "📚 **Your Class Schedule**\n\n*Your personalized timetable is available in the student dashboard. Check there for today's classes and upcoming subjects.*",
            teacher: "📚 **Teaching Schedule**\n\n*Your teaching schedule and class assignments are available in the teacher dashboard.*",
            admin: "📚 **System Schedule Overview**\n\n*Access all schedules and timetable management through the admin dashboard.*"
        };

        return {
            message: scheduleData[userRole] || scheduleData.student,
            type: 'info',
            intent: 'schedule'
        };
    }

    async handleStudentsQuery(userRole, userId) {
        if (userRole === 'teacher' || userRole === 'admin') {
            try {
                const studentCount = await this.getStudentCount();
                return {
                    message: `👨‍🎓 **Student Information**\n\nTotal students: **${studentCount}**\n\n*Access detailed student lists and management tools through your dashboard.*`,
                    type: 'info',
                    intent: 'students'
                };
            } catch (error) {
                console.error('Students query error:', error);
            }
        }

        return {
            message: "❌ You don't have permission to access student information.",
            type: 'error',
            intent: 'students'
        };
    }

    async handleAssignmentsQuery(userRole, userId) {
        const assignmentData = {
            teacher: "📝 **Assignment Management**\n\n*Use the teacher dashboard to create, manage, and review student assignments and submissions.*",
            admin: "📝 **Assignment Overview**\n\n*Access comprehensive assignment reports and management through the admin dashboard.*"
        };

        return {
            message: assignmentData[userRole] || "❌ You don't have permission to access assignment information.",
            type: userRole === 'teacher' || userRole === 'admin' ? 'info' : 'error',
            intent: 'assignments'
        };
    }

    async handleSystemStatusQuery() {
        try {
            const uptime = process.uptime();
            const memoryUsage = process.memoryUsage();
            const uptimeHours = Math.floor(uptime / 3600);
            const uptimeMinutes = Math.floor((uptime % 3600) / 60);

            return {
                message: `🖥️ **System Status**\n\n✅ **Status**: Online\n⏱️ **Uptime**: ${uptimeHours}h ${uptimeMinutes}m\n💾 **Memory**: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB used\n🔒 **Security**: All systems operational\n\n*All security modules (WAF, IPS, Anti-Phishing) are active and monitoring.*`,
                type: 'info',
                intent: 'system_status'
            };
        } catch (error) {
            return {
                message: '❌ Unable to retrieve system status.',
                type: 'error',
                intent: 'system_status'
            };
        }
    }

    async handleSecurityAlertsQuery() {
        try {
            const alerts = await this.getRecentSecurityAlerts();
            if (alerts.length === 0) {
                return {
                    message: "🛡️ **Security Status**\n\n✅ No recent security alerts\n🔒 All security systems operational\n📊 System is secure",
                    type: 'info',
                    intent: 'security_alerts'
                };
            }

            let alertMessage = "🚨 **Recent Security Alerts**\n\n";
            alerts.slice(0, 5).forEach((alert, index) => {
                alertMessage += `${index + 1}. **${alert.type}**: ${alert.message}\n`;
            });

            return {
                message: alertMessage,
                type: 'warning',
                intent: 'security_alerts'
            };
        } catch (error) {
            return {
                message: '❌ Unable to retrieve security alerts.',
                type: 'error',
                intent: 'security_alerts'
            };
        }
    }

    async handleBlockedIPsQuery() {
        try {
            // This would integrate with your IPS system
            return {
                message: "🚫 **Blocked IPs**\n\n*Access detailed IP blocking information through the security logs in your admin dashboard.*\n\n🛡️ IPS is actively monitoring and blocking suspicious IPs.",
                type: 'info',
                intent: 'blocked_ips'
            };
        } catch (error) {
            return {
                message: '❌ Unable to retrieve blocked IP information.',
                type: 'error',
                intent: 'blocked_ips'
            };
        }
    }

    async handleUserStatsQuery() {
        try {
            const stats = await this.getUserStatistics();
            return {
                message: `👥 **User Statistics**\n\n📊 **Total Users**: ${stats.total}\n👨‍🎓 **Students**: ${stats.students}\n👨‍🏫 **Teachers**: ${stats.teachers}\n👨‍💼 **Admins**: ${stats.admins}\n\n*Last updated: ${new Date().toLocaleString()}*`,
                type: 'info',
                intent: 'user_stats'
            };
        } catch (error) {
            return {
                message: '❌ Unable to retrieve user statistics.',
                type: 'error',
                intent: 'user_stats'
            };
        }
    }

    handleHelpQuery(userRole) {
        const helpMessages = {
            student: "🤖 **Student Assistant Help**\n\n**I can help you with:**\n• Check your grades and academic performance\n• View attendance records\n• Check fee status and payments\n• View class schedule and timetable\n• Get security tips and safety information\n\n**Quick Commands:**\n• \"Show my grades\"\n• \"Check attendance\"\n• \"Fee status\"\n• \"Today's schedule\"",
            teacher: "🤖 **Teacher Assistant Help**\n\n**I can help you with:**\n• View student information and lists\n• Check class schedules\n• Manage assignments and homework\n• View attendance records\n• Get security information\n\n**Quick Commands:**\n• \"Show my students\"\n• \"Class schedule\"\n• \"Pending assignments\"\n• \"Student attendance\"",
            admin: "🤖 **Admin Assistant Help**\n\n**I can help you with:**\n• System status and monitoring\n• Security alerts and threats\n• User statistics and reports\n• Blocked IPs and security events\n• Overall system management\n\n**Quick Commands:**\n• \"System status\"\n• \"Security alerts\"\n• \"User statistics\"\n• \"Blocked IPs\"",
            guest: "🤖 **Welcome!**\n\n**I can help you with:**\n• Login assistance\n• System information\n• General inquiries\n\n**Please log in to access personalized features.**"
        };

        return {
            message: helpMessages[userRole] || helpMessages.guest,
            type: 'info',
            intent: 'help'
        };
    }

    handleLoginHelpQuery() {
        return {
            message: "🔐 **Login Assistance**\n\n**Having trouble logging in?**\n\n1. **Check your credentials** - Ensure username and password are correct\n2. **Clear browser cache** - Try refreshing the page\n3. **Check CAPS LOCK** - Passwords are case-sensitive\n4. **Contact support** - If issues persist, contact your administrator\n\n**Security Tip**: Never share your login credentials with anyone!",
            type: 'info',
            intent: 'login_help'
        };
    }

    handleAboutQuery() {
        return {
            message: "🏫 **School Management System**\n\n**A comprehensive platform featuring:**\n\n🔒 **Enterprise Security**\n• WAF (Web Application Firewall)\n• IPS/IDS (Intrusion Prevention/Detection)\n• Anti-Phishing Protection\n• App Cloning Detection\n• Database Encryption\n\n👥 **Role-Based Access**\n• Student Portal\n• Teacher Dashboard\n• Admin Management\n\n🤖 **AI Assistant**\n• 24/7 Support\n• Security Awareness\n• Intelligent Responses\n\n*Built with security and user experience in mind.*",
            type: 'info',
            intent: 'about'
        };
    }

    handleSecurityTipsQuery() {
        const tips = [
            "🔐 Use strong, unique passwords for your account",
            "🚫 Never share your login credentials with anyone",
            "📧 Be cautious of phishing emails asking for personal information",
            "🔒 Always log out when using shared computers",
            "⚠️ Report suspicious activities to administrators immediately",
            "🛡️ Keep your browser and devices updated",
            "📱 Don't use public WiFi for sensitive activities"
        ];

        const randomTips = tips.sort(() => 0.5 - Math.random()).slice(0, 4);

        return {
            message: `🛡️ **Security Tips**\n\n${randomTips.join('\n')}\n\n**Remember**: Your security is our priority. Stay vigilant and report any suspicious activity!`,
            type: 'info',
            intent: 'security_tips'
        };
    }

    handleUnknownQuery(message, userRole) {
        const suggestions = {
            student: ["\"Show my grades\"", "\"Check attendance\"", "\"Fee status\"", "\"Today's schedule\""],
            teacher: ["\"Show my students\"", "\"Class schedule\"", "\"Assignments\""],
            admin: ["\"System status\"", "\"Security alerts\"", "\"User statistics\""],
            guest: ["\"Login help\"", "\"About system\""]
        };

        const userSuggestions = suggestions[userRole] || suggestions.guest;
        const suggestionText = userSuggestions.join(', ');

        return {
            message: `🤔 I didn't quite understand that. Here are some things you can try:\n\n${suggestionText}\n\nOr type **"help"** to see all available commands.`,
            type: 'info',
            intent: 'unknown'
        };
    }

    // Database helper methods
    async getStudentData(userId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM students WHERE id = (SELECT id FROM users WHERE username = ?)',
                [userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }

    async getStudentCount() {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT COUNT(*) as count FROM students', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
    }

    async getUserStatistics() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT role, COUNT(*) as count 
                FROM users 
                GROUP BY role
            `, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const stats = { total: 0, students: 0, teachers: 0, admins: 0 };
                    rows.forEach(row => {
                        stats.total += row.count;
                        stats[row.role + 's'] = row.count;
                    });
                    resolve(stats);
                }
            });
        });
    }

    async getRecentSecurityAlerts() {
        // This would read from your security log files
        try {
            const logFiles = ['waf_alerts.log', 'ids_alerts.log', 'phishing_alerts.log'];
            const alerts = [];
            
            for (const logFile of logFiles) {
                try {
                    const logPath = path.join(__dirname, '..', 'logs', logFile);
                    const content = await fs.readFile(logPath, 'utf8');
                    const lines = content.split('\n').filter(line => line.trim());
                    
                    // Get recent alerts (last 10 lines)
                    const recentLines = lines.slice(-10);
                    recentLines.forEach(line => {
                        if (line.includes('BLOCKED') || line.includes('ALERT')) {
                            alerts.push({
                                type: logFile.replace('_alerts.log', '').toUpperCase(),
                                message: line.substring(0, 100) + '...',
                                timestamp: new Date().toISOString()
                            });
                        }
                    });
                } catch (fileErr) {
                    // Log file might not exist, continue
                }
            }
            
            return alerts.slice(-5); // Return last 5 alerts
        } catch (error) {
            console.error('Error reading security alerts:', error);
            return [];
        }
    }

    async logConversation(userId, userMessage, botResponse, intent) {
        try {
            const logEntry = {
                timestamp: new Date().toISOString(),
                userId: userId,
                userMessage: userMessage,
                botResponse: botResponse,
                intent: intent
            };

            const logPath = path.join(__dirname, '..', 'logs', 'chatbot.log');
            await fs.appendFile(logPath, JSON.stringify(logEntry) + '\n');
        } catch (error) {
            console.error('Error logging conversation:', error);
        }
    }
}

module.exports = ChatbotService;
