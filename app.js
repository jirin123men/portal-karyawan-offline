"use strict";

const DBKEY = "portalKaryawanOffline_v2";
const PROJECT_ID = "portal-karyawan-d1fcc";
const EMPLOYEE_APP = "CEKKARYAWAN_FIREBASE";

let db = JSON.parse(localStorage.getItem(DBKEY) || "null") ||
  { admin: null, employees: [], leaves: [], attendance: [] };

let currentEmployee = null;
let scannedEmployee = null;
let cameraStream = null;
let scanTimer = null;
let secondaryApp = null;

const firebaseAuth = window.firebaseAuth;
const firebaseDB = window.firebaseDB;

function el(id) {
  return document.getElementById(id);
}

function safe(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[c]));
}

function save() {
  localStorage.setItem(DBKEY, JSON.stringify(db));
}

function show(id) {
  ["setupScreen", "loginScreen", "registerScreen",
   "adminScreen", "employeeScreen"].forEach(x => {
    if (el(x)) el(x).classList.add("hidden");
  });
  if (el(id)) el(id).classList.remove("hidden");
  if (id === "adminScreen") adminNavInit();
}

function showRegister() {
  show("registerScreen");
}

function today() {
  const d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

function timeNow() {
  return new Date().toLocaleTimeString("id-ID", {
    hour: "2-digit", minute: "2-digit"
  });
}

function randomToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return [...a].map(x => x.toString(16).padStart(2, "0")).join("");
}

function qrData(uid, employeeId) {
  return JSON.stringify({
    app: EMPLOYEE_APP,
    uid: uid,
    employeeId: employeeId
  });
}

function makeQr(uid, employeeId) {
  const q = qrcode(0, "M");
  q.addData(qrData(uid, employeeId));
  q.make();
  return q.createDataURL(6, 4);
}

function employeeEmail(id) {
  return id.toLowerCase() + "@" + PROJECT_ID + ".firebaseapp.com";
}

function getSecondaryAuth() {
  if (!secondaryApp) {
    secondaryApp = firebase.initializeApp(
      firebase.app().options,
      "EmployeeProvisioning"
    );
  }
  return secondaryApp.auth();
}

function mergeByKey(oldItems, newItems, keyFn) {
  const map = new Map();
  oldItems.forEach(x => map.set(keyFn(x), x));
  newItems.forEach(x => map.set(keyFn(x), x));
  return [...map.values()];
}

function mergeCloudIntoLocal(employees, leaves, attendance) {
  db.employees = mergeByKey(
    db.employees, employees, x => String(x.id)
  );
  db.leaves = mergeByKey(
    db.leaves, leaves, x => String(x.id)
  );
  db.attendance = mergeByKey(
    db.attendance, attendance,
    x => String(x.employeeId) + "_" + String(x.tanggal)
  );
  save();
}

async function loadAdminCloud() {
  const [employees, leaves, attendance] = await Promise.all([
    firebaseDB.collection("karyawan").get(),
    firebaseDB.collection("pengajuan_izin").get(),
    firebaseDB.collection("absensi").get()
  ]);

  mergeCloudIntoLocal(
    employees.docs.map(d => ({ ...d.data(), id: d.id })),
    leaves.docs.map(d => ({ ...d.data(), id: d.id })),
    attendance.docs.map(d => ({ ...d.data(), id: d.id }))
  );
}

function setupAdmin() {
  alert(
    "Pembuatan akun HRD sekarang menggunakan Firebase. " +
    "Silakan pilih DAFTAR AKUN HRD."
  );
  show("registerScreen");
}

async function adminLogin() {
  const email = el("adminEmail").value.trim();
  const password = el("adminPassword").value;

  if (!email || !password) {
    return alert("Masukkan email dan password HRD.");
  }

  try {
    const credential =
      await firebaseAuth.signInWithEmailAndPassword(email, password);

    const uid = credential.user.uid;
    const profile = await firebaseDB.collection("users").doc(uid).get();
    const data = profile.exists ? profile.data() : {};

    if (!profile.exists ||
        data.role !== "hrd" ||
        data.active !== true) {
      await firebaseAuth.signOut();
      return alert(
        "Akun belum memiliki akses HRD.\n" +
        "Pastikan dokumen users/" + uid +
        " memiliki role: hrd dan active: true."
      );
    }

    await loadAdminCloud();
    el("adminPassword").value = "";
    renderAdmin();
    show("adminScreen");
    adminNavInit();

  } catch (e) {
    console.error("LOGIN HRD:", e);
    alert("Login HRD gagal: " + (e.code || "") + " " + e.message);
  }
}

