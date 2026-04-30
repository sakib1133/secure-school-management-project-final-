const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const fs = require('fs');
const https = require('https');
const http = require('http');
const Razorpay = require('razorpay');
const QRCode = require('qrcode');
const NotificationService = require('./utils/notificationService');
const ChatbotService = require('./utils/chatbotService');
const NavigationChatbotService = require('./utils/navigationChatbotService');

// Load environment variables
require('dotenv').config();

// Validate required environment variables
function validateEnv() {
    const required = {
        'JWT_SECRET': 'JWT signing key',
        'SESSION_SECRET': 'Session encryption key',
        'ENCRYPTION_KEY': 'Data encryption key',
        'DB_URL': 'Database path'
    };

    const optional = {
        'SMTP_USER': 'SMTP username',
        'SMTP_PASS': 'SMTP password',
        'RAZORPAY_KEY_ID': 'Razorpay key ID',
        'RAZORPAY_KEY_SECRET': 'Razorpay secret'
    };

    let missing = [];
    let warnings = [];

    for (const [key, desc] of Object.entries(required)) {
        if (!process.env[key]) {
            missing.push(`${key} (${desc})`);
        }
    }

    for (const [key, desc] of Object.entries(optional)) {
        if (!process.env[key]) {
            warnings.push(`${key} (${desc})`);
        }
    }

    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:');
        missing.forEach(m => console.error(`   - ${m}`));
        console.error('\nPlease set these variables in your .env file and restart the server.');
        process.exit(1);
    }

    if (warnings.length > 0) {
        console.warn('⚠️  Optional environment variables not set:');
        warnings.forEach(w => console.warn(`   - ${w}`));
        console.warn('Some features may be disabled.\n');
    }

    console.log('✅ Environment variables validated successfully.\n');
}

validateEnv();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// Trust proxy for Render reverse proxy
app.set('trust proxy', 1);

// Initialize Notification Service
const notificationService = new NotificationService();

// Initialize Chatbot Service (will be initialized after database connection)
let chatbotService;
let navigationChatbotService;

// SSL Configuration for HTTPS
// Completely disable self-signed SSL on production platforms like Render that provide their own HTTPS
const SSL_CONFIG = {
    ENABLED: false, // Always disabled - use Render's built-in HTTPS
    KEY_PATH: process.env.SSL_KEY_PATH || './key.pem',
    CERT_PATH: process.env.SSL_CERT_PATH || './cert.pem',
    REDIRECT_HTTP: false
};

const otpEmailTransporter = (process.env.SMTP_USER && process.env.SMTP_PASS) ? nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
}) : null;

