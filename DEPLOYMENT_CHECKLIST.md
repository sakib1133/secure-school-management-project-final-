# Render Deployment Checklist

## Pre-Deployment

- [ ] All changes committed to git
- [ ] DB_PATH is set to `/opt/render/project/data/school.db` in render.yaml
- [ ] Disk is configured in render.yaml with mountPath `/opt/render/project/data`
- [ ] ENCRYPTION_KEY is set in environment variables

## Post-Deployment Verification

### Step 1: Check Health Endpoint
```bash
curl https://your-app.onrender.com/health
```
Expected response:
```json
{"status":"ok","timestamp":"...","db_path":"/opt/render/project/data/school.db","uptime":123}
```

### Step 2: Check Database Debug Endpoint
```bash
curl https://your-app.onrender.com/debug-db
```

**Expected healthy response:**
```json
{
    "status": "healthy",
    "database": {
        "db_path_used": "/opt/render/project/data/school.db"
    },
    "file_system": {
        "db_file_exists": true
    },
    "record_counts": {
        "users": 1,
        "students": 0,
        "teachers": 0
    },
    "admin_user_exists": true
}
```

### Step 3: Login Test
1. Navigate to `https://your-app.onrender.com/login.html`
2. Login with admin credentials (admin / admin@321 or your DEFAULT_ADMIN_PASSWORD)
3. Verify dashboard loads

### Step 4: Data Visibility Test
1. Go to Students section
2. Verify "No students found" message (expected initially)
3. Add a test student
4. Verify student appears in list

## Common Issues & Fixes

### Issue: "Database file exists: NO" in logs
**Fix:** Check disk is mounted and DB_PATH is correct

### Issue: "0 tables found" or "0 users"
**Fix:** This is expected on first deploy - admin user will be auto-created. Check `/debug-db` for `admin_user_exists: true`

### Issue: "Cannot read property 'x' of undefined"
**Fix:** Database may not be connected. Check logs for "CRITICAL ERROR connecting to database"

### Issue: Data disappears after redeploy
**Fix:** Ensure disk is configured and DB_PATH is set to `/opt/render/project/data/school.db`, NOT a relative path

## Environment Variables (Required)

Set these in Render Dashboard → Environment:

| Variable | Value |
|----------|-------|
| DB_PATH | `/opt/render/project/data/school.db` |
| JWT_SECRET | (generate random string) |
| SESSION_SECRET | (generate random string) |
| ENCRYPTION_KEY | (generate 64-char hex string) |
| NODE_ENV | `production` |

## Support Commands

Check database directly via Render Shell:
```bash
# List database directory
ls -la /opt/render/project/data/

# Check database file size
du -h /opt/render/project/data/school.db

# View database schema (if sqlite3 available)
sqlite3 /opt/render/project/data/school.db ".tables"
```