async function registerHrd() {
  const name = el("registerName").value.trim();
  const email = el("registerEmail").value.trim();
  const password = el("registerPassword").value;
  const confirm = el("registerConfirm").value;

  if (!name || !email || !password || !confirm) {
    return alert("Semua kolom wajib diisi.");
  }
  if (password.length < 6) {
    return alert("Password minimal 6 karakter.");
  }
  if (password !== confirm) {
    return alert("Konfirmasi password tidak sama.");
  }

  try {
    const credential =
      await firebaseAuth.createUserWithEmailAndPassword(email, password);

    const uid = credential.user.uid;

    await credential.user.updateProfile({ displayName: name });
    await firebaseAuth.signOut();

    ["registerName", "registerEmail", "registerPassword",
     "registerConfirm"].forEach(id => el(id).value = "");

    alert(
      "Pendaftaran berhasil.\nUID: " + uid +
      "\n\nAkun belum memiliki akses HRD. " +
      "Admin harus memberikan profil HRD di Firestore."
    );
    show("loginScreen");

  } catch (e) {
    console.error(e);
    alert("Pendaftaran gagal: " + (e.code || "") + " " + e.message);
  }
}

async function logout() {
  stopScan();
  currentEmployee = null;
  scannedEmployee = null;

  try {
    await firebaseAuth.signOut();
  } catch (e) {
    console.warn(e);
  }

  show("loginScreen");
}

function renderAdmin() {
  el("totalEmployees").textContent = db.employees.length;
  el("totalPending").textContent =
    db.leaves.filter(x => x.status === "Menunggu").length;

  el("employeeList").innerHTML = db.employees.length
    ? db.employees.map((e, i) => `
      <div class="item">
        <b>${safe(e.nama)}</b><br>
        ID: ${safe(e.id)} • ${safe(e.jabatan || "-")} •
        ${safe(e.divisi || "-")}<br>
        <span class="status ${e.active === false ? "no" : "ok"}">
          ${e.active === false ? "Nonaktif" : "Aktif"}
        </span>
        <div class="actions">
          <button class="smallbtn secondary"
            onclick="showEmployeeQr(${i})">LIHAT QR</button>
          <button class="smallbtn danger"
            onclick="toggleEmployee(${i})">
            ${e.active === false ? "Aktifkan" : "Nonaktifkan"}
          </button>
        </div>
        <div id="qrEmployee${i}"></div>
      </div>
    `).join("")
    : "<p class='muted'>Belum ada karyawan.</p>";

  el("adminLeaveList").innerHTML = db.leaves.length
    ? [...db.leaves].reverse().map(x => {
        const e = db.employees.find(a => a.id === x.employeeId);
        return `
          <div class="item">
            <b>${safe(e?.nama || x.employeeId)}</b> •
            ${safe(x.jenis)}<br>
            ${safe(x.mulai)} s/d ${safe(x.selesai)}<br>
            ${safe(x.alasan)}<br>
            <span class="status ${
              x.status === "Disetujui" ? "ok" :
              x.status === "Ditolak" ? "no" : ""
            }">${safe(x.status)}</span>
            ${x.status === "Menunggu" ? `
              <div class="actions">
                <button class="smallbtn green"
                  onclick="updateLeave('${safe(x.id)}','Disetujui')">
                  Setujui
                </button>
                <button class="smallbtn danger"
                  onclick="updateLeave('${safe(x.id)}','Ditolak')">
                  Tolak
                </button>
              </div>` : ""}
          </div>`;
      }).join("")
    : "<p class='muted'>Belum ada pengajuan.</p>";

  el("adminAttendanceList").innerHTML = db.attendance.length
    ? [...db.attendance].reverse().slice(0, 50).map(a => {
        const e = db.employees.find(x => x.id === a.employeeId);
        return `
          <div class="item">
            <b>${safe(e?.nama || a.employeeId)}</b><br>
            ${safe(a.tanggal)} • Masuk: ${safe(a.masuk || "-")}
            • Pulang: ${safe(a.pulang || "-")}
          </div>`;
      }).join("")
    : "<p class='muted'>Belum ada catatan absensi.</p>";
}

