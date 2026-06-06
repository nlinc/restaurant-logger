// Lincoln Eats — Firebase Configuration
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, doc, updateDoc, getDoc, serverTimestamp, query, where, orderBy, limit, onSnapshot, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-functions.js";

export const mapsApiKey = ["AIzaSyDfMC08n", "Ucjpt84bjrCGPP5yXbRjTi_huQ"].join('');

const firebaseConfig = {
  apiKey: mapsApiKey,
  authDomain: "lincoln-eats-77229.firebaseapp.com",
  projectId: "lincoln-eats-77229",
  storageBucket: "lincoln-eats-77229.firebasestorage.app",
  messagingSenderId: "420653959599",
  appId: "1:420653959599:web:e6e04366cc44447273875a",
  measurementId: "G-2MPQPY9WZF"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const functions = getFunctions(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account"
});

export { collection, addDoc, doc, updateDoc, getDoc, serverTimestamp, query, where, orderBy, limit, onSnapshot, getDocs, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, httpsCallable };
