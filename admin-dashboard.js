import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getDownloadURL, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { db, storage } from "./firebase-config.js";
import { logoutAndGo, requireAdmin } from "./app-auth.js";

const CACHE_TTL_MS = 45_000;
const CACHE_KEY = "gb_admin_bookings_cache_v4";
const BOOKING_COLLECTIONS = ["reservations", "bookings"];
const LIVE_DELAY_MS = 1_200;
const PRODUCT_IMAGE_MODE = "firestore-data-url";
const FIRESTORE_IMAGE_MAX_BYTES = 600_000;
// Put your deployed Cloudflare Worker URL here after deployment.
const EMAIL_API_ENDPOINT = "https://hidden-lake-a1b7.braazbedat10205.workers.dev";

const totalCount = document.getElementById("totalCount");
const pendingCount = document.getElementById("pendingCount");
const confirmedCount = document.getElementById("confirmedCount");
const completedCount = document.getElementById("completedCount");
const filterDate = document.getElementById("filterDate");
const filterStatus = document.getElementById("filterStatus");
const searchTerm = document.getElementById("searchTerm");
const refreshBtn = document.getElementById("refreshBtn");
const syncBadge = document.getElementById("syncBadge");
const bookingList = document.getElementById("bookingList");
const messageBox = document.getElementById("messageBox");
const userBadge = document.getElementById("userBadge");
const logoutBtn = document.getElementById("logoutBtn");
const galleryUploadForm = document.getElementById("galleryUploadForm");
const productNumberInput = document.getElementById("productNumber");
const galleryTitle = document.getElementById("galleryTitle");
const productPriceInput = document.getElementById("productPrice");
const productOfferInput = document.getElementById("productOffer");
const productAvailableInput = document.getElementById("productAvailable");
const productOfferTextInput = document.getElementById("productOfferText");
const galleryFile = document.getElementById("galleryFile");
const galleryUploadBtn = document.getElementById("galleryUploadBtn");
const cancelProductEditBtn = document.getElementById("cancelProductEditBtn");
const uploadMessage = document.getElementById("uploadMessage");
const galleryAdminGrid = document.getElementById("galleryAdminGrid");

let editingProduct = null;

const state = {
  bookings: [],
  collectionData: {
    reservations: [],
    bookings: [],
  },
  listeners: [],
  liveTimer: 0,
};

const currentUser = await requireAdmin();
if (!currentUser) {
  throw new Error("ADMIN_REQUIRED");
}

userBadge.textContent = currentUser.displayName || currentUser.email || "Admin";
userBadge.classList.remove("hidden");
logoutBtn.addEventListener("click", () => logoutAndGo());

initializeFilters();
bindEvents();
await loadBookings();
await loadGalleryImages();

function initializeFilters() {
  filterStatus.value = "all";
  filterDate.value = "";
}

function bindEvents() {
  refreshBtn.addEventListener("click", () => loadBookings({ force: true }));
  filterDate.addEventListener("input", renderBookings);
  filterStatus.addEventListener("change", handleStatusChange);
  searchTerm.addEventListener("input", renderBookings);
  bookingList.addEventListener("click", handleBookingActionWithFunction);
  galleryUploadForm?.addEventListener("submit", handleGalleryUpload);
  galleryAdminGrid?.addEventListener("click", handleProductAdminAction);
  cancelProductEditBtn?.addEventListener("click", resetProductForm);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("beforeunload", cleanup);
}

function handleStatusChange() {
  if (filterStatus.value === "today") {
    filterDate.value = getTodayString();
  } else if (filterStatus.value === "all") {
    filterDate.value = "";
  }

  renderBookings();
}

function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    clearTimeout(state.liveTimer);
    stopListeners();
    updateSyncBadge("متوقف مؤقتًا");
    return;
  }

  loadBookings();
}

function cleanup() {
  clearTimeout(state.liveTimer);
  stopListeners();
}

