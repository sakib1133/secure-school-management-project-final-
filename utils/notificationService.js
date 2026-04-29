const nodemailer = require('nodemailer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Notification Service for Security Alerts
class NotificationService {
    constructor() {
        this.emailConfig = {
            enabled: process.env.EMAIL_ALERTS_ENABLED === 'true',
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: process.env.ADMIN_EMAIL || 'admin@school.edu'
        };

        this.slackConfig = {
            enabled: process.env.SLACK_ALERTS_ENABLED === 'true',
            webhookUrl: process.env.SLACK_WEBHOOK_URL,
            channel: process.env.SLACK_CHANNEL || '#security-alerts',
            username: process.env.SLACK_USERNAME || 'School Security Bot'
        };

        this.discordConfig = {
            enabled: process.env.DISCORD_ALERTS_ENABLED === 'true',
            webhookUrl: process.env.DISCORD_WEBHOOK_URL,
            username: process.env.DISCORD_USERNAME || 'School Security Bot'
        };

        this.teamsConfig = {
            enabled: process.env.TEAMS_ALERTS_ENABLED === 'true',
            webhookUrl: process.env.TEAMS_WEBHOOK_URL
        };

        // Initialize email transporter
        this.emailTransporter = null;
        if (this.emailConfig.enabled && this.emailConfig.user && this.emailConfig.pass) {
            this.emailTransporter = nodemailer.createTransport({
                host: this.emailConfig.host,
                port: this.emailConfig.port,
                secure: this.emailConfig.secure,
                auth: {
                    user: this.emailConfig.user,
                    pass: this.emailConfig.pass
                }
            });

            // Verify SMTP connection
            this.emailTransporter.verify((error, success) => {
                if (error) {
                    console.error('SMTP connection failed:', error.message);
                } else {
                    console.log('SMTP working ✅');
                }
            });
        }

        // Alert rate limiting to prevent spam
        this.alertCooldown = new Map();
        this.cooldownDuration = 5 * 60 * 1000; // 5 minutes
    }

    // Reusable function to send emails
    async sendEmail(to, subject, html) {
        if (!this.emailConfig.enabled || !this.emailTransporter) {
            return { success: false, reason: 'Email not configured' };
        }

        try {
            const mailOptions = {
                from: this.emailConfig.from,
                to: to,
                subject: subject,
                html: html
            };

            const info = await this.emailTransporter.sendMail(mailOptions);
            console.log('Email sent successfully:', info.messageId);
            return { success: true, messageId: info.messageId };
        } catch (error) {
            console.error('Error sending email:', error.message);
            return { success: false, reason: error.message };
        }
    }

    // Check if alert should be sent (rate limiting)
    shouldSendAlert(alertType, identifier) {
        const key = `${alertType}_${identifier}`;
        const lastSent = this.alertCooldown.get(key);
        const now = Date.now();
        
        if (lastSent && (now - lastSent) < this.cooldownDuration) {
            return false;
        }
        
        this.alertCooldown.set(key, now);
        return true;
    }

    // Send email alert
    async sendEmailAlert(subject, message, priority = 'medium') {
        if (!this.emailConfig.enabled || !this.emailTransporter) {
            return { success: false, reason: 'Email not configured' };
        }

        try {
            const priorityEmoji = {
                low: '🟡',
                medium: '🟠', 
                high: '🔴',
                critical: '🚨'
            };

            const emailSubject = `${priorityEmoji[priority]} ${subject}`;
            const timestamp = new Date().toISOString();
            
            const htmlMessage = `
                <div style="font-family: Arial, sans-serif; max-width: 600px;">
                    <div style="background: #f44336; color: white; padding: 15px; border-radius: 5px 5px 0 0;">
                        <h2 style="margin: 0;">${priorityEmoji[priority]} Security Alert</h2>
                        <p style="margin: 5px 0 0 0; opacity: 0.9;">School Management System</p>
                    </div>
                    <div style="background: #fff; padding: 20px; border: 1px solid #ddd; border-top: none;">
                        <h3 style="color: #333; margin-top: 0;">${subject}</h3>
                        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0;">
                            <pre style="margin: 0; white-space: pre-wrap; font-family: 'Courier New', monospace;">${message}</pre>
                        </div>
                        <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee; color: #666; font-size: 12px;">
                            <p><strong>Timestamp:</strong> ${timestamp}</p>
                            <p><strong>System:</strong> School Management System</p>
                            <p><strong>Priority:</strong> ${priority.toUpperCase()}</p>
                        </div>
                    </div>
                </div>
            `;

            await this.emailTransporter.sendMail({
                from: this.emailConfig.from,
                to: this.emailConfig.to,
                subject: emailSubject,
                text: `${subject}\n\n${message}\n\nTimestamp: ${timestamp}`,
                html: htmlMessage
            });

            return { success: true, method: 'email' };
        } catch (error) {
            console.error('Email notification failed:', error.message);
            return { success: false, reason: error.message, method: 'email' };
        }
    }

    // Send Slack alert
    async sendSlackAlert(subject, message, priority = 'medium') {
        if (!this.slackConfig.enabled || !this.slackConfig.webhookUrl) {
            return { success: false, reason: 'Slack not configured' };
        }

        try {
            const priorityColors = {
                low: '#ffeb3b',
                medium: '#ff9800',
                high: '#f44336',
                critical: '#9c27b0'
            };

            const priorityEmoji = {
                low: ':warning:',
                medium: ':exclamation:',
                high: ':rotating_light:',
                critical: ':sos:'
            };

            const payload = {
                channel: this.slackConfig.channel,
                username: this.slackConfig.username,
                icon_emoji: ':shield:',
                attachments: [{
                    color: priorityColors[priority],
                    title: `${priorityEmoji[priority]} ${subject}`,
                    text: message,
                    fields: [
                        {
                            title: 'System',
                            value: 'School Management System',
                            short: true
                        },
                        {
                            title: 'Priority',
                            value: priority.toUpperCase(),
                            short: true
                        },
                        {
                            title: 'Timestamp',
                            value: new Date().toISOString(),
                            short: false
                        }
                    ],
                    footer: 'Security Alert System',
                    ts: Math.floor(Date.now() / 1000)
                }]
            };

            await axios.post(this.slackConfig.webhookUrl, payload);
            return { success: true, method: 'slack' };
        } catch (error) {
            console.error('Slack notification failed:', error.message);
            return { success: false, reason: error.message, method: 'slack' };
        }
    }

    // Send Discord alert
    async sendDiscordAlert(subject, message, priority = 'medium') {
        if (!this.discordConfig.enabled || !this.discordConfig.webhookUrl) {
            return { success: false, reason: 'Discord not configured' };
        }

        try {
            const priorityColors = {
                low: 0xffeb3b,
                medium: 0xff9800,
                high: 0xf44336,
                critical: 0x9c27b0
            };

            const payload = {
                username: this.discordConfig.username,
                avatar_url: 'https://cdn-icons-png.flaticon.com/512/2092/2092063.png',
                embeds: [{
                    title: `🛡️ Security Alert: ${subject}`,
                    description: message,
                    color: priorityColors[priority],
                    fields: [
                        {
                            name: 'System',
                            value: 'School Management System',
                            inline: true
                        },
                        {
                            name: 'Priority',
                            value: priority.toUpperCase(),
                            inline: true
                        }
                    ],
                    timestamp: new Date().toISOString(),
                    footer: {
                        text: 'Security Alert System'
                    }
                }]
            };

            await axios.post(this.discordConfig.webhookUrl, payload);
            return { success: true, method: 'discord' };
        } catch (error) {
            console.error('Discord notification failed:', error.message);
            return { success: false, reason: error.message, method: 'discord' };
        }
    }

    // Send Microsoft Teams alert
    async sendTeamsAlert(subject, message, priority = 'medium') {
        if (!this.teamsConfig.enabled || !this.teamsConfig.webhookUrl) {
            return { success: false, reason: 'Teams not configured' };
        }

        try {
            const priorityColors = {
                low: 'warning',
                medium: 'attention',
                high: 'attention',
                critical: 'attention'
            };

            const payload = {
                "@type": "MessageCard",
                "@context": "https://schema.org/extensions",
                summary: subject,
                themeColor: priorityColors[priority] === 'warning' ? 'ffeb3b' : 'f44336',
                sections: [{
                    activityTitle: `🛡️ Security Alert`,
                    activitySubtitle: subject,
                    activityImage: "https://cdn-icons-png.flaticon.com/512/2092/2092063.png",
                    facts: [
                        {
                            name: "System",
                            value: "School Management System"
                        },
                        {
                            name: "Priority",
                            value: priority.toUpperCase()
                        },
                        {
                            name: "Timestamp",
                            value: new Date().toISOString()
                        }
                    ],
                    text: message
                }]
            };

            await axios.post(this.teamsConfig.webhookUrl, payload);
            return { success: true, method: 'teams' };
        } catch (error) {
            console.error('Teams notification failed:', error.message);
            return { success: false, reason: error.message, method: 'teams' };
        }
    }

    // Send alert to all configured channels
    async sendSecurityAlert(alertType, subject, message, priority = 'medium', metadata = {}) {
        const identifier = metadata.ip || metadata.userId || 'general';
        
        // Rate limiting check
        if (!this.shouldSendAlert(alertType, identifier)) {
            console.log(`Alert rate limited: ${alertType} for ${identifier}`);
            return { success: false, reason: 'Rate limited' };
        }

        const results = [];
        const timestamp = new Date().toISOString();
        
        // Enhanced message with metadata
        const enhancedMessage = `${message}

Alert Details:
- Type: ${alertType}
- Priority: ${priority.toUpperCase()}
- Timestamp: ${timestamp}
${metadata.ip ? `- Source IP: ${metadata.ip}` : ''}
${metadata.userAgent ? `- User Agent: ${metadata.userAgent}` : ''}
${metadata.endpoint ? `- Endpoint: ${metadata.endpoint}` : ''}
${metadata.attempts ? `- Failed Attempts: ${metadata.attempts}` : ''}
${metadata.blockDuration ? `- Block Duration: ${metadata.blockDuration}` : ''}`;

        // Send to all configured notification channels
        if (this.emailConfig.enabled) {
            const emailResult = await this.sendEmailAlert(subject, enhancedMessage, priority);
            results.push(emailResult);
        }

        if (this.slackConfig.enabled) {
            const slackResult = await this.sendSlackAlert(subject, enhancedMessage, priority);
            results.push(slackResult);
        }

        if (this.discordConfig.enabled) {
            const discordResult = await this.sendDiscordAlert(subject, enhancedMessage, priority);
            results.push(discordResult);
        }

        if (this.teamsConfig.enabled) {
            const teamsResult = await this.sendTeamsAlert(subject, enhancedMessage, priority);
            results.push(teamsResult);
        }

        // Log notification attempts
        const logEntry = {
            timestamp,
            alertType,
            subject,
            priority,
            metadata,
            results: results.map(r => ({ method: r.method, success: r.success, reason: r.reason }))
        };

        this.logNotification(logEntry);

        const successCount = results.filter(r => r.success).length;
        return {
            success: successCount > 0,
            totalChannels: results.length,
            successCount,
            results
        };
    }

    // Log notification attempts
    logNotification(logEntry) {
        try {
            const logDir = path.join(__dirname, '..', 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }

            const logFile = path.join(logDir, 'notification_alerts.log');
            const logLine = `${logEntry.timestamp} - ${JSON.stringify(logEntry)}\n`;
            
            fs.appendFileSync(logFile, logLine);
        } catch (error) {
            console.error('Failed to log notification:', error.message);
        }
    }

    // Predefined alert methods for common security events
    async alertIPBlocked(ip, attempts, blockDuration, endpoint, userAgent) {
        return await this.sendSecurityAlert(
            'IP_BLOCKED',
            `IP Address Blocked: ${ip}`,
            `An IP address has been automatically blocked due to suspicious activity.

The IP ${ip} has been blocked for ${blockDuration} minutes after ${attempts} failed login attempts.

This is an automated security response to protect the system from potential brute force attacks.`,
            'high',
            {
                ip,
                attempts,
                blockDuration: `${blockDuration} minutes`,
                endpoint,
                userAgent
            }
        );
    }

    async alertSQLInjectionAttempt(ip, payload, endpoint, userAgent) {
        return await this.sendSecurityAlert(
            'SQL_INJECTION',
            `SQL Injection Attempt Blocked`,
            `A SQL injection attack has been detected and blocked.

The attack originated from IP ${ip} and was automatically blocked by the Web Application Firewall (WAF).

Attack payload: ${payload.substring(0, 200)}${payload.length > 200 ? '...' : ''}`,
            'critical',
            {
                ip,
                endpoint,
                userAgent,
                payload: payload.substring(0, 500)
            }
        );
    }

    async alertPhishingAttempt(ip, domain, endpoint, headers) {
        return await this.sendSecurityAlert(
            'PHISHING_ATTEMPT',
            `Phishing Attack Detected`,
            `A phishing attempt has been detected and blocked.

The attack originated from IP ${ip} using suspicious domain: ${domain}

This appears to be an attempt to steal user credentials through domain spoofing.`,
            'high',
            {
                ip,
                domain,
                endpoint,
                suspiciousDomain: domain
            }
        );
    }

    async alertAppCloningAttempt(ip, reason, userAgent, headers) {
        return await this.sendSecurityAlert(
            'APP_CLONING',
            `App Cloning Attempt Detected`,
            `An unauthorized application clone has been detected and blocked.

The attempt originated from IP ${ip} and was blocked due to: ${reason}

This indicates someone may be trying to access the system using a cloned or unauthorized application.`,
            'high',
            {
                ip,
                reason,
                userAgent,
                blockReason: reason
            }
        );
    }

    async alertMassDataAccess(userId, recordCount, endpoint, userRole) {
        return await this.sendSecurityAlert(
            'MASS_DATA_ACCESS',
            `Suspicious Mass Data Access`,
            `Anomalous data access pattern detected.

User ID ${userId} (Role: ${userRole}) has accessed ${recordCount} records in a single request.

This may indicate data exfiltration or unauthorized bulk data access.`,
            'medium',
            {
                userId,
                recordCount,
                endpoint,
                userRole
            }
        );
    }

    // Test notification system
    async testNotifications() {
        console.log('Testing notification system...');
        
        const testResult = await this.sendSecurityAlert(
            'SYSTEM_TEST',
            'Notification System Test',
            'This is a test message to verify that the security alert notification system is working correctly.',
            'low',
            {
                testMode: true,
                timestamp: new Date().toISOString()
            }
        );

        console.log('Test notification results:', testResult);
        return testResult;
    }

    // Test email system specifically
    async testEmail() {
        console.log('Testing email system...');
        
        const testResult = await this.sendEmail(
            this.emailConfig.to,
            'Test Email',
            '<h1>Email system working</h1><p>This is a test email to verify the email service is functioning correctly.</p>'
        );

        console.log('Test email result:', testResult);
        return testResult;
    }
}
module.exports = NotificationService;
