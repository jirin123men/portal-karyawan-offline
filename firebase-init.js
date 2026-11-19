"use strict";

if (!window.firebaseConfig) {
  throw new Error("Konfigurasi Firebase tidak ditemukan.");
}

if (!firebase.apps.length) {
  firebase.initializeApp(window.firebaseConfig);
}

window.firebaseAuth = firebase.auth();
window.firebaseDB = firebase.firestore();

console.log("Firebase berhasil diinisialisasi:", firebase.app().options.projectId);
