// ========================================
// Firebase конфигурациясы — qala-maselesi
// ========================================

const firebaseConfig = {
    apiKey: "AIzaSyDActJuUa6J1zsRrPfXjRkWt5ZnAik4Hmg",
    authDomain: "qala-maselesi.firebaseapp.com",
    projectId: "qala-maselesi",
    storageBucket: "qala-maselesi.firebasestorage.app",
    messagingSenderId: "1095554473447",
    appId: "1:1095554473447:web:09730264e55f01674fb142",
    measurementId: "G-LDXLPC6D0Y"
};

let isFirebaseConfigured = false;
let auth = null;
let db = null;

try {
    if (typeof firebase !== 'undefined' && firebaseConfig.apiKey) {
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore();
        isFirebaseConfigured = true;
        console.log("Firebase (qala-maselesi) сәтті қосылды! Cloud Firestore және Auth белсенді.");
    }
} catch (error) {
    console.error("Firebase қосылу қатесі:", error);
}
