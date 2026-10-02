// =================================================================
// Google Firebase Phone Authentication Configuration
// =================================================================
// Paste your Firebase Web App configuration below:
// (Get it free in 2 minutes from https://console.firebase.google.com)

if (typeof window === 'undefined') {
  module.exports = {};
  return;
}

window.FIREBASE_CONFIG = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Automatically initializes Firebase when valid config is present
window.isFirebaseConfigured = function() {
  return window.FIREBASE_CONFIG && 
         window.FIREBASE_CONFIG.apiKey && 
         !window.FIREBASE_CONFIG.apiKey.startsWith('YOUR_');
};

if (typeof firebase !== 'undefined' && window.isFirebaseConfigured()) {
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(window.FIREBASE_CONFIG);
      console.log('[FIREBASE] Real Phone SMS Authentication Initialized Successfully');
    }
  } catch (e) {
    console.error('[FIREBASE INIT ERROR]', e);
  }
}