function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const trimmed = email.trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function generateEmailOtp() {
    return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

function hashOtp(otp, salt) {
    return crypto.createHash('sha256').update(`${salt}:${otp}`).digest('hex');
}

function generateStudentId() {
    return "STU-" + new Date().getFullYear() + "-" + Math.floor(1000 + Math.random() * 9000);
}

// Generate next admission number in format STU001, STU002, etc.
async function generateNextAdmissionNumber() {
    return new Promise((resolve, reject) => {
        db.get('SELECT next_sequence_number FROM admission_sequence WHERE id = 1', [], (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            
            const sequenceNumber = row ? row.next_sequence_number : 1;
            const admissionNumber = 'STU' + sequenceNumber.toString().padStart(3, '0');
            
            // Increment the sequence number
            db.run('UPDATE admission_sequence SET next_sequence_number = next_sequence_number + 1 WHERE id = 1', [], (updateErr) => {
                if (updateErr) {
                    reject(updateErr);
                    return;
                }
                resolve(admissionNumber);
            });
        });
    });
}

async function sendOtpEmail(toEmail, otp) {
    // Check if email alerts are enabled
    if (process.env.EMAIL_ALERTS_ENABLED !== 'true') {
        console.log('Development OTP:', otp);
        return { sent: true, development: true };
    }

    if (!otpEmailTransporter) {
        console.error('Email transporter not configured');
        return { sent: false, reason: 'SMTP not configured' };
    }

    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    const subject = 'Your OTP Code';
    const text = `Your OTP is: ${otp}\n\nValid for 5 minutes.`;

    try {
        console.log('Sending OTP to email...');
        await otpEmailTransporter.sendMail({
            from,
            to: toEmail,
            subject,
            text
        });
        console.log('Email sent successfully ✅');
        return { sent: true };
    } catch (error) {
        console.error('Email failed ❌:', error.message);
        return { sent: false, reason: error.message };
    }
}

// AES Encryption Configuration
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; // For AES, this is always 16

// Use encryption key from environment variable
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ? 
    Buffer.from(process.env.ENCRYPTION_KEY, 'hex') : 
    Buffer.from('a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456', 'hex');

// Helper function to encrypt text
function encrypt(text) {
    if (!text) return text;
    let iv = crypto.randomBytes(IV_LENGTH);
    let cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

// Helper function to decrypt text
function decrypt(text) {
    if (!text) return text;
    try {
        const raw = String(text);
        const textParts = raw.split(':');
        if (textParts.length < 2) return text;

        const ivHex = textParts.shift();
        const encryptedHex = textParts.join(':');

        if (!ivHex || ivHex.length !== IV_LENGTH * 2 || !/^[0-9a-fA-F]+$/.test(ivHex)) return text;
        if (!encryptedHex || encryptedHex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(encryptedHex)) return text;

        const iv = Buffer.from(ivHex, 'hex');
        const encryptedText = Buffer.from(encryptedHex, 'hex');
        if (iv.length !== IV_LENGTH || encryptedText.length === 0) return text;

        const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (err) {
        return text;
    }
}

// Logging Configuration
const LOG_FILE = './logs/app.log';
const LOGIN_LOG_FILE = './logs/login_attempts.log';
const IDS_LOG_FILE = './logs/ids_alerts.log';
const ADS_LOG_FILE = './logs/anomaly_alerts.log';
const WAF_LOG_FILE = './logs/waf_alerts.log';
const PHISHING_LOG_FILE = './logs/phishing_alerts.log';
const APP_CLONING_LOG_FILE = './logs/app_cloning_alerts.log';
const SESSION_LOG_FILE = './logs/session_alerts.log';

// Ensure logs directory exists
if (!fs.existsSync('./logs')) {
    fs.mkdirSync('./logs');
}

// IPS Configuration (Intrusion Prevention System)
const IPS_CONFIG = {
    ENABLED: true, // Re-enabled after testing
    MAX_FAILED_ATTEMPTS: 3,
    BLOCK_DURATION: 10 * 60 * 1000, // 10 minutes in milliseconds
    CLEANUP_INTERVAL: 2 * 60 * 1000  // 2 minutes cleanup interval
};

// ADS Configuration (Anomaly Detection System)
const ADS_CONFIG = {
    MASS_FETCH_THRESHOLD: 50,        // Records fetched in single request
    RAPID_REQUEST_THRESHOLD: 10,     // Requests per minute from same user
    BULK_OPERATION_THRESHOLD: 20,    // Bulk operations per session
    TIME_WINDOW: 60 * 1000,          // 1 minute window for rate limiting
    SUSPICIOUS_PATTERNS: {
        MASS_STUDENT_FETCH: 50,
        MASS_TEACHER_FETCH: 30,
        RAPID_LOGIN_ATTEMPTS: 5,
        BULK_DATA_EXPORT: 100
    }
};

// WAF Configuration (Web Application Firewall)
const WAF_CONFIG = {
    ENABLED: true,
    BLOCK_MODE: true, // true = block, false = log only
    SQL_INJECTION_PATTERNS: [
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b).*(\b(FROM|INTO|SET|WHERE|VALUES)\b)/i,
        /(\'.*(\bOR\b|\bAND\b).*\')/i,
        /(;.*(--))/,
        /(\/\*.*\*\/)/,
        /(UNION.*SELECT|SELECT.*FROM|INSERT.*INTO|UPDATE.*SET|DELETE.*FROM)/i,
        /(\bEXEC\b|\bEXECUTE\b).*(\(|\s)/i,
        /(\'.*\bOR\b.*\'.*=.*\')/i,
        /(--.*\w)/
    ],
    XSS_PATTERNS: [
        /<script[^>]*>.*?<\/script>/gi,
        /<iframe[^>]*>.*?<\/iframe>/gi,
        /<object[^>]*>.*?<\/object>/gi,
        /<embed[^>]*>/gi,
        /javascript:/gi,
        /on\w+\s*=/gi,
        /<img[^>]*src[^>]*=.*?javascript:/gi,
        /eval\s*\(/gi,
        /expression\s*\(/gi,
        /vbscript:/gi
    ],
    COMMON_ATTACKS: [
        /\.\.\//g, // Directory traversal
        /\/etc\/passwd/gi,
        /\/proc\/self\/environ/gi,
        /cmd\.exe/gi,
        /powershell/gi,
        /%00/g, // Null byte injection
        /%2e%2e%2f/gi // URL encoded directory traversal
    ]
};

// Anti-Phishing Configuration
const ANTI_PHISHING_CONFIG = {
    ENABLED: true,
    BLOCK_MODE: true, // true = block, false = log only
    ALLOWED_DOMAINS: process.env.ALLOWED_DOMAINS ? 
        process.env.ALLOWED_DOMAINS.split(',').map(d => d.trim()) : 
        ['localhost', '127.0.0.1', '.onrender.com', 'render.com'],
    ALLOWED_ORIGINS: process.env.CORS_ORIGINS ? 
        process.env.CORS_ORIGINS.split(',').map(o => o.trim()) : 
        ['http://localhost:3000', 'http://127.0.0.1:5500', 'https://*.onrender.com'],
    CHECK_REFERER: true,
    CHECK_ORIGIN: true,
    CHECK_HOST: true,
    SUSPICIOUS_PATTERNS: [
        /phishing/i,
        /fake/i,
        /scam/i,
        /malicious/i,
        /evil/i,
        /hack/i,
        /steal/i,
        /credential/i,
        /login.*fake/i,
        /secure.*bank/i
    ]
};

// App-Cloning Protection Configuration
const APP_CLONING_CONFIG = {
    ENABLED: false,
    BLOCK_MODE: false, // true = block, false = log only
    APP_SIGNATURE: 'SchoolMgmt-v1.0-2025', // Unique app identifier
    REQUIRED_HEADERS: {
        'X-App-Signature': 'SchoolMgmt-Auth-Token',
        'X-App-Version': '1.0.0',
        'X-App-Build': 'prod-2025-001'
    },
    OPTIONAL_HEADERS: {
        'X-Client-Type': 'official-client',
        'X-App-Checksum': null // Will be calculated dynamically
    },
    FINGERPRINT_CHECKS: {
        USER_AGENT_PATTERNS: [
            /SchoolManagement\/1\.0/,
            /OfficialClient\/1\.0/
        ],
        SUSPICIOUS_AGENTS: [
            /bot/i,
            /crawler/i,
            /scraper/i,
            /clone/i,
            /copy/i,
            /fake/i,
            /unauthorized/i
        ]
    },
    TIMING_CHECKS: {
        MIN_REQUEST_INTERVAL: 100, // Minimum ms between requests
        MAX_REQUESTS_PER_MINUTE: 60
    }
};

// Session Timeout Configuration
const SESSION_CONFIG = {
    ENABLED: true,
    DEFAULT_TIMEOUT: 30 * 60 * 1000, // 30 minutes in milliseconds
    ROLE_TIMEOUTS: {
        'admin': 60 * 60 * 1000,      // 1 hour for admins
        'teacher': 45 * 60 * 1000,    // 45 minutes for teachers
        'student': 30 * 60 * 1000     // 30 minutes for students
    },
    WARNING_THRESHOLD: 5 * 60 * 1000, // 5 minutes warning before expiry
    AUTO_REFRESH_ENABLED: true,
    MAX_REFRESH_COUNT: 3,             // Maximum token refreshes per session
    CLEANUP_INTERVAL: 10 * 60 * 1000  // 10 minutes cleanup interval
};

// IDS Data Structures
const failedAttempts = new Map(); // IP -> { count, firstAttempt, lastAttempt }
const blockedIPs = new Map();     // IP -> { blockedAt, expiresAt, reason }

// ADS Data Structures
const userActivity = new Map();   // userId -> { requests: [], operations: [], lastActivity }
const anomalyPatterns = new Map(); // pattern -> { count, lastDetected, severity }

// WAF Data Structures
const wafStats = new Map(); // attackType -> { count, lastDetected, blockedIPs: Set() }

// Anti-Phishing Data Structures
const phishingStats = new Map(); // attackType -> { count, lastDetected, blockedIPs: Set() }

// App-Cloning Protection Data Structures
const appCloningStats = new Map(); // attackType -> { count, lastDetected, blockedIPs: Set() }
const clientFingerprints = new Map(); // clientIP -> { lastRequest, requestCount, fingerprint }
const requestTimings = new Map(); // clientIP -> { timestamps: [], violations: 0 }

// Session Management Data Structures
const activeSessions = new Map(); // sessionId -> { userId, username, role, issuedAt, lastActivity, refreshCount, expiresAt }
const sessionStats = new Map(); // eventType -> { count, lastOccurred }

// Session Management Functions
function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

function getSessionTimeout(role) {
    return SESSION_CONFIG.ROLE_TIMEOUTS[role] || SESSION_CONFIG.DEFAULT_TIMEOUT;
}

function createSession(userId, username, role) {
    const sessionId = generateSessionId();
    const now = Date.now();
    const timeout = getSessionTimeout(role);
    
    const session = {
        userId,
        username,
        role,
        issuedAt: now,
        lastActivity: now,
        refreshCount: 0,
        expiresAt: now + timeout
    };
    
    activeSessions.set(sessionId, session);
    updateSessionStats('SESSION_CREATED');
    
    writeLog(SESSION_LOG_FILE, `SESSION_CREATED: User ${username} (${role}) - SessionId: ${sessionId} - Expires: ${new Date(session.expiresAt).toISOString()}`);
    
    return sessionId;
}

function validateSession(sessionId) {
    if (!SESSION_CONFIG.ENABLED) {
        return { valid: true };
    }
    
    const session = activeSessions.get(sessionId);
    if (!session) {
        updateSessionStats('SESSION_NOT_FOUND');
        return { valid: false, reason: 'SESSION_NOT_FOUND' };
    }
    
    const now = Date.now();
    
    // Check if session has expired
    if (now > session.expiresAt) {
        activeSessions.delete(sessionId);
        updateSessionStats('SESSION_EXPIRED');
        writeLog(SESSION_LOG_FILE, `SESSION_EXPIRED: User ${session.username} (${session.role}) - SessionId: ${sessionId} - Expired at: ${new Date(session.expiresAt).toISOString()}`);
        return { valid: false, reason: 'SESSION_EXPIRED' };
    }
    
    // Update last activity
    session.lastActivity = now;
    updateSessionStats('SESSION_ACTIVITY');
    
    // Check if session is close to expiring (warning threshold)
    const timeUntilExpiry = session.expiresAt - now;
    if (timeUntilExpiry <= SESSION_CONFIG.WARNING_THRESHOLD) {
        return { 
            valid: true, 
            session, 
            warning: true, 
            timeUntilExpiry,
            canRefresh: SESSION_CONFIG.AUTO_REFRESH_ENABLED && session.refreshCount < SESSION_CONFIG.MAX_REFRESH_COUNT
        };
    }
    
    return { valid: true, session };
}

function refreshSession(sessionId) {
    if (!SESSION_CONFIG.AUTO_REFRESH_ENABLED) {
        return { success: false, reason: 'REFRESH_DISABLED' };
    }
    
    const session = activeSessions.get(sessionId);
    if (!session) {
        return { success: false, reason: 'SESSION_NOT_FOUND' };
    }
    
    if (session.refreshCount >= SESSION_CONFIG.MAX_REFRESH_COUNT) {
        return { success: false, reason: 'MAX_REFRESH_EXCEEDED' };
    }
    
    const now = Date.now();
    const timeout = getSessionTimeout(session.role);
    
    session.refreshCount++;
    session.lastActivity = now;
    session.expiresAt = now + timeout;
    
    updateSessionStats('SESSION_REFRESHED');
    writeLog(SESSION_LOG_FILE, `SESSION_REFRESHED: User ${session.username} (${session.role}) - SessionId: ${sessionId} - Refresh #${session.refreshCount} - New expiry: ${new Date(session.expiresAt).toISOString()}`);
    
    return { success: true, session, newExpiresAt: session.expiresAt };
}

function cleanupExpiredSessions() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [sessionId, session] of activeSessions.entries()) {
        if (now > session.expiresAt) {
            activeSessions.delete(sessionId);
            cleanedCount++;
            writeLog(SESSION_LOG_FILE, `SESSION_CLEANUP: Removed expired session for ${session.username} (${session.role}) - SessionId: ${sessionId}`);
        }
    }
    
    if (cleanedCount > 0) {
        updateSessionStats('SESSION_CLEANUP');
        writeLog(SESSION_LOG_FILE, `SESSION_CLEANUP: Removed ${cleanedCount} expired sessions`);
    }
    
    return cleanedCount;
}

function updateSessionStats(eventType) {
    const stats = sessionStats.get(eventType) || { count: 0, lastOccurred: null };
    stats.count++;
    stats.lastOccurred = Date.now();
    sessionStats.set(eventType, stats);
}

function getSessionStatistics() {
    const activeSessCount = activeSessions.size;
    const stats = {};
    
    for (const [eventType, data] of sessionStats.entries()) {
        stats[eventType] = {
            count: data.count,
            lastOccurred: data.lastOccurred ? new Date(data.lastOccurred).toISOString() : null
        };
    }
    
    return {
        activeSessions: activeSessCount,
        statistics: stats,
        config: {
            enabled: SESSION_CONFIG.ENABLED,
            defaultTimeout: SESSION_CONFIG.DEFAULT_TIMEOUT,
            roleTimeouts: SESSION_CONFIG.ROLE_TIMEOUTS,
            autoRefreshEnabled: SESSION_CONFIG.AUTO_REFRESH_ENABLED,
            maxRefreshCount: SESSION_CONFIG.MAX_REFRESH_COUNT
        }
    };
}

// IDS Functions
function trackFailedLogin(clientIP, username, reason, userAgent = 'Unknown') {
    const now = Date.now();
    
    if (!failedAttempts.has(clientIP)) {
        failedAttempts.set(clientIP, {
            count: 0,
            firstAttempt: now,
            lastAttempt: now,
            usernames: [],
            lastUserAgent: userAgent
        });
    }
    
    const attempts = failedAttempts.get(clientIP);
    attempts.count++;
    attempts.lastAttempt = now;
    attempts.lastUserAgent = userAgent;
    
    // Track unique usernames attempted
    if (!attempts.usernames.includes(username)) {
        attempts.usernames.push(username);
    }
    
    // Check if threshold reached
    if (attempts.count >= IPS_CONFIG.MAX_FAILED_ATTEMPTS) {
        blockIP(clientIP, attempts);
    }
}

async function blockIP(clientIP, attempts) {
    const now = Date.now();
    const expiresAt = now + IPS_CONFIG.BLOCK_DURATION;
    const blockDurationMinutes = IPS_CONFIG.BLOCK_DURATION / 1000 / 60;
    
    blockedIPs.set(clientIP, {
        blockedAt: now,
        expiresAt: expiresAt,
        reason: `Brute-force attack detected: ${attempts.count} failed login attempts`,
        usernames: attempts.usernames,
        totalAttempts: attempts.count
    });
    
    // Log IPS alert
    const alertMessage = `IPS_AUTO_BLOCK: IP ${clientIP} blocked for ${blockDurationMinutes} minutes - ${attempts.count} failed attempts on usernames: ${attempts.usernames.join(', ')}`;
    writeLog(IDS_LOG_FILE, alertMessage);
    console.log(`🛡️ IPS AUTO-BLOCK: ${alertMessage}`);
    
    // Send security alert notification
    try {
        await notificationService.alertIPBlocked(
            clientIP,
            attempts.count,
            blockDurationMinutes,
            '/api/login',
            attempts.lastUserAgent || 'Unknown'
        );
        console.log(`📧 Security alert sent for blocked IP: ${clientIP}`);
    } catch (error) {
        console.error('Failed to send IP block notification:', error.message);
        writeLog(IDS_LOG_FILE, `NOTIFICATION_FAILED: Could not send alert for blocked IP ${clientIP} - ${error.message}`);
    }
    
    // Clear failed attempts for this IP since it's now blocked
    failedAttempts.delete(clientIP);
}

function isIPBlocked(clientIP) {
    if (!blockedIPs.has(clientIP)) {
        return false;
    }
    
    const blockInfo = blockedIPs.get(clientIP);
    const now = Date.now();
    
    if (now > blockInfo.expiresAt) {
        // Block expired, remove it
        blockedIPs.delete(clientIP);
        writeLog(IDS_LOG_FILE, `BLOCK_EXPIRED: IP ${clientIP} unblocked after timeout`);
        console.log(`🔓 IDS: IP ${clientIP} unblocked after timeout`);
        return false;
    }
    
    return true;
}

function getBlockInfo(clientIP) {
    return blockedIPs.get(clientIP);
}

// Cleanup expired blocks and old failed attempts
function cleanupIDS() {
    const now = Date.now();
    
    // Clean expired blocks
    for (const [ip, blockInfo] of blockedIPs.entries()) {
        if (now > blockInfo.expiresAt) {
            blockedIPs.delete(ip);
            writeLog(IDS_LOG_FILE, `CLEANUP: Expired block removed for IP ${ip}`);
        }
    }
    
    // Clean old failed attempts (older than block duration)
    for (const [ip, attempts] of failedAttempts.entries()) {
        if (now - attempts.lastAttempt > IPS_CONFIG.BLOCK_DURATION) {
            failedAttempts.delete(ip);
        }
    }
}

// ADS Functions
function trackUserActivity(userId, operation, details) {
    const now = Date.now();
    
    if (!userActivity.has(userId)) {
        userActivity.set(userId, {
            requests: [],
            operations: [],
            lastActivity: now,
            sessionStart: now
        });
    }
    
    const activity = userActivity.get(userId);
    activity.requests.push({ timestamp: now, operation, details });
    activity.operations.push(operation);
    activity.lastActivity = now;
    
    // Keep only recent activity (last hour)
    const oneHourAgo = now - (60 * 60 * 1000);
    activity.requests = activity.requests.filter(req => req.timestamp > oneHourAgo);
    activity.operations = activity.operations.filter((op, index) => 
        activity.requests[index] && activity.requests[index].timestamp > oneHourAgo
    );
    
    // Check for anomalies
    checkForAnomalies(userId, activity, operation, details);
}

function checkForAnomalies(userId, activity, operation, details) {
    const now = Date.now();
    const recentRequests = activity.requests.filter(req => 
        now - req.timestamp < ADS_CONFIG.TIME_WINDOW
    );
    
    // Check for mass data fetch anomalies
    if (operation === 'FETCH_STUDENTS' && details.count >= ADS_CONFIG.SUSPICIOUS_PATTERNS.MASS_STUDENT_FETCH) {
        logAnomaly('MASS_STUDENT_FETCH', userId, {
            operation,
            recordCount: details.count,
            severity: 'HIGH',
            description: `User fetched ${details.count} student records in single request`
        });
    }
    
    if (operation === 'FETCH_TEACHERS' && details.count >= ADS_CONFIG.SUSPICIOUS_PATTERNS.MASS_TEACHER_FETCH) {
        logAnomaly('MASS_TEACHER_FETCH', userId, {
            operation,
            recordCount: details.count,
            severity: 'MEDIUM',
            description: `User fetched ${details.count} teacher records in single request`
        });
    }
    
    // Check for rapid request patterns
    if (recentRequests.length >= ADS_CONFIG.RAPID_REQUEST_THRESHOLD) {
        logAnomaly('RAPID_REQUESTS', userId, {
            operation: 'MULTIPLE',
            requestCount: recentRequests.length,
            timeWindow: ADS_CONFIG.TIME_WINDOW / 1000,
            severity: 'MEDIUM',
            description: `${recentRequests.length} requests in ${ADS_CONFIG.TIME_WINDOW/1000} seconds`
        });
    }
    
    // Check for bulk operations
    const bulkOps = activity.operations.filter(op => 
        ['CREATE_BULK', 'UPDATE_BULK', 'DELETE_BULK', 'EXPORT_BULK'].includes(op)
    );
    if (bulkOps.length >= ADS_CONFIG.BULK_OPERATION_THRESHOLD) {
        logAnomaly('BULK_OPERATIONS', userId, {
            operation: 'BULK_MULTIPLE',
            operationCount: bulkOps.length,
            severity: 'HIGH',
            description: `${bulkOps.length} bulk operations detected in session`
        });
    }
}

function logAnomaly(patternType, userId, details) {
    const now = Date.now();
    
    // Update anomaly pattern tracking
    if (!anomalyPatterns.has(patternType)) {
        anomalyPatterns.set(patternType, { count: 0, lastDetected: 0, severity: details.severity });
    }
    
    const pattern = anomalyPatterns.get(patternType);
    pattern.count++;
    pattern.lastDetected = now;
    
    // Log anomaly alert
    const alertMessage = `ADS_ANOMALY_DETECTED: ${patternType} - User: ${userId} - ${details.description} - Severity: ${details.severity}`;
    writeLog(ADS_LOG_FILE, alertMessage);
    console.log(`🔍 ADS ALERT: ${alertMessage}`);
    
    // Log detailed information
    const detailMessage = `ADS_DETAILS: Pattern: ${patternType}, User: ${userId}, Operation: ${details.operation}, Count: ${details.recordCount || details.requestCount || details.operationCount}, Severity: ${details.severity}`;
    writeLog(ADS_LOG_FILE, detailMessage);
}

function cleanupADS() {
    const now = Date.now();
    const cleanupThreshold = 24 * 60 * 60 * 1000; // 24 hours
    
    // Clean old user activity
    for (const [userId, activity] of userActivity.entries()) {
        if (now - activity.lastActivity > cleanupThreshold) {
            userActivity.delete(userId);
        }
    }
    
    // Clean old anomaly patterns (keep for analysis)
    for (const [pattern, data] of anomalyPatterns.entries()) {
        if (now - data.lastDetected > cleanupThreshold * 7) { // Keep for 7 days
            anomalyPatterns.delete(pattern);
        }
    }
}

// WAF Functions
function detectSQLInjection(input) {
    if (!input || typeof input !== 'string') return false;
    
    for (const pattern of WAF_CONFIG.SQL_INJECTION_PATTERNS) {
        if (pattern.test(input)) {
            return true;
        }
    }
    return false;
}

function detectXSS(input) {
    if (!input || typeof input !== 'string') return false;
    
    for (const pattern of WAF_CONFIG.XSS_PATTERNS) {
        if (pattern.test(input)) {
            return true;
        }
    }
    return false;
}

function detectCommonAttacks(input) {
    if (!input || typeof input !== 'string') return false;
    
    for (const pattern of WAF_CONFIG.COMMON_ATTACKS) {
        if (pattern.test(input)) {
            return true;
        }
    }
    return false;
}

async function logWAFAlert(attackType, clientIP, payload, blocked = true) {
    const now = Date.now();
    
    // Update WAF statistics
    if (!wafStats.has(clientIP)) {
        wafStats.set(clientIP, {
            totalBlocked: 0,
            attackTypes: new Set(),
            firstSeen: now,
            lastSeen: now
        });
    }
    
    const stats = wafStats.get(clientIP);
    stats.totalBlocked++;
    stats.attackTypes.add(attackType);
    stats.lastSeen = now;
    
    const alertMessage = `WAF_${blocked ? 'BLOCKED' : 'DETECTED'}: ${attackType} from ${clientIP} - Payload: ${payload.substring(0, 200)}${payload.length > 200 ? '...' : ''}`;
    writeLog(WAF_LOG_FILE, alertMessage);
    console.log(`🛡️ WAF: ${alertMessage}`);
    
    // Send security alert notification for critical attacks
    if (blocked && (attackType.includes('SQL_INJECTION') || attackType.includes('XSS'))) {
        try {
            if (attackType.includes('SQL_INJECTION')) {
                await notificationService.alertSQLInjectionAttempt(
                    clientIP,
                    payload,
                    'Multiple endpoints',
                    'Unknown'
                );
            } else {
                await notificationService.sendSecurityAlert(
                    'XSS_ATTACK',
                    `XSS Attack Blocked from ${clientIP}`,
                    `A Cross-Site Scripting (XSS) attack has been detected and blocked by the Web Application Firewall.

Attack Type: ${attackType}
Source IP: ${clientIP}
Payload: ${payload.substring(0, 300)}${payload.length > 300 ? '...' : ''}

This attack was automatically blocked to protect users from malicious script injection.`,
                    'high',
                    {
                        ip: clientIP,
                        attackType,
                        payload: payload.substring(0, 500)
                    }
                );
            }
            console.log(`📧 Security alert sent for WAF block: ${attackType} from ${clientIP}`);
        } catch (error) {
            console.error('Failed to send WAF notification:', error.message);
            writeLog(WAF_LOG_FILE, `NOTIFICATION_FAILED: Could not send alert for ${attackType} from ${clientIP} - ${error.message}`);
        }
    }
}

function wafMiddleware(req, res, next) {
    if (!WAF_CONFIG.ENABLED) {
        return next();
    }
    
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const method = req.method;
    const url = req.url;
    
    // Check URL for attacks
    if (detectSQLInjection(url)) {
        logWAFAlert('SQL_INJECTION_URL', clientIP, url, WAF_CONFIG.BLOCK_MODE);
        if (WAF_CONFIG.BLOCK_MODE) {
            return res.status(403).json({
                status: 'blocked',
                message: 'Request blocked by WAF: SQL injection detected in URL',
                code: 'WAF_SQL_INJECTION'
            });
        }
    }
    
    if (detectXSS(url)) {
        logWAFAlert('XSS_URL', clientIP, url, WAF_CONFIG.BLOCK_MODE);
        if (WAF_CONFIG.BLOCK_MODE) {
            return res.status(403).json({
                status: 'blocked',
                message: 'Request blocked by WAF: XSS detected in URL',
                code: 'WAF_XSS'
            });
        }
    }
    
    if (detectCommonAttacks(url)) {
        logWAFAlert('COMMON_ATTACK_URL', clientIP, url, WAF_CONFIG.BLOCK_MODE);
        if (WAF_CONFIG.BLOCK_MODE) {
            return res.status(403).json({
                status: 'blocked',
                message: 'Request blocked by WAF: Malicious pattern detected in URL',
                code: 'WAF_COMMON_ATTACK'
            });
        }
    }
    
    // Check query parameters
    for (const [key, value] of Object.entries(req.query || {})) {
        const queryValue = String(value);
        
        if (detectSQLInjection(queryValue)) {
            logWAFAlert('SQL_INJECTION_QUERY', clientIP, `${key}=${queryValue}`, WAF_CONFIG.BLOCK_MODE);
            if (WAF_CONFIG.BLOCK_MODE) {
                return res.status(403).json({
                    status: 'blocked',
                    message: 'Request blocked by WAF: SQL injection detected in query parameters',
                    code: 'WAF_SQL_INJECTION'
                });
            }
        }
        
        if (detectXSS(queryValue)) {
            logWAFAlert('XSS_QUERY', clientIP, `${key}=${queryValue}`, WAF_CONFIG.BLOCK_MODE);
            if (WAF_CONFIG.BLOCK_MODE) {
                return res.status(403).json({
                    status: 'blocked',
                    message: 'Request blocked by WAF: XSS detected in query parameters',
                    code: 'WAF_XSS'
                });
            }
        }
        
        if (detectCommonAttacks(queryValue)) {
            logWAFAlert('COMMON_ATTACK_QUERY', clientIP, `${key}=${queryValue}`, WAF_CONFIG.BLOCK_MODE);
            if (WAF_CONFIG.BLOCK_MODE) {
                return res.status(403).json({
                    status: 'blocked',
                    message: 'Request blocked by WAF: Malicious pattern detected in query parameters',
                    code: 'WAF_COMMON_ATTACK'
                });
            }
        }
    }
    
    // Check request body for POST/PUT requests
    if ((method === 'POST' || method === 'PUT') && req.body) {
        const bodyStr = JSON.stringify(req.body);
        
        if (detectSQLInjection(bodyStr)) {
            logWAFAlert('SQL_INJECTION_BODY', clientIP, bodyStr, WAF_CONFIG.BLOCK_MODE);
            if (WAF_CONFIG.BLOCK_MODE) {
                return res.status(403).json({
                    status: 'blocked',
                    message: 'Request blocked by WAF: SQL injection detected in request body',
                    code: 'WAF_SQL_INJECTION'
                });
            }
        }
        
        if (detectXSS(bodyStr)) {
            logWAFAlert('XSS_BODY', clientIP, bodyStr, WAF_CONFIG.BLOCK_MODE);
            if (WAF_CONFIG.BLOCK_MODE) {
                return res.status(403).json({
                    status: 'blocked',
                    message: 'Request blocked by WAF: XSS detected in request body',
                    code: 'WAF_XSS'
                });
            }
        }
        
        if (detectCommonAttacks(bodyStr)) {
            logWAFAlert('COMMON_ATTACK_BODY', clientIP, bodyStr, WAF_CONFIG.BLOCK_MODE);
            if (WAF_CONFIG.BLOCK_MODE) {
                return res.status(403).json({
                    status: 'blocked',
                    message: 'Request blocked by WAF: Malicious pattern detected in request body',
                    code: 'WAF_COMMON_ATTACK'
                });
            }
        }
    }
    
    // Check headers for attacks (selective cookie checking - allow rzp_/razorpay cookies)
    for (const [headerName, headerValue] of Object.entries(req.headers || {})) {
        const headerStr = String(headerValue);
        const lowerHeaderName = headerName.toLowerCase();

        // For cookie header, check each cookie individually
        if (lowerHeaderName === 'cookie') {
            const cookies = headerStr.split(';');
            let hasSuspiciousCookie = false;
            let suspiciousCookieDetails = '';

            for (const cookie of cookies) {
                const cookieName = cookie.split('=')[0].trim().toLowerCase();
                const cookieValue = cookie.substring(cookie.indexOf('=') + 1).trim();

                // Skip whitelisted cookies (Razorpay cookies)
                if (cookieName.startsWith('rzp_') || cookieName.includes('razorpay')) {
                    continue;
                }

                // Check non-whitelisted cookies for XSS
                if (detectXSS(cookieValue)) {
                    hasSuspiciousCookie = true;
                    suspiciousCookieDetails = `${cookieName}: ${cookieValue.substring(0, 50)}...`;
                    break;
                }

                // Check non-whitelisted cookies for common attacks
                if (detectCommonAttacks(cookieValue)) {
                    hasSuspiciousCookie = true;
                    suspiciousCookieDetails = `${cookieName}: ${cookieValue.substring(0, 50)}...`;
                    break;
                }
            }

            if (hasSuspiciousCookie) {
                // Log but allow from localhost (still logged for monitoring)
                const isLocalhost = clientIP === '::1' || clientIP === '127.0.0.1';
                logWAFAlert('XSS_COOKIE', clientIP, suspiciousCookieDetails, WAF_CONFIG.BLOCK_MODE && !isLocalhost);

                if (WAF_CONFIG.BLOCK_MODE && !isLocalhost) {
                    return res.status(403).json({
                        status: 'blocked',
                        message: 'Request blocked by WAF: Suspicious cookie detected',
                        code: 'WAF_COOKIE'
                    });
                }
            }
            continue; // Skip regular header checking for cookie header
        }

        // Regular header checking
        if (detectXSS(headerStr)) {
            logWAFAlert('XSS_HEADER', clientIP, `${headerName}: ${headerStr}`, WAF_CONFIG.BLOCK_MODE);
            if (WAF_CONFIG.BLOCK_MODE) {
                return res.status(403).json({
                    status: 'blocked',
                    message: 'Request blocked by WAF: XSS detected in headers',
                    code: 'WAF_XSS'
                });
            }
        }

        if (detectCommonAttacks(headerStr)) {
            logWAFAlert('COMMON_ATTACK_HEADER', clientIP, `${headerName}: ${headerStr}`, WAF_CONFIG.BLOCK_MODE);
            if (WAF_CONFIG.BLOCK_MODE) {
                return res.status(403).json({
                    status: 'blocked',
                    message: 'Request blocked by WAF: Malicious pattern detected in headers',
                    code: 'WAF_COMMON_ATTACK'
                });
            }
        }
    }
    
    next();
}

function cleanupWAF() {
    const now = Date.now();
    const cleanupThreshold = 24 * 60 * 60 * 1000; // 24 hours
    
    // Clean old WAF statistics (keep for analysis)
    for (const [attackType, stats] of wafStats.entries()) {
        if (now - stats.lastDetected > cleanupThreshold * 7) { // Keep for 7 days
            wafStats.delete(attackType);
        }
    }
}

// Anti-Phishing Functions
function isValidDomain(domain) {
    if (!domain) return false;
    const domainLower = domain.toLowerCase();
    const allowedDomains = ANTI_PHISHING_CONFIG.ALLOWED_DOMAINS;
    
    for (const allowed of allowedDomains) {
        if (allowed.startsWith('.')) {
            // Wildcard subdomain matching (e.g., .onrender.com matches any.onrender.com)
            if (domainLower === allowed.slice(1) || domainLower.endsWith(allowed)) {
                return true;
            }
        } else if (allowed === domainLower) {
            return true;
        }
    }
    return false;
}

function isValidOrigin(origin) {
    if (!origin) return false;
    const originLower = origin.toLowerCase();
    const allowedOrigins = ANTI_PHISHING_CONFIG.ALLOWED_ORIGINS;
    
    for (const allowed of allowedOrigins) {
        if (allowed.includes('*')) {
            // Wildcard matching (e.g., https://*.onrender.com)
            const pattern = allowed.replace('*', '.*');
            const regex = new RegExp('^' + pattern + '$');
            if (regex.test(originLower)) {
                return true;
            }
        } else if (allowed === originLower) {
            return true;
        }
    }
    return false;
}

function detectSuspiciousDomain(domain) {
    if (!domain) return false;
    
    for (const pattern of ANTI_PHISHING_CONFIG.SUSPICIOUS_PATTERNS) {
        if (pattern.test(domain)) {
            return true;
        }
    }
    return false;
}

function extractDomainFromUrl(url) {
    if (!url) return null;
    try {
        const urlObj = new URL(url);
        return urlObj.hostname + (urlObj.port ? ':' + urlObj.port : '');
    } catch (e) {
        return null;
    }
}

async function logPhishingAlert(alertType, clientIP, details, blocked = true) {
    const now = Date.now();
    
    // Update phishing statistics
    if (!phishingStats.has(alertType)) {
        phishingStats.set(alertType, { count: 0, lastDetected: 0, blockedIPs: new Set() });
    }
    
    const stats = phishingStats.get(alertType);
    stats.count++;
    stats.lastDetected = now;
    stats.blockedIPs.add(clientIP);
    
    const alertMessage = `ANTI_PHISHING_${blocked ? 'BLOCKED' : 'DETECTED'}: ${alertType} from ${clientIP} - Details: ${JSON.stringify(details)}`;
    writeLog(PHISHING_LOG_FILE, alertMessage);
    console.log(`🎣 Anti-Phishing: ${alertMessage}`);
    
    // Send security alert notification for phishing attempts
    if (blocked) {
        try {
            await notificationService.alertPhishingAttempt(
                clientIP,
                details.domain || details.host || 'Unknown',
                details.endpoint || '/api/login',
                details
            );
            console.log(`📧 Security alert sent for phishing attempt: ${alertType} from ${clientIP}`);
        } catch (error) {
            console.error('Failed to send phishing notification:', error.message);
            writeLog(PHISHING_LOG_FILE, `NOTIFICATION_FAILED: Could not send alert for ${alertType} from ${clientIP} - ${error.message}`);
        }
    }
}

function antiPhishingMiddleware(req, res, next) {
    if (!ANTI_PHISHING_CONFIG.ENABLED) {
        return next();
    }
    
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const host = req.get('host');
    const origin = req.get('origin');
    const referer = req.get('referer');
    const userAgent = req.get('user-agent') || '';
    
    // Check Host header
    if (ANTI_PHISHING_CONFIG.CHECK_HOST && host) {
        if (!isValidDomain(host)) {
            logPhishingAlert('INVALID_HOST', clientIP, { 
                host, 
                endpoint: req.originalUrl,
                userAgent: userAgent.substring(0, 100)
            }, ANTI_PHISHING_CONFIG.BLOCK_MODE);
            
            if (ANTI_PHISHING_CONFIG.BLOCK_MODE) {
                return res.status(403).json({
                    status: 'blocked',
                    message: 'Request blocked: Invalid host domain detected',
                    code: 'PHISHING_INVALID_HOST'
                });
            }
        }
        
        if (detectSuspiciousDomain(host)) {
            logPhishingAlert('SUSPICIOUS_HOST', clientIP, { 
                host, 
                endpoint: req.originalUrl,
                userAgent: userAgent.substring(0, 100)
            }, ANTI_PHISHING_CONFIG.BLOCK_MODE);
            
            if (ANTI_PHISHING_CONFIG.BLOCK_MODE) {
                return res.status(403).json({
                    status: 'blocked',
                    message: 'Request blocked: Suspicious domain pattern detected',
                    code: 'PHISHING_SUSPICIOUS_DOMAIN'
                });
            }
        }
    }
    
    // Check Origin header
    if (ANTI_PHISHING_CONFIG.CHECK_ORIGIN && origin) {
        if (!isValidOrigin(origin)) {
            const originDomain = extractDomainFromUrl(origin);
            logPhishingAlert('INVALID_ORIGIN', clientIP, { 
                origin, 
                domain: originDomain,
                endpoint: req.originalUrl,
                userAgent: userAgent.substring(0, 100)
            }, ANTI_PHISHING_CONFIG.BLOCK_MODE);
            
            if (ANTI_PHISHING_CONFIG.BLOCK_MODE) {
                return res.status(403).json({
                    status: 'blocked',
                    message: 'Request blocked: Invalid origin domain detected',
                    code: 'PHISHING_INVALID_ORIGIN'
                });
            }
        }
    }
    
    // Check Referer header
    if (ANTI_PHISHING_CONFIG.CHECK_REFERER && referer) {
        const refererDomain = extractDomainFromUrl(referer);
        if (refererDomain && !isValidDomain(refererDomain)) {
            logPhishingAlert('INVALID_REFERER', clientIP, { 
                referer, 
                domain: refererDomain,
                endpoint: req.originalUrl,
                userAgent: userAgent.substring(0, 100)
            }, ANTI_PHISHING_CONFIG.BLOCK_MODE);
            
            if (ANTI_PHISHING_CONFIG.BLOCK_MODE) {
                return res.status(403).json({
                    status: 'blocked',
                    message: 'Request blocked: Invalid referer domain detected',
                    code: 'PHISHING_INVALID_REFERER'
                });
            }
        }
        
        if (refererDomain && detectSuspiciousDomain(refererDomain)) {
            logPhishingAlert('SUSPICIOUS_REFERER', clientIP, { 
                referer, 
                domain: refererDomain,
                endpoint: req.originalUrl,
                userAgent: userAgent.substring(0, 100)
            }, ANTI_PHISHING_CONFIG.BLOCK_MODE);
            
            if (ANTI_PHISHING_CONFIG.BLOCK_MODE) {
                return res.status(403).json({
                    status: 'blocked',
                    message: 'Request blocked: Suspicious referer domain detected',
                    code: 'PHISHING_SUSPICIOUS_REFERER'
                });
            }
        }
    }
    
    next();
}

function cleanupPhishing() {
    const now = Date.now();
    const cleanupThreshold = 24 * 60 * 60 * 1000; // 24 hours
    
    // Clean old phishing statistics (keep for analysis)
    for (const [alertType, stats] of phishingStats.entries()) {
        if (now - stats.lastDetected > cleanupThreshold * 7) { // Keep for 7 days
            phishingStats.delete(alertType);
        }
    }
}

// App-Cloning Protection Functions
function generateAppChecksum(req) {
    const data = {
        userAgent: req.get('user-agent') || '',
        timestamp: Math.floor(Date.now() / 60000), // Round to minute
        signature: APP_CLONING_CONFIG.APP_SIGNATURE
    };
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').substring(0, 16);
}

function validateAppSignature(req) {
    const requiredHeaders = APP_CLONING_CONFIG.REQUIRED_HEADERS;
    
    for (const [headerName, expectedValue] of Object.entries(requiredHeaders)) {
        const headerValue = req.get(headerName);
        if (!headerValue || headerValue !== expectedValue) {
            return {
                valid: false,
                reason: `Missing or invalid header: ${headerName}`,
                expected: expectedValue,
                received: headerValue || 'missing'
            };
        }
    }
    
    return { valid: true };
}

function validateUserAgent(userAgent) {
    if (!userAgent) {
        return { valid: false, reason: 'Missing User-Agent header' };
    }
    
    // Check for suspicious patterns
    for (const pattern of APP_CLONING_CONFIG.FINGERPRINT_CHECKS.SUSPICIOUS_AGENTS) {
        if (pattern.test(userAgent)) {
            return { 
                valid: false, 
                reason: 'Suspicious User-Agent pattern detected',
                pattern: pattern.toString()
            };
        }
    }
    
    // Check for official patterns (optional - can be relaxed)
    const hasOfficialPattern = APP_CLONING_CONFIG.FINGERPRINT_CHECKS.USER_AGENT_PATTERNS.some(
        pattern => pattern.test(userAgent)
    );
    
    return { 
        valid: true, 
        isOfficial: hasOfficialPattern,
        userAgent: userAgent.substring(0, 100) // Truncate for logging
    };
}

function checkRequestTiming(clientIP) {
    const now = Date.now();
    
    if (!requestTimings.has(clientIP)) {
        requestTimings.set(clientIP, { timestamps: [now], violations: 0 });
        return { valid: true };
    }
    
    const timing = requestTimings.get(clientIP);
    const oneMinuteAgo = now - 60000;
    
    // Clean old timestamps
    timing.timestamps = timing.timestamps.filter(ts => ts > oneMinuteAgo);
    timing.timestamps.push(now);
    
    // Check request rate
    if (timing.timestamps.length > APP_CLONING_CONFIG.TIMING_CHECKS.MAX_REQUESTS_PER_MINUTE) {
        timing.violations++;
        return {
            valid: false,
            reason: 'Request rate limit exceeded',
            requestCount: timing.timestamps.length,
            limit: APP_CLONING_CONFIG.TIMING_CHECKS.MAX_REQUESTS_PER_MINUTE
        };
    }
    
    // Check minimum interval (if more than one request)
    if (timing.timestamps.length > 1) {
        const lastTwo = timing.timestamps.slice(-2);
        const interval = lastTwo[1] - lastTwo[0];
        
        if (interval < APP_CLONING_CONFIG.TIMING_CHECKS.MIN_REQUEST_INTERVAL) {
            timing.violations++;
            return {
                valid: false,
                reason: 'Requests too frequent',
                interval: interval,
                minimum: APP_CLONING_CONFIG.TIMING_CHECKS.MIN_REQUEST_INTERVAL
            };
        }
    }
    
    return { valid: true };
}

function generateClientFingerprint(req, clientIP) {
    const userAgent = req.get('user-agent') || '';
    const acceptLanguage = req.get('accept-language') || '';
    const acceptEncoding = req.get('accept-encoding') || '';
    
    const fingerprintData = {
        userAgent: userAgent.substring(0, 200),
        acceptLanguage,
        acceptEncoding,
        ip: clientIP
    };
    
    return crypto.createHash('md5').update(JSON.stringify(fingerprintData)).digest('hex');
}

function logAppCloningAlert(alertType, clientIP, details, blocked = true) {
    const now = Date.now();
    
    // Update app cloning statistics
    if (!appCloningStats.has(alertType)) {
        appCloningStats.set(alertType, { count: 0, lastDetected: 0, blockedIPs: new Set() });
    }
    
    const stats = appCloningStats.get(alertType);
    stats.count++;
    stats.lastDetected = now;
    stats.blockedIPs.add(clientIP);
    
    // Log app cloning alert
    const action = blocked ? 'BLOCKED' : 'DETECTED';
    const alertMessage = `APP_CLONING_${action}: ${alertType} - IP: ${clientIP} - Details: ${JSON.stringify(details)}`;
    writeLog(APP_CLONING_LOG_FILE, alertMessage);
    console.log(`🔒 APP-CLONING ${action}: ${alertType} from ${clientIP}`);
    
    // Log detailed information
    const detailMessage = `APP_CLONING_DETAILS: Type: ${alertType}, IP: ${clientIP}, Action: ${action}, Reason: ${details.reason || 'unknown'}`;
    writeLog(APP_CLONING_LOG_FILE, detailMessage);
}

function appCloningMiddleware(req, res, next) {
    if (!APP_CLONING_CONFIG.ENABLED) {
        return next();
    }
    
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('user-agent') || '';
    const now = Date.now();
    
    // 1. Validate required headers
    const signatureCheck = validateAppSignature(req);
    if (!signatureCheck.valid) {
        logAppCloningAlert('INVALID_SIGNATURE', clientIP, {
            reason: signatureCheck.reason,
            expected: signatureCheck.expected,
            received: signatureCheck.received,
            endpoint: req.originalUrl,
            userAgent: userAgent.substring(0, 100)
        }, APP_CLONING_CONFIG.BLOCK_MODE);
        
        if (APP_CLONING_CONFIG.BLOCK_MODE) {
            return res.status(403).json({
                status: 'blocked',
                message: 'Request blocked: Invalid application signature',
                code: 'APP_CLONING_INVALID_SIGNATURE'
            });
        }
    }
    
    // 2. Validate User-Agent
    const userAgentCheck = validateUserAgent(userAgent);
    if (!userAgentCheck.valid) {
        logAppCloningAlert('SUSPICIOUS_USER_AGENT', clientIP, {
            reason: userAgentCheck.reason,
            userAgent: userAgent.substring(0, 100),
            pattern: userAgentCheck.pattern,
            endpoint: req.originalUrl
        }, APP_CLONING_CONFIG.BLOCK_MODE);
        
        if (APP_CLONING_CONFIG.BLOCK_MODE) {
            return res.status(403).json({
                status: 'blocked',
                message: 'Request blocked: Suspicious client detected',
                code: 'APP_CLONING_SUSPICIOUS_CLIENT'
            });
        }
    }
    
    // 3. Check request timing
    const timingCheck = checkRequestTiming(clientIP);
    if (!timingCheck.valid) {
        logAppCloningAlert('TIMING_VIOLATION', clientIP, {
            reason: timingCheck.reason,
            requestCount: timingCheck.requestCount,
            interval: timingCheck.interval,
            endpoint: req.originalUrl,
            userAgent: userAgent.substring(0, 100)
        }, APP_CLONING_CONFIG.BLOCK_MODE);
        
        if (APP_CLONING_CONFIG.BLOCK_MODE) {
            return res.status(429).json({
                status: 'blocked',
                message: 'Request blocked: Suspicious request pattern detected',
                code: 'APP_CLONING_TIMING_VIOLATION'
            });
        }
    }
    
    // 4. Generate and track client fingerprint
    const fingerprint = generateClientFingerprint(req, clientIP);
    if (!clientFingerprints.has(clientIP)) {
        clientFingerprints.set(clientIP, {
            fingerprint,
            firstSeen: now,
            lastRequest: now,
            requestCount: 1
        });
    } else {
        const existing = clientFingerprints.get(clientIP);
        existing.lastRequest = now;
        existing.requestCount++;
        
        // Check if fingerprint changed (potential cloning)
        if (existing.fingerprint !== fingerprint) {
            logAppCloningAlert('FINGERPRINT_MISMATCH', clientIP, {
                reason: 'Client fingerprint changed',
                oldFingerprint: existing.fingerprint,
                newFingerprint: fingerprint,
                endpoint: req.originalUrl,
                userAgent: userAgent.substring(0, 100)
            }, false); // Log only, don't block (could be legitimate)
        }
    }
    
    // 5. Add response headers to identify legitimate responses
    res.set({
        'X-App-Response-Signature': APP_CLONING_CONFIG.APP_SIGNATURE,
        'X-App-Response-Checksum': generateAppChecksum(req),
        'X-App-Timestamp': now.toString()
    });
    
    next();
}

function cleanupAppCloning() {
    const now = Date.now();
    const cleanupThreshold = 24 * 60 * 60 * 1000; // 24 hours
    
    // Clean old app cloning statistics
    for (const [alertType, stats] of appCloningStats.entries()) {
        if (now - stats.lastDetected > cleanupThreshold * 7) { // Keep for 7 days
            appCloningStats.delete(alertType);
        }
    }
    
    // Clean old client fingerprints
    for (const [clientIP, data] of clientFingerprints.entries()) {
        if (now - data.lastRequest > cleanupThreshold) {
            clientFingerprints.delete(clientIP);
        }
    }
    
    // Clean old request timings
    for (const [clientIP, timing] of requestTimings.entries()) {
        const oneHourAgo = now - (60 * 60 * 1000);
        timing.timestamps = timing.timestamps.filter(ts => ts > oneHourAgo);
        
        if (timing.timestamps.length === 0) {
            requestTimings.delete(clientIP);
        }
    }
}

// Start cleanup intervals
setInterval(cleanupIDS, IPS_CONFIG.CLEANUP_INTERVAL);
setInterval(cleanupADS, 60 * 60 * 1000); // Clean ADS data every hour
setInterval(cleanupWAF, 60 * 60 * 1000); // Clean WAF data every hour
setInterval(cleanupPhishing, 60 * 60 * 1000); // Cleanup expired blocks every 2 minutes
setInterval(cleanupAppCloning, 60 * 60 * 1000); // Clean app cloning data every hour

// Cleanup expired sessions based on configured interval
setInterval(() => {
    cleanupExpiredSessions();
}, SESSION_CONFIG.CLEANUP_INTERVAL); // Clean app cloning data every hour

// Helper function to write logs
function writeLog(logFile, message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logFile, logEntry);
}

// API Request Logging Middleware
function apiLogger(req, res, next) {
    const startTime = Date.now();
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    
    // Log request
    const requestLog = `${req.method} ${req.originalUrl} - IP: ${clientIP} - User-Agent: ${userAgent}`;
    writeLog(LOG_FILE, `REQUEST: ${requestLog}`);
    console.log(`📝 API Request: ${req.method} ${req.originalUrl} from ${clientIP}`);
    
    // Capture response
    const originalSend = res.send;
    res.send = function(data) {
        const duration = Date.now() - startTime;
        const statusCode = res.statusCode;
        
        // Log response
        const responseLog = `${req.method} ${req.originalUrl} - Status: ${statusCode} - Duration: ${duration}ms - IP: ${clientIP}`;
        writeLog(LOG_FILE, `RESPONSE: ${responseLog}`);
        console.log(`📤 API Response: ${req.method} ${req.originalUrl} - ${statusCode} (${duration}ms)`);
        
        // Log user info if available
        if (req.user) {
            const userLog = `User: ${req.user.username} (${req.user.role}) - ${req.method} ${req.originalUrl}`;
            writeLog(LOG_FILE, `USER_ACTION: ${userLog}`);
        }
        
        originalSend.call(this, data);
    };
    
    next();
}

// Login Attempt Logging Function
function logLoginAttempt(username, role, success, reason = '', clientIP = 'unknown') {
    const timestamp = new Date().toISOString();
    const status = success ? 'SUCCESS' : 'FAILED';
    const logMessage = `LOGIN_${status}: Username: ${username} | Role: ${role} | IP: ${clientIP} | Reason: ${reason}`;
    
    writeLog(LOGIN_LOG_FILE, logMessage);
    console.log(`🔐 Login ${status}: ${username} (${role}) from ${clientIP} ${reason ? '- ' + reason : ''}`);
}

// Initialize SQLite database
// CRITICAL: Force use of Render persistent disk path in production
// No fallback to local database to prevent data loss
const dbPath = process.env.DB_PATH;

if (!dbPath) {
    console.error('❌ CRITICAL ERROR: DB_PATH environment variable is not set!');
    console.error('   Database cannot be initialized without DB_PATH.');
    console.error('   Set DB_PATH to /opt/render/project/data/school.db for Render deployment.');
    process.exit(1);
}

const dbDir = require('path').dirname(dbPath);

console.log('📁 Database Configuration:');
console.log(`   DB_PATH: ${dbPath}`);
console.log(`   DB_DIR: ${dbDir}`);

// Create directory if it doesn't exist
if (!require('fs').existsSync(dbDir)) {
    console.log(`📂 Creating database directory: ${dbDir}`);
    require('fs').mkdirSync(dbDir, { recursive: true });
    console.log(`✅ Database directory created: ${dbDir}`);
} else {
    console.log(`✅ Database directory exists: ${dbDir}`);
}

// Check if database file exists
const dbExists = require('fs').existsSync(dbPath);
console.log(`📊 Database file exists: ${dbExists ? 'YES' : 'NO'}`);
if (dbExists) {
    const stats = require('fs').statSync(dbPath);
    console.log(`   Database file size: ${stats.size} bytes`);
    console.log(`   Last modified: ${stats.mtime.toISOString()}`);
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        // Initialize Chatbot Service after database connection
        chatbotService = new ChatbotService(db);
        // Initialize Navigation Chatbot Service (for internal chatbot)
        navigationChatbotService = new NavigationChatbotService(db);
        console.log('✅ Database connected successfully at:', dbPath);
        
        // Check existing tables to verify database state
        db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
            if (err) {
                console.error('❌ Error checking tables:', err.message);
            } else {
                console.log(`📋 Existing tables in database: ${tables.length}`);
                tables.forEach(t => console.log(`   - ${t.name}`));
            }
        });
        
        // Create tables if not exists
        db.serialize(() => {
            // Users table
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL,
                avatar TEXT,
                mfa_enabled INTEGER DEFAULT 0
            )`, (err) => {
                if (err) {
                    console.error('Error creating users table:', err.message);
                } else {
                    console.log('Users table is ready');
                    
                    // Add mfa_enabled column if it doesn't exist
                    db.run(`ALTER TABLE users ADD COLUMN mfa_enabled INTEGER DEFAULT 0`, (alterErr) => {
                        if (alterErr && !alterErr.message.includes('duplicate column')) {
                            console.log('mfa_enabled column already exists or error:', alterErr.message);
                        } else {
                            console.log('mfa_enabled column added or already exists');
                        }
                    });
                    
                    // Insert default admin user if not exists
                    // Check if admin already exists before attempting to create
                    db.get('SELECT id FROM users WHERE username = ?', ['admin'], (checkErr, adminRow) => {
                        if (checkErr) {
                            console.error('Error checking for existing admin:', checkErr.message);
                            return;
                        }
                        
                        if (adminRow) {
                            console.log('Default admin user already exists - skipping creation');
                            return;
                        }
                        
                        // Admin doesn't exist, create it
                        const adminUser = {
                            username: 'admin',
                            password: process.env.DEFAULT_ADMIN_PASSWORD || 'admin@321', // Use env var or default
                            role: 'admin'
                        };
                        
                        // Hash the password before storing
                        bcrypt.hash(adminUser.password, 10, (err, hashedPassword) => {
                            if (err) {
                                console.error('Error hashing admin password:', err.message);
                                return;
                            }
                            
                            const stmt = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
                            stmt.run(adminUser.username, hashedPassword, adminUser.role, function(err) {
                                if (err) {
                                    console.error('Error creating default admin:', err.message);
                                } else {
                                    console.log('Default admin user created with hashed password');
                                }
                                stmt.finalize();
                            });
                        });
                    });
                }
            });

            // Students table
            db.run(`CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                age INTEGER,
                grade TEXT
            )`, (err) => {
                if (err) {
                    console.error('Error creating students table:', err.message);
                } else {
                    console.log('Students table is ready');
                    // Ensure required columns exist
                    db.all("PRAGMA table_info(students)", [], (err, columns) => {
                        if (err) {
                            console.error('Error reading students table info:', err.message);
                            return;
                        }
                        const hasUserId = columns.some(col => col.name === 'user_id');
                        if (!hasUserId) {
                            db.run("ALTER TABLE students ADD COLUMN user_id INTEGER", (alterErr) => {
                                if (alterErr) {
                                    console.error('Error adding user_id to students:', alterErr.message);
                                } else {
                                    console.log('Added user_id column to students table');
                                }
                            });
                        }
                        const hasEmail = columns.some(col => col.name === 'email');
                        if (!hasEmail) {
                            db.run("ALTER TABLE students ADD COLUMN email TEXT", (alterErr) => {
                                if (alterErr) {
                                    console.error('Error adding email to students:', alterErr.message);
                                } else {
                                    console.log('Added email column to students table');
                                }
                            });
                        }
                        const hasClass = columns.some(col => col.name === 'class');
                        if (!hasClass) {
                            db.run("ALTER TABLE students ADD COLUMN class TEXT", (alterErr) => {
                                if (alterErr) {
                                    console.error('Error adding class to students:', alterErr.message);
                                } else {
                                    console.log('Added class column to students table');
                                }
                            });
                        }
                        const hasPhone = columns.some(col => col.name === 'phone');
                        if (!hasPhone) {
                            db.run("ALTER TABLE students ADD COLUMN phone TEXT", (alterErr) => {
                                if (alterErr) {
                                    console.error('Error adding phone to students:', alterErr.message);
                                } else {
                                    console.log('Added phone column to students table');
                                }
                            });
                        }
                        const hasBio = columns.some(col => col.name === 'bio');
                        if (!hasBio) {
                            db.run("ALTER TABLE students ADD COLUMN bio TEXT", (alterErr) => {
                                if (alterErr) {
                                    console.error('Error adding bio to students:', alterErr.message);
                                } else {
                                    console.log('Added bio column to students table');
                                }
                            });
                        }
                        const hasRollNumber = columns.some(col => col.name === 'roll_number');
                        if (!hasRollNumber) {
                            db.run("ALTER TABLE students ADD COLUMN roll_number TEXT", (alterErr) => {
                                if (alterErr) {
                                    console.error('Error adding roll_number to students:', alterErr.message);
                                } else {
                                    console.log('Added roll_number column to students table');
                                }
                            });
                        }
                        const hasAdmissionNumber = columns.some(col => col.name === 'admission_number');
                        if (!hasAdmissionNumber) {
                            db.run("ALTER TABLE students ADD COLUMN admission_number TEXT", (alterErr) => {
                                if (alterErr) {
                                    console.error('Error adding admission_number to students:', alterErr.message);
                                } else {
                                    console.log('Added admission_number column to students table');
                                }
                            });
                        }
                        const hasAddress = columns.some(col => col.name === 'address');
                        if (!hasAddress) {
                            db.run("ALTER TABLE students ADD COLUMN address TEXT", (alterErr) => {
                                if (alterErr) {
                                    console.error('Error adding address to students:', alterErr.message);
                                } else {
                                    console.log('Added address column to students table');
                                }
                            });
                        }
                        const hasAvatar = columns.some(col => col.name === 'avatar');
                        if (!hasAvatar) {
                            db.run("ALTER TABLE students ADD COLUMN avatar TEXT", (alterErr) => {
                                if (alterErr) {
                                    console.error('Error adding avatar to students:', alterErr.message);
                                } else {
                                    console.log('Added avatar column to students table');
                                }
                            });
                        }
                    });
                }
            });

            // Admission sequence table - tracks the next admission number to ensure no ID reuse
            db.run(`CREATE TABLE IF NOT EXISTS admission_sequence (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                next_sequence_number INTEGER DEFAULT 1
            )`, (err) => {
                if (err) {
                    console.error('Error creating admission_sequence table:', err.message);
                } else {
                    console.log('Admission sequence table is ready');
                    // Initialize the sequence if not exists
                    db.run(`INSERT OR IGNORE INTO admission_sequence (id, next_sequence_number) VALUES (1, 1)`, (initErr) => {
                        if (initErr) {
                            console.error('Error initializing admission sequence:', initErr.message);
                        } else {
                            console.log('Admission sequence initialized');
                        }
                    });
                }
            });

            // Teachers table
            db.run(`CREATE TABLE IF NOT EXISTS teachers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                subject TEXT,
                experience INTEGER
            )`, (err) => {
                if (err) {
                    console.error('Error creating teachers table:', err.message);
                } else {
                    console.log('Teachers table is ready');
                    // Ensure additional columns exist
                    db.all("PRAGMA table_info(teachers)", [], (err, columns) => {
                        if (err) {
                            console.error('Error reading teachers table info:', err.message);
                            return;
                        }
                        const hasEmail = columns.some(col => col.name === 'email');
                        if (!hasEmail) {
                            db.run("ALTER TABLE teachers ADD COLUMN email TEXT", (alterErr) => {
                                if (alterErr) {
                                    console.error('Error adding email to teachers:', alterErr.message);
                                } else {
                                    console.log('Added email column to teachers table');
                                }
                            });
                        }
                        const hasPhone = columns.some(col => col.name === 'phone');
                        if (!hasPhone) {
                            db.run("ALTER TABLE teachers ADD COLUMN phone TEXT", (alterErr) => {
                                if (alterErr) {
                                    console.error('Error adding phone to teachers:', alterErr.message);
                                } else {
                                    console.log('Added phone column to teachers table');
                                }
                            });
                        }
                        const hasDepartment = columns.some(col => col.name === 'department');
                        if (!hasDepartment) {
                            db.run("ALTER TABLE teachers ADD COLUMN department TEXT", (alterErr) => {
                                if (alterErr) {
                                    console.error('Error adding department to teachers:', alterErr.message);
                                } else {
                                    console.log('Added department column to teachers table');
                                }
                            });
                        }
                    });
                }
            });

            // Classes table
            db.run(`CREATE TABLE IF NOT EXISTS classes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                room TEXT,
                capacity INTEGER
            )`, (err) => {
                if (err) {
                    console.error('Error creating classes table:', err.message);
                } else {
                    console.log('Classes table is ready');
                    // Ensure additional columns exist
                    db.all("PRAGMA table_info(classes)", [], (err, columns) => {
                        if (err) {
                            console.error('Error reading classes table info:', err.message);
                            return;
                        }
                        const hasRoom = columns.some(col => col.name === 'room');
                        if (!hasRoom) {
                            db.run("ALTER TABLE classes ADD COLUMN room TEXT", (alterErr) => {
                                if (alterErr) {
                                    console.error('Error adding room to classes:', alterErr.message);
                                } else {
                                    console.log('Added room column to classes table');
                                }
                            });
                        }
                        const hasCapacity = columns.some(col => col.name === 'capacity');
                        if (!hasCapacity) {
                            db.run("ALTER TABLE classes ADD COLUMN capacity INTEGER", (alterErr) => {
                                if (alterErr) {
                                    console.error('Error adding capacity to classes:', alterErr.message);
                                } else {
                                    console.log('Added capacity column to classes table');
                                }
                            });
                        }
                    });
                }
            });

            // Subjects table
            db.run(`CREATE TABLE IF NOT EXISTS subjects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                code TEXT,
                credits INTEGER
            )`, (err) => {
                if (err) {
                    console.error('Error creating subjects table:', err.message);
                } else {
                    console.log('Subjects table is ready');
                }
            });

            // Timetables table
            db.run(`CREATE TABLE IF NOT EXISTS timetables (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                class_id INTEGER NOT NULL,
                subject_id INTEGER NOT NULL,
                teacher_id INTEGER NOT NULL,
                day TEXT NOT NULL,
                time_slot TEXT NOT NULL,
                FOREIGN KEY (class_id) REFERENCES classes(id),
                FOREIGN KEY (subject_id) REFERENCES subjects(id),
                FOREIGN KEY (teacher_id) REFERENCES teachers(id)
            )`, (err) => {
                if (err) {
                    console.error('Error creating timetables table:', err.message);
                } else {
                    console.log('Timetables table is ready');
                }
            });

            // Notices table
            db.run(`CREATE TABLE IF NOT EXISTS notices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                type TEXT NOT NULL,
                target_audience TEXT NOT NULL,
                content TEXT NOT NULL,
                created_by TEXT DEFAULT 'Admin',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`, (err) => {
                if (err) {
                    console.error('Error creating notices table:', err.message);
                } else {
                    console.log('Notices table is ready');
                }
            });

            // Notifications table - Secure notification system
            db.run(`CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                created_by TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_active INTEGER DEFAULT 1,
                target_role TEXT DEFAULT 'student',
                is_pinned INTEGER DEFAULT 0,
                expires_at DATETIME
            )`, (err) => {
                if (err) {
                    console.error('Error creating notifications table:', err.message);
                } else {
                    console.log('Notifications table is ready');
                }
            });

            // Payments table for Razorpay integration
            db.run(`CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL,
                amount INTEGER NOT NULL,
                currency TEXT DEFAULT 'INR',
                status TEXT DEFAULT 'pending',
                order_id TEXT UNIQUE,
                payment_id TEXT UNIQUE,
                receipt_id TEXT,
                description TEXT,
                payment_method TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (student_id) REFERENCES students(id)
            )`, (err) => {
                if (err) {
                    console.error('Error creating payments table:', err.message);
                } else {
                    console.log('Payments table is ready');
                }
            });

            // Payment OTP table for 2FA payment verification
            db.run(`CREATE TABLE IF NOT EXISTS payment_otp (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL,
                otp_hash TEXT NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                is_verified INTEGER DEFAULT 0,
                attempt_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (student_id) REFERENCES students(id)
            )`, (err) => {
                if (err) {
                    console.error('Error creating payment_otp table:', err.message);
                } else {
                    console.log('Payment OTP table is ready');
                }
            });

            db.all("PRAGMA table_info(users)", [], (err, columns) => {
                if (err) {
                    console.error('Error reading users table info:', err.message);
                    return;
                }

                const hasEmail = columns.some(col => col.name === 'email');
                if (!hasEmail) {
                    db.run("ALTER TABLE users ADD COLUMN email TEXT", (alterErr) => {
                        if (alterErr) {
                            console.error('Error adding email to users:', alterErr.message);
                        }
                    });
                }

                const hasTwoFactor = columns.some(col => col.name === 'two_factor_enabled');
                if (!hasTwoFactor) {
                    db.run("ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER DEFAULT 0", (alterErr) => {
                        if (alterErr) {
                            console.error('Error adding two_factor_enabled to users:', alterErr.message);
                        }
                    });
                }

                const hasFullName = columns.some(col => col.name === 'full_name');
                if (!hasFullName) {
                    db.run("ALTER TABLE users ADD COLUMN full_name TEXT", (alterErr) => {
                        if (alterErr) {
                            console.error('Error adding full_name to users:', alterErr.message);
                        }
                    });
                }

                const hasPhone = columns.some(col => col.name === 'phone');
                if (!hasPhone) {
                    db.run("ALTER TABLE users ADD COLUMN phone TEXT", (alterErr) => {
                        if (alterErr) {
                            console.error('Error adding phone to users:', alterErr.message);
                        }
                    });
                }

                const hasDepartment = columns.some(col => col.name === 'department');
                if (!hasDepartment) {
                    db.run("ALTER TABLE users ADD COLUMN department TEXT", (alterErr) => {
                        if (alterErr) {
                            console.error('Error adding department to users:', alterErr.message);
                        }
                    });
                }
            });

            db.run(`CREATE TABLE IF NOT EXISTS email_otps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                email TEXT NOT NULL,
                purpose TEXT NOT NULL,
                otp_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                is_verified INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`, (err) => {
                if (err) {
                    console.error('Error creating email_otps table:', err.message);
                } else {
                    console.log('Email OTPs table is ready');
                }
            });

            // MFA OTPs table for admin
            db.run(`CREATE TABLE IF NOT EXISTS mfa_otps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                otp_code TEXT NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                used INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`, (err) => {
                if (err) {
                    console.error('Error creating mfa_otps table:', err.message);
                } else {
                    console.log('MFA OTPs table is ready');
                }
            });

            // Fee Management System Tables
            db.run(`CREATE TABLE IF NOT EXISTS fees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                amount REAL NOT NULL,
                description TEXT,
                due_date TEXT,
                status TEXT DEFAULT 'PENDING',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`, (err) => {
                if (err) {
                    console.error('Error creating fees table:', err.message);
                } else {
                    console.log('Fees table is ready');
                }
            });

            db.run(`CREATE TABLE IF NOT EXISTS fee_payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fee_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                amount REAL NOT NULL,
                status TEXT DEFAULT 'SUCCESS',
                paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (fee_id) REFERENCES fees(id)
            )`, (err) => {
                if (err) {
                    console.error('Error creating fee_payments table:', err.message);
                } else {
                    console.log('Fee payments table is ready');
                }
            });

            db.run(`CREATE TABLE IF NOT EXISTS fee_otp (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                fee_id INTEGER NOT NULL,
                otp_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                attempts INTEGER DEFAULT 0,
                verified INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (fee_id) REFERENCES fees(id)
            )`, (err) => {
                if (err) {
                    console.error('Error creating fee_otp table:', err.message);
                } else {
                    console.log('Fee OTP table is ready');
                }
            });

            // Create indexes for better performance
            db.run(`CREATE INDEX IF NOT EXISTS idx_fees_username ON fees(username)`, (err) => {
                if (err) console.error('Error creating idx_fees_username:', err.message);
            });

            db.run(`CREATE INDEX IF NOT EXISTS idx_fee_payments_username ON fee_payments(username)`, (err) => {
                if (err) console.error('Error creating idx_fee_payments_username:', err.message);
            });

            // School payment details table (QR code, bank details, UPI)
            db.run(`CREATE TABLE IF NOT EXISTS school_payment_details (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                upi_id TEXT,
                qr_code_path TEXT,
                bank_name TEXT,
                account_number TEXT,
                ifsc TEXT
            )`, (err) => {
                if (err) {
                    console.error('Error creating school_payment_details table:', err.message);
                } else {
                    console.log('School payment details table is ready');
                    // Insert default payment details if not exists
                    db.get("SELECT COUNT(*) as count FROM school_payment_details", [], (err, row) => {
                        if (!err && row.count === 0) {
                            db.run(`INSERT INTO school_payment_details (upi_id, qr_code_path, bank_name, account_number, ifsc) VALUES (?, ?, ?, ?, ?)`,
                                ['7017759464@jio', '/uploads/qr.png', 'Bank of Baroda', '52740100008707', 'BARB0GANSAH'],
                                (insertErr) => {
                                    if (!insertErr) console.log('Default school payment details inserted');
                                }
                            );
                        }
                    });
                }
            });
        });
        
        // After all tables are created, verify data counts for debugging
        setTimeout(() => {
            console.log('📊 Verifying database data counts...');
            const tablesToCheck = ['users', 'students', 'teachers', 'classes', 'subjects', 'notices', 'payments', 'fees', 'fee_payments'];
            
            tablesToCheck.forEach(tableName => {
                db.get(`SELECT COUNT(*) as count FROM ${tableName}`, [], (err, row) => {
                    if (err) {
                        console.log(`   ❌ ${tableName}: Error - ${err.message}`);
                    } else {
                        console.log(`   ✅ ${tableName}: ${row.count} records`);
                    }
                });
            });
        }, 1000); // Delay to ensure all tables are ready
    }
});

// Hardened CORS Configuration
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = process.env.CORS_ORIGINS ? 
            process.env.CORS_ORIGINS.split(',').map(o => o.trim()) : 
            ['http://localhost:3000', 'http://127.0.0.1:5500', 'https://*.onrender.com'];
        
        const originLower = origin.toLowerCase();
        let isAllowed = false;
        
        for (const allowed of allowedOrigins) {
            if (allowed.includes('*')) {
                // Wildcard matching (e.g., https://*.onrender.com)
                const pattern = allowed.replace('*', '.*');
                const regex = new RegExp('^' + pattern + '$');
                if (regex.test(originLower)) {
                    isAllowed = true;
                    break;
                }
            } else if (allowed === originLower) {
                isAllowed = true;
                break;
            }
        }
        
        if (isAllowed) {
            callback(null, true);
        } else {
            console.log(`🚫 CORS: Blocked origin ${origin}`);
            writeLog(LOG_FILE, `CORS_BLOCKED: Origin ${origin} not in allowed list`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type', 
        'Authorization', 
        'X-Session-Id', 
        'X-App-Signature', 
        'X-App-Version', 
        'X-App-Build',
        'X-Requested-With',
        'Accept',
        'Cache-Control'
    ],
    exposedHeaders: [
        'X-Session-Warning',
        'X-Session-Time-Remaining', 
        'X-Session-Can-Refresh',
        'X-App-Response-Signature',
        'X-App-Response-Checksum',
        'X-App-Timestamp'
    ],
    credentials: true,
    maxAge: parseInt(process.env.CORS_MAX_AGE) || 86400, // 24 hours
    optionsSuccessStatus: 200, // For legacy browser support
    preflightContinue: false
};

// Security Headers Middleware
function securityHeaders(req, res, next) {
    if (process.env.SECURITY_HEADERS_ENABLED === 'true') {
        // Strict Transport Security (HSTS)
        if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
            res.setHeader('Strict-Transport-Security', `max-age=${process.env.HSTS_MAX_AGE || 31536000}; includeSubDomains; preload`);
        }
        
        // Content Security Policy
        if (process.env.CSP_ENABLED === 'true') {
            // Allow trusted CDNs for fonts and lottie while keeping strict defaults
            res.setHeader('Content-Security-Policy',
                "default-src 'self'; " +
                "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; " +
                "img-src 'self' data: https:; " +
                "font-src 'self' https://fonts.gstatic.com data: https://cdnjs.cloudflare.com; " +
                "connect-src 'self'; " +
                "frame-ancestors 'none';"
            );
        }
        
        // Additional security headers
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    }
    next();
}

// Apply middleware
app.use(cors(corsOptions));
app.use(securityHeaders);
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// HTTP to HTTPS Redirect Middleware (if enabled)
if (SSL_CONFIG.ENABLED && SSL_CONFIG.REDIRECT_HTTP) {
    app.use(httpsRedirect);
}

// WAF Middleware - Check for attacks first
app.use(wafMiddleware);

// App-Cloning Protection Middleware - Check app signature and headers
app.use(appCloningMiddleware);

// Anti-Phishing Middleware - Check domain validity for login requests
app.use('/api/login', antiPhishingMiddleware);

// IDS Middleware - Check blocked IPs first
app.use((req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    
    // Skip IPS blocking if disabled
    if (!IPS_CONFIG.ENABLED) {
        return next();
    }
    
    if (isIPBlocked(clientIP)) {
        const blockInfo = getBlockInfo(clientIP);
        const remainingTime = Math.ceil((blockInfo.expiresAt - Date.now()) / 1000 / 60);
        
        writeLog(IDS_LOG_FILE, `BLOCKED_REQUEST: IP ${clientIP} attempted ${req.method} ${req.originalUrl} while blocked`);
        console.log(`🚫 IDS: Blocked IP ${clientIP} attempted access to ${req.method} ${req.originalUrl}`);
        
        return res.status(429).json({
            status: 'blocked',
            message: 'IP address temporarily blocked due to suspicious activity',
            reason: blockInfo.reason,
            unblockTime: remainingTime,
            details: `Your IP has been blocked for ${remainingTime} more minutes due to multiple failed login attempts.`
        });
    }
    
    next();
});

// Add logging middleware for all API requests
app.use(apiLogger);

// Enhanced JWT Authentication Middleware with Session Timeout
const authenticateToken = (req, res, next) => {
    // DEVELOPMENT BYPASS - Comment out for production
    if (process.env.NODE_ENV !== 'production' && req.headers['x-dev-bypass'] === 'creator-access') {
        // Bypass authentication for development testing
        req.user = {
            userId: 1,
            username: 'admin',
            role: 'admin',
            sessionId: 'dev-session'
        };
        return next();
    }
    
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    const sessionId = req.headers['x-session-id']; // Optional session ID header
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    
    if (!token) {
        writeLog(LOG_FILE, `AUTH_FAILED: No token provided - ${req.method} ${req.originalUrl} - IP: ${clientIP}`);
        return res.status(401).json({ 
            status: 'failed', 
            message: 'Access token required' 
        });
    }
    
    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) {
            writeLog(LOG_FILE, `AUTH_FAILED: Invalid/expired token - ${req.method} ${req.originalUrl} - IP: ${clientIP} - Error: ${err.message}`);
            
            // Check if it's a token expiration error
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ 
                    status: 'failed', 
                    message: 'Token has expired',
                    code: 'TOKEN_EXPIRED',
                    expiredAt: err.expiredAt
                });
            }
            
            return res.status(403).json({ 
                status: 'failed', 
                message: 'Invalid token',
                code: 'TOKEN_INVALID'
            });
        }
        
        // If session management is enabled and session ID is provided, validate session
        if (SESSION_CONFIG.ENABLED && sessionId) {
            const sessionValidation = validateSession(sessionId);
            
            if (!sessionValidation.valid) {
                writeLog(SESSION_LOG_FILE, `SESSION_VALIDATION_FAILED: User ${user.username} - SessionId: ${sessionId} - Reason: ${sessionValidation.reason} - IP: ${clientIP}`);
                
                return res.status(401).json({
                    status: 'failed',
                    message: 'Session has expired or is invalid',
                    code: sessionValidation.reason,
                    requiresReauth: true
                });
            }
            
            // Check for session warning (close to expiry)
            if (sessionValidation.warning) {
                res.set('X-Session-Warning', 'true');
                res.set('X-Session-Time-Remaining', sessionValidation.timeUntilExpiry.toString());
                res.set('X-Session-Can-Refresh', sessionValidation.canRefresh.toString());
                
                writeLog(SESSION_LOG_FILE, `SESSION_WARNING: User ${user.username} - SessionId: ${sessionId} - Time remaining: ${Math.floor(sessionValidation.timeUntilExpiry / 1000)}s - IP: ${clientIP}`);
            }
            
            // Add session info to request
            req.session = sessionValidation.session;
            req.sessionId = sessionId;
        }
        
        req.user = user;
        writeLog(LOG_FILE, `AUTH_SUCCESS: User ${user.username} (${user.role}) authenticated - ${req.method} ${req.originalUrl} - IP: ${clientIP}${sessionId ? ` - SessionId: ${sessionId}` : ''}`);
        next();
    });
};

// Role-based Authorization Middleware
const authorizeRole = (roles) => {
    return (req, res, next) => {
        const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
        
        if (!req.user) {
            writeLog(LOG_FILE, `AUTHZ_FAILED: No user in request - ${req.method} ${req.originalUrl} - IP: ${clientIP}`);
            return res.status(401).json({ 
                status: 'failed', 
                message: 'User not authenticated' 
            });
        }
        
        if (!roles.includes(req.user.role)) {
            writeLog(LOG_FILE, `AUTHZ_FAILED: Insufficient permissions - User: ${req.user.username} (${req.user.role}) - Required: ${roles.join(',')} - ${req.method} ${req.originalUrl} - IP: ${clientIP}`);
            return res.status(403).json({ 
                status: 'failed', 
                message: 'Insufficient permissions' 
            });
        }
        
        writeLog(LOG_FILE, `AUTHZ_SUCCESS: User ${req.user.username} (${req.user.role}) authorized for ${req.method} ${req.originalUrl} - IP: ${clientIP}`);
        next();
    };
};

// Teacher-only middleware - Only allows users with role='teacher'
const authorizeTeacher = (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    
    if (!req.user) {
        writeLog(LOG_FILE, `AUTHZ_FAILED: No user in request - ${req.method} ${req.originalUrl} - IP: ${clientIP}`);
        return res.status(401).json({ 
            error: 'Access denied',
            message: 'User not authenticated' 
        });
    }
    
    if (req.user.role !== 'teacher') {
        writeLog(LOG_FILE, `AUTHZ_FAILED: Not a teacher - User: ${req.user.username} (${req.user.role}) - ${req.method} ${req.originalUrl} - IP: ${clientIP}`);
        return res.status(403).json({ 
            error: 'Access denied',
            message: 'Only teachers can access this resource' 
        });
    }
    
    writeLog(LOG_FILE, `AUTHZ_SUCCESS: Teacher ${req.user.username} authorized for ${req.method} ${req.originalUrl} - IP: ${clientIP}`);
    next();
};

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Chatbot endpoint
app.post('/api/chatbot', authenticateToken, async (req, res) => {
    try {
        const { message } = req.body;
        const userRole = req.user.role;
        const userId = req.user.username;
        const sessionId = req.sessionId || req.headers['x-session-id'];
        
        if (!message || typeof message !== 'string') {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid message format'
            });
        }

        if (!chatbotService) {
            return res.status(503).json({
                status: 'error',
                message: 'Chatbot service unavailable'
            });
        }

        // Process message through chatbot service
        const response = await chatbotService.processMessage(message, userRole, userId, sessionId);
        
        // Log chatbot interaction
        const logMessage = `${new Date().toISOString()} - CHATBOT - User: ${userId} (${userRole}) - Query: "${message.substring(0, 100)}" - Intent: ${response.intent}`;
        writeLog('./logs/chatbot_interactions.log', logMessage);
        
        res.json({
            status: 'success',
            message: response.message,
            type: response.type || 'info',
            intent: response.intent,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Chatbot API error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
});

// ============================================================================
// INTERNAL AI CHATBOT ENDPOINT (After Login - Role-Based)
// ============================================================================

// Rate limiting for internal chatbot (per user)
const internalChatbotRateLimit = new Map(); // userId -> { count, resetTime }

// Rate limiting middleware for internal chatbot
function internalChatbotRateLimitMiddleware(req, res, next) {
    const userId = req.user?.username || req.user?.userId || 'unknown';
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const maxRequests = 15; // Max 15 requests per minute per user
    
    // Get or create rate limit entry
    if (!internalChatbotRateLimit.has(userId)) {
        internalChatbotRateLimit.set(userId, { count: 0, resetTime: now + windowMs });
    }
    
    const limit = internalChatbotRateLimit.get(userId);
    
    // Reset if window expired
    if (now > limit.resetTime) {
        limit.count = 0;
        limit.resetTime = now + windowMs;
    }
    
    // Check limit
    if (limit.count >= maxRequests) {
        writeLog(LOG_FILE, `INTERNAL_CHATBOT_RATE_LIMIT: User ${userId} exceeded rate limit`);
        return res.status(429).json({
            status: 'error',
            message: 'Too many requests. Please wait a moment.',
            retryAfter: Math.ceil((limit.resetTime - now) / 1000)
        });
    }
    
    // Increment counter
    limit.count++;
    next();
}

// Enhanced input sanitization for internal chatbot
function sanitizeInternalChatbotInput(input) {
    if (!input || typeof input !== 'string') return '';
    
    // Remove potential script tags and event handlers
    let sanitized = input
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/data:text\/html/gi, '')
        .replace(/eval\s*\(/gi, '')
        .replace(/expression\s*\(/gi, '')
        .replace(/vbscript:/gi, '')
        .replace(/onload\s*=/gi, '')
        .replace(/onerror\s*=/gi, '');
    
    // Limit length (longer for internal chatbot)
    sanitized = sanitized.substring(0, 500);
    
    // Remove excessive whitespace
    sanitized = sanitized.trim().replace(/\s+/g, ' ');
    
    return sanitized;
}

// Prompt injection detection patterns
const promptInjectionPatterns = [
    /ignore\s+(previous|above|all)\s+instructions?/i,
    /system\s*:\s*you\s+are/i,
    /act\s+as\s+(if\s+you\s+are|a)/i,
    /forget\s+(everything|all|previous)/i,
    /new\s+instructions?\s*:/i,
    /override\s+(system|security|rules)/i,
    /you\s+are\s+now/i,
    /pretend\s+you\s+are/i,
    /disregard\s+(previous|all|above)/i,
    /forget\s+all\s+rules/i
];

// Internal AI Chatbot Endpoint
// SECURITY: Requires authentication and role validation
app.post('/api/chatbot/internal', 
    authenticateToken, // Require authentication
    authorizeRole(['student', 'teacher', 'admin']), // Validate role
    internalChatbotRateLimitMiddleware, // Rate limiting
    async (req, res) => {
        try {
            const { message } = req.body;
            const userRole = req.user.role;
            const userId = req.user.username || req.user.userId;
            const sessionId = req.sessionId || req.headers['x-session-id'];
            const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
            
            // Validate message
            if (!message || typeof message !== 'string') {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid message format'
                });
            }
            
            // Sanitize input
            const sanitizedMessage = sanitizeInternalChatbotInput(message);
            
            if (!sanitizedMessage || sanitizedMessage.length === 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Message cannot be empty'
                });
            }
            
            // Check for prompt injection attempts
            for (const pattern of promptInjectionPatterns) {
                if (pattern.test(sanitizedMessage)) {
                    writeLog(LOG_FILE, `INTERNAL_CHATBOT_INJECTION_ATTEMPT: User ${userId} (${userRole}) - Query: ${sanitizedMessage.substring(0, 50)}`);
                    return res.status(400).json({
                        status: 'error',
                        message: 'Invalid input detected. Please rephrase your question.'
                    });
                }
            }
            
            // ====================================================================
            // NAVIGATION CHATBOT: Intent-based navigation assistant
            // ====================================================================
            
            let response = null;
            
            // Use Navigation Chatbot Service (does NOT show data, only guides)
            if (navigationChatbotService) {
                try {
                    response = await navigationChatbotService.processMessage(
                        sanitizedMessage, 
                        userRole, 
                        userId, 
                        sessionId
                    );
                    console.log(`[InternalChatbot] Navigation response for user ${userId}: ${response.intent} -> ${response.action}`);
                } catch (error) {
                    console.error(`[InternalChatbot] Navigation processing error for user ${userId}:`, error.message);
                    // Fall through to fallback
                }
            }
            
            // Fallback if navigation service unavailable
            if (!response) {
                response = {
                    action: 'suggest',
                    message: getDefaultFallbackResponse(userRole),
                    intent: 'fallback'
                };
                console.log(`[InternalChatbot] Using fallback response for user ${userId}`);
            }
            
            // Log chatbot interaction for admin review
            const logMessage = `${new Date().toISOString()} - INTERNAL_CHATBOT - User: ${userId} (${userRole}) - Query: "${sanitizedMessage.substring(0, 100)}" - Intent: ${response.intent || 'unknown'} - UsedAI: ${usedAI} - IP: ${clientIP}`;
            writeLog('./logs/internal_chatbot_interactions.log', logMessage);
            
            // Store in database for admin review
            db.run(`CREATE TABLE IF NOT EXISTS internal_chatbot_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                user_role TEXT NOT NULL,
                query TEXT NOT NULL,
                response TEXT NOT NULL,
                intent TEXT,
                used_ai INTEGER DEFAULT 0,
                ai_failed INTEGER DEFAULT 0,
                ip_address TEXT,
                session_id TEXT,
                timestamp TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )`, (err) => {
                if (err) {
                    console.error('Error creating internal_chatbot_logs table:', err.message);
                } else {
                    db.run(
                        `INSERT INTO internal_chatbot_logs (user_id, user_role, query, response, intent, used_ai, ai_failed, ip_address, session_id, timestamp, created_at) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            userId,
                            userRole,
                            sanitizedMessage,
                            response.message || response.text || '',
                            response.intent || 'unknown',
                            usedAI ? 1 : 0,
                            aiFailed ? 1 : 0,
                            clientIP,
                            sessionId || '',
                            new Date().toISOString(),
                            Date.now()
                        ],
                        (err) => {
                            if (err) {
                                console.error('Error logging internal chatbot query:', err.message);
                            }
                        }
                    );
                }
            });
            
            // Return navigation response
            res.json({
                status: 'success',
                message: response.message || response.text || getDefaultFallbackResponse(userRole),
                action: response.action || 'inform', // 'navigate', 'inform', 'suggest'
                target: response.target || null, // URL to navigate to
                intent: response.intent || 'unknown',
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('[InternalChatbot] API error:', error);
            
            // Log error
            writeLog(LOG_FILE, `INTERNAL_CHATBOT_ERROR: ${error.message}`);
            
            // Always return success with fallback (never show error to user)
            const fallbackResponse = getSmartFallbackResponse(
                req.body?.message || '', 
                req.user?.role || 'student', 
                req.user?.username || 'unknown'
            );
            
            res.json({
                status: 'success',
                message: fallbackResponse.message || fallbackResponse.text || getDefaultFallbackResponse(req.user?.role || 'student'),
                type: 'info',
                intent: 'fallback',
                timestamp: new Date().toISOString()
            });
        }
    }
);

