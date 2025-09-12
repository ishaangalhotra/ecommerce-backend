# 🔄 Hybrid Authentication Request Flow

## Current Configuration

**Frontend**: `hybrid-auth-frontend.js`  
**Backend URL**: `https://quicklocal-backend.onrender.com`  
**Supabase URL**: `https://pmvhsjezhuokwygvhhqk.supabase.co`  

---

## 📝 **REGISTRATION FLOW**

When a user calls `auth.register()` or `auth.registerWithValidation()`:

```
🌐 Frontend (Browser)
    ↓
    📝 User fills registration form
    ↓
    🔍 Frontend validation (if using registerWithValidation)
    ↓
    📤 HTTP POST Request
    ↓
┌─────────────────────────────────────────────────┐
│  Request Details:                               │
│  URL: https://quicklocal-backend.onrender.com/  │
│       api/hybrid-auth/register                  │
│  Method: POST                                   │
│  Headers: Content-Type: application/json       │
│  Body: {                                        │
│    "name": "John Doe",                          │
│    "email": "user@example.com",                 │
│    "password": "securepass123",                 │
│    "phone": "9876543210" (optional),            │
│    "role": "customer"                           │
│  }                                              │
└─────────────────────────────────────────────────┘
    ↓
🌍 Internet → Render.com Hosting
    ↓
🖥️  Your Backend Server (server.js)
    ↓
📍 Route: /api/hybrid-auth (hybridAuth.js)
    ↓
🔐 Endpoint: POST /register (line 33-126)
    ↓
✅ Validation: express-validator checks
    ↓
🔍 MongoDB Check: Existing user search
    ↓
🚀 Supabase API Call:
    URL: https://pmvhsjezhuokwygvhhqk.supabase.co
    Method: supabaseAdmin.auth.admin.createUser()
    ↓
💾 MongoDB Save: User data with supabaseId
    ↓
📊 Analytics Log: Supabase event logging
    ↓
📤 Response back to frontend:
    {
      "success": true,
      "message": "Registration successful!",
      "requiresVerification": true/false
    }
```

---

## 🔐 **LOGIN FLOW**

When a user calls `auth.login(identifier, password)`:

```
🌐 Frontend (Browser)
    ↓
    🔍 User enters email/phone + password
    ↓
    📤 HTTP POST Request
    ↓
┌─────────────────────────────────────────────────┐
│  Request Details:                               │
│  URL: https://quicklocal-backend.onrender.com/  │
│       api/hybrid-auth/login                     │
│  Method: POST                                   │
│  Headers: Content-Type: application/json       │
│  Body: {                                        │
│    "identifier": "user@example.com" OR          │
│                  "9876543210",                  │
│    "password": "securepass123"                  │
│  }                                              │
└─────────────────────────────────────────────────┘
    ↓
🌍 Internet → Render.com Hosting
    ↓
🖥️  Your Backend Server (server.js)
    ↓
📍 Route: /api/hybrid-auth (hybridAuth.js)
    ↓
🔐 Endpoint: POST /login (line 233-373)
    ↓
✅ Validation: identifier format check
    ↓
🔍 MongoDB Search: Find user by email OR phone
    ↓
┌─── User Found? ───┐
│                   │
│  📱 Supabase User │  🔑 Legacy JWT User
│                   │
│  🚀 Supabase Auth │  🛡️  Password Check
│  supabase.auth    │  user.correctPassword()
│  .signInWithPassword() │
│                   │
│  📤 Return:       │  📤 Return:
│  - accessToken    │  - JWT token
│  - refreshToken   │  - user data
│  - user data      │
└─────────────────────┘
    ↓
📤 Response back to frontend:
    
    For Supabase Users:
    {
      "success": true,
      "message": "Login successful",
      "accessToken": "eyJ...",
      "refreshToken": "abc...",
      "user": { id, name, email, role, ... }
    }
    
    For Legacy Users:
    {
      "success": true,
      "message": "Login successful (legacy mode)",
      "token": "eyJ...",
      "user": { id, name, email, role, ... }
    }
```

---

## 🔄 **Authentication Check Flow**

When the app initializes or checks auth status:

```
🌐 Frontend Initialization
    ↓
🔍 Check localStorage for tokens:
    - supabase_access_token (new users)
    - token (legacy users)
    ↓
📤 HTTP GET Request
    ↓
┌─────────────────────────────────────────────────┐
│  Request Details:                               │
│  URL: https://quicklocal-backend.onrender.com/  │
│       api/hybrid-auth/me                        │
│  Method: GET                                    │
│  Headers: Authorization: Bearer <token>         │
└─────────────────────────────────────────────────┘
    ↓
🖥️  Backend: GET /me (line 407-431)
    ↓
🛡️  Middleware: hybridProtect
    ↓
💾 MongoDB: Find user by ID
    ↓
📤 Response: User profile data
```

---

## 🌐 **Complete Request Path Summary**

### All Auth Requests Go To:
```
1. 🌐 Browser/Frontend
2. 🌍 Internet
3. 🏗️  Render.com (https://quicklocal-backend.onrender.com)
4. 🖥️  Your Node.js Server (server.js)
5. 📍 Hybrid Auth Routes (/routes/hybridAuth.js)
6. 💾 MongoDB (user data storage)
7. 🚀 Supabase (authentication service)
8. 📤 Response back to frontend
```

### Key Endpoints:
- **Registration**: `POST /api/hybrid-auth/register`
- **Login**: `POST /api/hybrid-auth/login` 
- **Profile**: `GET /api/hybrid-auth/me`
- **Logout**: `POST /api/hybrid-auth/logout`
- **Refresh**: `POST /api/hybrid-auth/refresh-token`

---

## 🔧 **What Happens Behind the Scenes**

### Registration Process:
1. **Frontend** → Validates input → Sends to backend
2. **Backend** → Validates again → Checks MongoDB for duplicates
3. **Supabase** → Creates authentication record
4. **MongoDB** → Saves user profile with Supabase ID
5. **Backend** → Logs analytics → Sends response
6. **Frontend** → Handles response → Updates UI

### Login Process:
1. **Frontend** → Sends credentials to backend
2. **Backend** → Finds user in MongoDB
3. **Authentication**:
   - **New users**: Supabase authentication
   - **Legacy users**: JWT token validation
4. **Backend** → Returns appropriate tokens
5. **Frontend** → Stores tokens → Updates auth state

---

## 📋 **Current Server Status**

- ✅ **Backend Server**: Deployed at Render.com
- ✅ **Hybrid Routes**: Active at `/api/hybrid-auth/*`
- ❌ **Legacy Routes**: Disabled (`/api/v1/auth/*`)
- ✅ **Supabase Integration**: Active
- ✅ **MongoDB Storage**: User profiles stored

All authentication requests now flow through the hybrid system! 🎯
