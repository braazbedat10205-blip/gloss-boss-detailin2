# Firebase Setup

1. فعّل `Email/Password` من `Firebase Console > Authentication > Sign-in method`.
2. افتح `Firestore Database > Rules` وانسخ محتوى ملف [firestore.rules](/c:/Projects/gloos-boos-site/firestore.rules) ثم اضغط `Publish`.
3. بعد ما صاحب المحل يعمل حساب من `login.html`:
   ضع وثيقة جديدة داخل مجموعة `admins`.
   اجعل `Document ID` هو نفس `UID` الخاص بصاحب المحل من `Authentication > Users`.
   أضف أي حقول تحبها مثل `email` أو `name`.
4. إذا بدك شخصين فقط يدخلوا `admin.html`:
   أنشئ وثيقتين فقط داخل `admins`.
   كل وثيقة يكون `Document ID` فيها هو `UID` للحساب المسموح له.
   أي مستخدم غير موجود داخل `admins/{uid}` سيتم منعه من دخول صفحة الإدارة.
5. ما في داعي تنشئ مجموعات الحجز يدويًا. الموقع سينشئ:
   `users`
   `bookingSlots`
   `bookings`

## كيف صار النظام

- أي زبون لازم يسجل دخول قبل ما يدخل `index.html` أو صفحة الحجوزات.
- صفحة `admin.html` لا تظهر إلا إذا كان المستخدم موجودًا في `admins/{uid}`.
- لدخول شخصين فقط، أضف UIDين فقط داخل مجموعة `admins`.
- الحجز يُسجل على الموعد نفسه كمعرّف ثابت، لذلك لا يمكن حجز نفس الدور مرتين.
- رقم الهاتف صار إجباري داخل نموذج الحجز حتى يتم التواصل لتأكيد الموعد.