async function addEmployee() {
  const id = el("newId").value.trim();
  const nama = el("newName").value.trim();
  const jabatan = el("newTitle").value.trim();
  const divisi = el("newDivision").value.trim();
  const password = el("newEmployeePassword").value;

  if (!id || !nama || !password) {
    return alert("ID, nama, dan password awal wajib diisi.");
  }

  if (!/^[A-Za-z0-9]+$/.test(id)) {
    return alert("ID karyawan hanya boleh huruf dan angka.");
  }

  if (password.length < 6) {
    return alert("Password awal minimal 6 karakter.");
  }

  if (db.employees.some(x =>
      x.id.toLowerCase() === id.toLowerCase())) {
    return alert("ID karyawan sudah digunakan.");
  }

  const employeeRef = firebaseDB.collection("karyawan").doc(id);
  const existing = await employeeRef.get();

  if (existing.exists) {
    return alert("ID karyawan sudah terdaftar di Firebase.");
  }

  let newUser = null;
  let secondary = null;

  try {
    secondary = getSecondaryAuth();

    const credential = await secondary.createUserWithEmailAndPassword(
      employeeEmail(id), password
    );
    newUser = credential.user;

    await newUser.updateProfile({ displayName: nama });

    const uid = newUser.uid;
    const batch = firebaseDB.batch();

    batch.set(firebaseDB.collection("users").doc(uid), {
      role: "karyawan",
      active: true,
      employeeId: id,
      nama: nama
    });

    batch.set(employeeRef, {
      uid: uid,
      id: id,
      nama: nama,
      jabatan: jabatan,
      divisi: divisi,
      active: true,
      status: "Aktif",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    const emp = {
      id, uid, nama, jabatan, divisi,
      active: true, status: "Aktif"
    };

    db.employees.push(emp);
    save();
    renderAdmin();

    ["newId", "newName", "newTitle",
     "newDivision", "newEmployeePassword"].forEach(
      x => el(x).value = ""
    );

    el("newQrResult").innerHTML = `
      <hr>
      <div class="center">
        <h4>Akun Karyawan Berhasil Dibuat</h4>
        <img class="qrimg" src="${makeQr(uid, id)}">
        <b>${safe(nama)}</b><br>
        ID: ${safe(id)}
        <p>Berikan QR, ID, dan password awal kepada karyawan.</p>
        <button class="secondary" onclick="window.print()">
          CETAK KARTU / QR
        </button>
      </div>`;

    alert("Akun karyawan berhasil dibuat.");

  } catch (e) {
    console.error("BUAT KARYAWAN:", e);

    if (newUser) {
      try {
        await newUser.delete();
      } catch (deleteError) {
        console.error("Gagal membersihkan akun sementara:", deleteError);
      }
    }

    alert(
      "Gagal membuat akun karyawan: " +
      (e.code || "") + " " + e.message
    );

  } finally {
    if (secondary) {
      try {
        await secondary.signOut();
      } catch (e) {
        console.warn(e);
      }
    }
  }
}

function showEmployeeQr(i) {
  const e = db.employees[i];
  if (!e || !e.uid) {
    return alert("Karyawan ini belum memiliki akun Firebase.");
  }

  el("qrEmployee" + i).innerHTML = `
    <div class="center">
      <img class="qrimg" src="${makeQr(e.uid, e.id)}">
      <b>${safe(e.nama)}</b><br>
      ID: ${safe(e.id)}
      <p>QR identitas karyawan.</p>
    </div>`;
}

async function toggleEmployee(i) {
  const e = db.employees[i];
  if (!e || !e.uid) {
    return alert("Akun Firebase karyawan tidak ditemukan.");
  }

  const active = e.active === false;

  try {
    const batch = firebaseDB.batch();

    batch.update(firebaseDB.collection("users").doc(e.uid), {
      active: active
    });

    batch.update(firebaseDB.collection("karyawan").doc(e.id), {
      active: active,
      status: active ? "Aktif" : "Nonaktif"
    });

    await batch.commit();

    e.active = active;
    e.status = active ? "Aktif" : "Nonaktif";
    save();
    renderAdmin();

  } catch (err) {
    alert("Gagal mengubah status: " + err.message);
  }
}

function startScan() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return alert("Kamera memerlukan browser HTTPS atau localhost.");
  }

  const video = el("camera");
  video.classList.remove("hidden");
  el("stopScan").classList.remove("hidden");

  navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false
  }).then(stream => {
    cameraStream = stream;
    video.srcObject = stream;
    video.play();

    const canvas = el("scanCanvas");
    const ctx = canvas.getContext("2d", {
      willReadFrequently: true
    });

    function tick() {
      if (!cameraStream) return;

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const image = ctx.getImageData(
          0, 0, canvas.width, canvas.height
        );

        const code = jsQR(
          image.data, image.width, image.height,
          { inversionAttempts: "dontInvert" }
        );

        if (code) {
          try {
            const obj = JSON.parse(code.data);

            if (obj.app === EMPLOYEE_APP &&
                obj.uid && obj.employeeId) {
              stopScan();
              handleScanned(obj);
              return;
            }
          } catch (e) {
            console.warn("QR belum sesuai format.");
          }
        }
      }

      scanTimer = requestAnimationFrame(tick);
    }

    tick();

  }).catch(e => {
    stopScan();
    alert("Kamera gagal dibuka: " + e.message);
  });
}