async function loadBookings({ force = false } = {}) {
  clearTimeout(state.liveTimer);
  stopListeners();

  const cached = force ? null : readCache();

  if (cached && isFresh(cached.savedAt)) {
    state.collectionData = cached.collectionData;
    state.bookings = mergeBookingsFromCollections();
    renderBookings();
    updateSyncBadge("كاش محلي");
    setMessage("تم عرض الحجوزات من الكاش المحلي وسيبدأ التحديث المباشر بعد لحظات.", "info");
    state.liveTimer = window.setTimeout(startLiveSync, LIVE_DELAY_MS);
    return;
  }

  setRefreshState(true, "جارٍ تحميل الحجوزات...");
  updateSyncBadge("تحميل مباشر");
  await fetchAllBookings();
  setRefreshState(false);
  state.liveTimer = window.setTimeout(startLiveSync, LIVE_DELAY_MS);
}

async function fetchAllBookings() {
  const results = await Promise.allSettled(
    BOOKING_COLLECTIONS.map((collectionName) => getDocs(collection(db, collectionName))),
  );

  let successCount = 0;

  results.forEach((result, index) => {
    const collectionName = BOOKING_COLLECTIONS[index];

    if (result.status === "fulfilled") {
      successCount += 1;
      state.collectionData[collectionName] = result.value.docs.map((documentSnapshot) =>
        normalizeBookingSnapshot(documentSnapshot, collectionName),
      );
    } else {
      state.collectionData[collectionName] = [];
    }
  });

  state.bookings = mergeBookingsFromCollections();
  writeCache();
  renderBookings();

  if (!successCount) {
    updateSyncBadge("تعذر الاتصال");
    setMessage("تعذر تحميل الحجوزات من Firebase. تأكد من نشر القواعد وتحديث الصفحة.", "error");
    return;
  }

  updateSyncBadge("قراءة مباشرة");

  if (!state.bookings.length) {
    setMessage("لا توجد حجوزات ظاهرة حاليًا في collections الحجوزات.", "info");
    return;
  }

  setMessage(`تم تحميل ${state.bookings.length} حجز بنجاح.`, "success");
}

function startLiveSync() {
  clearTimeout(state.liveTimer);
  stopListeners();
  updateSyncBadge("تحديث مباشر");

  state.listeners = BOOKING_COLLECTIONS.map((collectionName) =>
    onSnapshot(
      collection(db, collectionName),
      (snapshot) => {
        state.collectionData[collectionName] = snapshot.docs.map((documentSnapshot) =>
          normalizeBookingSnapshot(documentSnapshot, collectionName),
        );
        state.bookings = mergeBookingsFromCollections();
        writeCache();
        renderBookings();
        setMessage(
          state.bookings.length
            ? `تم تحديث الحجوزات مباشرة. العدد الحالي ${state.bookings.length}.`
            : "لا توجد حجوزات ظاهرة حاليًا في collections الحجوزات.",
          state.bookings.length ? "success" : "info",
        );
      },
      () => {
        updateSyncBadge("تعذر الاتصال");
        setMessage("فشل التحديث المباشر. ما زالت آخر نسخة محفوظة ظاهرة.", "error");
      },
    ),
  );
}

function stopListeners() {
  state.listeners.forEach((unsubscribe) => {
    if (typeof unsubscribe === "function") {
      unsubscribe();
    }
  });
  state.listeners = [];
}

function mergeBookingsFromCollections() {
  const mergedMap = new Map();

  for (const collectionName of BOOKING_COLLECTIONS) {
    for (const booking of state.collectionData[collectionName] || []) {
      const key = booking.slotKey || `${booking.date}_${booking.time}_${booking.phone}`;
      const previous = mergedMap.get(key);

      if (!previous) {
        mergedMap.set(key, booking);
        continue;
      }

      const previousScore = getCollectionPriority(previous.collectionName);
      const nextScore = getCollectionPriority(booking.collectionName);

      if (nextScore < previousScore || booking.updatedAtMs > previous.updatedAtMs) {
        mergedMap.set(key, booking);
      }
    }
  }

  return Array.from(mergedMap.values()).sort((left, right) => {
    const leftStamp = left.updatedAtMs || left.createdAtMs || 0;
    const rightStamp = right.updatedAtMs || right.createdAtMs || 0;

    if (leftStamp !== rightStamp) {
      return rightStamp - leftStamp;
    }

    const leftKey = `${left.date || ""}_${left.time || ""}_${left.slotKey || ""}`;
    const rightKey = `${right.date || ""}_${right.time || ""}_${right.slotKey || ""}`;
    return rightKey.localeCompare(leftKey);
  });
}

