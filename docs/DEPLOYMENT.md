# YouTube AutoPilot - Production Deployment Guide

YouTube AutoPilot is an automated SaaS platform that connects a user's Google Drive source folder, processes up to 2 videos per day, generates YouTube metadata using Groq Cloud AI, and publishes them to YouTube and multi-social channels with AI-driven content orchestration.

---

## 1. Prerequisites
- Google Cloud Platform (GCP) Project
- Groq Cloud API Key ([groq.com](https://console.groq.com))
- Firebase project (or Firestore database)
- Node.js 20+ runtime

---

## 2. Google Cloud Setup & Enable APIs

1. Create or select a Google Cloud Project in the [GCP Console](https://console.cloud.google.com).
2. Enable the required Google APIs:
   ```bash
   gcloud services enable \
     drive.googleapis.com \
     youtube.googleapis.com \
     cloudscheduler.googleapis.com \
     run.googleapis.com \
     firestore.googleapis.com
   ```

---

## 3. Configure OAuth Consent Screen & Credentials

1. Go to **APIs & Services > OAuth consent screen**.
2. Select User Type: **External** (or Internal for Workspace).
3. Fill in App Information:
   - App Name: `YouTube AutoPilot`
   - User support email: your email
   - Developer contact email: your email
4. Add the required Scopes:
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/drive.metadata.readonly`
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
5. Go to **APIs & Services > Credentials** > **Create Credentials > OAuth Client ID**:
   - Application Type: **Web application**
   - Name: `YouTube AutoPilot Web Client`
   - Authorized JavaScript origins:
     - `http://localhost:3000`
     - `https://your-cloud-run-service.run.app`
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/google/callback`
     - `https://your-cloud-run-service.run.app/api/auth/google/callback`
6. Note down:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

---

## 4. Obtain Groq Cloud API Key

1. Sign up at [Groq Console](https://console.groq.com).
2. Create an API Key in **API Keys**.
3. Set `GROQ_API_KEY=gsk_...`
4. Choose model: `GROQ_MODEL=llama-3.3-70b-versatile`

---

## 5. Supabase PostgreSQL Configuration

1. Create a free project at [Supabase](https://supabase.com).
2. Go to **Project Settings > API** and copy:
   - **Project URL** (`SUPABASE_URL`)
   - **service_role key** (`SUPABASE_SERVICE_ROLE_KEY`) or **anon key** (`SUPABASE_ANON_KEY`)
3. Open **SQL Editor** in Supabase and run the provided script in `supabase/schema.sql` (or click "View & Copy PostgreSQL Schema" inside the app's Settings page).
4. Set environment variables:
   - `SUPABASE_URL=https://your-project.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY=your-service-role-or-anon-key`
   *(Note: The application also supports an in-memory/local persistent fallback for rapid offline testing without Supabase credentials)*

---

## 6. Environment Variables Checklist

Set these in your container runtime (Google Cloud Run or `.env`):

```env
NODE_ENV=production
APP_URL=https://your-app.run.app

# Groq Cloud
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile

# Google OAuth
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://your-app.run.app/api/auth/google/callback

# Supabase PostgreSQL credentials
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_ANON_KEY=...
```

---

## 7. Deploy to Google Cloud Run

Deploy the container using Google Cloud Build / Cloud Run:

```bash
# Build & Deploy
gcloud run deploy youtube-autopilot \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 3000 \
  --set-env-vars NODE_ENV=production,APP_URL=https://youtube-autopilot-xyz.a.run.app,GROQ_MODEL=llama-3.3-70b-versatile
```

---

## 8. Configure Google Cloud Scheduler for Automation

To trigger the server-side automation worker automatically every day at 10:00 AM (or user-defined time):

```bash
gcloud scheduler jobs create http youtube-autopilot-daily \
  --location=us-central1 \
  --schedule="0 10 * * *" \
  --time-zone="America/New_York" \
  --uri="https://your-cloud-run-service.run.app/api/automation/run" \
  --http-method=POST \
  --headers="Content-Type: application/json,X-CloudScheduler=true"
```

The endpoint `/api/automation/run` is idempotent, enforces the strict 2 videos/day quota, prevents concurrent race conditions with job locks, and logs all events.