function stopScan() {
  if (scanTimer) cancelAnimationFrame(scanTimer);
  scanTimer = null;

  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }

  if (el("camera")) el("camera").classList.add("hidden");
  if (el("stopScan")) el("stopScan").classList.add("hidden");
}

function handleScanned(obj) {
  scannedEmployee = obj;

  el("employeeLoginBox").classList.remove("hidden");
  el("scanTitle").textContent = "Login Karyawan";
  el("scanInfo").textContent = "ID: " + obj.employeeId;
  el("employeeLoginFields").classList.remove("hidden");

  el("employeeIdLogin").value = obj.employeeId;
}

async function employeeLogin() {
  if (!scannedEmployee) {
    return alert("Silakan scan QR karyawan terlebih dahulu.");
  }

  const id = el("employeeIdLogin").value.trim();
  const password = el("employeePassword").value;

  if (id !== scannedEmployee.employeeId) {
    return alert("ID tidak sesuai dengan QR.");
  }

  if (!password) {
    return alert("Masukkan password karyawan.");
  }

  try {
    const credential = await firebaseAuth.signInWithEmailAndPassword(
      employeeEmail(id), password
    );

    const uid = credential.user.uid;

    if (uid !== scannedEmployee.uid) {
      await firebaseAuth.signOut();
      return alert("QR tidak cocok dengan akun yang login.");
    }

    const profile = await firebaseDB.collection("users")
      .doc(uid).get();

    if (!profile.exists ||
        profile.data().role !== "karyawan" ||
        profile.data().active !== true ||
        profile.data().employeeId !== id) {
      await firebaseAuth.signOut();
      return alert("Akun karyawan tidak aktif atau profil tidak valid.");
    }

    const employeeDoc = await firebaseDB.collection("karyawan")
      .doc(id).get();

    if (!employeeDoc.exists ||
        employeeDoc.data().uid !== uid ||
        employeeDoc.data().active !== true) {
      await firebaseAuth.signOut();
      return alert("Data karyawan tidak ditemukan atau dinonaktifkan.");
    }

    currentEmployee = {
      ...employeeDoc.data(),
      id: id,
      uid: uid
    };

    el("employeePassword").value = "";
    scannedEmployee = null;

    await loadEmployeeCloud();
    renderEmployee();
    show("employeeScreen");
    employeeNavGo("dashboard");

  } catch (e) {
    console.error("LOGIN KARYAWAN:", e);
    alert("Login karyawan gagal: " + (e.code || "") + " " + e.message);
  }
}

async function loadEmployeeCloud() {
  const uid = currentEmployee.uid;

  const [attendance, leaves] = await Promise.all([
    firebaseDB.collection("absensi")
      .where("uid", "==", uid).get(),
    firebaseDB.collection("pengajuan_izin")
      .where("uid", "==", uid).get()
  ]);

  const cloudAttendance = attendance.docs.map(d => ({
    ...d.data(), id: d.id
  }));

  const cloudLeaves = leaves.docs.map(d => ({
    ...d.data(), id: d.id
  }));

  db.attendance = mergeByKey(
    db.attendance.filter(x => x.employeeId !== currentEmployee.id),
    cloudAttendance,
    x => String(x.employeeId) + "_" + String(x.tanggal)
  );

  db.leaves = mergeByKey(
    db.leaves.filter(x => x.employeeId !== currentEmployee.id),
    cloudLeaves,
    x => String(x.id)
  );

  save();
}