function getCollectionPriority(collectionName) {
  return collectionName === "reservations" ? 0 : 1;
}

function renderBookings() {
  const normalizedSearch = searchTerm.value.trim().toLowerCase();
  const statusFilter = filterStatus.value;
  const today = getTodayString();
  const dateFilter = statusFilter === "today" ? today : filterDate.value.trim();

  const visibleBookings = state.bookings.filter((booking) => {
    const matchesStatus =
      statusFilter === "all" ||
      statusFilter === "today" ||
      booking.status === statusFilter;
    const matchesDate = !dateFilter || booking.date === dateFilter;
    const matchesSearch =
      !normalizedSearch ||
      [booking.customerName, booking.phone, booking.service, booking.userEmail, booking.vehicle].some((value) =>
        String(value || "").toLowerCase().includes(normalizedSearch),
      );

    return matchesStatus && matchesDate && matchesSearch;
  });

  updateStats(state.bookings);

  if (!visibleBookings.length) {
    bookingList.innerHTML = `
      <div class="emptyState">
        <h3>لا توجد حجوزات مطابقة</h3>
        <p>إذا الحجز موجود في Firebase وما ظهر هنا، جرّب زر تحديث ثم تأكد من نشر آخر نسخة للموقع والقواعد.</p>
      </div>
    `;
    return;
  }

  bookingList.innerHTML = visibleBookings
    .map((booking) => {
      const statusLabel = getStatusLabel(booking.status);
      const vehicle = booking.vehicle?.trim() ? booking.vehicle : "غير مذكور";
      const notes = booking.notes?.trim() ? booking.notes : "لا توجد ملاحظات";

      return `
        <article class="bookingCard">
          <div class="bookingHead">
            <h3>${escapeHtml(booking.customerName)}</h3>
            <span class="statusBadge ${escapeHtml(booking.status)}">${statusLabel}</span>
          </div>

          <div class="bookingMeta">
            <span>${escapeHtml(booking.date)} | ${escapeHtml(booking.time)}</span>
            <span>${escapeHtml(booking.service)}</span>
          </div>

          <div class="detailList">
            <div class="detailRow">
              <span class="detailLabel">الهاتف</span>
              <span class="detailValue"><a href="tel:${escapeHtml(booking.phone)}">${escapeHtml(booking.phone)}</a></span>
            </div>
            <div class="detailRow">
              <span class="detailLabel">البريد</span>
              <span class="detailValue">${escapeHtml(booking.userEmail || "-")}</span>
            </div>
            <div class="detailRow">
              <span class="detailLabel">السيارة</span>
              <span class="detailValue">${escapeHtml(vehicle)}</span>
            </div>
            <div class="detailRow">
              <span class="detailLabel">الملاحظات</span>
              <span class="detailValue">${escapeHtml(notes)}</span>
            </div>
            <div class="detailRow">
              <span class="detailLabel">المصدر</span>
              <span class="detailValue">${escapeHtml(booking.collectionName)}</span>
            </div>
          </div>

          <div class="statusActions">
            ${getActionButtons(booking)}
          </div>
        </article>
      `;
    })
    .join("");
}