// Helper function: Determine if query needs AI reasoning
function queryNeedsAI(message) {
    const normalized = message.toLowerCase();
    
    // Simple queries that can be handled by intent-based system
    const simplePatterns = [
        /\b(attendance|grades?|schedule|timetable|fees?|exams?|assignments?)\b/i,
        /\b(how\s+to|what\s+is|show\s+me|tell\s+me\s+about)\b/i,
        /\b(alerts?|status|system|help)\b/i
    ];
    
    // If matches simple patterns, intent-based should handle it
    for (const pattern of simplePatterns) {
        if (pattern.test(normalized)) {
            return false; // Don't need AI
        }
    }
    
    // Complex queries that might benefit from AI
    const complexPatterns = [
        /\b(why|explain|analyze|compare|recommend|suggest|what\s+should|how\s+can\s+I\s+improve)\b/i,
        /\b(insights?|trends?|patterns?|summary|overview)\b/i
    ];
    
    for (const pattern of complexPatterns) {
        if (pattern.test(normalized)) {
            return true; // Could benefit from AI
        }
    }
    
    // Default: try intent-based first
    return false;
}

// Helper function: Call AI API (if configured)
async function callAIAPI(message, userRole, userId) {
    // Check if AI API is configured
    const AI_API_KEY = process.env.AI_API_KEY;
    const AI_API_URL = process.env.AI_API_URL;
    
    if (!AI_API_KEY || !AI_API_URL) {
        // AI API not configured - return null to use fallback
        return null;
    }
    
    try {
        // Load role-specific prompt
        const fs = require('fs').promises;
        const path = require('path');
        let prompt = '';
        
        try {
            const promptPath = path.join(__dirname, 'prompts', `${userRole}.txt`);
            prompt = await fs.readFile(promptPath, 'utf8');
        } catch (err) {
            // Prompt file not found - use default
            prompt = `You are a helpful assistant for ${userRole}s in a School Management System.`;
        }
        
        // Use https module for Node.js (fetch may not be available)
        const https = require('https');
        const http = require('http');
        const url = require('url');
        
        // Parse URL
        const apiUrl = new URL(AI_API_URL);
        const isHttps = apiUrl.protocol === 'https:';
        const client = isHttps ? https : http;
        
        // Prepare request data
        const requestData = JSON.stringify({
            model: process.env.AI_MODEL || 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: message }
            ],
            max_tokens: 200,
            temperature: 0.7
        });
        
        // Call AI API using Node.js http/https
        return new Promise((resolve, reject) => {
            const options = {
                hostname: apiUrl.hostname,
                port: apiUrl.port || (isHttps ? 443 : 80),
                path: apiUrl.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${AI_API_KEY}`,
                    'Content-Length': Buffer.byteLength(requestData)
                },
                timeout: 5000 // 5 second timeout
            };
            
            const req = client.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const jsonData = JSON.parse(data);
                            resolve({
                                success: true,
                                message: jsonData.choices?.[0]?.message?.content || jsonData.response || 'I processed your request, but here\'s what I can tell you based on the latest system data...'
                            });
                        } catch (parseError) {
                            reject(new Error('Failed to parse AI response'));
                        }
                    } else {
                        reject(new Error(`AI API returned ${res.statusCode}`));
                    }
                });
            });
            
            req.on('error', (error) => {
                reject(error);
            });
            
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('AI API request timeout'));
            });
            
            req.write(requestData);
            req.end();
        });
        
    } catch (error) {
        console.error('[InternalChatbot] AI API call failed:', error.message);
        return null; // Return null to trigger fallback
    }
}

// Helper function: Get smart fallback response based on query and role
function getSmartFallbackResponse(message, userRole, userId) {
    const normalized = message.toLowerCase();
    
    // Role-based fallback responses
    const roleFallbacks = {
        student: {
            attendance: "I'm having trouble connecting right now, but based on the latest system data, your attendance records are available in your dashboard. Please check there for the most up-to-date information.",
            grades: "I'm temporarily offline, but your grades are accessible through your student dashboard. For detailed academic performance, please visit the dashboard.",
            schedule: "I can't access real-time data right now, but your class schedule and timetable are always available in your student dashboard.",
            exams: "For exam schedules and dates, please check your student dashboard. The information is updated regularly there.",
            default: "I'm having trouble connecting right now, but I can still help with basic info. Your student dashboard has all the latest information about attendance, grades, schedules, and assignments."
        },
        teacher: {
            attendance: "I'm temporarily offline, but class attendance data is available in your teacher dashboard. You can view and manage student attendance there.",
            students: "Student information is accessible through your teacher dashboard. Please check there for class rosters and student details.",
            exams: "Exam schedules and grading information are available in your teacher dashboard. Check there for the latest updates.",
            performance: "I can't access real-time analytics right now, but student performance insights are available in your teacher dashboard.",
            default: "I'm having trouble connecting right now, but your teacher dashboard has all the tools you need for class management, attendance tracking, and student performance monitoring."
        },
        admin: {
            alerts: "No critical alerts are reported today. For real-time security monitoring, please check the admin dashboard's security panel.",
            attendance: "Attendance summaries are available in your admin dashboard. The system is running normally with no issues reported.",
            system: "System status is operational. All services are running normally. For detailed system information, check the admin dashboard.",
            users: "User management tools are available in your admin dashboard. The system is functioning normally.",
            default: "I'm temporarily offline, but your admin dashboard provides comprehensive system management tools. All systems are operational with no critical issues reported."
        }
    };
    
    const fallbacks = roleFallbacks[userRole] || roleFallbacks.student;
    
    // Try to match query to specific fallback
    if (normalized.includes('attendance') || normalized.includes('present') || normalized.includes('absent')) {
        return {
            message: fallbacks.attendance || fallbacks.default,
            type: 'info',
            intent: 'attendance_fallback'
        };
    }
    
    if (normalized.includes('grade') || normalized.includes('mark') || normalized.includes('score')) {
        return {
            message: fallbacks.grades || fallbacks.default,
            type: 'info',
            intent: 'grades_fallback'
        };
    }
    
    if (normalized.includes('schedule') || normalized.includes('timetable') || normalized.includes('class')) {
        return {
            message: fallbacks.schedule || fallbacks.default,
            type: 'info',
            intent: 'schedule_fallback'
        };
    }
    
    if (normalized.includes('exam') || normalized.includes('test')) {
        return {
            message: fallbacks.exams || fallbacks.default,
            type: 'info',
            intent: 'exams_fallback'
        };
    }
    
    if (normalized.includes('alert') || normalized.includes('notification')) {
        return {
            message: fallbacks.alerts || fallbacks.default,
            type: 'info',
            intent: 'alerts_fallback'
        };
    }
    
    if (normalized.includes('system') || normalized.includes('status')) {
        return {
            message: fallbacks.system || fallbacks.default,
            type: 'info',
            intent: 'system_fallback'
        };
    }
    
    // Default fallback
    return {
        message: fallbacks.default,
        type: 'info',
        intent: 'general_fallback'
    };
}

// Helper function: Get default fallback response
function getDefaultFallbackResponse(userRole) {
    const defaults = {
        student: "I'm temporarily offline, but your student dashboard has all the information you need about attendance, grades, schedules, and assignments.",
        teacher: "I'm having trouble connecting right now, but your teacher dashboard provides all the tools for class management and student monitoring.",
        admin: "I'm temporarily offline, but your admin dashboard has comprehensive system management tools. All systems are operational."
    };
    
    return defaults[userRole] || defaults.student;
}

// Admin endpoint to view internal chatbot logs
app.get('/api/admin/internal-chatbot-logs', 
    authenticateToken, 
    authorizeRole(['admin']), 
    (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 50;
            const offset = parseInt(req.query.offset) || 0;
            const userRole = req.query.role || null;
            const userId = req.query.userId || null;
            
            let query = 'SELECT * FROM internal_chatbot_logs WHERE 1=1';
            const params = [];
            
            if (userRole) {
                query += ' AND user_role = ?';
                params.push(userRole);
            }
            
            if (userId) {
                query += ' AND user_id = ?';
                params.push(userId);
            }
            
            query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);
            
            db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('Error fetching internal chatbot logs:', err);
                    return res.status(500).json({
                        status: 'error',
                        message: 'Failed to fetch logs'
                    });
                }
                
                // Get total count
                let countQuery = 'SELECT COUNT(*) as total FROM internal_chatbot_logs WHERE 1=1';
                const countParams = [];
                
                if (userRole) {
                    countQuery += ' AND user_role = ?';
                    countParams.push(userRole);
                }
                
                if (userId) {
                    countQuery += ' AND user_id = ?';
                    countParams.push(userId);
                }
                
                db.get(countQuery, countParams, (err, countRow) => {
                    if (err) {
                        return res.status(500).json({
                            status: 'error',
                            message: 'Failed to fetch log count'
                        });
                    }
                    
                    res.json({
                        status: 'success',
                        data: rows,
                        total: countRow.total,
                        limit,
                        offset
                    });
                });
            });
        } catch (error) {
            console.error('Admin internal chatbot logs error:', error);
            res.status(500).json({
                status: 'error',
                message: 'Internal server error'
            });
        }
    }
);

// Cleanup rate limit map periodically
setInterval(() => {
    const now = Date.now();
    for (const [userId, limit] of internalChatbotRateLimit.entries()) {
        if (now > limit.resetTime) {
            internalChatbotRateLimit.delete(userId);
        }
    }
}, 5 * 60 * 1000); // Clean every 5 minutes

// Login Chatbot Logging Endpoint (Public - for login page chatbot)
// Rate limiting and security for unauthenticated users
const loginChatbotRateLimit = new Map(); // IP -> { count, resetTime }

// Rate limiting middleware for login chatbot
function loginChatbotRateLimitMiddleware(req, res, next) {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const maxRequests = 10; // Max 10 requests per minute
    
    // Get or create rate limit entry
    if (!loginChatbotRateLimit.has(clientIP)) {
        loginChatbotRateLimit.set(clientIP, { count: 0, resetTime: now + windowMs });
    }
    
    const limit = loginChatbotRateLimit.get(clientIP);
    
    // Reset if window expired
    if (now > limit.resetTime) {
        limit.count = 0;
        limit.resetTime = now + windowMs;
    }
    
    // Check limit
    if (limit.count >= maxRequests) {
        writeLog(LOG_FILE, `LOGIN_CHATBOT_RATE_LIMIT: IP ${clientIP} exceeded rate limit`);
        return res.status(429).json({
            status: 'error',
            message: 'Too many requests. Please wait a moment.',
            retryAfter: Math.ceil((limit.resetTime - now) / 1000)
        });
    }
    
    // Increment counter
    limit.count++;
    next();
}

// Input sanitization function
function sanitizeChatbotInput(input) {
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

// Login chatbot log endpoint (public, but rate-limited and sanitized)
app.post('/api/chatbot/log', loginChatbotRateLimitMiddleware, async (req, res) => {
    try {
        const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
        const { query, response, timestamp, page, userAgent } = req.body;
        
        // Sanitize all inputs
        const sanitizedQuery = sanitizeChatbotInput(query);
        const sanitizedResponse = sanitizeChatbotInput(response);
        const sanitizedPage = sanitizeChatbotInput(page || 'login');
        const sanitizedUserAgent = sanitizeChatbotInput(userAgent || 'Unknown');
        
        // Validate inputs
        if (!sanitizedQuery || sanitizedQuery.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid query'
            });
        }
        
        // Check for prompt injection attempts
        const promptInjectionPatterns = [
            /ignore\s+(previous|above|all)\s+instructions?/i,
            /system\s*:\s*you\s+are/i,
            /act\s+as\s+(if\s+you\s+are|a)/i,
            /forget\s+(everything|all|previous)/i,
            /new\s+instructions?\s*:/i,
            /override\s+(system|security|rules)/i
        ];
        
        for (const pattern of promptInjectionPatterns) {
            if (pattern.test(sanitizedQuery)) {
                writeLog(LOG_FILE, `LOGIN_CHATBOT_INJECTION_ATTEMPT: IP ${clientIP} - Query: ${sanitizedQuery.substring(0, 50)}`);
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid input detected'
                });
            }
        }
        
        // Log to file
        const logEntry = {
            timestamp: timestamp || new Date().toISOString(),
            ip: clientIP,
            query: sanitizedQuery,
            response: sanitizedResponse,
            page: sanitizedPage,
            userAgent: sanitizedUserAgent.substring(0, 200)
        };
        
        writeLog('./logs/login_chatbot.log', JSON.stringify(logEntry));
        
        // Store in database if table exists
        db.run(`CREATE TABLE IF NOT EXISTS login_chatbot_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL,
            query TEXT NOT NULL,
            response TEXT NOT NULL,
            page TEXT,
            user_agent TEXT,
            timestamp TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )`, (err) => {
            if (err) {
                console.error('Error creating login_chatbot_logs table:', err.message);
            } else {
                // Insert log entry
                db.run(
                    `INSERT INTO login_chatbot_logs (ip, query, response, page, user_agent, timestamp, created_at) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        clientIP,
                        sanitizedQuery,
                        sanitizedResponse,
                        sanitizedPage,
                        sanitizedUserAgent.substring(0, 200),
                        logEntry.timestamp,
                        Date.now()
                    ],
                    (err) => {
                        if (err) {
                            console.error('Error logging chatbot query:', err.message);
                        }
                    }
                );
            }
        });
        
        res.json({
            status: 'success',
            message: 'Query logged successfully'
        });
        
    } catch (error) {
        console.error('Login chatbot log error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
});