function renderEmployee() {
  const e = currentEmployee;
  if (!e) return;

  el("employeeWelcome").textContent = "Halo, " + e.nama;
  el("employeeProfile").innerHTML =
    "ID: " + safe(e.id) +
    "<br>Jabatan: " + safe(e.jabatan || "-") +
    "<br>Divisi: " + safe(e.divisi || "-");

  const mine = db.attendance.filter(x => x.employeeId === e.id);
  const leaves = db.leaves.filter(x => x.employeeId === e.id);

  el("myAttendance").textContent = mine.length;
  el("myLeaves").textContent = leaves.length;

  const todayRow = mine.find(x => x.tanggal === today());

  el("todayAttendance").textContent = todayRow
    ? `Tanggal ${todayRow.tanggal} • Masuk ${todayRow.masuk || "-"} • Pulang ${todayRow.pulang || "-"}`
    : "Belum ada absensi hari ini.";

  el("myLeaveList").innerHTML = leaves.length
    ? [...leaves].reverse().map(x => `
      <div class="item">
        <b>${safe(x.jenis)}</b><br>
        ${safe(x.mulai)} s/d ${safe(x.selesai)}<br>
        ${safe(x.alasan)}<br>
        <span class="status ${
          x.status === "Disetujui" ? "ok" :
          x.status === "Ditolak" ? "no" : ""
        }">${safe(x.status)}</span>
      </div>`).join("")
    : "<p class='muted'>Belum ada pengajuan.</p>";

  el("myAttendanceList").innerHTML = mine.length
    ? [...mine].reverse().map(x => `
      <div class="item">
        ${safe(x.tanggal)} • Masuk ${safe(x.masuk || "-")}
        • Pulang ${safe(x.pulang || "-")}
      </div>`).join("")
    : "<p class='muted'>Belum ada riwayat absensi.</p>";
}


function employeeNavGo(view) {
  const views = {
    dashboard: "employeeDashboard",
    absensi: "employeeAbsensi",
    izin: "employeeIzin",
    riwayat: "employeeRiwayat"
  };

  Object.values(views).forEach(id => {
    const section = el(id);
    if (section) section.classList.add("hidden");
  });

  if (views[view]) {
    el(views[view]).classList.remove("hidden");
  }

  document.querySelectorAll(".employee-nav-btn").forEach(btn => {
    btn.classList.remove("active");
  });

  const buttons = {
    dashboard: 0,
    absensi: 1,
    izin: 2,
    riwayat: 3
  };

  const activeButton = document.querySelectorAll(".employee-nav-btn")[buttons[view]];
  if (activeButton) activeButton.classList.add("active");
}

async function markAttendance(type) {
  const e = currentEmployee;
  if (!e) return;

  try {
    const ref = firebaseDB.collection("absensi")
      .doc(e.uid + "_" + today());

    const snap = await ref.get();
    let row;

    if (!snap.exists) {
      if (type !== "Masuk") {
        return alert("Absen masuk terlebih dahulu.");
      }

      row = {
        uid: e.uid,
        employeeId: e.id,
        tanggal: today(),
        masuk: timeNow(),
        pulang: ""
      };

      await ref.set(row);

    } else {
      row = snap.data();

      if (type === "Masuk") {
        return alert("Absensi masuk hari ini sudah tercatat.");
      }

      if (!row.masuk) {
        return alert("Absen masuk terlebih dahulu.");
      }

      if (row.pulang) {
        return alert("Absensi pulang sudah tercatat.");
      }

      row.pulang = timeNow();
      await ref.update({ pulang: row.pulang });
    }

    const index = db.attendance.findIndex(x =>
      x.employeeId === e.id && x.tanggal === today()
    );

    if (index >= 0) db.attendance[index] = row;
    else db.attendance.push(row);

    save();
    renderEmployee();
    alert("Absensi " + type + " berhasil disimpan ke Firebase.");

  } catch (err) {
    console.error(err);
    alert("Absensi gagal: " + (err.code || "") + " " + err.message);
  }
}