async function handleBookingAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  const slotKey = button.dataset.slot;
  if (!action || !slotKey) {
    return;
  }

  button.disabled = true;

  try {
    if (action === "confirm") {
      await updateBookingAcrossCollections(slotKey, { status: "confirmed", updatedAt: serverTimestamp() });
      applyOptimisticStatus(slotKey, "confirmed");
      setMessage("تم تأكيد الحجز.", "success");
    }

    if (action === "complete") {
      await updateBookingAcrossCollections(slotKey, { status: "completed", updatedAt: serverTimestamp() });
      applyOptimisticStatus(slotKey, "completed");
      setMessage("تم تحويل الحجز إلى منجز.", "success");
    }

    if (action === "cancel") {
      await runTransaction(db, async (transaction) => {
        let bookingExists = false;

        for (const collectionName of BOOKING_COLLECTIONS) {
          const bookingRef = doc(db, collectionName, slotKey);
          const bookingSnapshot = await transaction.get(bookingRef);

          if (bookingSnapshot.exists()) {
            bookingExists = true;
            transaction.update(bookingRef, {
              status: "cancelled",
              updatedAt: serverTimestamp(),
            });
          }
        }

        if (!bookingExists) {
          throw new Error("BOOKING_NOT_FOUND");
        }

        transaction.delete(doc(db, "bookingSlots", slotKey));
      });

      applyOptimisticStatus(slotKey, "cancelled");
      setMessage("تم إلغاء الموعد وإعادته كموعد متاح.", "success");
    }
  } catch {
    setMessage("تعذر تحديث حالة الحجز. حاول مرة ثانية.", "error");
  } finally {
    button.disabled = false;
  }
}

async function handleBookingActionWithFunction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  const slotKey = button.dataset.slot;
  if (!action || !slotKey || !["confirm", "complete", "cancel"].includes(action)) {
    return;
  }

  button.disabled = true;

  try {
    const booking = findBookingBySlotKey(slotKey);
    const nextStatus = getStatusForAction(action);
    let emailSent = false;

    if (action === "confirm") {
      await updateBookingAcrossCollections(slotKey, { status: nextStatus, updatedAt: serverTimestamp() });
      applyOptimisticStatus(slotKey, "confirmed");
      emailSent = await sendBookingEmail("booking-confirmation", booking);
    } else {
      await deleteBookingAcrossCollections(slotKey);
      await deleteDoc(doc(db, "bookingSlots", slotKey));
      removeOptimisticBooking(slotKey);
      if (action === "cancel") {
        emailSent = await sendBookingEmail("booking-cancellation", booking);
      }
    }

    setMessage(buildStatusMessage(action, emailSent), "success");
  } catch (error) {
    console.error(error);
    setMessage("Could not update booking. Check Firebase rules and try again.", "error");
  } finally {
    button.disabled = false;
  }
}

function findBookingBySlotKey(slotKey) {
  return state.bookings.find((booking) => booking.slotKey === slotKey) || null;
}

async function sendBookingEmail(type, booking) {
  if (!EMAIL_API_ENDPOINT || !booking?.userEmail) {
    return false;
  }

  const response = await fetch(EMAIL_API_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type,
      to: booking.userEmail,
      booking: {
        customerName: booking.customerName,
        service: booking.service,
        date: booking.date,
        time: booking.time,
        vehicle: booking.vehicle,
      },
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    console.error("Email Worker failed:", response.status, details);
    return false;
  }

  return true;
}

async function updateBookingAcrossCollections(slotKey, payload) {
  const results = await Promise.allSettled(
    BOOKING_COLLECTIONS.map((collectionName) =>
      updateDoc(doc(db, collectionName, slotKey), payload),
    ),
  );

  if (!results.some((result) => result.status === "fulfilled")) {
    throw new Error("BOOKING_NOT_FOUND");
  }
}

async function deleteBookingAcrossCollections(slotKey) {
  const results = await Promise.allSettled(
    BOOKING_COLLECTIONS.map((collectionName) =>
      deleteDoc(doc(db, collectionName, slotKey)),
    ),
  );

  if (!results.some((result) => result.status === "fulfilled")) {
    throw new Error("BOOKING_NOT_FOUND");
  }
}

function applyOptimisticStatus(slotKey, nextStatus) {
  state.bookings = state.bookings.map((booking) =>
    booking.slotKey === slotKey
      ? { ...booking, status: nextStatus, updatedAtMs: Date.now() }
      : booking,
  );

  for (const collectionName of BOOKING_COLLECTIONS) {
    state.collectionData[collectionName] = (state.collectionData[collectionName] || []).map((booking) =>
      booking.slotKey === slotKey
        ? { ...booking, status: nextStatus, updatedAtMs: Date.now() }
        : booking,
    );
  }

  writeCache();
  renderBookings();
}