// Admin endpoint to view login chatbot logs (requires authentication)
app.get('/api/admin/login-chatbot-logs', authenticateToken, authorizeRole(['admin']), (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        
        db.all(
            `SELECT * FROM login_chatbot_logs 
             ORDER BY created_at DESC 
             LIMIT ? OFFSET ?`,
            [limit, offset],
            (err, rows) => {
                if (err) {
                    console.error('Error fetching chatbot logs:', err);
                    return res.status(500).json({
                        status: 'error',
                        message: 'Failed to fetch logs'
                    });
                }
                
                // Get total count
                db.get('SELECT COUNT(*) as total FROM login_chatbot_logs', (err, countRow) => {
                    if (err) {
                        return res.status(500).json({
                            status: 'error',
                            message: 'Failed to fetch log count'
                        });
                    }
                    
                    res.json({
                        status: 'success',
                        data: rows,
                        total: countRow.total,
                        limit,
                        offset
                    });
                });
            }
        );
    } catch (error) {
        console.error('Admin chatbot logs error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
});

// Cleanup rate limit map periodically
setInterval(() => {
    const now = Date.now();
    for (const [ip, limit] of loginChatbotRateLimit.entries()) {
        if (now > limit.resetTime) {
            loginChatbotRateLimit.delete(ip);
        }
    }
}, 5 * 60 * 1000); // Clean every 5 minutes

// Login endpoint
app.post('/api/login', async (req, res) => {
    const { username, password, role } = req.body;
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    
    if (!username || !password || !role) {
        logLoginAttempt(username || 'unknown', role || 'unknown', false, 'Missing credentials', clientIP);
        return res.status(400).json({ 
            status: 'failed', 
            message: 'Username, password, and role are required' 
        });
    }
    
    const query = 'SELECT * FROM users WHERE username = ? AND role = ?';
    
    console.log("Login attempt:", { username, role });
    
    db.get(query, [username, role], async (err, user) => {
        console.log("DB user:", user ? { id: user.id, username: user.username, role: user.role } : null);
        if (err) {
            console.error('Database error during login:', err);
            logLoginAttempt(username, role, false, 'Database error', clientIP);
            return res.status(500).json({ 
                status: 'failed', 
                message: 'Database error. Please contact support.' 
            });
        }
        
        if (!user) {
            console.log('User not found in database for:', { username, role });
            logLoginAttempt(username, role, false, 'User not found', clientIP);
            trackFailedLogin(clientIP, username, 'User not found', req.get('User-Agent'));
            return res.status(401).json({ 
                status: 'failed', 
                message: 'User not found. Please check your username and role.' 
            });
        }
        
        // Password verification using bcrypt
        try {
            // PRODUCTION MODE - Compare hashed passwords
            const isPasswordValid = await bcrypt.compare(password, user.password);
            
            if (!isPasswordValid) {
                console.log('Invalid password for user:', username);
                logLoginAttempt(username, role, false, 'Invalid password', clientIP);
                trackFailedLogin(clientIP, username, 'Invalid password', req.get('User-Agent'));
                return res.status(401).json({ 
                    status: 'failed', 
                    message: 'Invalid password. Please try again.' 
                });
            }
            
            // Create session and generate JWT token with role-based timeout
            const sessionId = createSession(user.id, user.username, user.role);
            const timeout = getSessionTimeout(user.role);
            const expiresInSeconds = Math.floor(timeout / 1000);
            
            const token = jwt.sign(
                { 
                    userId: user.id, 
                    username: user.username, 
                    role: user.role,
                    sessionId: sessionId,
                    iat: Math.floor(Date.now() / 1000)
                },
                process.env.JWT_SECRET || 'your-secret-key',
                { expiresIn: expiresInSeconds }
            );
            
            logLoginAttempt(username, role, true, 'Successful login', clientIP);
            
            // Determine redirect URL based on role
            let redirectUrl;
            if (user.role === 'admin') {
                redirectUrl = '/dashboard.html';
            } else if (user.role === 'student') {
                redirectUrl = '/student/student_dashboard.html';
            } else if (user.role === 'teacher') {
                redirectUrl = '/teacher/teacher_dashboard.html';
            } else {
                redirectUrl = '/dashboard.html';
            }
            
            // Don't send password back in the response
            delete user.password;
            return res.status(200).json({ 
                status: 'success', 
                user: user,
                token: token,
                sessionId: sessionId,
                expiresIn: expiresInSeconds,
                expiresAt: new Date(Date.now() + timeout).toISOString(),
                redirectUrl: redirectUrl,
                sessionTimeout: {
                    role: user.role,
                    timeoutMs: timeout,
                    warningThreshold: SESSION_CONFIG.WARNING_THRESHOLD,
                    canRefresh: SESSION_CONFIG.AUTO_REFRESH_ENABLED,
                    maxRefreshCount: SESSION_CONFIG.MAX_REFRESH_COUNT
                }
            });
        } catch (error) {
            console.error('Password verification error:', error);
            logLoginAttempt(username, role, false, 'Password verification error', clientIP);
            return res.status(500).json({ 
                status: 'failed', 
                message: 'Internal server error' 
            });
        }
    });
});

app.get('/api/me', authenticateToken, (req, res) => {
    db.get(
        'SELECT id, username, role, email, full_name, phone, department, two_factor_enabled, avatar, student_id FROM users WHERE id = ?',
        [req.user.userId],
        (err, row) => {
            if (err) {
                console.error('Error fetching current user:', err);
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to fetch user profile'
                });
            }
            if (!row) {
                return res.status(404).json({
                    status: 'error',
                    message: 'User not found'
                });
            }
            return res.json({
                status: 'success',
                user: {
                    ...row,
                    twoFactor: row.two_factor_enabled ? 'enabled' : 'disabled'
                }
            });
        }
    );
});

