// Social Login Implementation for QuickLocal
// Add these to your frontend and backend

// ==================== FRONTEND (HTML + JavaScript) ====================

// 1. Add to your login.html <head>
/*
<script src="https://accounts.google.com/gsi/client" async defer></script>
<script async defer crossorigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js"></script>
*/

// 2. Add to your login form HTML
/*
<div class="social-login-container">
  <button id="google-login-btn" class="btn-social btn-google">
    <i class="fab fa-google"></i> Continue with Google
  </button>
  
  <button id="facebook-login-btn" class="btn-social btn-facebook">
    <i class="fab fa-facebook-f"></i> Continue with Facebook
  </button>
</div>

<div id="g_id_onload"
     data-client_id="YOUR_GOOGLE_CLIENT_ID"
     data-callback="handleGoogleSignIn"
     data-auto_prompt="false">
</div>
*/

// 3. Frontend JavaScript Implementation
class SocialLogin {
  constructor() {
    this.initGoogle();
    this.initFacebook();
  }

  // Google Sign-In Implementation
  initGoogle() {
    window.handleGoogleSignIn = async (response) => {
      try {
        console.log('Google sign-in response:', response);
        
        const result = await fetch('/api/v1/auth/google-login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            credential: response.credential
          })
        });

        const data = await result.json();
        
        if (data.success) {
          // Store token
          localStorage.setItem('authToken', data.accessToken);
          localStorage.setItem('user', JSON.stringify(data.user));
          
          // Redirect to dashboard
          window.location.href = '/dashboard.html';
          
          // Track analytics
          if (typeof gtag !== 'undefined') {
            gtag('event', 'login', {
              method: 'Google'
            });
          }
        } else {
          this.showError(data.message);
        }
      } catch (error) {
        console.error('Google login error:', error);
        this.showError('Google sign-in failed. Please try again.');
      }
    };
  }

  // Facebook Login Implementation
  initFacebook() {
    window.fbAsyncInit = function() {
      FB.init({
        appId: 'YOUR_FACEBOOK_APP_ID',
        cookie: true,
        xfbml: true,
        version: 'v18.0'
      });
    };

    document.getElementById('facebook-login-btn')?.addEventListener('click', () => {
      FB.login((response) => {
        if (response.authResponse) {
          FB.api('/me', { fields: 'name,email,picture' }, (userInfo) => {
            this.handleFacebookLogin(response.authResponse, userInfo);
          });
        }
      }, { scope: 'email' });
    });
  }

  async handleFacebookLogin(authResponse, userInfo) {
    try {
      const result = await fetch('/api/v1/auth/facebook-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          accessToken: authResponse.accessToken,
          userID: authResponse.userID,
          userInfo: userInfo
        })
      });

      const data = await result.json();
      
      if (data.success) {
        localStorage.setItem('authToken', data.accessToken);
        localStorage.setItem('user', JSON.stringify(data.user));
        window.location.href = '/dashboard.html';
        
        if (typeof gtag !== 'undefined') {
          gtag('event', 'login', {
            method: 'Facebook'
          });
        }
      } else {
        this.showError(data.message);
      }
    } catch (error) {
      console.error('Facebook login error:', error);
      this.showError('Facebook sign-in failed. Please try again.');
    }
  }

  showError(message) {
    const errorDiv = document.getElementById('error-message') || 
                    document.createElement('div');
    errorDiv.id = 'error-message';
    errorDiv.className = 'alert alert-danger';
    errorDiv.textContent = message;
    
    const form = document.querySelector('.login-form');
    form.insertBefore(errorDiv, form.firstChild);
    
    setTimeout(() => {
      errorDiv.remove();
    }, 5000);
  }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
  new SocialLogin();
});

// ==================== BACKEND ROUTES ====================
// Add these routes to your auth.js

/* 
// Google OAuth Login Route
router.post('/google-login', async (req, res) => {
  try {
    const { credential } = req.body;
    
    // Verify Google JWT token
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    // Check if user exists
    let user = await User.findOne({ 
      $or: [
        { email: email },
        { googleId: googleId }
      ]
    });

    if (!user) {
      // Create new user
      user = new User({
        name: name,
        email: email,
        googleId: googleId,
        profilePicture: picture,
        isVerified: true, // Google accounts are pre-verified
        role: 'customer',
        authProvider: 'google'
      });
      
      await user.save();
    } else if (!user.googleId) {
      // Link existing account
      user.googleId = googleId;
      user.profilePicture = picture || user.profilePicture;
      await user.save();
    }

    // Generate JWT token
    const accessToken = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.json({
      success: true,
      accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        profilePicture: user.profilePicture
      }
    });

  } catch (error) {
    console.error('Google login error:', error);
    res.status(401).json({
      success: false,
      message: 'Google authentication failed'
    });
  }
});

// Facebook OAuth Login Route  
router.post('/facebook-login', async (req, res) => {
  try {
    const { accessToken, userID, userInfo } = req.body;
    
    // Verify Facebook token
    const axios = require('axios');
    const fbResponse = await axios.get(
      `https://graph.facebook.com/me?access_token=${accessToken}&fields=id,name,email`
    );
    
    if (fbResponse.data.id !== userID) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Facebook token'
      });
    }

    const { id: facebookId, name, email } = fbResponse.data;

    // Check if user exists
    let user = await User.findOne({
      $or: [
        { email: email },
        { facebookId: facebookId }
      ]
    });

    if (!user) {
      // Create new user
      user = new User({
        name: name,
        email: email,
        facebookId: facebookId,
        profilePicture: userInfo.picture?.data?.url,
        isVerified: true,
        role: 'customer',
        authProvider: 'facebook'
      });
      
      await user.save();
    } else if (!user.facebookId) {
      // Link existing account
      user.facebookId = facebookId;
      user.profilePicture = userInfo.picture?.data?.url || user.profilePicture;
      await user.save();
    }

    // Generate JWT token
    const accessToken = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.json({
      success: true,
      accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        profilePicture: user.profilePicture
      }
    });

  } catch (error) {
    console.error('Facebook login error:', error);
    res.status(401).json({
      success: false,
      message: 'Facebook authentication failed'
    });
  }
});
*/

// ==================== ENVIRONMENT VARIABLES ====================
/*
Add to your .env file:

GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
FACEBOOK_APP_ID=your_facebook_app_id_here
FACEBOOK_APP_SECRET=your_facebook_app_secret_here
*/

// ==================== CSS STYLING ====================
/*
.social-login-container {
  margin: 20px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.btn-social {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 12px 20px;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
  width: 100%;
}

.btn-google {
  background-color: #4285f4;
  color: white;
}

.btn-google:hover {
  background-color: #3367d6;
}

.btn-facebook {
  background-color: #1877f2;
  color: white;
}

.btn-facebook:hover {
  background-color: #166fe5;
}

.social-divider {
  text-align: center;
  margin: 20px 0;
  position: relative;
}

.social-divider::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: #ddd;
}

.social-divider span {
  background: white;
  padding: 0 15px;
  color: #666;
  font-size: 14px;
}
*/