function removeOptimisticBooking(slotKey) {
  state.bookings = state.bookings.filter((booking) => booking.slotKey !== slotKey);

  for (const collectionName of BOOKING_COLLECTIONS) {
    state.collectionData[collectionName] = (state.collectionData[collectionName] || []).filter((booking) =>
      booking.slotKey !== slotKey,
    );
  }

  writeCache();
  renderBookings();
}

function getStatusForAction(action) {
  return {
    confirm: "confirmed",
    complete: "completed",
    cancel: "cancelled",
  }[action] || "pending";
}

function buildStatusMessage(action, emailSent) {
  const emailText = emailSent ? " Email sent." : " Status saved, but email was not sent. Check EMAIL_API_ENDPOINT and the Brevo Worker.";
  if (action === "confirm") {
    return `Booking confirmed.${emailText}`;
  }
  if (action === "complete") {
    return "Booking completed, archived, and removed from the active list.";
  }
  return `Booking cancelled, archived, removed from the active list, and the slot is available again.${emailText}`;
}

function normalizeBookingSnapshot(snapshot, collectionName) {
  const data = snapshot.data() || {};
  const updatedAtMs = toMillis(data.updatedAt) || toMillis(data.createdAt);
  const fallbackDate = data.date || data.bookingDate || data.selectedDate || data.reservationDate || formatDateFromMillis(updatedAtMs);
  const fallbackTime = data.time || data.bookingTime || data.selectedTime || data.reservationTime || "--:--";

  return {
    collectionName,
    slotKey: data.slotKey || snapshot.id,
    customerName: data.customerName || data.name || data.fullName || data.customer || "بدون اسم",
    phone: data.phone || data.phoneNumber || data.customerPhone || data.mobile || "-",
    service: data.service || data.serviceName || data.serviceType || "خدمة غير محددة",
    date: fallbackDate,
    time: fallbackTime,
    vehicle: data.vehicle || data.vehicleName || data.carModel || data.model || "",
    notes: data.notes || data.comment || data.message || "",
    status: data.status || data.reservationStatus || "pending",
    userEmail: data.userEmail || data.email || "",
    updatedAtMs,
    createdAtMs: toMillis(data.createdAt) || updatedAtMs,
  };
}

function updateStats(bookings) {
  totalCount.textContent = String(bookings.length);
  pendingCount.textContent = String(bookings.filter((booking) => booking.status === "pending").length);
  confirmedCount.textContent = String(bookings.filter((booking) => booking.status === "confirmed").length);
  completedCount.textContent = String(bookings.filter((booking) => booking.status === "completed").length);
}

function getStatusLabel(status) {
  const labels = {
    pending: "بانتظار التأكيد",
    confirmed: "مؤكد",
    completed: "منجز",
    cancelled: "ملغي",
  };

  return labels[status] || status;
}

function getActionButtons(booking) {
  const slot = escapeHtml(booking.slotKey);

  if (booking.status === "cancelled") {
    return `<span class="hintBadge">الموعد ملغي</span>`;
  }

  if (booking.status === "completed") {
    return `<span class="hintBadge">تم إنجاز الخدمة</span>`;
  }

  if (booking.status === "confirmed") {
    return `
      <button type="button" class="statusButton" data-action="complete" data-slot="${slot}">تم الإنجاز</button>
      <button type="button" class="statusButton" data-action="cancel" data-slot="${slot}">إلغاء الموعد</button>
    `;
  }

  return `
    <button type="button" class="statusButton" data-action="confirm" data-slot="${slot}">تأكيد</button>
    <button type="button" class="statusButton" data-action="complete" data-slot="${slot}">تم الإنجاز</button>
    <button type="button" class="statusButton" data-action="cancel" data-slot="${slot}">إلغاء الموعد</button>
  `;
}