app.put('/api/admin/profile', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const { fullName, email, phone, department } = req.body || {};

    if (!fullName || !email || !phone || !department) {
        return res.status(400).json({
            status: 'error',
            message: 'fullName, email, phone, and department are required'
        });
    }

    if (!isValidEmail(email)) {
        return res.status(400).json({
            status: 'error',
            message: 'Valid email is required'
        });
    }

    db.run(
        'UPDATE users SET full_name = ?, email = ?, phone = ?, department = ? WHERE id = ?',
        [fullName.trim(), email.trim(), phone.trim(), department.trim(), req.user.userId],
        function(err) {
            if (err) {
                console.error('Error updating admin profile:', err);
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to update profile'
                });
            }

            return res.json({
                status: 'success',
                message: 'Profile updated successfully'
            });
        }
    );
});

// Update admin avatar
app.put('/api/admin/avatar', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const { avatar } = req.body || {};

    if (!avatar) {
        return res.status(400).json({
            status: 'error',
            message: 'Avatar data is required'
        });
    }

    // Validate base64 image format
    if (!avatar.startsWith('data:image/')) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid image format. Expected base64 data URI'
        });
    }

    db.run(
        'UPDATE users SET avatar = ? WHERE id = ?',
        [avatar, req.user.userId],
        function(err) {
            if (err) {
                console.error('Error updating avatar:', err);
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to update avatar'
                });
            }

            return res.json({
                status: 'success',
                message: 'Avatar updated successfully'
            });
        }
    );
});

app.post('/api/admin/change-password', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
        return res.status(400).json({
            status: 'error',
            message: 'currentPassword and newPassword are required'
        });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({
            status: 'error',
            message: 'New password must be at least 8 characters long'
        });
    }

    db.get('SELECT password FROM users WHERE id = ?', [req.user.userId], async (err, row) => {
        if (err) {
            console.error('Error fetching current password:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to update password'
            });
        }

        if (!row) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        const matches = await bcrypt.compare(currentPassword, row.password);
        if (!matches) {
            return res.status(401).json({
                status: 'error',
                message: 'Current password is incorrect'
            });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user.userId], function(updateErr) {
            if (updateErr) {
                console.error('Error updating password:', updateErr);
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to update password'
                });
            }

            return res.json({
                status: 'success',
                message: 'Password updated successfully'
            });
        });
    });
});

app.post('/api/2fa/send-email-otp', authenticateToken, (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const userId = req.user.userId;
    const { email, purpose } = req.body || {};

    if (!isValidEmail(email)) {
        return res.status(400).json({
            status: 'error',
            message: 'Valid email is required'
        });
    }

    const otpPurpose = (typeof purpose === 'string' && purpose.trim()) ? purpose.trim() : 'toggle_2fa';
    const otp = generateEmailOtp();
    const salt = crypto.randomBytes(16).toString('hex');
    const otpHash = hashOtp(otp, salt);
    const now = Date.now();
    const expiresAt = now + 5 * 60 * 1000;

    db.serialize(() => {
        db.run(
            'UPDATE email_otps SET used = 1 WHERE user_id = ? AND purpose = ? AND used = 0',
            [userId, otpPurpose]
        );

        db.run(
            'UPDATE users SET email = ? WHERE id = ?',
            [email.trim(), userId]
        );

        db.run(
            'INSERT INTO email_otps (user_id, email, purpose, otp_hash, salt, expires_at, used, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
            [userId, email.trim(), otpPurpose, otpHash, salt, expiresAt, now],
            async (err) => {
                if (err) {
                    console.error('Error creating email OTP:', err);
                    writeLog(LOG_FILE, `OTP_CREATE_FAILED: User ${req.user.username} - IP: ${clientIP} - Error: ${err.message}`);
                    return res.status(500).json({
                        status: 'error',
                        message: 'Failed to create OTP'
                    });
                }

                try {
                    const emailResult = await sendOtpEmail(email.trim(), otp);
                    const response = {
                        status: 'success',
                        message: emailResult.sent ? 'OTP sent successfully' : 'OTP generated (email not configured)',
                        expiresInMs: 5 * 60 * 1000
                    };

                    if (process.env.NODE_ENV === 'development' && !emailResult.sent) {
                        response.otp = otp;
                    }

                    writeLog(LOG_FILE, `OTP_SENT: User ${req.user.username} - Email: ${email.trim()} - Purpose: ${otpPurpose} - IP: ${clientIP} - Sent: ${emailResult.sent}`);
                    return res.json(response);
                } catch (sendErr) {
                    console.error('OTP email send failed:', sendErr);
                    writeLog(LOG_FILE, `OTP_SEND_FAILED: User ${req.user.username} - Email: ${email.trim()} - Purpose: ${otpPurpose} - IP: ${clientIP} - Error: ${sendErr.message}`);
                    const response = {
                        status: 'success',
                        message: 'OTP generated (email send failed)',
                        expiresInMs: 5 * 60 * 1000
                    };
                    if (process.env.NODE_ENV === 'development') {
                        response.otp = otp;
                    }
                    return res.json(response);
                }
            }
        );
    });
});

app.post('/api/2fa/verify-email-otp', authenticateToken, (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const userId = req.user.userId;
    const { email, otp, desiredStatus, purpose } = req.body || {};

    if (!isValidEmail(email)) {
        return res.status(400).json({
            status: 'error',
            message: 'Valid email is required'
        });
    }

    const otpStr = typeof otp === 'string' ? otp.trim() : '';
    if (!/^\d{6}$/.test(otpStr)) {
        return res.status(400).json({
            status: 'error',
            message: 'Valid 6-digit OTP is required'
        });
    }

    const otpPurpose = (typeof purpose === 'string' && purpose.trim()) ? purpose.trim() : 'toggle_2fa';
    const normalizedDesired = (desiredStatus === 'enabled' || desiredStatus === 'disabled') ? desiredStatus : null;
    if (!normalizedDesired) {
        return res.status(400).json({
            status: 'error',
            message: 'desiredStatus must be enabled or disabled'
        });
    }

    const now = Date.now();
    db.get(
        'SELECT * FROM email_otps WHERE user_id = ? AND email = ? AND purpose = ? AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
        [userId, email.trim(), otpPurpose, now],
        (err, row) => {
            if (err) {
                console.error('OTP lookup failed:', err);
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to verify OTP'
                });
            }

            if (!row) {
                return res.status(400).json({
                    status: 'error',
                    message: 'OTP not found or expired'
                });
            }

            const computed = hashOtp(otpStr, row.salt);
            if (computed !== row.otp_hash) {
                writeLog(LOG_FILE, `OTP_VERIFY_FAILED: User ${req.user.username} - Email: ${email.trim()} - Purpose: ${otpPurpose} - IP: ${clientIP}`);
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid OTP'
                });
            }

            const enabledValue = normalizedDesired === 'enabled' ? 1 : 0;
            db.serialize(() => {
                db.run('UPDATE email_otps SET used = 1 WHERE id = ?', [row.id]);
                db.run('UPDATE users SET two_factor_enabled = ?, email = ? WHERE id = ?', [enabledValue, email.trim(), userId], (updateErr) => {
                    if (updateErr) {
                        console.error('2FA update failed:', updateErr);
                        return res.status(500).json({
                            status: 'error',
                            message: 'Failed to update 2FA status'
                        });
                    }

                    writeLog(LOG_FILE, `OTP_VERIFY_SUCCESS: User ${req.user.username} - Email: ${email.trim()} - 2FA: ${normalizedDesired} - IP: ${clientIP}`);
                    return res.json({
                        status: 'success',
                        message: 'OTP verified',
                        twoFactor: normalizedDesired
                    });
                });
            });
        }
    );
});

// ======================
// ======================
// SESSION MANAGEMENT ENDPOINTS
// ======================

// Refresh token endpoint
app.post('/api/refresh-token', authenticateToken, (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const sessionId = req.sessionId || req.headers['x-session-id'];
    
    if (!sessionId) {
        return res.status(400).json({
            status: 'failed',
            message: 'Session ID required for token refresh'
        });
    }
    
    const refreshResult = refreshSession(sessionId);
    
    if (!refreshResult.success) {
        writeLog(SESSION_LOG_FILE, `TOKEN_REFRESH_FAILED: User ${req.user.username} - SessionId: ${sessionId} - Reason: ${refreshResult.reason} - IP: ${clientIP}`);
        
        return res.status(401).json({
            status: 'failed',
            message: 'Unable to refresh token',
            code: refreshResult.reason,
            requiresReauth: refreshResult.reason === 'MAX_REFRESH_EXCEEDED' || refreshResult.reason === 'SESSION_NOT_FOUND'
        });
    }
    
    // Generate new JWT token
    const timeout = getSessionTimeout(req.user.role);
    const expiresInSeconds = Math.floor(timeout / 1000);
    
    const newToken = jwt.sign(
        { 
            userId: req.user.userId, 
            username: req.user.username, 
            role: req.user.role,
            sessionId: sessionId,
            iat: Math.floor(Date.now() / 1000)
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: expiresInSeconds }
    );
    
    writeLog(SESSION_LOG_FILE, `TOKEN_REFRESHED: User ${req.user.username} - SessionId: ${sessionId} - Refresh #${refreshResult.session.refreshCount} - IP: ${clientIP}`);
    
    res.json({
        status: 'success',
        token: newToken,
        expiresIn: expiresInSeconds,
        expiresAt: new Date(refreshResult.newExpiresAt).toISOString(),
        refreshCount: refreshResult.session.refreshCount,
        maxRefreshCount: SESSION_CONFIG.MAX_REFRESH_COUNT
    });
});

// Get session info endpoint
app.get('/api/session-info', authenticateToken, (req, res) => {
    const sessionId = req.sessionId || req.headers['x-session-id'];
    
    if (!sessionId || !req.session) {
        return res.json({
            status: 'success',
            sessionManagement: false,
            message: 'Session management not active for this token'
        });
    }
    
    const now = Date.now();
    const timeUntilExpiry = req.session.expiresAt - now;
    
    res.json({
        status: 'success',
        sessionManagement: true,
        session: {
            id: sessionId,
            userId: req.session.userId,
            username: req.session.username,
            role: req.session.role,
            issuedAt: new Date(req.session.issuedAt).toISOString(),
            lastActivity: new Date(req.session.lastActivity).toISOString(),
            expiresAt: new Date(req.session.expiresAt).toISOString(),
            timeUntilExpiry: timeUntilExpiry,
            refreshCount: req.session.refreshCount,
            maxRefreshCount: SESSION_CONFIG.MAX_REFRESH_COUNT,
            canRefresh: SESSION_CONFIG.AUTO_REFRESH_ENABLED && req.session.refreshCount < SESSION_CONFIG.MAX_REFRESH_COUNT,
            warningThreshold: SESSION_CONFIG.WARNING_THRESHOLD,
            isNearExpiry: timeUntilExpiry <= SESSION_CONFIG.WARNING_THRESHOLD
        }
    });
});

// Logout endpoint (invalidate session)
app.post('/api/logout', authenticateToken, (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const sessionId = req.sessionId || req.headers['x-session-id'];
    
    if (sessionId && activeSessions.has(sessionId)) {
        const session = activeSessions.get(sessionId);
        activeSessions.delete(sessionId);
        updateSessionStats('SESSION_LOGOUT');
        writeLog(SESSION_LOG_FILE, `SESSION_LOGOUT: User ${session.username} (${session.role}) - SessionId: ${sessionId} - IP: ${clientIP}`);
    }
    
    writeLog(LOG_FILE, `LOGOUT: User ${req.user.username} (${req.user.role}) - IP: ${clientIP}`);
    
    res.json({
        status: 'success',
        message: 'Logged out successfully'
    });
});

// MFA Endpoints for Admin Profile

// GET /api/admin/info - Get current admin info including MFA status
app.get('/api/admin/info', authenticateToken, authorizeRole(['admin']), (req, res) => {
    db.get('SELECT id, username, mfa_enabled FROM users WHERE id = ? AND role = ?', [req.user.userId, 'admin'], (err, user) => {
        if (err) {
            console.error('Error getting admin info:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'Admin not found' });
        }
        
        res.json({
            success: true,
            admin: {
                id: user.id,
                username: user.username,
                two_factor_enabled: user.mfa_enabled === 1
            }
        });
    });
});

// POST /api/admin/mfa-toggle - Enable/disable MFA for admin with password verification
app.post('/api/admin/mfa-toggle', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const { enable, password } = req.body;
    
    if (!password) {
        return res.status(400).json({ success: false, message: 'Password is required' });
    }
    
    // Get admin's current password hash and email
    db.get('SELECT id, password, mfa_enabled, email FROM users WHERE id = ? AND role = ?', [req.user.userId, 'admin'], (err, user) => {
        if (err) {
            console.error('Error getting admin:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'Admin not found' });
        }
        
        // Verify password
        bcrypt.compare(password, user.password, (compareErr, passwordMatch) => {
            if (compareErr) {
                console.error('Password comparison error:', compareErr);
                return res.status(500).json({ success: false, message: 'Server error' });
            }
            
            if (!passwordMatch) {
                return res.status(401).json({ success: false, message: 'Invalid password' });
            }
            
            // If enabling MFA, generate OTP and send email
            if (enable) {
                if (!user.email) {
                    return res.status(500).json({ success: false, message: 'No email address configured for admin' });
                }
                
                const otp = generateEmailOtp();
                const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
                
                // Store OTP in database
                db.run('INSERT INTO mfa_otps (user_id, otp_code, expires_at) VALUES (?, ?, ?)', 
                    [req.user.userId, otp, expiresAt], 
                    (insertErr) => {
                        if (insertErr) {
                            console.error('Error storing OTP:', insertErr);
                            return res.status(500).json({ success: false, message: 'Failed to generate OTP' });
                        }
                        
                        // Send OTP via email using actual admin email
                        sendOtpEmail(user.email, otp).then((emailResult) => {
                            if (emailResult.sent) {
                                console.log(`MFA OTP sent to admin email: ${user.email}`);
                                res.json({
                                    success: true,
                                    step: 'VERIFY_OTP',
                                    message: 'OTP sent to your email for verification'
                                });
                            } else {
                                console.error('Failed to send MFA OTP to:', user.email, 'Reason:', emailResult.reason);
                                res.status(500).json({ success: false, message: 'Failed to send OTP email' });
                            }
                        }).catch((emailErr) => {
                            console.error('Email error:', emailErr);
                            res.status(500).json({ success: false, message: 'Failed to send OTP email' });
                        });
                    }
                );
            } else {
                // Disabling MFA - directly update
                db.run('UPDATE users SET mfa_enabled = 0 WHERE id = ?', [req.user.userId], (updateErr) => {
                    if (updateErr) {
                        console.error('Error disabling MFA:', updateErr);
                        return res.status(500).json({ success: false, message: 'Failed to disable MFA' });
                    }
                    
                    res.json({
                        success: true,
                        message: 'MFA disabled successfully'
                    });
                });
            }
        });
    });
});

// POST /api/admin/verify-mfa-enable - Verify OTP to enable MFA
app.post('/api/admin/verify-mfa-enable', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const { otp } = req.body;
    
    if (!otp || otp.length !== 6) {
        return res.status(400).json({ success: false, message: 'Invalid OTP format' });
    }
    
    // Get the most recent OTP for this admin
    db.get('SELECT id, otp_code, expires_at, used FROM mfa_otps WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', 
        [req.user.userId], 
        (err, otpRecord) => {
            if (err) {
                console.error('Error getting OTP:', err);
                return res.status(500).json({ success: false, message: 'Database error' });
            }
            
            if (!otpRecord) {
                return res.status(400).json({ success: false, message: 'No OTP found' });
            }
            
            // Check if OTP is expired
            if (new Date() > new Date(otpRecord.expires_at)) {
                return res.status(400).json({ success: false, message: 'OTP has expired' });
            }
            
            // Check if OTP has already been used
            if (otpRecord.used === 1) {
                return res.status(400).json({ success: false, message: 'OTP has already been used' });
            }
            
            // Check if OTP matches
            if (otp !== otpRecord.otp_code) {
                return res.status(400).json({ success: false, message: 'Invalid OTP' });
            }
            
            // OTP is valid - mark as used and enable MFA
            db.run('UPDATE mfa_otps SET used = 1 WHERE id = ?', [otpRecord.id], (updateErr) => {
                if (updateErr) {
                    console.error('Error marking OTP as used:', updateErr);
                    return res.status(500).json({ success: false, message: 'Database error' });
                }
                
                db.run('UPDATE users SET mfa_enabled = 1 WHERE id = ?', [req.user.userId], (updateUserErr) => {
                    if (updateUserErr) {
                        console.error('Error enabling MFA:', updateUserErr);
                        return res.status(500).json({ success: false, message: 'Failed to enable MFA' });
                    }
                    
                    res.json({
                        success: true,
                        message: 'MFA enabled successfully'
                    });
                });
            });
        }
    );
});

// POST /api/admin/resend-mfa-otp - Resend OTP for MFA enable
app.post('/api/admin/resend-mfa-otp', authenticateToken, authorizeRole(['admin']), (req, res) => {
    // Clean expired OTPs first
    db.run('DELETE FROM mfa_otps WHERE expires_at < ?', [new Date().toISOString()], (cleanErr) => {
        if (cleanErr) {
            console.error('Error cleaning expired OTPs:', cleanErr);
        }
    });
    
    // Get admin's email from database
    db.get('SELECT email FROM users WHERE id = ?', [req.user.userId], (emailErr, user) => {
        if (emailErr) {
            console.error('Error fetching user email:', emailErr);
            return res.status(500).json({ success: false, message: 'Failed to fetch user email' });
        }
        
        if (!user || !user.email) {
            console.error('No email found for admin user:', req.user.userId);
            return res.status(500).json({ success: false, message: 'No email address configured for admin' });
        }
        
        // Generate new OTP
        const otp = generateEmailOtp();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        
        // Store new OTP
        db.run('INSERT INTO mfa_otps (user_id, otp_code, expires_at) VALUES (?, ?, ?)', 
            [req.user.userId, otp, expiresAt], 
            (insertErr) => {
                if (insertErr) {
                    console.error('Error storing OTP:', insertErr);
                    return res.status(500).json({ success: false, message: 'Failed to generate OTP' });
                }
                
                // Send OTP via email using actual admin email
                sendOtpEmail(user.email, otp).then((emailResult) => {
                    if (emailResult.sent) {
                        console.log(`OTP sent to admin email: ${user.email}`);
                        res.json({
                            success: true,
                            message: 'New OTP sent to your email'
                        });
                    } else {
                        console.error('Failed to send OTP to:', user.email, 'Reason:', emailResult.reason);
                        res.status(500).json({ success: false, message: 'Failed to send OTP email' });
                    }
                }).catch((emailErr) => {
                    console.error('Email error:', emailErr);
                    res.status(500).json({ success: false, message: 'Failed to send OTP email' });
                });
            }
        );
    });
});

// Admin endpoint to view session statistics
app.get('/api/admin/session-stats', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const stats = getSessionStatistics();
    res.json({
        status: 'success',
        ...stats
    });
});

// USER MANAGEMENT (Admin only)
// ======================

// GET all users (without passwords)
app.get('/users', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const sql = 'SELECT id, username, role FROM users';
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching users:', err);
            return res.status(500).json({ status: 'error', message: 'Failed to fetch users' });
        }
        
        // ADS: Track user management access
        const userId = req.user.userId;
        const recordCount = rows.length;
        trackUserActivity(userId, 'FETCH_USERS', { 
            count: recordCount, 
            userRole: req.user.role,
            endpoint: '/users'
        });
        
        res.json({ status: 'success', data: rows });
    });
});

// CREATE new user
app.post('/users', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
        return res.status(400).json({ status: 'error', message: 'username, password and role are required' });
    }
    try {
        const hashed = await bcrypt.hash(password, 10);
        const stmt = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
        stmt.run(username, hashed, role, function(err) {
            if (err) {
                console.error('Error creating user:', err);
                return res.status(500).json({ status: 'error', message: 'Failed to create user' });
            }
            res.status(201).json({ status: 'success', message: 'User created', userId: this.lastID });
        });
    } catch (e) {
        console.error('Error hashing password:', e);
        return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Update password endpoint
app.post('/api/update-password', async (req, res) => {
    const { username, newPassword } = req.body;
    
    if (!username || !newPassword) {
        return res.status(400).json({ 
            status: 'failed', 
            message: 'Username and new password are required' 
        });
    }
    
    try {
        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        const query = 'UPDATE users SET password = ? WHERE username = ?';
        
        db.run(query, [hashedPassword, username], function(err) {
            if (err) {
                console.error('Error updating password:', err);
                return res.status(500).json({ 
                    status: 'failed', 
                    message: 'Error updating password' 
                });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ 
                    status: 'failed', 
                    message: 'User not found' 
                });
            }
            
            res.status(200).json({ 
                status: 'updated',
                message: 'Password updated successfully'
            });
        });
    } catch (error) {
        console.error('Password hashing error:', error);
        return res.status(500).json({ 
            status: 'failed', 
            message: 'Error updating password' 
        });
    }
});

// Test database connection
app.get('/test-db', (req, res) => {
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='students'", (err, row) => {
        if (err) {
            console.error('Database test error:', err);
            return res.status(500).json({ 
                status: 'error', 
                message: 'Database test failed',
                error: process.env.NODE_ENV === 'development' ? err.message : undefined
            });
        }
        
        res.json({ 
            status: 'success', 
            database: 'connected',
            studentsTable: row ? 'exists' : 'not found',
            details: row || {}
        });
    });
});

// ======================
// TEACHER ROUTES
// ======================

// GET all teachers (Admin only)
app.get('/teachers', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const sql = 'SELECT * FROM teachers';
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching teachers:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch teachers'
            });
        }
        // Decrypt sensitive fields for authorized users
        const decryptedRows = rows.map(row => ({
            ...row,
            name: decrypt(row.name),
            subject: row.subject ? decrypt(row.subject) : null,
            experience: row.experience ? parseInt(decrypt(row.experience)) : null,
            email: row.email ? decrypt(row.email) : null,
            phone: row.phone ? decrypt(row.phone) : null,
            department: row.department ? decrypt(row.department) : null
        }));
        
        // ADS: Track mass teacher record fetch
        const userId = req.user.userId;
        const recordCount = decryptedRows.length;
        trackUserActivity(userId, 'FETCH_TEACHERS', { 
            count: recordCount, 
            userRole: req.user.role,
            endpoint: '/teachers'
        });
        
        res.json({
            status: 'success',
            data: decryptedRows
        });
    });
});

// GET single teacher by ID (Admin only)
app.get('/teachers/:id', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const sql = 'SELECT * FROM teachers WHERE id = ?';
    db.get(sql, [req.params.id], (err, row) => {
        if (err) {
            console.error('Error fetching teacher:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch teacher'
            });
        }
        if (!row) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }
        // Decrypt sensitive fields for authorized users
        const decryptedRow = {
            ...row,
            name: decrypt(row.name),
            subject: row.subject ? decrypt(row.subject) : null,
            experience: row.experience ? parseInt(decrypt(row.experience)) : null
        };
        res.json({
            status: 'success',
            data: decryptedRow
        });
    });
});

// CREATE new teacher
app.post('/teachers', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const { name, subject, experience, email, phone, department } = req.body;
    
    if (!name) {
        return res.status(400).json({
            status: 'error',
            message: 'Name is required'
        });
    }
    
    // Encrypt sensitive fields
    const encryptedName = encrypt(name);
    const encryptedSubject = subject ? encrypt(subject) : null;
    const encryptedExperience = experience ? encrypt(experience.toString()) : null;
    const encryptedEmail = email ? encrypt(email) : null;
    const encryptedPhone = phone ? encrypt(phone) : null;
    const encryptedDepartment = department ? encrypt(department) : null;
    
    const sql = 'INSERT INTO teachers (name, subject, experience, email, phone, department) VALUES (?, ?, ?, ?, ?, ?)';
    const params = [encryptedName, encryptedSubject, encryptedExperience, encryptedEmail, encryptedPhone, encryptedDepartment];
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('Error creating teacher:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to create teacher'
            });
        }
        
        res.status(201).json({
            status: 'success',
            message: 'Teacher created successfully',
            teacherId: this.lastID
        });
    });
});

// UPDATE teacher
app.put('/teachers/:id', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const { name, subject, experience, email, phone, department } = req.body;
    
    if (!name) {
        return res.status(400).json({
            status: 'error',
            message: 'Name is required'
        });
    }
    
    // Encrypt sensitive fields
    const encryptedName = encrypt(name);
    const encryptedSubject = subject ? encrypt(subject) : null;
    const encryptedExperience = experience ? encrypt(experience.toString()) : null;
    const encryptedEmail = email ? encrypt(email) : null;
    const encryptedPhone = phone ? encrypt(phone) : null;
    const encryptedDepartment = department ? encrypt(department) : null;
    
    const sql = `
        UPDATE teachers 
        SET name = COALESCE(?, name),
            subject = COALESCE(?, subject),
            experience = COALESCE(?, experience),
            email = COALESCE(?, email),
            phone = COALESCE(?, phone),
            department = COALESCE(?, department)
        WHERE id = ?
    `;
    const params = [encryptedName, encryptedSubject, encryptedExperience, encryptedEmail, encryptedPhone, encryptedDepartment, req.params.id];
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('Error updating teacher:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to update teacher'
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }
        
        res.json({
            status: 'success',
            message: 'Teacher updated successfully',
            changes: this.changes
        });
    });
});

