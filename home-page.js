import {
  addDoc,
  average,
  collection,
  count,
  getAggregateFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { isAdmin, logoutAndGo, requireUser } from "./app-auth.js";

const REVIEWS_CACHE_KEY = "gb_reviews_cache_v2";
const REVIEWS_CACHE_TTL_MS = 45_000;
const REVIEWS_LIMIT = 8;

const adminLink = document.getElementById("adminLink");
const userWelcome = document.getElementById("userWelcome");
const logoutBtn = document.getElementById("logoutBtn");
const reviewForm = document.getElementById("reviewForm");
const reviewName = document.getElementById("reviewName");
const reviewService = document.getElementById("reviewService");
const reviewComment = document.getElementById("reviewComment");
const reviewSubmit = document.getElementById("reviewSubmit");
const reviewMessage = document.getElementById("reviewMessage");
const reviewsList = document.getElementById("reviewsList");
const reviewAverage = document.getElementById("reviewAverage");
const reviewStars = document.getElementById("reviewStars");
const reviewCount = document.getElementById("reviewCount");

const reviewState = {
  items: [],
  stats: null,
  unsubscribe: null,
  listenerTimer: 0,
  statsTimer: 0,
  lastNotice: {
    ar: "رأيك يهمنا.",
    he: "הדעה שלך חשובה לנו.",
    type: "info",
  },
};

const currentUser = await requireUser();
if (!currentUser) {
  throw new Error("LOGIN_REQUIRED");
}

userWelcome.textContent = currentUser.displayName || currentUser.email || "Gloss Boss";
userWelcome.hidden = false;
logoutBtn.hidden = false;
logoutBtn.addEventListener("click", () => logoutAndGo());

if (await isAdmin(currentUser)) {
  adminLink.hidden = false;
}

reviewName.value = buildDefaultReviewerName(currentUser);
reviewForm.addEventListener("submit", (event) => submitReview(event, currentUser));
document.addEventListener("visibilitychange", handleVisibilityChange);
window.addEventListener("beforeunload", cleanup);
setReviewNotice("رأيك يهمنا.", "הדעה שלך חשובה לנו.", "info");

for (const button of document.querySelectorAll(".lang-btn")) {
  button.addEventListener("click", () => {
    window.setTimeout(() => {
      renderReviewStats(reviewState.stats);
      renderReviews(reviewState.items);
      setReviewNotice(reviewState.lastNotice.ar, reviewState.lastNotice.he, reviewState.lastNotice.type);
    }, 0);
  });
}

await hydrateReviews();

async function hydrateReviews({ force = false } = {}) {
  clearTimeout(reviewState.listenerTimer);
  stopReviewListener();

  const cached = force ? null : readReviewCache();
  const hasFreshItems = cached && isFreshTimestamp(cached.itemsFetchedAt);
  const hasFreshStats = cached && isFreshTimestamp(cached.statsFetchedAt);

  if (hasFreshItems) {
    reviewState.items = cached.items;
    renderReviews(reviewState.items);
  }

  if (hasFreshStats) {
    reviewState.stats = cached.stats;
    renderReviewStats(reviewState.stats);
  }

  if (hasFreshItems && !force) {
    scheduleReviewListener(getRemainingMs(cached.itemsFetchedAt));
  } else {
    startReviewListener();
  }

  if (!hasFreshStats || force) {
    await refreshReviewStats({ force: true });
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    clearTimeout(reviewState.listenerTimer);
    stopReviewListener();
    return;
  }

  hydrateReviews();
}

function cleanup() {
  clearTimeout(reviewState.listenerTimer);
  clearTimeout(reviewState.statsTimer);
  stopReviewListener();
}

function scheduleReviewListener(delayMs) {
  clearTimeout(reviewState.listenerTimer);
  reviewState.listenerTimer = window.setTimeout(() => {
    if (document.visibilityState === "hidden") {
      return;
    }

    startReviewListener();
  }, Math.max(400, delayMs));
}

function startReviewListener() {
  clearTimeout(reviewState.listenerTimer);
  stopReviewListener();

  const reviewsQuery = query(
    collection(db, "reviews"),
    orderBy("createdAt", "desc"),
    limit(REVIEWS_LIMIT),
  );

  let firstSnapshot = true;

  reviewState.unsubscribe = onSnapshot(
    reviewsQuery,
    (snapshot) => {
      reviewState.items = snapshot.docs.map(normalizeReviewSnapshot);
      renderReviews(reviewState.items);
      writeReviewCache({
        items: reviewState.items,
        itemsFetchedAt: Date.now(),
      });

      if (firstSnapshot || snapshot.docChanges().length) {
        scheduleStatsRefresh();
      }

      firstSnapshot = false;
    },
    () => {
      renderReviews(reviewState.items);
    },
  );
}

function stopReviewListener() {
  if (typeof reviewState.unsubscribe === "function") {
    reviewState.unsubscribe();
  }

  reviewState.unsubscribe = null;
}

function scheduleStatsRefresh() {
  clearTimeout(reviewState.statsTimer);
  reviewState.statsTimer = window.setTimeout(() => {
    refreshReviewStats({ force: true });
  }, 180);
}

async function refreshReviewStats({ force = false } = {}) {
  const cached = force ? null : readReviewCache();
  if (!force && cached?.stats && isFreshTimestamp(cached.statsFetchedAt)) {
    reviewState.stats = cached.stats;
    renderReviewStats(reviewState.stats);
    return;
  }

  try {
    const aggregateSnapshot = await getAggregateFromServer(collection(db, "reviews"), {
      averageRating: average("rating"),
      reviewCount: count(),
    });

    const aggregateData = aggregateSnapshot.data();
    reviewState.stats = {
      averageRating: Number(aggregateData.averageRating || 0),
      reviewCount: Number(aggregateData.reviewCount || 0),
    };

    renderReviewStats(reviewState.stats);
    writeReviewCache({
      stats: reviewState.stats,
      statsFetchedAt: Date.now(),
    });
  } catch {
    if (reviewState.stats) {
      renderReviewStats(reviewState.stats);
    }
  }
}

async function submitReview(event, user) {
  event.preventDefault();

  const name = reviewName.value.trim();
  const service = reviewService.value || "Detailing";
  const comment = reviewComment.value.trim();
  const rating = Number(reviewForm.querySelector('input[name="rating"]:checked')?.value || 0);

  if (!name) {
    setReviewNotice("اكتب الاسم أولًا.", "יש לכתוב שם קודם.", "error");
    return;
  }

  if (rating < 1 || rating > 5) {
    setReviewNotice("اختر تقييمًا من 1 إلى 5.", "יש לבחור דירוג בין 1 ל-5.", "error");
    return;
  }

  reviewSubmit.disabled = true;
  reviewSubmit.textContent = getText("جارٍ إرسال التقييم...", "שולח ביקורת...");

  try {
    await addDoc(collection(db, "reviews"), {
      name,
      rating,
      comment,
      date: getTodayString(),
      service,
      userId: user.uid,
      userEmail: user.email || "",
      createdAt: serverTimestamp(),
    });

    reviewForm.reset();
    reviewName.value = buildDefaultReviewerName(user);
    reviewService.value = service;
    setReviewNotice("تم إرسال التقييم بنجاح.", "הביקורת נשלחה בהצלחה.", "success");
    await hydrateReviews({ force: true });
  } catch {
    setReviewNotice(
      "تعذر إرسال التقييم الآن. حاول مرة ثانية.",
      "לא ניתן היה לשלוח את הביקורת עכשיו. נסה שוב.",
      "error",
    );
  } finally {
    reviewSubmit.disabled = false;
    reviewSubmit.textContent = getText("أرسل التقييم", "שלח ביקורת");
  }
}

function renderReviews(items) {
  if (!items.length) {
    reviewsList.innerHTML = `
      <article class="reviewCard reviewCardEmpty">
        <h3>${escapeHtml(getText("لا توجد تقييمات بعد.", "עדיין אין ביקורות."))}</h3>
        <p>${escapeHtml(getText("كن أول شخص يشارك تجربته مع الخدمة.", "היה הראשון לשתף את החוויה שלך עם השירות."))}</p>
      </article>
    `;
    return;
  }

  reviewsList.innerHTML = items
    .map((review) => {
      const displayName = review.name || "Gloss Boss";
      const displayComment =
        review.comment || getText("تقييم بدون تعليق إضافي.", "ביקורת ללא תגובה נוספת.");

      return `
        <article class="reviewCard">
          <div class="reviewCardHeader">
            <strong>${escapeHtml(displayName)}</strong>
            <span class="reviewServiceTag">${escapeHtml(review.service)}</span>
          </div>
          <div class="reviewCardRating">${buildStarText(review.rating)}</div>
          <p class="reviewCommentText">${escapeHtml(displayComment)}</p>
          <div class="reviewCardFooter">
            <span class="reviewMetaText">${escapeHtml(formatReviewDate(review.date, review.createdAtMs))}</span>
            <span class="reviewMetaText">${escapeHtml(`${review.rating}/5`)}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderReviewStats(stats) {
  const safeStats = stats || { averageRating: 0, reviewCount: 0 };
  const averageValue = Number.isFinite(safeStats.averageRating) ? safeStats.averageRating : 0;
  const reviewTotal = Number.isFinite(safeStats.reviewCount) ? safeStats.reviewCount : 0;

  reviewAverage.textContent = averageValue ? averageValue.toFixed(1) : "0.0";
  reviewStars.textContent = buildStarText(Math.round(averageValue));
  reviewCount.textContent = getText(`${reviewTotal} تقييم`, `${reviewTotal} ביקורות`);
}

function setReviewNotice(arabicText, hebrewText, type = "info") {
  reviewState.lastNotice = { ar: arabicText, he: hebrewText, type };
  reviewMessage.textContent = getText(arabicText, hebrewText);
  reviewMessage.className = `reviewNotice is-${type}`;
}

function normalizeReviewSnapshot(snapshot) {
  const data = snapshot.data() || {};

  return {
    id: snapshot.id,
    name: data.name || "",
    rating: Number(data.rating || 0),
    comment: data.comment || "",
    service: data.service || "Detailing",
    date: data.date || getTodayString(),
    createdAtMs: toMillis(data.createdAt),
  };
}

function readReviewCache() {
  try {
    const rawValue = window.localStorage.getItem(REVIEWS_CACHE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeReviewCache(nextValues) {
  try {
    const currentCache = readReviewCache() || {};
    window.localStorage.setItem(
      REVIEWS_CACHE_KEY,
      JSON.stringify({
        ...currentCache,
        ...nextValues,
      }),
    );
  } catch {
    // Ignore storage quota failures.
  }
}

function isFreshTimestamp(timestamp) {
  return Number(timestamp) > 0 && Date.now() - timestamp <= REVIEWS_CACHE_TTL_MS;
}

function getRemainingMs(timestamp) {
  return Math.max(0, REVIEWS_CACHE_TTL_MS - (Date.now() - timestamp));
}

function buildDefaultReviewerName(user) {
  return (user.displayName || user.email?.split("@")[0] || "").trim();
}

function buildStarText(rating) {
  const safeRating = Math.max(0, Math.min(5, Number(rating || 0)));
  return "★★★★★".slice(0, safeRating) + "☆☆☆☆☆".slice(0, 5 - safeRating);
}

function formatReviewDate(dateValue, createdAtMs) {
  if (dateValue) {
    return dateValue;
  }

  if (createdAtMs) {
    const date = new Date(createdAtMs);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  return getTodayString();
}

function getTodayString() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toMillis(value) {
  if (!value) {
    return 0;
  }

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.seconds === "number") {
    return value.seconds * 1000;
  }

  return Number(value) || 0;
}

function getText(arabicValue, hebrewValue) {
  return (window.localStorage.getItem("lang") || "ar") === "he" ? hebrewValue : arabicValue;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