function setRefreshState(isBusy, label = "تحديث") {
  refreshBtn.disabled = isBusy;
  refreshBtn.textContent = isBusy ? label : "تحديث";
}

function updateSyncBadge(label) {
  syncBadge.textContent = label;
}

function setMessage(text, type = "info") {
  messageBox.textContent = text;
  messageBox.className = `messageBox is-${type}`;
}

function readCache() {
  try {
    const rawValue = window.localStorage.getItem(CACHE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeCache() {
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        collectionData: state.collectionData,
      }),
    );
  } catch {
    // Ignore localStorage quota issues.
  }
}

function isFresh(savedAt) {
  return Date.now() - Number(savedAt || 0) <= CACHE_TTL_MS;
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

function formatDateFromMillis(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayString() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function handleGalleryUpload(event) {
  event.preventDefault();

  const file = galleryFile?.files?.[0];
  const title = normalizeProductTitle(galleryTitle?.value, file?.name);
  const productNumber = normalizeOptionalProductField(productNumberInput?.value, 40);
  const price = normalizeOptionalProductField(productPriceInput?.value, 40);
  const offerText = normalizeOptionalProductField(productOfferTextInput?.value, 60);
  const offerEnabled = Boolean(productOfferInput?.checked);
  const available = productAvailableInput ? Boolean(productAvailableInput.checked) : true;
  const isEditing = Boolean(editingProduct?.id);

  if (!file && !isEditing) {
    setUploadMessage("Choose a valid image file.", "error");
    return;
  }

  if (file && !file.type.startsWith("image/")) {
    setUploadMessage("Choose a valid image file.", "error");
    return;
  }

  galleryUploadBtn.disabled = true;
  setUploadMessage(file ? "Compressing image and converting to WebP..." : "Saving product changes...", "info");
  console.group("[products upload]");
  console.log("Selected file:", {
    name: file?.name || null,
    type: file?.type || null,
    size: file?.size || 0,
    productTitle: title,
    productNumber,
    price,
    offerEnabled,
    offerText,
    available,
    mode: isEditing ? "update" : "create",
  });

  try {
    let imageUrl = editingProduct?.imageUrl || "";
    let originalSize = editingProduct?.originalSize || 0;
    let compressedSize = editingProduct?.compressedSize || 0;

    if (file) {
      const compressed = await compressImageToWebp(file);
      console.log("Image compressed:", {
        width: compressed.width,
        height: compressed.height,
        originalSize: file.size,
        webpSize: compressed.blob.size,
        type: compressed.blob.type,
      });

      const safeName = buildSafeFileName(title);
      const storagePath = `products/${Date.now()}-${safeName}.webp`;
      imageUrl = await resolveProductImageUrl({
        blob: compressed.blob,
        file,
        storagePath,
      });
      originalSize = file.size;
      compressedSize = compressed.blob.size;
    }

    const productRef = isEditing ? doc(db, "products", editingProduct.id) : doc(collection(db, "products"));
    const productPayload = {
      title,
      imageUrl,
      imageType: "image/webp",
      imageStorage: PRODUCT_IMAGE_MODE,
      originalSize,
      compressedSize,
      available,
      offerEnabled,
      offerText,
      updatedAt: serverTimestamp(),
    };

    if (!isEditing) {
      productPayload.createdAt = serverTimestamp();
    }

    if (productNumber) {
      productPayload.productNumber = productNumber;
    }

    if (price) {
      productPayload.price = price;
    }

    console.log("Saving Firestore document:", {
      collection: "products",
      id: productRef.id,
      payload: { ...productPayload, createdAt: productPayload.createdAt ? "serverTimestamp()" : undefined, updatedAt: "serverTimestamp()" },
    });
    await setDoc(productRef, productPayload, { merge: true });
    console.log("Firestore product document saved:", productRef.path);

    resetProductForm();
    setUploadMessage(file
      ? `Product saved. ${formatBytes(file.size)} -> ${formatBytes(compressedSize)}.`
      : "Product changes saved.",
    "success");
    await loadGalleryImages();
  } catch (error) {
    console.error("Product upload/save failed:", error);
    setUploadMessage(buildProductUploadErrorMessage(error), "error");
  } finally {
    console.groupEnd();
    galleryUploadBtn.disabled = false;
  }
}

async function loadGalleryImages() {
  if (!galleryAdminGrid) {
    return;
  }

  try {
    const snapshot = await getDocs(collection(db, "products"));
    const images = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt))
      .slice(0, 8);

    if (!images.length) {
      galleryAdminGrid.innerHTML = '<div class="emptyState">No uploaded products yet.</div>';
      return;
    }

    galleryAdminGrid.innerHTML = images
      .map((image) => `
        <article class="adminGalleryCard" data-product-id="${escapeHtml(image.id)}">
          <img src="${escapeHtml(image.imageUrl || "")}" alt="${escapeHtml(image.title || "Product image")}" loading="lazy" decoding="async">
          <strong>${escapeHtml(image.title || "Untitled")}</strong>
          <span>${escapeHtml([image.productNumber, image.price].filter(Boolean).join(" | ") || "Saved in products")}</span>
          <span class="offerPill">${image.available === false ? "غير متوفر" : "متوفر"}</span>
          ${image.offerEnabled ? `<span class="offerPill">${escapeHtml(image.offerText || "Offer")}</span>` : ""}
          <div class="adminGalleryActions">
            <button type="button" class="textAction" data-action="edit-product" data-product-id="${escapeHtml(image.id)}">تعديل</button>
            <button type="button" class="textAction" data-action="toggle-available" data-product-id="${escapeHtml(image.id)}">${image.available === false ? "جعله متوفر" : "جعله غير متوفر"}</button>
            <button type="button" class="textAction" data-action="toggle-offer" data-product-id="${escapeHtml(image.id)}">${image.offerEnabled ? "إخفاء العرض" : "عمل عرض"}</button>
            <button type="button" class="textAction dangerAction" data-action="delete-product" data-product-id="${escapeHtml(image.id)}">حذف</button>
          </div>
        </article>
      `)
      .join("");
  } catch (error) {
    console.error(error);
    galleryAdminGrid.innerHTML = '<div class="emptyState">Could not load uploaded photos.</div>';
  }
}