// DELETE teacher
app.delete('/teachers/:id', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const sql = 'DELETE FROM teachers WHERE id = ?';
    
    db.run(sql, [req.params.id], function(err) {
        if (err) {
            console.error('Error deleting teacher:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to delete teacher'
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Teacher not found'
            });
        }
        
        res.json({
            status: 'success',
            message: 'Teacher deleted successfully',
            changes: this.changes
        });
    });
});

// ======================
// CLASSES MANAGEMENT
// ======================

// GET all classes
app.get('/classes', authenticateToken, authorizeRole(['admin', 'teacher']), (req, res) => {
    const sql = 'SELECT * FROM classes';
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching classes:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch classes'
            });
        }
        res.json({
            status: 'success',
            data: rows
        });
    });
});

// CREATE new class
app.post('/classes', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const { name, room, capacity } = req.body;
    
    if (!name) {
        return res.status(400).json({
            status: 'error',
            message: 'Class name is required'
        });
    }
    
    const sql = 'INSERT INTO classes (name, room, capacity) VALUES (?, ?, ?)';
    const params = [name, room || null, capacity || null];
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('Error creating class:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to create class'
            });
        }
        
        res.status(201).json({
            status: 'success',
            message: 'Class created successfully',
            classId: this.lastID
        });
    });
});

// UPDATE class
app.put('/classes/:id', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const { name, room, capacity } = req.body;
    
    if (!name) {
        return res.status(400).json({
            status: 'error',
            message: 'Class name is required'
        });
    }
    
    const sql = `
        UPDATE classes 
        SET name = COALESCE(?, name),
            room = COALESCE(?, room),
            capacity = COALESCE(?, capacity)
        WHERE id = ?
    `;
    const params = [name, room || null, capacity || null, req.params.id];
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('Error updating class:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to update class'
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Class not found'
            });
        }
        
        res.json({
            status: 'success',
            message: 'Class updated successfully'
        });
    });
});

// DELETE class
app.delete('/classes/:id', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const sql = 'DELETE FROM classes WHERE id = ?';
    
    db.run(sql, [req.params.id], function(err) {
        if (err) {
            console.error('Error deleting class:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to delete class'
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Class not found'
            });
        }
        
        res.json({
            status: 'success',
            message: 'Class deleted successfully'
        });
    });
});

// ======================
// SUBJECTS MANAGEMENT
// ======================

// GET all subjects
app.get('/subjects', authenticateToken, authorizeRole(['admin', 'teacher']), (req, res) => {
    const sql = 'SELECT * FROM subjects';
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching subjects:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch subjects'
            });
        }
        res.json({
            status: 'success',
            data: rows
        });
    });
});

// CREATE new subject
app.post('/subjects', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const { name, code, credits } = req.body;
    
    if (!name) {
        return res.status(400).json({
            status: 'error',
            message: 'Subject name is required'
        });
    }
    
    const sql = 'INSERT INTO subjects (name, code, credits) VALUES (?, ?, ?)';
    const params = [name, code || null, credits || null];
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('Error creating subject:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to create subject'
            });
        }
        
        res.status(201).json({
            status: 'success',
            message: 'Subject created successfully',
            subjectId: this.lastID
        });
    });
});

// UPDATE subject
app.put('/subjects/:id', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const { name, code, credits } = req.body;
    
    if (!name) {
        return res.status(400).json({
            status: 'error',
            message: 'Subject name is required'
        });
    }
    
    const sql = `
        UPDATE subjects 
        SET name = COALESCE(?, name),
            code = COALESCE(?, code),
            credits = COALESCE(?, credits)
        WHERE id = ?
    `;
    const params = [name, code || null, credits || null, req.params.id];
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('Error updating subject:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to update subject'
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Subject not found'
            });
        }
        
        res.json({
            status: 'success',
            message: 'Subject updated successfully'
        });
    });
});

// DELETE subject
app.delete('/subjects/:id', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const sql = 'DELETE FROM subjects WHERE id = ?';
    
    db.run(sql, [req.params.id], function(err) {
        if (err) {
            console.error('Error deleting subject:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to delete subject'
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Subject not found'
            });
        }
        
        res.json({
            status: 'success',
            message: 'Subject deleted successfully'
        });
    });
});

// ======================
// TIMETABLE MANAGEMENT
// ======================

// CREATE new timetable entry
app.post('/timetables', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const { class_id, subject_id, teacher_id, day, time_slot } = req.body;
    
    if (!class_id || !subject_id || !teacher_id || !day || !time_slot) {
        return res.status(400).json({
            status: 'error',
            message: 'All fields are required'
        });
    }
    
    const sql = 'INSERT INTO timetables (class_id, subject_id, teacher_id, day, time_slot) VALUES (?, ?, ?, ?, ?)';
    const params = [class_id, subject_id, teacher_id, day, time_slot];
    
    db.run(sql, params, function(err) {
        if (err) {
            console.error('Error creating timetable:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to create timetable'
            });
        }
        
        res.status(201).json({
            status: 'success',
            message: 'Timetable created successfully',
            timetableId: this.lastID
        });
    });
});

// GET all students (admins and teachers only)
app.get('/students', authenticateToken, authorizeRole(['admin', 'teacher']), (req, res) => {
    const sql = 'SELECT * FROM students';
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(400).json({
                status: 'error',
                message: err.message
            });
        }
        // Decrypt sensitive fields for authorized users
        const decryptedRows = rows.map(row => ({
            ...row,
            name: decrypt(row.name),
            age: row.age ? parseInt(decrypt(row.age)) : null,
            grade: row.grade ? decrypt(row.grade) : null,
            email: row.email ? decrypt(row.email) : null,
            class: row.class,
            phone: row.phone ? decrypt(row.phone) : null,
            address: row.address ? decrypt(row.address) : null
        }));
        
        // ADS: Track mass student record fetch
        const userId = req.user.userId;
        const recordCount = decryptedRows.length;
        trackUserActivity(userId, 'FETCH_STUDENTS', { 
            count: recordCount, 
            userRole: req.user.role,
            endpoint: '/students'
        });
        
        res.json({
            status: 'success',
            data: decryptedRows
        });
    });
});

// GET current student's own profile
app.get('/students/me', authenticateToken, authorizeRole(['student']), (req, res) => {
    const sql = 'SELECT * FROM students WHERE user_id = ?';
    db.get(sql, [req.user.userId], (err, row) => {
        if (err) {
            return res.status(400).json({
                status: 'error',
                message: err.message
            });
        }
        if (!row) {
            return res.status(404).json({
                status: 'error',
                message: 'Student profile not found'
            });
        }
        // Decrypt sensitive fields for authorized user
        const decryptedRow = {
            ...row,
            name: decrypt(row.name),
            age: row.age ? parseInt(decrypt(row.age)) : null,
            grade: row.grade ? decrypt(row.grade) : null,
            email: row.email ? decrypt(row.email) : null,
            phone: row.phone ? decrypt(row.phone) : null,
            address: row.address ? decrypt(row.address) : null,
            roll_number: row.roll_number ? decrypt(row.roll_number) : null,
            admission_number: row.admission_number ? decrypt(row.admission_number) : null
        };
        res.json({
            status: 'success',
            data: decryptedRow
        });
    });
});

// GET single student by ID
app.get('/students/:id', authenticateToken, authorizeRole(['admin', 'teacher', 'student']), (req, res) => {
    const sql = 'SELECT * FROM students WHERE id = ?';
    db.get(sql, [req.params.id], (err, row) => {
        if (err) {
            return res.status(400).json({
                status: 'error',
                message: err.message
            });
        }
        if (!row) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }
        // If the requester is a student, ensure they only access their own profile
        if (req.user.role === 'student') {
            if (!row.user_id || row.user_id !== req.user.userId) {
                return res.status(403).json({
                    status: 'failed',
                    message: 'Insufficient permissions'
                });
            }
        }
        // Decrypt sensitive fields for authorized users
        const decryptedRow = {
            ...row,
            name: decrypt(row.name),
            age: row.age ? parseInt(decrypt(row.age)) : null,
            grade: row.grade ? decrypt(row.grade) : null
        };
        res.json({
            status: 'success',
            data: decryptedRow
        });
    });
});

// CREATE new student (admin and teacher)
app.post('/students', authenticateToken, authorizeRole(['admin', 'teacher']), async (req, res) => {
    const { name, age, grade, userId, email, class: cls, phone, roll_number, admission_number, avatar, username, password, address } = req.body;
    
    if (!name) {
        return res.status(400).json({
            status: 'error',
            message: 'Name is required'
        });
    }
    
    try {
        let finalUserId = userId;
        
        // If username and password are provided, create a user account first
        if (username && password) {
            // Check if username already exists
            const existingUser = await new Promise((resolve, reject) => {
                db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            if (existingUser) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Username already exists'
                });
            }
            
            // Hash the password
            const hashedPassword = await bcrypt.hash(password, 10);
            
            // Generate unique student ID
            const studentId = generateStudentId();
            
            // Create user account
            finalUserId = await new Promise((resolve, reject) => {
                db.run('INSERT INTO users (username, password, role, student_id) VALUES (?, ?, ?, ?)', 
                    [username, hashedPassword, 'student', studentId], 
                    function(err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    }
                );
            });
        }
        
        // Encrypt sensitive fields
        const encryptedName = encrypt(name);
        const encryptedAge = age ? encrypt(age.toString()) : null;
        const encryptedGrade = grade ? encrypt(grade) : null;
        const encryptedEmail = email ? encrypt(email) : null;
        const encryptedPhone = phone ? encrypt(phone) : null;
        const encryptedRollNumber = roll_number ? encrypt(roll_number) : null;
        const encryptedAdmissionNumber = admission_number ? encrypt(admission_number) : null;
        const encryptedAddress = address ? encrypt(address) : null;
        
        const sql = 'INSERT INTO students (name, age, grade, user_id, email, class, phone, roll_number, admission_number, avatar, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
        const params = [encryptedName, encryptedAge, encryptedGrade, finalUserId || null, encryptedEmail, cls || null, encryptedPhone, encryptedRollNumber, encryptedAdmissionNumber, avatar || null, encryptedAddress];
        
        await new Promise((resolve, reject) => {
            db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
        
        res.status(201).json({
            status: 'success',
            message: 'Student created successfully',
            studentId: this.lastID
        });
    } catch (error) {
        console.error('Error creating student:', error);
        res.status(400).json({
            status: 'error',
            message: error.message || 'Failed to create student'
        });
    }
});

// UPDATE student (admin and teacher)
app.put('/students/:id', authenticateToken, authorizeRole(['admin', 'teacher']), (req, res) => {
    const { name, age, grade, userId, email, class: cls, phone, roll_number, admission_number, avatar, username, address } = req.body;
    
    if (!name) {
        return res.status(400).json({
            status: 'error',
            message: 'Name is required'
        });
    }
    
    // First get the student record to find the user_id
    const getSql = 'SELECT user_id FROM students WHERE id = ?';
    
    db.get(getSql, [req.params.id], (err, student) => {
        if (err) {
            return res.status(400).json({
                status: 'error',
                message: err.message
            });
        }
        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }
        
        // Encrypt sensitive fields
        const encryptedName = encrypt(name);
        const encryptedAge = age ? encrypt(age.toString()) : null;
        const encryptedGrade = grade ? encrypt(grade) : null;
        const encryptedEmail = email ? encrypt(email) : null;
        const encryptedPhone = phone ? encrypt(phone) : null;
        const encryptedRollNumber = roll_number ? encrypt(roll_number) : null;
        const encryptedAdmissionNumber = admission_number ? encrypt(admission_number) : null;
        const encryptedAddress = address ? encrypt(address) : null;
        
        // Update students table
        const updateStudentSql = `
            UPDATE students 
            SET name = COALESCE(?, name),
                age = ?,
                grade = ?,
                user_id = COALESCE(?, user_id),
                email = ?,
                class = COALESCE(?, class),
                phone = ?,
                roll_number = ?,
                admission_number = ?,
                avatar = COALESCE(?, avatar),
                address = ?
            WHERE id = ?
        `;
        const studentParams = [encryptedName, encryptedAge, encryptedGrade, userId || null, encryptedEmail, cls || null, encryptedPhone, encryptedRollNumber, encryptedAdmissionNumber, avatar || null, encryptedAddress, req.params.id];
        
        db.run(updateStudentSql, studentParams, function(err) {
            if (err) {
                return res.status(400).json({
                    status: 'error',
                    message: err.message
                });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Student not found'
                });
            }
            
            // Also update username in users table if provided and user_id exists
            if (username && student.user_id) {
                // Check if username already exists for another user
                const checkUsernameSql = 'SELECT id FROM users WHERE username = ? AND id != ?';
                db.get(checkUsernameSql, [username, student.user_id], (checkErr, existingUser) => {
                    if (checkErr) {
                        console.error('Error checking username:', checkErr);
                        return; // Don't fail the request
                    }
                    
                    if (existingUser) {
                        // Username already exists, don't update it
                        console.log('Username already exists, skipping username update');
                    } else {
                        // Update username in users table
                        const updateUserSql = 'UPDATE users SET username = ? WHERE id = ?';
                        db.run(updateUserSql, [username, student.user_id], (updateErr) => {
                            if (updateErr) {
                                console.error('Error updating username:', updateErr);
                                // Don't fail the request if username update fails
                            }
                        });
                    }
                });
            }
            
            res.json({
                status: 'success',
                message: 'Student updated successfully',
                changes: this.changes
            });
        });
    });
});

// DELETE student (admin and teacher)
app.delete('/students/:id', authenticateToken, authorizeRole(['admin', 'teacher']), (req, res) => {
    // First get the student record to find the user_id
    const getSql = 'SELECT user_id FROM students WHERE id = ?';
    
    db.get(getSql, [req.params.id], (err, student) => {
        if (err) {
            return res.status(400).json({
                status: 'error',
                message: err.message
            });
        }
        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }
        
        // Delete from students table
        const deleteStudentSql = 'DELETE FROM students WHERE id = ?';
        db.run(deleteStudentSql, [req.params.id], function(err) {
            if (err) {
                return res.status(400).json({
                    status: 'error',
                    message: err.message
                });
            }
            if (this.changes === 0) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Student not found'
                });
            }
            
            // Also delete from users table if user_id exists
            if (student.user_id) {
                db.run('DELETE FROM users WHERE id = ?', [student.user_id], (userErr) => {
                    if (userErr) {
                        console.error('Error deleting user:', userErr);
                        // Don't fail the request if user deletion fails, but log it
                    }
                });
            }
            
            res.json({
                status: 'success',
                message: 'Student deleted permanently',
                changes: this.changes
            });
        });
    });
});

// UPDATE current student's own profile (student only)
app.put('/students/me', authenticateToken, authorizeRole(['student']), (req, res) => {
    const { name, email, phone, bio } = req.body;
    
    // First get the student record by user_id
    const getSql = 'SELECT id FROM students WHERE user_id = ?';
    db.get(getSql, [req.user.userId], (err, row) => {
        if (err) {
            return res.status(400).json({
                status: 'error',
                message: err.message
            });
        }
        if (!row) {
            return res.status(404).json({
                status: 'error',
                message: 'Student profile not found'
            });
        }
        
        // Encrypt sensitive fields
        const encryptedName = name ? encrypt(name) : null;
        const encryptedEmail = email ? encrypt(email) : null;
        const encryptedPhone = phone ? encrypt(phone) : null;
        const encryptedBio = bio ? encrypt(bio) : null;
        
        // Update the student record
        const updateSql = `
            UPDATE students 
            SET name = COALESCE(?, name),
                email = ?,
                phone = ?,
                bio = ?
            WHERE id = ?
        `;
        const params = [encryptedName, encryptedEmail, encryptedPhone, encryptedBio, row.id];
        
        db.run(updateSql, params, function(err) {
            if (err) {
                return res.status(400).json({
                    status: 'error',
                    message: err.message
                });
            }
            
            res.json({
                status: 'success',
                message: 'Profile updated successfully',
                changes: this.changes
            });
        });
    });
});


// SSL Certificate Loading Function
function loadSSLCertificates() {
    try {
        if (!fs.existsSync(SSL_CONFIG.KEY_PATH) || !fs.existsSync(SSL_CONFIG.CERT_PATH)) {
            console.warn('⚠️  SSL certificates not found. HTTPS will be disabled.');
            console.warn(`   Expected files: ${SSL_CONFIG.KEY_PATH}, ${SSL_CONFIG.CERT_PATH}`);
            return null;
        }

        const privateKey = fs.readFileSync(SSL_CONFIG.KEY_PATH, 'utf8');
        const certificate = fs.readFileSync(SSL_CONFIG.CERT_PATH, 'utf8');
        
        console.log('🔐 SSL certificates loaded successfully');
        return { key: privateKey, cert: certificate };
    } catch (error) {
        console.error('❌ Error loading SSL certificates:', error.message);
        return null;
    }
}

// HTTP to HTTPS Redirect Middleware
function httpsRedirect(req, res, next) {
    // Only redirect if request is not already HTTPS and not from HTTPS port
    if (SSL_CONFIG.ENABLED && SSL_CONFIG.REDIRECT_HTTP && 
        !req.secure && 
        req.header('x-forwarded-proto') !== 'https' &&
        req.get('host') && req.get('host').includes(':' + PORT)) {
        
        const httpsUrl = `https://${req.get('host').replace(':' + PORT, ':' + HTTPS_PORT)}${req.url}`;
        console.log(`🔄 Redirecting HTTP to HTTPS: ${req.url} -> ${httpsUrl}`);
        return res.redirect(301, httpsUrl);
    }
    next();
}

// ======================
// NOTICES MANAGEMENT
// ======================

// GET all notices
app.get('/api/notices', (req, res) => {
    const sql = 'SELECT * FROM notices ORDER BY created_at DESC';
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching notices:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch notices'
            });
        }
        res.json({
            status: 'success',
            data: rows
        });
    });
});

// POST create notice
app.post('/api/notices', (req, res) => {
    const { title, type, target_audience, content, created_by } = req.body;
    
    if (!title || !type || !target_audience || !content) {
        return res.status(400).json({
            status: 'error',
            message: 'All fields are required'
        });
    }
    
    const sql = 'INSERT INTO notices (title, type, target_audience, content, created_by) VALUES (?, ?, ?, ?, ?)';
    db.run(sql, [title, type, target_audience, content, created_by || 'Admin'], function(err) {
        if (err) {
            console.error('Error creating notice:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to create notice'
            });
        }
        
        res.json({
            status: 'success',
            message: 'Notice created successfully',
            data: { id: this.lastID }
        });
    });
});

// PUT update notice
app.put('/api/notices/:id', (req, res) => {
    const { title, type, target_audience, content } = req.body;
    const { id } = req.params;
    
    const sql = 'UPDATE notices SET title = ?, type = ?, target_audience = ?, content = ? WHERE id = ?';
    db.run(sql, [title, type, target_audience, content, id], function(err) {
        if (err) {
            console.error('Error updating notice:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to update notice'
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Notice not found'
            });
        }
        
        res.json({
            status: 'success',
            message: 'Notice updated successfully'
        });
    });
});

// DELETE notice
app.delete('/api/notices/:id', (req, res) => {
    const sql = 'DELETE FROM notices WHERE id = ?';
    
    db.run(sql, [req.params.id], function(err) {
        if (err) {
            console.error('Error deleting notice:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to delete notice'
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Notice not found'
            });
        }
        
        res.json({
            status: 'success',
            message: 'Notice deleted successfully'
        });
    });
});

// ======================
// SECURE NOTIFICATIONS SYSTEM
// ======================

// POST /api/notifications/create - Create notification (Admin only)
app.post('/api/notifications/create', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const { title, message, target_role, is_pinned, expires_at } = req.body;
    
    if (!title || !message) {
        return res.status(400).json({
            status: 'error',
            message: 'Title and message are required'
        });
    }
    
    const createdBy = req.user.username || 'Admin';
    const sql = `INSERT INTO notifications (title, message, created_by, target_role, is_pinned, expires_at) 
                 VALUES (?, ?, ?, ?, ?, ?)`;
    
    db.run(sql, [title, message, createdBy, target_role || 'student', is_pinned || 0, expires_at || null], function(err) {
        if (err) {
            console.error('Error creating notification:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to create notification'
            });
        }
        
        res.json({
            status: 'success',
            message: 'Notification created successfully',
            data: { id: this.lastID }
        });
    });
});

// GET /api/notifications/student - Get active notifications for students (Read-only)
app.get('/api/notifications/student', authenticateToken, authorizeRole(['student', 'teacher', 'admin']), (req, res) => {
    const sql = `SELECT * FROM notifications 
                 WHERE is_active = 1 
                 AND (expires_at IS NULL OR expires_at > datetime('now'))
                 ORDER BY is_pinned DESC, created_at DESC`;
    
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching notifications:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch notifications'
            });
        }
        
        res.json({
            status: 'success',
            data: rows
        });
    });
});

// GET /api/notifications - Get all notifications (Admin only)
app.get('/api/notifications', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const sql = 'SELECT * FROM notifications ORDER BY created_at DESC';
    
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching notifications:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch notifications'
            });
        }
        
        res.json({
            status: 'success',
            data: rows
        });
    });
});

// DELETE /api/notifications/:id - Delete notification (Admin only)
app.delete('/api/notifications/:id', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const sql = 'DELETE FROM notifications WHERE id = ?';
    
    db.run(sql, [req.params.id], function(err) {
        if (err) {
            console.error('Error deleting notification:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to delete notification'
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Notification not found'
            });
        }
        
        res.json({
            status: 'success',
            message: 'Notification deleted successfully'
        });
    });
});

// PATCH /api/notifications/:id - Update notification (Admin only)
app.patch('/api/notifications/:id', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const { title, message, is_active, is_pinned, expires_at } = req.body;
    const { id } = req.params;
    
    const updates = [];
    const values = [];
    
    if (title !== undefined) {
        updates.push('title = ?');
        values.push(title);
    }
    if (message !== undefined) {
        updates.push('message = ?');
        values.push(message);
    }
    if (is_active !== undefined) {
        updates.push('is_active = ?');
        values.push(is_active);
    }
    if (is_pinned !== undefined) {
        updates.push('is_pinned = ?');
        values.push(is_pinned);
    }
    if (expires_at !== undefined) {
        updates.push('expires_at = ?');
        values.push(expires_at);
    }
    
    if (updates.length === 0) {
        return res.status(400).json({
            status: 'error',
            message: 'No fields to update'
        });
    }
    
    values.push(id);
    const sql = `UPDATE notifications SET ${updates.join(', ')} WHERE id = ?`;
    
    db.run(sql, values, function(err) {
        if (err) {
            console.error('Error updating notification:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to update notification'
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Notification not found'
            });
        }
        
        res.json({
            status: 'success',
            message: 'Notification updated successfully'
        });
    });
});

// ======================
// RAZORPAY PAYMENT SYSTEM
// ======================

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_dummy_key',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_secret'
});

// POST /api/payments/create-order - Create Razorpay order (Student only)
app.post('/api/payments/create-order', authenticateToken, authorizeRole(['student']), async (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const userId = req.user.userId;
    
    try {
        const { amount, description = 'School Fee Payment' } = req.body;
        
        if (!amount || isNaN(amount) || amount < 1) {
            return res.status(400).json({
                status: 'error',
                message: 'Valid amount is required (minimum ₹1)'
            });
        }
        
        // Get student info
        const student = await new Promise((resolve, reject) => {
            db.get('SELECT id, name, email FROM students WHERE user_id = ?', [userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student record not found'
            });
        }

        // Check if student has a valid verified OTP
        const verifiedOtp = await hasValidVerifiedOtp(student.id);

        if (!verifiedOtp) {
            writeLog(LOG_FILE, `PAYMENT_ORDER_DENIED: User ${userId} - IP: ${clientIP} - OTP verification required`);
            return res.status(403).json({
                status: 'error',
                message: 'OTP verification required before payment',
                code: 'OTP_REQUIRED'
            });
        }

        // Create receipt ID
        const receiptId = `RCPT_${Date.now()}_${student.id}`;

        // Create Razorpay order
        const options = {
            amount: amount * 100, // Razorpay expects amount in paise
            currency: 'INR',
            receipt: receiptId,
            notes: {
                student_id: student.id,
                student_name: student.name,
                description: description
            }
        };

        const order = await razorpay.orders.create(options);

        // Store order in database
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO payments (student_id, amount, currency, status, order_id, receipt_id, description)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [student.id, amount, 'INR', 'pending', order.id, receiptId, description],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });

        // Invalidate OTP after successful order creation
        await invalidateOtp(student.id);

        writeLog(LOG_FILE, `PAYMENT_ORDER_CREATED: User ${userId} - Order ${order.id} - Amount ₹${amount} - IP: ${clientIP}`);
        
        res.json({
            status: 'success',
            orderId: order.id,
            amount: amount,
            currency: 'INR',
            receiptId: receiptId,
            keyId: process.env.RAZORPAY_KEY_ID
        });
        
    } catch (error) {
        console.error('Error creating payment order:', error);
        writeLog(LOG_FILE, `PAYMENT_ORDER_FAILED: User ${userId} - Error: ${error.message} - IP: ${clientIP}`);
        res.status(500).json({
            status: 'error',
            message: 'Failed to create payment order'
        });
    }
});

