import { doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth, authReady, db } from "./firebase-config.js";

export async function waitForUser() {
  await authReady.catch(() => {});

  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};

    unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        resolve(user);
      },
      (error) => {
        unsubscribe();
        reject(error);
      },
    );
  });
}

export async function requireUser(options = {}) {
  const {
    redirectTo = "login.html",
    requireVerified = true,
    messageCode = "login_required",
  } = options;

  const user = await waitForUser();

  if (!user) {
    redirectWithMessage(redirectTo, messageCode);
    return null;
  }

  if (requireVerified && !user.emailVerified) {
    await signOut(auth).catch(() => {});
    redirectWithMessage("login.html", "verify_email");
    return null;
  }

  return user;
}

export async function requireAdmin() {
  const user = await requireUser();

  if (!user) {
    return null;
  }

  const admin = await isAdmin(user);

  if (!admin) {
    window.location.replace("index.html");
    return null;
  }

  return user;
}

export async function isAdmin(user) {
  if (!user) {
    return false;
  }

  const adminSnapshot = await getDoc(doc(db, "admins", user.uid));
  return adminSnapshot.exists();
}

export async function getUserProfile(uid) {
  const snapshot = await getDoc(doc(db, "users", uid));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function saveUserProfile(user, profile = {}) {
  if (!user) {
    return;
  }

  const profileRef = doc(db, "users", user.uid);
  const currentSnapshot = await getDoc(profileRef);
  const currentData = currentSnapshot.exists() ? currentSnapshot.data() : {};
  const name = (profile.name || currentData.name || user.displayName || "").trim();

  if (!name) {
    return;
  }

  await setDoc(
    profileRef,
    {
      uid: user.uid,
      email: user.email || "",
      name,
      phone: normalizeOptionalValue(profile.phone, currentData.phone),
      createdAt: currentData.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function logoutAndGo(target = "login.html") {
  await signOut(auth);
  window.location.replace(target);
}

export function redirectWithMessage(path, code) {
  const nextUrl = new URL(path, window.location.href);

  if (code) {
    nextUrl.searchParams.set("message", code);
  }

  window.location.replace(nextUrl.toString());
}

export function readMessageCode() {
  return new URLSearchParams(window.location.search).get("message");
}

export function messageFromCode(code) {
  const messages = {
    login_required: "سجل دخولك أولًا حتى تدخل على الموقع.",
    verify_email: "فعّل البريد الإلكتروني أولًا ثم سجل الدخول.",
    reservation_required: "لازم تكون مسجل دخول حتى تقدر تحجز.",
  };

  return messages[code] || "";
}

export function mapFirebaseError(error) {
  const fallback = "صار خطأ غير متوقع. حاول مرة ثانية.";
  const code = error?.code || "";

  const messages = {
    "auth/email-already-in-use": "هذا البريد مستخدم من قبل.",
    "auth/invalid-email": "البريد الإلكتروني غير صحيح.",
    "auth/invalid-credential": "البريد أو كلمة المرور غير صحيحة.",
    "auth/missing-password": "اكتب كلمة المرور.",
    "auth/user-not-found": "هذا الحساب غير موجود.",
    "auth/wrong-password": "كلمة المرور غير صحيحة.",
    "auth/weak-password": "كلمة المرور لازم تكون 6 أحرف أو أكثر.",
    "auth/too-many-requests": "في محاولات كثيرة. حاول بعد شوي.",
    "auth/network-request-failed": "في مشكلة اتصال. تأكد من الإنترنت وحاول مرة ثانية.",
  };

  return messages[code] || error?.message || fallback;
}

function normalizeOptionalValue(nextValue, currentValue) {
  if (typeof nextValue === "string") {
    return nextValue.trim();
  }

  return currentValue || "";
}