async function handleProductAdminAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  const productId = button.dataset.productId;
  if (!productId) {
    return;
  }

  const snapshot = await getDocs(collection(db, "products"));
  const productDocument = snapshot.docs.find((item) => item.id === productId);
  if (!productDocument) {
    setUploadMessage("Product not found. Refresh and try again.", "error");
    return;
  }

  const product = { id: productDocument.id, ...productDocument.data() };

  if (button.dataset.action === "edit-product") {
    startProductEdit(product);
    return;
  }

  if (button.dataset.action === "toggle-offer") {
    await updateDoc(doc(db, "products", productId), {
      offerEnabled: !product.offerEnabled,
      offerText: product.offerText || "Special offer",
      updatedAt: serverTimestamp(),
    });
    setUploadMessage("Offer status updated.", "success");
    await loadGalleryImages();
    return;
  }

  if (button.dataset.action === "toggle-available") {
    await updateDoc(doc(db, "products", productId), {
      available: product.available === false,
      updatedAt: serverTimestamp(),
    });
    setUploadMessage("Product availability updated.", "success");
    await loadGalleryImages();
    return;
  }

  if (button.dataset.action === "delete-product") {
    const confirmed = window.confirm(`Delete product "${product.title || "Untitled"}"?`);
    if (!confirmed) {
      return;
    }

    await deleteDoc(doc(db, "products", productId));
    if (editingProduct?.id === productId) {
      resetProductForm();
    }
    setUploadMessage("Product deleted.", "success");
    await loadGalleryImages();
  }
}

function startProductEdit(product) {
  editingProduct = product;
  productNumberInput.value = product.productNumber || "";
  galleryTitle.value = product.title || "";
  productPriceInput.value = product.price || "";
  productOfferInput.checked = Boolean(product.offerEnabled);
  if (productAvailableInput) {
    productAvailableInput.checked = product.available !== false;
  }
  productOfferTextInput.value = product.offerText || "";
  galleryFile.value = "";
  galleryUploadBtn.textContent = "تحديث المنتج";
  cancelProductEditBtn?.classList.remove("hidden");
  setUploadMessage("Editing product. Choose a new image only if you want to replace it.", "info");
}