// POST /api/payments/verify - Verify Razorpay payment signature (Student only)
app.post('/api/payments/verify', authenticateToken, authorizeRole(['student']), async (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const userId = req.user.userId;
    
    try {
        const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
        
        if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(400).json({
                status: 'error',
                message: 'Order ID, Payment ID, and Signature are required'
            });
        }
        
        // Verify signature
        const body = razorpayOrderId + '|' + razorpayPaymentId;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest('hex');
        
        if (expectedSignature !== razorpaySignature) {
            writeLog(LOG_FILE, `PAYMENT_VERIFY_FAILED: User ${userId} - Invalid signature - IP: ${clientIP}`);
            return res.status(400).json({
                status: 'error',
                message: 'Invalid payment signature'
            });
        }
        
        // Get payment details from Razorpay
        const payment = await razorpay.payments.fetch(razorpayPaymentId);
        
        // Update payment record in database
        const paymentMethod = payment.method || 'unknown';
        const status = payment.status === 'captured' ? 'completed' : payment.status;
        
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE payments SET payment_id = ?, status = ?, payment_method = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE order_id = ?`,
                [razorpayPaymentId, status, paymentMethod, razorpayOrderId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
        
        writeLog(LOG_FILE, `PAYMENT_VERIFIED: User ${userId} - Order ${razorpayOrderId} - Payment ${razorpayPaymentId} - Status: ${status} - IP: ${clientIP}`);
        
        // Send notification
        notificationService.sendNotification({
            type: 'payment_success',
            title: 'Payment Successful',
            message: `Your payment of ₹${payment.amount / 100} has been received successfully.`,
            userId: userId,
            priority: 'normal'
        });
        
        res.json({
            status: 'success',
            message: 'Payment verified successfully',
            paymentId: razorpayPaymentId,
            amount: payment.amount / 100,
            method: paymentMethod,
            status: status
        });
        
    } catch (error) {
        console.error('Error verifying payment:', error);
        writeLog(LOG_FILE, `PAYMENT_VERIFY_ERROR: User ${userId} - Error: ${error.message} - IP: ${clientIP}`);
        res.status(500).json({
            status: 'error',
            message: 'Failed to verify payment'
        });
    }
});

// GET /api/payments/my-payments - Get student's payment history (Student only)
app.get('/api/payments/my-payments', authenticateToken, authorizeRole(['student']), (req, res) => {
    const userId = req.user.userId;
    
    db.all(
        `SELECT p.* FROM payments p
         JOIN students s ON p.student_id = s.id
         WHERE s.user_id = ?
         ORDER BY p.created_at DESC`,
        [userId],
        (err, rows) => {
            if (err) {
                console.error('Error fetching payments:', err);
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to fetch payment history'
                });
            }
            
            res.json({
                status: 'success',
                payments: rows
            });
        }
    );
});

// GET /api/payments/receipt/:paymentId - Get receipt details (Student only)
app.get('/api/payments/receipt/:paymentId', authenticateToken, authorizeRole(['student']), (req, res) => {
    const userId = req.user.userId;
    const paymentId = req.params.paymentId;
    
    db.get(
        `SELECT p.*, s.name as student_name, s.email as student_email 
         FROM payments p
         JOIN students s ON p.student_id = s.id
         WHERE p.payment_id = ? AND s.user_id = ? AND p.status = 'completed'`,
        [paymentId, userId],
        (err, row) => {
            if (err) {
                console.error('Error fetching receipt:', err);
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to fetch receipt'
                });
            }
            
            if (!row) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Receipt not found'
                });
            }
            
            res.json({
                status: 'success',
                receipt: {
                    id: row.id,
                    receiptId: row.receipt_id,
                    studentName: row.student_name,
                    studentEmail: row.student_email,
                    amount: row.amount,
                    currency: row.currency,
                    description: row.description,
                    paymentId: row.payment_id,
                    orderId: row.order_id,
                    paymentMethod: row.payment_method,
                    paidAt: row.updated_at
                }
            });
        }
    );
});

// GET /api/admin/payments - Get all payments (Admin only)
app.get('/api/admin/payments', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const { status, studentId, limit = 50, offset = 0 } = req.query;
    
    let sql = `SELECT p.*, s.name as student_name, s.email as student_email, s.roll_number
               FROM payments p
               JOIN students s ON p.student_id = s.id
               WHERE 1=1`;
    const params = [];
    
    if (status) {
        sql += ` AND p.status = ?`;
        params.push(status);
    }
    
    if (studentId) {
        sql += ` AND p.student_id = ?`;
        params.push(studentId);
    }
    
    sql += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));
    
    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Error fetching admin payments:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch payments'
            });
        }
        
        // Get total count
        db.get(
            `SELECT COUNT(*) as total FROM payments p
             JOIN students s ON p.student_id = s.id
             WHERE 1=1${status ? ' AND p.status = ?' : ''}${studentId ? ' AND p.student_id = ?' : ''}`,
            status ? (studentId ? [status, studentId] : [status]) : (studentId ? [studentId] : []),
            (countErr, countRow) => {
                if (countErr) {
                    console.error('Error counting payments:', countErr);
                }
                
                res.json({
                    status: 'success',
                    payments: rows,
                    total: countRow ? countRow.total : rows.length,
                    limit: parseInt(limit),
                    offset: parseInt(offset)
                });
            }
        );
    });
});

// GET /api/admin/payments/summary - Get payment summary stats (Admin only)
app.get('/api/admin/payments/summary', authenticateToken, authorizeRole(['admin']), (req, res) => {
    db.get(
        `SELECT 
            COUNT(*) as total_payments,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
            SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_revenue,
            SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) as pending_amount
         FROM payments`,
        [],
        (err, row) => {
            if (err) {
                console.error('Error fetching payment summary:', err);
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to fetch payment summary'
                });
            }
            
            res.json({
                status: 'success',
                summary: row
            });
        }
    );
});

// GET /api/admin/stats - Get admin dashboard stats (Admin only)
app.get('/api/admin/stats', authenticateToken, authorizeRole(['admin']), (req, res) => {
    db.get(
        `SELECT
            COUNT(*) as total_students,
            SUM(CASE WHEN fee_status = 'paid' THEN 1 ELSE 0 END) as paid_count,
            SUM(CASE WHEN fee_status = 'pending' THEN 1 ELSE 0 END) as pending_count,
            SUM(fee_due) as total_fee_due
         FROM students`,
        [],
        (err, row) => {
            if (err) {
                console.error('Error fetching admin stats:', err);
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to fetch admin stats'
                });
            }

            res.json({
                status: 'success',
                stats: row
            });
        }
    );
});

// GET /api/teachers/count - Get total number of teachers
app.get('/api/teachers/count', (req, res) => {
    db.get(
        'SELECT COUNT(*) as total FROM users WHERE role = ?',
        ['teacher'],
        (err, row) => {
            if (err) {
                console.error('Error counting teachers:', err);
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to count teachers'
                });
            }
            res.json({
                status: 'success',
                total: row.total
            });
        }
    );
});

// GET /api/students/count - Get total number of students
app.get('/api/students/count', (req, res) => {
    db.get(
        'SELECT COUNT(*) as total FROM users WHERE role = ?',
        ['student'],
        (err, row) => {
            if (err) {
                console.error('Error counting students:', err);
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to count students'
                });
            }

            res.json({
                status: 'success',
                total: row.total
            });
        }
    );
});

// GET /api/students/class-distribution - Get class distribution data
app.get('/api/students/class-distribution', (req, res) => {
    const sql = `
        SELECT class, COUNT(*) as student_count
        FROM students
        WHERE class IS NOT NULL AND class != ''
        GROUP BY class
        ORDER BY class DESC
    `;
    
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching class distribution:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch class distribution'
            });
        }

        // Calculate total students for percentage
        const totalStudents = rows.reduce((sum, row) => sum + row.student_count, 0);
        
        // Format the data for the chart
        const classData = rows.map(row => ({
            class: row.class,
            students: row.student_count,
            percentage: totalStudents > 0 ? ((row.student_count / totalStudents) * 100).toFixed(1) : 0
        }));

        res.json({
            status: 'success',
            data: classData,
            total: totalStudents
        });
    });
});

// GET /api/admin/next-admission-number - Get next admission number (Admin only)
app.get('/api/admin/next-admission-number', authenticateToken, authorizeRole(['admin']), (req, res) => {
    db.get('SELECT next_sequence_number FROM admission_sequence WHERE id = 1', [], (err, row) => {
        if (err) {
            console.error('Error fetching next admission number:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch next admission number'
            });
        }
        
        const sequenceNumber = row ? row.next_sequence_number : 1;
        const admissionNumber = 'STU' + sequenceNumber.toString().padStart(3, '0');
        
        // Increment the sequence number immediately
        db.run('UPDATE admission_sequence SET next_sequence_number = next_sequence_number + 1 WHERE id = 1', [], (updateErr) => {
            if (updateErr) {
                console.error('Error incrementing admission sequence:', updateErr);
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to increment admission sequence'
                });
            }
            
            res.json({
                status: 'success',
                admissionNumber: admissionNumber
            });
        });
    });
});

// GET /api/admin/students - Get all students with username (Admin only)
app.get('/api/admin/students', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const sql = `
        SELECT s.*, u.username
        FROM students s
        LEFT JOIN users u ON s.user_id = u.id
    `;
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching admin students:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch students'
            });
        }

        // Decrypt sensitive fields
        const decryptedRows = rows.map(row => ({
            ...row,
            name: decrypt(row.name),
            age: row.age ? parseInt(decrypt(row.age)) : null,
            grade: row.grade ? decrypt(row.grade) : null,
            class: row.class || null,
            email: row.email ? decrypt(row.email) : null,
            phone: row.phone ? decrypt(row.phone) : null,
            roll_number: row.roll_number ? decrypt(row.roll_number) : null,
            admission_number: row.admission_number ? decrypt(row.admission_number) : null,
            bio: row.bio ? decrypt(row.bio) : null,
            address: row.address ? decrypt(row.address) : null
        }));

        res.json({
            status: 'success',
            students: decryptedRows
        });
    });
});

// POST /api/admin/students - Create new student (Admin only)
app.post('/api/admin/students', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { name, age, grade, userId, email, class: cls, phone, roll_number, admission_number, avatar, username, password, address } = req.body;
    
    if (!name) {
        return res.status(400).json({
            status: 'error',
            message: 'Name is required'
        });
    }
    
    try {
        let finalUserId = userId;
        
        // If username and password are provided, create a user account first
        if (username && password) {
            // Check if username already exists
            const existingUser = await new Promise((resolve, reject) => {
                db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            if (existingUser) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Username already exists'
                });
            }
            
            // Hash the password
            const hashedPassword = await bcrypt.hash(password, 10);
            
            // Generate unique student ID
            const studentId = generateStudentId();
            
            // Create user account
            finalUserId = await new Promise((resolve, reject) => {
                db.run('INSERT INTO users (username, password, role, student_id) VALUES (?, ?, ?, ?)', 
                    [username, hashedPassword, 'student', studentId], 
                    function(err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    }
                );
            });
        }
        
        // Use the provided admission number (frontend already fetched and incremented it)
        const finalAdmissionNumber = admission_number;
        
        // Encrypt sensitive fields
        const encryptedName = encrypt(name);
        const encryptedAge = age ? encrypt(age.toString()) : null;
        const encryptedGrade = grade ? encrypt(grade) : null;
        const encryptedEmail = email ? encrypt(email) : null;
        const encryptedPhone = phone ? encrypt(phone) : null;
        const encryptedRollNumber = roll_number ? encrypt(roll_number) : null;
        const encryptedAdmissionNumber = finalAdmissionNumber ? encrypt(finalAdmissionNumber) : null;
        const encryptedAddress = address ? encrypt(address) : null;
        
        const sql = 'INSERT INTO students (name, age, grade, user_id, email, class, phone, roll_number, admission_number, avatar, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
        const params = [encryptedName, encryptedAge, encryptedGrade, finalUserId || null, encryptedEmail, cls || null, encryptedPhone, encryptedRollNumber, encryptedAdmissionNumber, avatar || null, encryptedAddress];
        
        await new Promise((resolve, reject) => {
            db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
        
        res.status(201).json({
            status: 'success',
            message: 'Student created successfully',
            studentId: this.lastID
        });
    } catch (error) {
        console.error('Error creating student:', error);
        res.status(400).json({
            status: 'error',
            message: error.message || 'Failed to create student'
        });
    }
});

// POST /api/admin/create-teacher - Create teacher (Admin only)
app.post('/api/admin/create-teacher', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { username, password, full_name, subject, qualification, experience, email, phone } = req.body;
    
    if (!username || !password || !full_name) {
        return res.status(400).json({
            status: 'error',
            message: 'username, password, and full_name are required'
        });
    }
    
    try {
        // Check if username already exists
        const existingUser = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (existingUser) {
            return res.status(400).json({
                status: 'error',
                message: 'Username already exists'
            });
        }
        
        // Hash the password
        const passwordHash = await bcrypt.hash(password, 10);
        
        // Insert into users table with role='teacher'
        const userId = await new Promise((resolve, reject) => {
            db.run('INSERT INTO users (username, password, role, name, email) VALUES (?, ?, ?, ?, ?)', 
                [username, passwordHash, 'teacher', full_name, email || null], 
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
        
        // Insert into teacher_profile table
        await new Promise((resolve, reject) => {
            db.run('INSERT INTO teacher_profile (user_id, full_name, subject, qualification, experience, email, phone) VALUES (?, ?, ?, ?, ?, ?, ?)', 
                [userId, full_name, subject || null, qualification || null, experience || null, email || null, phone || null], 
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
        
        res.status(201).json({
            status: 'success',
            message: 'Teacher created successfully'
        });
    } catch (error) {
        console.error('Error creating teacher:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to create teacher'
        });
    }
});

// GET /api/admin/get-teachers - Get all teachers with profiles (Admin only)
app.get('/api/admin/get-teachers', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    try {
        const sql = `
            SELECT 
                tp.id as teacher_profile_id,
                tp.user_id,
                tp.full_name,
                tp.subject,
                tp.qualification,
                tp.experience,
                tp.email,
                tp.phone,
                tp.created_at,
                u.username,
                u.role
            FROM teacher_profile tp
            JOIN users u ON tp.user_id = u.id
            WHERE u.role = 'teacher'
            ORDER BY tp.created_at DESC
        `;
        
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error('Error fetching teachers:', err);
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to fetch teachers'
                });
            }
            
            res.status(200).json({
                status: 'success',
                teachers: rows || []
            });
        });
    } catch (error) {
        console.error('Error fetching teachers:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to fetch teachers'
        });
    }
});

// GET /api/teacher/profile - Get current teacher's profile (Teacher only)
app.get('/api/teacher/profile', authenticateToken, authorizeTeacher, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        const sql = `
            SELECT 
                tp.id as teacher_profile_id,
                tp.user_id,
                tp.full_name,
                tp.subject,
                tp.qualification,
                tp.experience,
                tp.email,
                tp.phone,
                tp.created_at,
                u.username,
                u.role
            FROM teacher_profile tp
            JOIN users u ON tp.user_id = u.id
            WHERE tp.user_id = ? AND u.role = 'teacher'
        `;
        
        db.get(sql, [userId], (err, row) => {
            if (err) {
                console.error('Error fetching teacher profile:', err);
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to fetch teacher profile'
                });
            }
            
            if (!row) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Teacher profile not found'
                });
            }
            
            res.status(200).json({
                status: 'success',
                teacher: row
            });
        });
    } catch (error) {
        console.error('Error fetching teacher profile:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to fetch teacher profile'
        });
    }
});

// DELETE /api/admin/delete-teacher/:id - Delete teacher (Admin only)
app.delete('/api/admin/delete-teacher/:id', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const teacherProfileId = req.params.id;
    
    try {
        // First get the user_id from teacher_profile
        db.get('SELECT user_id FROM teacher_profile WHERE id = ?', [teacherProfileId], (err, row) => {
            if (err) {
                console.error('Error fetching teacher profile:', err);
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to fetch teacher'
                });
            }
            
            if (!row) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Teacher not found'
                });
            }
            
            const userId = row.user_id;
            
            // Delete from teacher_profile (will cascade due to foreign key)
            db.run('DELETE FROM teacher_profile WHERE id = ?', [teacherProfileId], function(err) {
                if (err) {
                    console.error('Error deleting teacher profile:', err);
                    return res.status(500).json({
                        status: 'error',
                        message: 'Failed to delete teacher profile'
                    });
                }
                
                // Delete from users table
                db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
                    if (err) {
                        console.error('Error deleting user:', err);
                        return res.status(500).json({
                            status: 'error',
                            message: 'Failed to delete user'
                        });
                    }
                    
                    res.status(200).json({
                        status: 'success',
                        message: 'Teacher deleted successfully'
                    });
                });
            });
        });
    } catch (error) {
        console.error('Error deleting teacher:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to delete teacher'
        });
    }
});

// DELETE /api/admin/delete-student/:id - Delete student (Admin only)
app.delete('/api/admin/delete-student/:id', authenticateToken, authorizeRole(['admin']), (req, res) => {
    const studentId = req.params.id;

    // First get the user_id from students table
    db.get('SELECT user_id FROM students WHERE id = ?', [studentId], (err, row) => {
        if (err) {
            console.error('Error fetching student:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch student'
            });
        }

        if (!row) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }

        const userId = row.user_id;

        // Delete from students table
        db.run('DELETE FROM students WHERE id = ?', [studentId], (err) => {
            if (err) {
                console.error('Error deleting student:', err);
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to delete student'
                });
            }

            // Also delete from users table if user_id exists
            if (userId) {
                db.run('DELETE FROM users WHERE id = ?', [userId], (userErr) => {
                    if (userErr) {
                        console.error('Error deleting user:', userErr);
                        // Don't fail the request if user deletion fails
                    }
                });
            }

            res.json({
                status: 'success',
                message: 'Student deleted successfully'
            });
        });
    });
});

// PUT /api/admin/update-student/:id - Update student (Admin only)
app.put('/api/admin/update-student/:id', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const studentId = req.params.id;
    const { name, class: cls, username, password } = req.body;

    if (!name || !cls) {
        return res.status(400).json({
            status: 'error',
            message: 'Name and class are required'
        });
    }

    // Get student record with user_id
    db.get('SELECT * FROM students WHERE id = ?', [studentId], (err, student) => {
        if (err) {
            console.error('Error fetching student:', err);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch student'
            });
        }

        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student not found'
            });
        }

        // Update student record
        const encryptedName = encrypt(name);
        const sql = `
            UPDATE students
            SET name = ?, class = ?
            WHERE id = ?
        `;

        db.run(sql, [encryptedName, cls, studentId], (updateErr) => {
            if (updateErr) {
                console.error('Error updating student:', updateErr);
                return res.status(500).json({
                    status: 'error',
                    message: 'Failed to update student'
                });
            }

            // Update username/password in users table if user_id exists
            if (student.user_id) {
                if (username || password) {
                    const updates = [];
                    const params = [];

                    if (username) {
                        updates.push('username = ?');
                        params.push(username);
                    }

                    if (password) {
                        bcrypt.hash(password, 10, (hashErr, hashedPassword) => {
                            if (hashErr) {
                                console.error('Error hashing password:', hashErr);
                                return res.status(500).json({
                                    status: 'error',
                                    message: 'Failed to hash password'
                                });
                            }

                            updates.push('password = ?');
                            params.push(hashedPassword);
                            params.push(student.user_id);

                            const userSql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
                            db.run(userSql, params, (userErr) => {
                                if (userErr) {
                                    console.error('Error updating user:', userErr);
                                    if (userErr.message.includes('UNIQUE')) {
                                        return res.status(400).json({
                                            status: 'error',
                                            message: 'Username already exists'
                                        });
                                    }
                                    return res.status(500).json({
                                        status: 'error',
                                        message: 'Failed to update user'
                                    });
                                }

                                res.json({
                                    status: 'success',
                                    message: 'Student updated successfully'
                                });
                            });
                        });
                        return;
                    }

                    if (username) {
                        params.push(student.user_id);
                        const userSql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
                        db.run(userSql, params, (userErr) => {
                            if (userErr) {
                                console.error('Error updating user:', userErr);
                                if (userErr.message.includes('UNIQUE')) {
                                    return res.status(400).json({
                                        status: 'error',
                                        message: 'Username already exists'
                                    });
                                }
                                return res.status(500).json({
                                    status: 'error',
                                    message: 'Failed to update user'
                                });
                            }

                            res.json({
                                status: 'success',
                                message: 'Student updated successfully'
                            });
                        });
                        return;
                    }
                } else {
                    res.json({
                        status: 'success',
                        message: 'Student updated successfully'
                    });
                }
            } else {
                res.json({
                    status: 'success',
                    message: 'Student updated successfully'
                });
            }
        });
    });
});

// ======================
// PAYMENT OTP SYSTEM
// ======================

// In-memory rate limiting for OTP requests (studentId -> {count, lastRequest, attemptCount})
const otpRateLimit = new Map();
const OTP_RATE_LIMIT_WINDOW = 30 * 1000; // 30 seconds
const MAX_OTP_REQUESTS_PER_SESSION = 3;
const MAX_OTP_ATTEMPTS = 3;

// Helper function to generate 6-digit numeric OTP
function generatePaymentOtp() {
    return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

// Helper function to hash OTP using SHA-256 with salt
function hashPaymentOtp(otp, salt) {
    return crypto.createHash('sha256').update(`${salt}:${otp}`).digest('hex');
}

// Helper function to send payment OTP email
async function sendPaymentOtpEmail(toEmail, otp) {
    // Check if email alerts are enabled
    if (process.env.EMAIL_ALERTS_ENABLED !== 'true') {
        console.log('Development OTP:', otp);
        return { sent: true, development: true };
    }

    if (!otpEmailTransporter) {
        console.error('Email transporter not configured');
        return { sent: false, reason: 'SMTP not configured' };
    }

    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    const subject = 'Your OTP Code';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1e3a5f;">Your OTP Code</h2>
            <p>Your One-Time Password (OTP) is:</p>
            <div style="background: #f0f4f8; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
                <span style="font-size: 32px; font-weight: bold; color: #1e3a5f; letter-spacing: 8px;">${otp}</span>
            </div>
            <p style="color: #666;"><strong>Valid for 5 minutes</strong></p>
            <p style="color: #666;">If you did not request this OTP, please ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 12px; color: #999;">This is an automated message from School Management System. Please do not reply.</p>
        </div>
    `;

    try {
        console.log('Sending OTP to email...');
        await otpEmailTransporter.sendMail({
            from,
            to: toEmail,
            subject,
            html
        });
        console.log('Email sent successfully ✅');
        return { sent: true };
    } catch (error) {
        console.error('Email failed ❌:', error.message);
        return { sent: false, reason: error.message };
    }
}