async function submitLeave() {
  const e = currentEmployee;
  if (!e) return;

  const jenis = el("leaveType").value;
  const mulai = el("leaveStart").value;
  const selesai = el("leaveEnd").value;
  const alasan = el("leaveReason").value.trim();

  if (!mulai || !selesai || !alasan) {
    return alert("Lengkapi semua data pengajuan.");
  }

  if (selesai < mulai) {
    return alert("Tanggal selesai tidak boleh sebelum tanggal mulai.");
  }

  try {
    const id = randomToken().slice(0, 20);

    const data = {
      uid: e.uid,
      employeeId: e.id,
      jenis: jenis,
      mulai: mulai,
      selesai: selesai,
      alasan: alasan,
      status: "Menunggu",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    await firebaseDB.collection("pengajuan_izin").doc(id).set(data);

    db.leaves.push({
      ...data,
      id: id,
      createdAt: new Date().toISOString()
    });

    save();
    el("leaveReason").value = "";
    renderEmployee();
    alert("Pengajuan berhasil dikirim ke Firebase.");

  } catch (err) {
    alert("Pengajuan gagal: " + (err.code || "") + " " + err.message);
  }
}

async function updateLeave(id, status) {
  const item = db.leaves.find(x => x.id === id);
  if (!item) return;

  try {
    await firebaseDB.collection("pengajuan_izin")
      .doc(id).update({ status: status });

    item.status = status;
    save();
    renderAdmin();

  } catch (e) {
    alert("Gagal memperbarui pengajuan: " + e.message);
  }
}

function exportBackup() {
  const blob = new Blob(
    [JSON.stringify(db, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "backup_portal_karyawan.json";
  a.click();
  URL.revokeObjectURL(url);
}

async function importBackup() {
  const f = el("backupFile").files[0];
  if (!f) return alert("Pilih file backup JSON.");

  try {
    const obj = JSON.parse(await f.text());

    if (!obj ||
        !Array.isArray(obj.employees) ||
        !Array.isArray(obj.leaves) ||
        !Array.isArray(obj.attendance)) {
      throw Error("Format backup tidak sesuai.");
    }

    if (!confirm(
      "Impor akan mengganti data lokal perangkat ini. " +
      "Data Firebase tidak dihapus. Lanjutkan?"
    )) return;

    db = obj;
    save();
    alert("Backup lokal berhasil dipulihkan.");
    renderAdmin();

  } catch (e) {
    alert("Gagal impor: " + e.message);
  }
}

function init() {
  show("loginScreen");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

init();

// ======================================
// NAVIGASI BAWAH HRD
// ======================================
function adminNavInit() {
  const screen = el("adminScreen");
  if (!screen) return;

  const cards = Array.from(screen.children).filter(node => node.classList && node.classList.contains("card"));
  if (cards.length < 6) return;

  const labels = [
    ["⌂", "Home"],
    ["＋", "Tambah"],
    ["♙", "Karyawan"],
    ["✓", "Persetujuan"],
    ["▦", "Rekap"],
    ["☻", "Profil"]
  ];

  let nav = el("adminBottomNav");

  if (!nav) {
    nav = document.createElement("nav");
    nav.id = "adminBottomNav";
    nav.setAttribute("aria-label", "Navigasi HRD");

    labels.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "admin-nav-button";
      button.innerHTML =
        '<span class="admin-nav-icon">' + item[0] + '</span>' +
        '<span class="admin-nav-label">' + item[1] + '</span>';

      button.addEventListener("click", () => adminNavGo(index));
      nav.appendChild(button);
    });

    screen.appendChild(nav);
  }

  // Informasi profil HRD ditambahkan pada bagian Profil.
  const profileCard = cards[5];
  if (!el("hrdProfilePanel")) {
    const panel = document.createElement("div");
    panel.id = "hrdProfilePanel";
    panel.className = "hrd-profile-panel";

    const title = document.createElement("h3");
    title.textContent = "Profil HRD";

    const email = document.createElement("p");
    email.id = "hrdProfileEmail";

    const uid = document.createElement("p");
    uid.id = "hrdProfileUid";

    panel.append(title, email, uid);
    profileCard.insertBefore(panel, profileCard.firstChild);
  }

  const user = firebaseAuth && firebaseAuth.currentUser;
  const emailElement = el("hrdProfileEmail");
  const uidElement = el("hrdProfileUid");

  if (emailElement) {
    emailElement.textContent = "Email: " + (user?.email || "-");
  }
  if (uidElement) {
    uidElement.textContent = "UID: " + (user?.uid || "-");
  }

  adminNavGo(0);
}

function adminNavGo(index) {
  const screen = el("adminScreen");
  if (!screen) return;

  const cards = Array.from(screen.children).filter(node => node.classList && node.classList.contains("card"));
  const nav = el("adminBottomNav");
  if (!nav || index < 0 || index >= 6) return;

  cards.forEach((card, i) => {
    card.classList.toggle("admin-section-hidden", i !== index);
  });

  Array.from(nav.querySelectorAll("button")).forEach((button, i) => {
    button.classList.toggle("active", i === index);
    button.setAttribute("aria-current", i === index ? "page" : "false");
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}