function resetProductForm() {
  editingProduct = null;
  galleryUploadForm?.reset();
  if (productAvailableInput) {
    productAvailableInput.checked = true;
  }
  galleryUploadBtn.textContent = "Save product";
  cancelProductEditBtn?.classList.add("hidden");
}

async function compressImageToWebp(file) {
  const bitmap = await createImageBitmap(file);
  let maxDimension = 1280;
  let quality = 0.74;
  let width = 1;
  let height = 1;
  let blob = null;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    width = Math.max(1, Math.round(bitmap.width * scale));
    height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    blob = await canvasToWebpBlob(canvas, quality);

    if (blob.size <= FIRESTORE_IMAGE_MAX_BYTES) {
      break;
    }

    maxDimension = Math.max(720, Math.round(maxDimension * 0.82));
    quality = Math.max(0.56, quality - 0.06);
  }

  bitmap.close?.();

  return { blob, width, height };
}

function canvasToWebpBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
      } else {
        reject(new Error("WEBP_CONVERSION_FAILED"));
      }
    }, "image/webp", quality);
  });
}

async function resolveProductImageUrl({ blob, file, storagePath }) {
  if (PRODUCT_IMAGE_MODE === "firebase-storage") {
    const imageRef = ref(storage, storagePath);
    console.log("Uploading WebP to Storage:", storagePath);

    const uploadSnapshot = await uploadBytes(imageRef, blob, {
      contentType: "image/webp",
      customMetadata: {
        originalName: file.name,
        originalSize: String(file.size),
        compressedSize: String(blob.size),
      },
    });
    console.log("Storage upload complete:", uploadSnapshot.ref.fullPath);

    const downloadUrl = await getDownloadURL(uploadSnapshot.ref);
    console.log("Download URL created:", downloadUrl);
    return downloadUrl;
  }

  console.log("Storage disabled for this project. Saving compressed WebP directly in Firestore document.");
  const dataUrl = await blobToDataUrl(blob);
  if (dataUrl.length > 900_000) {
    throw new Error("FIRESTORE_IMAGE_TOO_LARGE");
  }
  console.log("Firestore image data URL ready:", {
    bytes: blob.size,
    characters: dataUrl.length,
  });
  return dataUrl;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("DATA_URL_FAILED"));
    reader.readAsDataURL(blob);
  });
}

function buildSafeFileName(value) {
  const safe = String(value || "photo")
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || "photo";
}

function normalizeProductTitle(rawTitle, fileName = "Product") {
  const fallbackTitle = String(fileName || "Product").replace(/\.[^.]+$/, "");
  const title = String(rawTitle || fallbackTitle).trim();
  return title.slice(0, 80) || "Product";
}

function normalizeOptionalProductField(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function buildProductUploadErrorMessage(error) {
  const code = error?.code || "";
  const message = error?.message || "";

  if (code.includes("permission-denied")) {
    return "Image uploaded, but Firestore blocked saving the product. Check products rules and admin permission.";
  }

  if (code.includes("storage/unauthorized")) {
    return "Storage blocked the upload. Check Storage rules for products/ and admin permission.";
  }

  if (message.includes("WEBP_CONVERSION_FAILED")) {
    return "Could not convert image to WebP. Try another image.";
  }

  if (message.includes("FIRESTORE_IMAGE_TOO_LARGE")) {
    return "Image is still too large after compression. Try a smaller photo or crop it first.";
  }

  return "Product upload failed. Open the browser console to see the exact failing step.";
}

function formatBytes(bytes) {
  if (!bytes) {
    return "0 KB";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function setUploadMessage(text, type = "info") {
  if (!uploadMessage) {
    return;
  }

  uploadMessage.textContent = text;
  uploadMessage.className = `messageBox is-${type}`;
}