// POST /api/payments/send-otp - Send payment verification OTP
app.post('/api/payments/send-otp', authenticateToken, authorizeRole(['student']), async (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const userId = req.user.userId;
    const sessionId = req.sessionId || 'default';
    const rateLimitKey = `${userId}:${sessionId}`;

    try {
        // Get student info with email
        const student = await new Promise((resolve, reject) => {
            db.get('SELECT id, name, email FROM students WHERE user_id = ?', [userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student record not found'
            });
        }

        if (!student.email) {
            return res.status(400).json({
                status: 'error',
                message: 'No email address associated with your account'
            });
        }

        // Decrypt email (students table stores encrypted emails)
        let decryptedEmail;
        try {
            decryptedEmail = decrypt(student.email);
        } catch (decryptError) {
            console.error('Failed to decrypt email:', decryptError);
            writeLog(LOG_FILE, `PAYMENT_OTP_DECRYPT_ERROR: User ${userId} - IP: ${clientIP} - Email decryption failed`);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to process email address'
            });
        }

        // Rate limiting check: 1 OTP per 30 seconds
        const now = Date.now();
        const rateLimitInfo = otpRateLimit.get(rateLimitKey);

        if (rateLimitInfo) {
            const timeSinceLastRequest = now - rateLimitInfo.lastRequest;

            if (timeSinceLastRequest < OTP_RATE_LIMIT_WINDOW) {
                const waitSeconds = Math.ceil((OTP_RATE_LIMIT_WINDOW - timeSinceLastRequest) / 1000);
                writeLog(LOG_FILE, `PAYMENT_OTP_RATE_LIMIT: User ${userId} - IP: ${clientIP} - Must wait ${waitSeconds}s`);
                return res.status(429).json({
                    status: 'error',
                    message: `Please wait ${waitSeconds} seconds before requesting another OTP`,
                    retryAfter: waitSeconds
                });
            }

            // Check max OTP requests per session
            if (rateLimitInfo.count >= MAX_OTP_REQUESTS_PER_SESSION) {
                writeLog(LOG_FILE, `PAYMENT_OTP_LIMIT_EXCEEDED: User ${userId} - IP: ${clientIP} - Max ${MAX_OTP_REQUESTS_PER_SESSION} OTPs reached`);
                return res.status(429).json({
                    status: 'error',
                    message: 'Maximum OTP requests reached. Please contact support.'
                });
            }
        }

        // Delete any existing unverified OTPs for this student
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM payment_otp WHERE student_id = ? AND is_verified = 0', [student.id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Generate OTP and hash
        const otp = generatePaymentOtp();
        const salt = crypto.randomBytes(16).toString('hex');
        const otpHash = hashPaymentOtp(otp, salt);
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

        // Store OTP in database
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO payment_otp (student_id, otp_hash, expires_at, is_verified, attempt_count)
                 VALUES (?, ?, ?, 0, 0)`,
                [student.id, `${salt}:${otpHash}`, expiresAt.toISOString()],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });

        // Send OTP via email
        const emailResult = await sendPaymentOtpEmail(decryptedEmail, otp);

        if (!emailResult.sent && !emailResult.development) {
            // Clean up if email failed
            await new Promise((resolve) => {
                db.run('DELETE FROM payment_otp WHERE student_id = ? AND is_verified = 0', [student.id], () => resolve());
            });

            writeLog(LOG_FILE, `PAYMENT_OTP_EMAIL_FAILED: User ${userId} - IP: ${clientIP} - Reason: ${emailResult.reason}`);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to send OTP email. Please try again later.'
            });
        }

        // Update rate limiting
        const currentCount = rateLimitInfo ? rateLimitInfo.count : 0;
        otpRateLimit.set(rateLimitKey, {
            count: currentCount + 1,
            lastRequest: now,
            attemptCount: 0
        });

        writeLog(LOG_FILE, `PAYMENT_OTP_SENT: User ${userId} - IP: ${clientIP} - Email: ${student.email} - Sent: ${emailResult.sent} - Development: ${emailResult.development}`);

        res.json({
            status: 'success',
            message: 'OTP sent to your registered email address'
        });

    } catch (error) {
        console.error('Error sending payment OTP:', error);
        writeLog(LOG_FILE, `PAYMENT_OTP_ERROR: User ${userId} - IP: ${clientIP} - Error: ${error.message}`);
        res.status(500).json({
            status: 'error',
            message: 'Failed to send OTP'
        });
    }
});

// POST /api/payments/verify-otp - Verify payment OTP
app.post('/api/payments/verify-otp', authenticateToken, authorizeRole(['student']), async (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const userId = req.user.userId;
    const { otp } = req.body;

    if (!otp || !/^\d{6}$/.test(otp)) {
        return res.status(400).json({
            status: 'error',
            message: 'Valid 6-digit OTP is required'
        });
    }

    try {
        // Get student info
        const student = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM students WHERE user_id = ?', [userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!student) {
            return res.status(404).json({
                status: 'error',
                message: 'Student record not found'
            });
        }

        // Get the latest OTP record for this student
        const otpRecord = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM payment_otp 
                 WHERE student_id = ? AND is_verified = 0
                 ORDER BY created_at DESC LIMIT 1`,
                [student.id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!otpRecord) {
            writeLog(LOG_FILE, `PAYMENT_OTP_VERIFY_NO_RECORD: User ${userId} - IP: ${clientIP}`);
            return res.status(400).json({
                status: 'error',
                message: 'No active OTP found. Please request a new OTP.'
            });
        }

        // Check if OTP has expired
        const now = new Date();
        const expiresAt = new Date(otpRecord.expires_at);

        if (now > expiresAt) {
            // Delete expired OTP
            await new Promise((resolve) => {
                db.run('DELETE FROM payment_otp WHERE id = ?', [otpRecord.id], () => resolve());
            });

            writeLog(LOG_FILE, `PAYMENT_OTP_EXPIRED: User ${userId} - IP: ${clientIP}`);
            return res.status(400).json({
                status: 'error',
                message: 'OTP has expired. Please request a new OTP.'
            });
        }

        // Check max attempts
        if (otpRecord.attempt_count >= MAX_OTP_ATTEMPTS) {
            // Delete OTP after max attempts
            await new Promise((resolve) => {
                db.run('DELETE FROM payment_otp WHERE id = ?', [otpRecord.id], () => resolve());
            });

            writeLog(LOG_FILE, `PAYMENT_OTP_MAX_ATTEMPTS: User ${userId} - IP: ${clientIP}`);
            return res.status(429).json({
                status: 'error',
                message: 'Maximum verification attempts reached. Please request a new OTP.'
            });
        }

        // Verify OTP hash
        const [salt, storedHash] = otpRecord.otp_hash.split(':');
        const inputHash = hashPaymentOtp(otp, salt);

        if (inputHash !== storedHash) {
            // Increment attempt count
            await new Promise((resolve) => {
                db.run(
                    'UPDATE payment_otp SET attempt_count = attempt_count + 1 WHERE id = ?',
                    [otpRecord.id],
                    () => resolve()
                );
            });

            const remainingAttempts = MAX_OTP_ATTEMPTS - (otpRecord.attempt_count + 1);
            writeLog(LOG_FILE, `PAYMENT_OTP_INVALID: User ${userId} - IP: ${clientIP} - Remaining attempts: ${remainingAttempts}`);

            return res.status(400).json({
                status: 'error',
                message: `Invalid OTP. ${remainingAttempts} attempts remaining.`
            });
        }

        // OTP is valid - mark as verified
        await new Promise((resolve, reject) => {
            db.run(
                'UPDATE payment_otp SET is_verified = 1 WHERE id = ?',
                [otpRecord.id],
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        writeLog(LOG_FILE, `PAYMENT_OTP_VERIFIED: User ${userId} - IP: ${clientIP}`);

        res.json({
            status: 'success',
            message: 'OTP verified successfully. You can now proceed with payment.'
        });

    } catch (error) {
        console.error('Error verifying payment OTP:', error);
        writeLog(LOG_FILE, `PAYMENT_OTP_VERIFY_ERROR: User ${userId} - IP: ${clientIP} - Error: ${error.message}`);
        res.status(500).json({
            status: 'error',
            message: 'Failed to verify OTP'
        });
    }
});

// Helper function to check if student has valid verified OTP
async function hasValidVerifiedOtp(studentId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT * FROM payment_otp 
             WHERE student_id = ? AND is_verified = 1 AND expires_at > datetime('now')
             ORDER BY created_at DESC LIMIT 1`,
            [studentId],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });
}

// Helper function to invalidate OTP after payment
async function invalidateOtp(studentId) {
    return new Promise((resolve) => {
        db.run(
            'UPDATE payment_otp SET is_verified = 0 WHERE student_id = ? AND is_verified = 1',
            [studentId],
            () => resolve()
        );
    });
}

// Cleanup function for expired OTPs (run periodically)
function cleanupExpiredOtps() {
    db.run(
        `DELETE FROM payment_otp WHERE expires_at < datetime('now') OR 
         (is_verified = 0 AND attempt_count >= ?)`,
        [MAX_OTP_ATTEMPTS],
        function(err) {
            if (err) {
                console.error('Error cleaning up expired OTPs:', err);
            } else if (this.changes > 0) {
                console.log(`Cleaned up ${this.changes} expired/invalid OTP records`);
            }
        }
    );
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredOtps, 5 * 60 * 1000);

// ==================== FEE MANAGEMENT SYSTEM API ROUTES ====================

// Helper function to generate fee OTP
function generateFeeOtp() {
    return crypto.randomInt(100000, 999999).toString();
}

// Helper function to hash fee OTP
function hashFeeOtp(otp, salt) {
    return crypto.createHash('sha256').update(`${salt}:${otp}`).digest('hex');
}

// POST /api/fees/create - Admin creates fee for student by username
app.post('/api/fees/create', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { username, amount, description, due_date } = req.body;
    const clientIP = req.ip || req.connection.remoteAddress;

    // Validation
    if (!username || !amount) {
        return res.status(400).json({
            status: 'error',
            message: 'Username and amount are required'
        });
    }

    if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({
            status: 'error',
            message: 'Amount must be a positive number'
        });
    }

    try {
        // Check if user exists
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT id, username, role FROM users WHERE username = ?', [username], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!user) {
            writeLog(LOG_FILE, `FEE_CREATE_USER_NOT_FOUND: ${username} - IP: ${clientIP}`);
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        if (user.role !== 'student') {
            return res.status(400).json({
                status: 'error',
                message: 'Fees can only be assigned to students'
            });
        }

        // Create fee
        const result = await new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO fees (username, amount, description, due_date, status) VALUES (?, ?, ?, ?, ?)',
                [username, amount, description || '', due_date || '', 'PENDING'],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });

        writeLog(LOG_FILE, `FEE_CREATED: ID ${result.id} for ${username} - Amount: ${amount} - IP: ${clientIP}`);

        res.json({
            status: 'success',
            message: 'Fee assigned successfully',
            fee_id: result.id
        });

    } catch (error) {
        console.error('Error creating fee:', error);
        writeLog(LOG_FILE, `FEE_CREATE_ERROR: ${username} - IP: ${clientIP} - Error: ${error.message}`);
        res.status(500).json({
            status: 'error',
            message: 'Failed to create fee'
        });
    }
});

// GET /api/fees/student - Student gets their fees
app.get('/api/fees/student', authenticateToken, authorizeRole(['student']), async (req, res) => {
    const username = req.user.username;

    try {
        const fees = await new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM fees WHERE username = ? ORDER BY created_at DESC',
                [username],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        res.json({
            status: 'success',
            fees: fees
        });

    } catch (error) {
        console.error('Error fetching fees:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch fees'
        });
    }
});

// GET /api/fees/all - Admin gets all fees
app.get('/api/fees/all', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    try {
        const fees = await new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM fees ORDER BY created_at DESC',
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        res.json({
            status: 'success',
            fees: fees
        });

    } catch (error) {
        console.error('Error fetching all fees:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch fees'
        });
    }
});

// POST /api/fees/send-otp - Send OTP for payment
app.post('/api/fees/send-otp', authenticateToken, authorizeRole(['student']), async (req, res) => {
    const { fee_id } = req.body;
    const username = req.user.username;
    const clientIP = req.ip || req.connection.remoteAddress;

    if (!fee_id) {
        return res.status(400).json({
            status: 'error',
            message: 'Fee ID is required'
        });
    }

    try {
        // Check if fee exists and belongs to user
        const fee = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM fees WHERE id = ? AND username = ?',
                [fee_id, username],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!fee) {
            return res.status(404).json({
                status: 'error',
                message: 'Fee not found or does not belong to you'
            });
        }

        if (fee.status !== 'PENDING') {
            return res.status(400).json({
                status: 'error',
                message: 'Fee is already paid'
            });
        }

        // Rate limit: Check if OTP was sent in last 30 seconds
        const recentOtp = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM fee_otp 
                 WHERE username = ? AND fee_id = ? 
                 AND created_at > datetime('now', '-30 seconds')`,
                [username, fee_id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (recentOtp) {
            return res.status(429).json({
                status: 'error',
                message: 'Please wait 30 seconds before requesting another OTP'
            });
        }

        // Generate OTP
        const otp = generateFeeOtp();
        const salt = crypto.randomBytes(16).toString('hex');
        const otpHash = hashFeeOtp(otp, salt);
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

        // Store OTP
        await new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO fee_otp (username, fee_id, otp_hash, salt, expires_at, attempts, verified) VALUES (?, ?, ?, ?, ?, 0, 0)',
                [username, fee_id, otpHash, salt, expiresAt],
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Send OTP via email - fetch from students table (single source of truth)
        const student = await new Promise((resolve, reject) => {
            db.get('SELECT email FROM students WHERE user_id = ?', [req.user.userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!student || !student.email) {
            console.log('Student email not found for user_id:', req.user.userId);
            writeLog(LOG_FILE, `FEE_OTP_SEND_ERROR: ${username} - Fee ID: ${fee_id} - Student email not found`);
            return res.status(400).json({
                status: 'error',
                message: 'No email address associated with your account'
            });
        }

        // Decrypt email (students table stores encrypted emails)
        let decryptedEmail;
        try {
            decryptedEmail = decrypt(student.email);
        } catch (decryptError) {
            console.error('Failed to decrypt email:', decryptError);
            writeLog(LOG_FILE, `FEE_OTP_SEND_ERROR: ${username} - Fee ID: ${fee_id} - Email decryption failed`);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to process email address'
            });
        }

        const emailResult = await sendOtpEmail(decryptedEmail, otp);
        writeLog(LOG_FILE, `FEE_OTP_SENT: ${username} - Fee ID: ${fee_id} - Email: ${decryptedEmail} - Sent: ${emailResult.sent} - Development: ${emailResult.development}`);

        if (!emailResult.sent && !emailResult.development) {
            console.error('Failed to send OTP email:', emailResult.reason);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to send OTP email. Please try again later.'
            });
        }

        res.json({
            status: 'success',
            message: 'OTP sent successfully'
        });

    } catch (error) {
        console.error('Error sending OTP:', error);
        writeLog(LOG_FILE, `FEE_OTP_SEND_ERROR: ${username} - Fee ID: ${fee_id} - IP: ${clientIP} - Error: ${error.message}`);
        res.status(500).json({
            status: 'error',
            message: 'Failed to send OTP'
        });
    }
});

// POST /api/fees/verify-otp - Verify OTP for payment
app.post('/api/fees/verify-otp', authenticateToken, authorizeRole(['student']), async (req, res) => {
    const { fee_id, otp } = req.body;
    const username = req.user.username;
    const clientIP = req.ip || req.connection.remoteAddress;
    const MAX_OTP_ATTEMPTS = 3;

    if (!fee_id || !otp) {
        return res.status(400).json({
            status: 'error',
            message: 'Fee ID and OTP are required'
        });
    }

    try {
        // Get latest OTP for this fee
        const otpRecord = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM fee_otp 
                 WHERE username = ? AND fee_id = ? 
                 ORDER BY created_at DESC LIMIT 1`,
                [username, fee_id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!otpRecord) {
            return res.status(400).json({
                status: 'error',
                message: 'No OTP found. Please request a new OTP.'
            });
        }

        // Check if already verified
        if (otpRecord.verified === 1) {
            return res.json({
                status: 'success',
                message: 'OTP already verified. You can proceed with payment.'
            });
        }

        // Check expiry
        if (new Date(otpRecord.expires_at) < new Date()) {
            return res.status(400).json({
                status: 'error',
                message: 'OTP has expired. Please request a new OTP.'
            });
        }

        // Check max attempts
        if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
            return res.status(429).json({
                status: 'error',
                message: 'Maximum verification attempts reached. Please request a new OTP.'
            });
        }

        // Verify OTP hash
        const inputHash = hashFeeOtp(otp, otpRecord.salt);

        if (inputHash !== otpRecord.otp_hash) {
            // Increment attempts
            await new Promise((resolve) => {
                db.run(
                    'UPDATE fee_otp SET attempts = attempts + 1 WHERE id = ?',
                    [otpRecord.id],
                    () => resolve()
                );
            });

            const remainingAttempts = MAX_OTP_ATTEMPTS - (otpRecord.attempts + 1);
            return res.status(400).json({
                status: 'error',
                message: `Invalid OTP. ${remainingAttempts} attempts remaining.`
            });
        }

        // OTP is valid - mark as verified
        await new Promise((resolve) => {
            db.run(
                'UPDATE fee_otp SET verified = 1 WHERE id = ?',
                [otpRecord.id],
                () => resolve()
            );
        });

        writeLog(LOG_FILE, `FEE_OTP_VERIFIED: ${username} - Fee ID: ${fee_id} - IP: ${clientIP}`);

        res.json({
            status: 'success',
            message: 'OTP verified successfully. You can now complete the payment.'
        });

    } catch (error) {
        console.error('Error verifying OTP:', error);
        writeLog(LOG_FILE, `FEE_OTP_VERIFY_ERROR: ${username} - Fee ID: ${fee_id} - IP: ${clientIP} - Error: ${error.message}`);
        res.status(500).json({
            status: 'error',
            message: 'Failed to verify OTP'
        });
    }
});

// GET /api/payment/details - Get school payment details (QR, Bank, UPI)
app.get('/api/payment/details', authenticateToken, async (req, res) => {
    try {
        const paymentDetails = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM school_payment_details LIMIT 1', [], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!paymentDetails) {
            return res.status(404).json({
                status: 'error',
                message: 'Payment details not configured'
            });
        }

        // Generate QR code for UPI payment
        const upiId = process.env.UPI_ID || paymentDetails.upi_id;
        const schoolName = process.env.SCHOOL_NAME || 'School';
        const amount = req.query.amount || '';
        
        const upiLink = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(schoolName)}&am=${amount}&cu=INR`;
        
        const qrImage = await QRCode.toDataURL(upiLink);

        res.json({
            status: 'success',
            upi_id: upiId,
            qr_code: qrImage,
            bank_name: process.env.BANK_NAME || paymentDetails.bank_name,
            account_number: process.env.ACCOUNT_NO || paymentDetails.account_number,
            ifsc: process.env.IFSC || paymentDetails.ifsc
        });

    } catch (error) {
        console.error('Error fetching payment details:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch payment details'
        });
    }
});

// POST /api/fees/complete-payment - Complete payment after OTP verification
app.post('/api/fees/complete-payment', authenticateToken, authorizeRole(['student']), async (req, res) => {
    const { fee_id } = req.body;
    const username = req.user.username;
    const clientIP = req.ip || req.connection.remoteAddress;

    if (!fee_id) {
        return res.status(400).json({
            status: 'error',
            message: 'Fee ID is required'
        });
    }

    try {
        // Check if fee exists and belongs to user
        const fee = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM fees WHERE id = ? AND username = ?',
                [fee_id, username],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!fee) {
            return res.status(404).json({
                status: 'error',
                message: 'Fee not found or does not belong to you'
            });
        }

        if (fee.status === 'PAID') {
            return res.status(400).json({
                status: 'error',
                message: 'Fee is already paid'
            });
        }

        // Check if OTP is verified
        const otpRecord = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM fee_otp 
                 WHERE username = ? AND fee_id = ? AND verified = 1 
                 AND expires_at > datetime('now')
                 ORDER BY created_at DESC LIMIT 1`,
                [username, fee_id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!otpRecord) {
            return res.status(400).json({
                status: 'error',
                message: 'No verified OTP found. Please verify OTP first.'
            });
        }

        // Check if payment already exists
        const existingPayment = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM fee_payments WHERE fee_id = ? AND username = ?',
                [fee_id, username],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (existingPayment) {
            return res.status(400).json({
                status: 'error',
                message: 'Payment already completed for this fee'
            });
        }

        // Update fee status to PAID
        await new Promise((resolve, reject) => {
            db.run(
                'UPDATE fees SET status = ? WHERE id = ?',
                ['PAID', fee_id],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Create payment record
        await new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO fee_payments (fee_id, username, amount, payment_method, transaction_id, payment_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [fee_id, username, fee.amount, 'OTP', 'OTP-' + Date.now(), new Date().toISOString(), 'COMPLETED'],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        writeLog(LOG_FILE, `FEE_PAYMENT_COMPLETED: ${username} - Fee ID: ${fee_id} - Amount: ${fee.amount} - IP: ${clientIP}`);

        res.json({
            status: 'success',
            message: 'Payment completed successfully'
        });

    } catch (error) {
        console.error('Error completing payment:', error);
        writeLog(LOG_FILE, `FEE_PAYMENT_ERROR: ${username} - Fee ID: ${fee_id} - IP: ${clientIP} - Error: ${error.message}`);
        res.status(500).json({
            status: 'error',
            message: 'Failed to complete payment'
        });
    }
});

// POST /api/fees/mark-paid - Student marks payment as done (after manual payment)
app.post('/api/fees/mark-paid', authenticateToken, authorizeRole(['student']), async (req, res) => {
    const { fee_id, payment_method, transaction_id } = req.body;
    const username = req.user.username;
    const clientIP = req.ip || req.connection.remoteAddress;

    if (!fee_id || !payment_method) {
        return res.status(400).json({
            status: 'error',
            message: 'Fee ID and payment method are required'
        });
    }

    if (!['UPI', 'BANK'].includes(payment_method)) {
        return res.status(400).json({
            status: 'error',
            message: 'Payment method must be UPI or BANK'
        });
    }

    try {
        // Check if fee exists and belongs to user
        const fee = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM fees WHERE id = ? AND username = ?',
                [fee_id, username],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!fee) {
            return res.status(404).json({
                status: 'error',
                message: 'Fee not found or does not belong to you'
            });
        }

        if (fee.status === 'PAID') {
            return res.status(400).json({
                status: 'error',
                message: 'Fee is already paid'
            });
        }

        // Check if OTP is verified
        const otpRecord = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM fee_otp 
                 WHERE username = ? AND fee_id = ? AND verified = 1 
                 AND expires_at > datetime('now')
                 ORDER BY created_at DESC LIMIT 1`,
                [username, fee_id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!otpRecord) {
            return res.status(400).json({
                status: 'error',
                message: 'No verified OTP found. Please verify OTP first.'
            });
        }

        // Check if payment already exists
        const existingPayment = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM fee_payments WHERE fee_id = ? AND username = ?',
                [fee_id, username],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (existingPayment) {
            return res.status(400).json({
                status: 'error',
                message: 'Payment already submitted. Waiting for admin approval.'
            });
        }

        // Insert payment record with pending status
        const paymentResult = await new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO fee_payments (fee_id, username, amount, payment_method, transaction_id, status, paid_at) VALUES (?, ?, ?, ?, ?, ?, datetime("now"))',
                [fee_id, username, fee.amount, payment_method, transaction_id || null, 'pending'],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });

        console.log("Payment request created:", username, fee.amount);

        writeLog(LOG_FILE, `FEE_PAYMENT_MARKED: ${username} - Fee ID: ${fee_id} - Amount: ${fee.amount} - Method: ${payment_method} - Payment ID: ${paymentResult.id} - IP: ${clientIP}`);

        res.json({
            status: 'success',
            message: 'Payment marked successfully. Waiting for admin approval.',
            payment_id: paymentResult.id
        });

    } catch (error) {
        console.error('Error marking payment:', error);
        writeLog(LOG_FILE, `FEE_PAYMENT_MARK_ERROR: ${username} - Fee ID: ${fee_id} - IP: ${clientIP} - Error: ${error.message}`);
        res.status(500).json({
            status: 'error',
            message: 'Failed to mark payment'
        });
    }
});

// GET /api/admin/payment-requests - Admin views pending payment requests
app.get('/api/admin/payment-requests', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    try {
        const query = `SELECT fp.*, u.username 
                      FROM fee_payments fp 
                      JOIN users u ON fp.username = u.username
                      WHERE fp.status = 'pending'
                      ORDER BY fp.paid_at DESC`;

        const payments = await new Promise((resolve, reject) => {
            db.all(query, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        res.json({
            status: 'success',
            payments: payments
        });

    } catch (error) {
        console.error('Error fetching payment requests:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch payment requests'
        });
    }
});

// POST /api/admin/approve-payment - Admin approves payment
app.post('/api/admin/approve-payment', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { payment_id } = req.body;
    const clientIP = req.ip || req.connection.remoteAddress;

    if (!payment_id) {
        return res.status(400).json({
            status: 'error',
            message: 'Payment ID is required'
        });
    }

    try {
        // Get payment details
        const payment = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM fee_payments WHERE id = ?',
                [payment_id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!payment) {
            return res.status(404).json({
                status: 'error',
                message: 'Payment not found'
            });
        }

        if (payment.status !== 'pending') {
            return res.status(400).json({
                status: 'error',
                message: 'Payment is already processed'
            });
        }

        // Update payment status to paid
        await new Promise((resolve) => {
            db.run(
                'UPDATE fee_payments SET status = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?',
                ['paid', payment_id],
                () => resolve()
            );
        });

        // Update fee status to PAID
        await new Promise((resolve) => {
            db.run(
                'UPDATE fees SET status = ? WHERE id = ?',
                ['PAID', payment.fee_id],
                () => resolve()
            );
        });

        writeLog(LOG_FILE, `FEE_PAYMENT_APPROVED: Payment ID: ${payment_id} - Fee ID: ${payment.fee_id} - Username: ${payment.username} - IP: ${clientIP}`);

        res.json({
            status: 'success',
            message: 'Payment approved successfully'
        });

    } catch (error) {
        console.error('Error approving payment:', error);
        writeLog(LOG_FILE, `FEE_PAYMENT_APPROVE_ERROR: Payment ID: ${payment_id} - IP: ${clientIP} - Error: ${error.message}`);
        res.status(500).json({
            status: 'error',
            message: 'Failed to approve payment'
        });
    }
});

// POST /api/admin/reject-payment - Admin rejects payment
app.post('/api/admin/reject-payment', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { payment_id } = req.body;
    const clientIP = req.ip || req.connection.remoteAddress;

    if (!payment_id) {
        return res.status(400).json({
            status: 'error',
            message: 'Payment ID is required'
        });
    }

    try {
        // Get payment details
        const payment = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM fee_payments WHERE id = ?',
                [payment_id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!payment) {
            return res.status(404).json({
                status: 'error',
                message: 'Payment not found'
            });
        }

        if (payment.status !== 'pending') {
            return res.status(400).json({
                status: 'error',
                message: 'Payment is already processed'
            });
        }

        // Update payment status to rejected
        await new Promise((resolve) => {
            db.run(
                'UPDATE fee_payments SET status = ? WHERE id = ?',
                ['rejected', payment_id],
                () => resolve()
            );
        });

        writeLog(LOG_FILE, `FEE_PAYMENT_REJECTED: Payment ID: ${payment_id} - Fee ID: ${payment.fee_id} - Username: ${payment.username} - IP: ${clientIP}`);

        res.json({
            status: 'success',
            message: 'Payment rejected successfully'
        });

    } catch (error) {
        console.error('Error rejecting payment:', error);
        writeLog(LOG_FILE, `FEE_PAYMENT_REJECT_ERROR: Payment ID: ${payment_id} - IP: ${clientIP} - Error: ${error.message}`);
        res.status(500).json({
            status: 'error',
            message: 'Failed to reject payment'
        });
    }
});

// GET /api/fees/payments/history - Get payment history for student
app.get('/api/fees/payments/history', authenticateToken, authorizeRole(['student']), async (req, res) => {
    const username = req.user.username;

    try {
        const payments = await new Promise((resolve, reject) => {
            db.all(
                `SELECT fp.*, u.username
                 FROM fee_payments fp 
                 JOIN users u ON fp.username = u.username
                 WHERE fp.username = ? AND fp.status = 'paid'
                 ORDER BY fp.paid_at DESC`,
                [username],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        res.json({
            status: 'success',
            payments: payments
        });

    } catch (error) {
        console.error('Error fetching payment history:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch payment history'
        });
    }
});

// GET /api/fees/payments/all - Admin gets all payment history
app.get('/api/fees/payments/all', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    try {
        const payments = await new Promise((resolve, reject) => {
            db.all(
                `SELECT fp.*, f.description, f.due_date 
                 FROM fee_payments fp 
                 JOIN fees f ON fp.fee_id = f.id 
                 ORDER BY fp.paid_at DESC`,
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        res.json({
            status: 'success',
            payments: payments
        });

    } catch (error) {
        console.error('Error fetching all payments:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch payment history'
        });
    }
});

// GET /api/fees/statistics - Get fee statistics for dashboard
app.get('/api/fees/statistics', async (req, res) => {
    try {
        // Get fee payment statistics
        const stats = await new Promise((resolve, reject) => {
            db.all(
                `SELECT 
                    CASE 
                        WHEN LOWER(status) = 'paid' OR LOWER(status) = 'success' OR LOWER(status) = 'completed' THEN 'Paid'
                        WHEN LOWER(status) = 'pending' THEN 'Pending'
                        WHEN LOWER(status) = 'rejected' THEN 'Overdue'
                        ELSE 'Other'
                    END as payment_status,
                    COUNT(*) as student_count
                    FROM fee_payments 
                    GROUP BY payment_status`,
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        // Get total fees for percentage calculation
        const totalFees = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as total FROM fee_payments', [], (err, row) => {
                if (err) reject(err);
                else resolve(row.total);
            });
        });

        // Format data for chart
        const chartData = [
            { status: 'Paid', students: 0, percentage: 0, color: '#28a745' },
            { status: 'Pending', students: 0, percentage: 0, color: '#ffc107' },
            { status: 'Overdue', students: 0, percentage: 0, color: '#dc3545' }
        ];

        // Populate with actual data
        stats.forEach(stat => {
            const chartItem = chartData.find(item => item.status === stat.payment_status);
            if (chartItem) {
                chartItem.students = stat.student_count;
                chartItem.percentage = totalFees > 0 ? ((stat.student_count / totalFees) * 100).toFixed(1) : 0;
            }
        });

        res.json({
            status: 'success',
            data: chartData,
            total: totalFees
        });

    } catch (error) {
        console.error('Error fetching fee statistics:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch fee statistics'
        });
    }
});

// DELETE /api/fees/:id - Admin deletes a fee
app.delete('/api/fees/:id', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const feeId = req.params.id;

    try {
        // Check if fee exists
        const fee = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM fees WHERE id = ?', [feeId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!fee) {
            return res.status(404).json({
                status: 'error',
                message: 'Fee not found'
            });
        }

        if (fee.status === 'PAID') {
            return res.status(400).json({
                status: 'error',
                message: 'Cannot delete paid fee'
            });
        }

        // Delete fee
        await new Promise((resolve) => {
            db.run('DELETE FROM fees WHERE id = ?', [feeId], () => resolve());
        });

        res.json({
            status: 'success',
            message: 'Fee deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting fee:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete fee'
        });
    }
});

// ==================== END FEE MANAGEMENT SYSTEM ====================

// Start servers
function startServers() {
    // Start HTTPS server if SSL is enabled; otherwise start HTTP server
    if (SSL_CONFIG.ENABLED) {
        const credentials = loadSSLCertificates();
        
        if (credentials) {
            const httpsServer = https.createServer(credentials, app);
            
            httpsServer.listen(HTTPS_PORT, () => {
                console.log(`🔒 HTTPS Server running on https://localhost:${HTTPS_PORT}`);
                console.log(`   → SSL/TLS encryption enabled with self-signed certificates`);
                console.log(`   → Certificate: ${SSL_CONFIG.CERT_PATH}`);
                console.log(`   → Private Key: ${SSL_CONFIG.KEY_PATH}`);
                console.log(`   → HTTP server disabled - HTTPS-only mode`);
            });

            httpsServer.on('error', (error) => {
                if (error.code === 'EADDRINUSE') {
                    console.error(`❌ HTTPS port ${HTTPS_PORT} is already in use`);
                } else {
                    console.error('❌ HTTPS server error:', error.message);
                }
            });
        } else {
            console.log('⚠️  HTTPS server disabled due to certificate loading failure');
        }
    } else {
        const httpServer = app.listen(PORT, '0.0.0.0', () => {
            console.log(`🔓 HTTP Server running on http://0.0.0.0:${PORT}`);
        });
        httpServer.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`❌ HTTP port ${PORT} is already in use`);
            } else {
                console.error('❌ HTTP server error:', error.message);
            }
        });
        console.log('⚠️  SSL is disabled. HTTP server is running. Enable SSL for secure operation.');
    }
}

startServers();
