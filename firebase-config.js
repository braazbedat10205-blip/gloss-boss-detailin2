import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, browserLocalPersistence, setPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBAy3mnRE9Al1p5Har99bOnYvnqYHy2rC8",
  authDomain: "gloos-boos-site.firebaseapp.com",
  projectId: "gloos-boos-site",
  storageBucket: "gloos-boos-site.firebasestorage.app",
  messagingSenderId: "960988719968",
  appId: "1:960988719968:web:c2d4c12538a72a3cff8c05",
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const authReady = setPersistence(auth, browserLocalPersistence);
