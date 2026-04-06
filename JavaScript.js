// دالة طلب عنصر معين
function orderItem(itemName) {
    let phone = "972533044605"; // ضع رقمك الصحيح هنا
    let message = "مرحبا، حاب أطلب: " + itemName;
    let url = "https://wa.me/" + phone + "?text=" + encodeURIComponent(message);
    window.open(url, "_blank");
}

// زر حجز عام
document.addEventListener("DOMContentLoaded", function () {
    let whatsappBtn = document.getElementById("whatsappBtn");
    if (whatsappBtn) {
        whatsappBtn.addEventListener("click", function () {
            let phone = "972533044605"; // ضع رقمك هنا
            let message = "مرحبا! أرغب بحجز خدمة من Gloss Boss Detailing.";
            let url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
            window.open(url, "_blank");
        });
    }
});
//////////////////////////////////
const translations = {
    ar: {
        title: "Gloss Boss Detailing",
        subtitle: "حماية • لمعان • فخامة",
        book: "احجز الآن",
        services: "خدماتنا",
        location: "موقعنا",
        open_waze: "افتح Waze",
        works: "شوف أعمالنا",
        products: "المنتجات",
        about: "من نحن",
    },
    he: {
        title: "Gloss Boss Detailing",
        subtitle: "הגנה • ברק • יוקרה",
        book: "הזמן עכשיו",
        services: "השירותים שלנו",
        location: "המיקום שלנו",
        open_waze: "פתח Waze",
        works: "צפה בעבודות",
        products: "מוצרים",
        about: "אודותינו",
    }
};

let currentLang = localStorage.getItem("lang") || "ar";

function applyLanguage(lang) {
    document.documentElement.lang = lang;
    document.body.dir = "rtl"; // الاثنين RTL

    document.querySelectorAll("[data-translate]").forEach(el => {
        const key = el.getAttribute("data-translate");
        if (translations[lang][key]) {
            el.innerText = translations[lang][key];
        }
    });

    localStorage.setItem("lang", lang);
}

function toggleLanguage() {
    currentLang = (currentLang === "ar") ? "he" : "ar";
    applyLanguage(currentLang);
}

// تشغيل أول ما الصفحة تفتح
window.onload = () => {
    applyLanguage(currentLang);
};





