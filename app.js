
function portalNotify(message, type) {
  const msg = String(message || "");

  if (!type) {
    if (/gagal|error|tidak ditemukan|tidak sesuai|tidak aktif/i.test(msg)) {
      type = "error";
    } else if (/wajib|lengkapi|terlebih dahulu|minimal|tidak boleh|masukkan|pilih/i.test(msg)) {
      type = "warning";
    } else if (/berhasil|sukses/i.test(msg)) {
      type = "success";
    } else {
      type = "info";
    }
  }

  const settings = {
    success: { icon: "✓", title: "Berhasil", label: "TRANSAKSI BERHASIL" },
    error: { icon: "×", title: "Terjadi Kesalahan", label: "PROSES GAGAL" },
    warning: { icon: "!", title: "Perlu Perhatian", label: "PERIKSA KEMBALI" },
    info: { icon: "i", title: "Informasi", label: "PEMBERITAHUAN" }
  };

  const item = settings[type] || settings.info;

  let container = document.getElementById("portalToastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "portalToastContainer";
    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-atomic", "false");
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = "portal-toast portal-toast-" + type;
  toast.setAttribute("role", "status");

  const accent = document.createElement("div");
  accent.className = "portal-toast-accent";

  const icon = document.createElement("div");
  icon.className = "portal-toast-icon";
  icon.textContent = item.icon;

  const content = document.createElement("div");
  content.className = "portal-toast-content";

  const label = document.createElement("small");
  label.className = "portal-toast-label";
  label.textContent = item.label;

  const heading = document.createElement("strong");
  heading.textContent = item.title;

  const description = document.createElement("span");
  description.textContent = msg;

  content.append(label, heading, description);

  const close = document.createElement("button");
  close.className = "portal-toast-close";
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Tutup notifikasi");

  const progress = document.createElement("div");
  progress.className = "portal-toast-progress";

  toast.append(accent, icon, content, close, progress);
  container.appendChild(toast);

  let removed = false;
  let timer;

  function removeToast() {
    if (removed) return;
    removed = true;
    clearTimeout(timer);
    toast.classList.remove("show");
    toast.classList.add("hide");
    setTimeout(() => toast.remove(), 300);
  }

  close.addEventListener("click", removeToast);

  requestAnimationFrame(() => toast.classList.add("show"));

  timer = setTimeout(removeToast, 5000);
}

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
  portalNotify(
    "Pembuatan akun HRD memerlukan akses administrator. " +
    "Silakan pilih DAFTAR AKUN HRD."
  );
  show("registerScreen");
}

async function adminLogin() {
  const email = el("adminEmail").value.trim();
  const password = el("adminPassword").value;

  if (!email || !password) {
    return portalNotify("Masukkan email dan password HRD.");
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
      return portalNotify(
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
    portalNotify("Login berhasil. Selamat datang di Dashboard HRD.", "success");

  } catch (e) {
    console.error("LOGIN HRD:", e);
    portalNotify("Email atau password HRD tidak sesuai. Silakan periksa kembali.");
  }
}

async function registerHrd() {
  const name = el("registerName").value.trim();
  const email = el("registerEmail").value.trim();
  const password = el("registerPassword").value;
  const confirm = el("registerConfirm").value;

  if (!name || !email || !password || !confirm) {
    return portalNotify("Semua kolom wajib diisi.");
  }
  if (password.length < 6) {
    return portalNotify("Password minimal 6 karakter.");
  }
  if (password !== confirm) {
    return portalNotify("Konfirmasi password tidak sama.");
  }

  try {
    const credential =
      await firebaseAuth.createUserWithEmailAndPassword(email, password);

    const uid = credential.user.uid;

    await credential.user.updateProfile({ displayName: name });
    await firebaseAuth.signOut();

    ["registerName", "registerEmail", "registerPassword",
     "registerConfirm"].forEach(id => el(id).value = "");

    portalNotify(
      "Pendaftaran berhasil.\nUID: " + uid +
      "\n\nAkun belum memiliki akses HRD. " +
      "Admin harus memberikan profil HRD di Firestore."
    );
    show("loginScreen");

  } catch (e) {
    console.error(e);
    portalNotify("Pendaftaran gagal: " + (e.code || "") + " " + e.message);
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
        ${e.foto ? `<img src="${safe(e.foto)}" alt="Foto ${safe(e.nama)}" style="width:64px;height:64px;object-fit:cover;border-radius:50%;margin-bottom:8px">` : ""}
        <b>${safe(e.nama)}</b><br>
        ID: ${safe(e.id)} • ${safe(e.jabatan || "-")} •
        ${safe(e.divisi || "-")}<br>
        <span class="status ${e.active === false ? "no" : "ok"}">
          ${e.active === false ? "Nonaktif" : "Aktif"}
        </span>
        <div class="actions">
          <button class="smallbtn secondary" onclick="showEmployeeQr(${i})">QR</button>
          <button class="smallbtn secondary" onclick="showEmployeeDetail(${i})">DETAIL</button>
          <button class="smallbtn secondary" onclick="editEmployee(${i})">EDIT</button>
          <button class="smallbtn secondary" onclick="printEmployeeCard(${i})">CETAK ID CARD</button>
          <button class="smallbtn danger" onclick="toggleEmployee(${i})">
            ${e.active === false ? "Aktifkan" : "Nonaktifkan"}
          </button>
          <button class="smallbtn danger" onclick="deleteEmployee(${i})">HAPUS</button>
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
    return portalNotify("ID, nama, dan password awal wajib diisi.");
  }

  if (!/^[A-Za-z0-9]+$/.test(id)) {
    return portalNotify("ID karyawan hanya boleh huruf dan angka.");
  }

  if (password.length < 6) {
    return portalNotify("Password awal minimal 6 karakter.");
  }

  if (db.employees.some(x =>
      x.id.toLowerCase() === id.toLowerCase())) {
    return portalNotify("ID karyawan sudah digunakan.");
  }

  const employeeRef = firebaseDB.collection("karyawan").doc(id);
  const existing = await employeeRef.get();

  if (existing.exists) {
    return portalNotify("ID karyawan sudah terdaftar. Gunakan ID yang berbeda.");
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

    portalNotify("Akun karyawan berhasil dibuat.");

  } catch (e) {
    console.error("BUAT KARYAWAN:", e);

    if (newUser) {
      try {
        await newUser.delete();
      } catch (deleteError) {
        console.error("Gagal membersihkan akun sementara:", deleteError);
      }
    }

    portalNotify(
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
    return portalNotify("Karyawan ini belum memiliki akun akses. Silakan buat akun terlebih dahulu.");
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
    return portalNotify("Akun karyawan tidak ditemukan. Periksa kembali data karyawan.");
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
    portalNotify("Gagal mengubah status: " + err.message);
  }
}



// DETAIL KARYAWAN - KHUSUS TAMPILAN HRD
function showEmployeeDetail(i) {
  const e = db.employees[i];
  if (!e) return;

  const rows = [
    ["ID Karyawan", e.id],
    ["Nama lengkap", e.nama],
    ["Jabatan", e.jabatan],
    ["Divisi / Bagian", e.divisi],
    ["Nomor HP", e.nomorHp],
    ["Email kerja", e.emailKerja],
    ["Tanggal masuk", e.tanggalMasuk],
    ["Status kerja", e.statusKerja],
    ["Lokasi kerja", e.lokasiKerja],
    ["Status akun", e.active === false ? "Nonaktif" : "Aktif"]
  ];

  let modal = document.getElementById("employeeFeatureModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "employeeFeatureModal";
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div style="position:fixed;inset:0;background:#0009;z-index:99999;overflow:auto;padding:18px">
      <div style="background:var(--card,#fff);color:var(--text, #222);max-width:600px;margin:25px auto;padding:22px;border-radius:16px">
        <h2>Detail Karyawan</h2>
        <div style="text-align:center;margin:18px">
          <div style="font-size:42px">👤</div>
          <h3>${safe(e.nama)}</h3>
          <p>${safe(e.jabatan || "-")} • ${safe(e.divisi || "-")}</p>
        </div>
        ${rows.map(([label, value]) => `
          <div style="padding:10px 0;border-bottom:1px solid #ddd">
            <small style="opacity:.7">${safe(label)}</small>
            <div><b>${safe(value || "-")}</b></div>
          </div>
        `).join("")}
        <p style="font-size:12px;opacity:.7">
          Data gaji, NIK, dan alamat pribadi akan ditambahkan pada bagian data HRD yang terlindungi.
        </p>
        <button class="full" onclick="document.getElementById('employeeFeatureModal').innerHTML=''">TUTUP</button>
      </div>
    </div>`;
}

// EDIT DATA KARYAWAN
function editEmployee(i) {
  window.editEmployeePhotoData = "";
  const e = db.employees[i];
  if (!e) return;

  let modal = document.getElementById("employeeFeatureModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "employeeFeatureModal";
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div style="position:fixed;inset:0;background:#0009;z-index:99999;overflow:auto;padding:18px">
      <div style="background:var(--card,#fff);color:var(--text,#222);max-width:600px;margin:25px auto;padding:22px;border-radius:16px">
        <h2>Edit Data Karyawan</h2>
        <label>ID Karyawan</label>
        <input value="${safe(e.id)}" disabled>
        <label>Nama lengkap</label>
        <input id="editEmpNama" value="${safe(e.nama)}">
        <label>Foto Karyawan</label>
        <div style="margin:10px 0">
          <img id="editEmpFotoPreview"
            src="${safe(e.foto || '')}"
            style="width:110px;height:110px;object-fit:cover;border-radius:50%;background:#eee;display:${e.foto ? 'block' : 'none'}">
          <input id="editEmpFoto" type="file"
            accept="image/jpeg,image/png,image/webp"
            onchange="previewEmployeePhoto(this)">
        </div>
        <label>Jabatan</label>
        <input id="editEmpJabatan" value="${safe(e.jabatan)}">
        <label>Divisi / Bagian</label>
        <input id="editEmpDivisi" value="${safe(e.divisi)}">
        <label>Nomor HP</label>
        <input id="editEmpHp" value="${safe(e.nomorHp)}" placeholder="08xxxxxxxxxx">
        <label>Email kerja</label>
        <input id="editEmpEmail" type="email" value="${safe(e.emailKerja)}">
        <label>Tanggal masuk</label>
        <input id="editEmpTanggal" type="date" value="${safe(e.tanggalMasuk)}">
        <label>Status kerja</label>
        <select id="editEmpStatus">
          <option value="Tetap">Tetap</option>
          <option value="Kontrak">Kontrak</option>
          <option value="Harian">Harian</option>
          <option value="Magang">Magang</option>
        </select>
        <label>Lokasi kerja</label>
        <input id="editEmpLokasi" value="${safe(e.lokasiKerja)}">
        <div class="actions">
          <button class="full" onclick="saveEmployeeEdit(${i})">SIMPAN PERUBAHAN</button>
          <button class="secondary" onclick="document.getElementById('employeeFeatureModal').innerHTML=''">BATAL</button>
        </div>
      </div>
    </div>`;

  const status = document.getElementById("editEmpStatus");
  if (status && e.statusKerja) status.value = e.statusKerja;
}


window.editEmployeePhotoData = "";

async function compressEmployeePhoto(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Pilih file gambar yang valid.");
  }

  const imageUrl = URL.createObjectURL(file);

  try {
    const img = new Image();
    img.src = imageUrl;
    await img.decode();

    const maxSide = 500;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    let quality = 0.7;
    let data = canvas.toDataURL("image/jpeg", quality);

    while (data.length * 0.75 > 350 * 1024 && quality > 0.35) {
      quality -= 0.1;
      data = canvas.toDataURL("image/jpeg", quality);
    }

    if (data.length * 0.75 > 350 * 1024) {
      throw new Error("Ukuran foto masih terlalu besar.");
    }

    return data;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function previewEmployeePhoto(input) {
  const file = input.files && input.files[0];
  if (!file) return;

  try {
    window.editEmployeePhotoData = await compressEmployeePhoto(file);
    const preview = document.getElementById("editEmpFotoPreview");
    preview.src = window.editEmployeePhotoData;
    preview.style.display = "block";
  } catch (err) {
    window.editEmployeePhotoData = "";
    input.value = "";
    portalNotify(err.message || "Foto gagal diproses.");
  }
}

async function saveEmployeeEdit(i) {
  const e = db.employees[i];
  if (!e) return;

  const nama = document.getElementById("editEmpNama").value.trim();
  if (!nama) return portalNotify("Nama karyawan wajib diisi.");

  const updates = {
    nama,
    jabatan: document.getElementById("editEmpJabatan").value.trim(),
    divisi: document.getElementById("editEmpDivisi").value.trim(),
    nomorHp: document.getElementById("editEmpHp").value.trim(),
    emailKerja: document.getElementById("editEmpEmail").value.trim(),
    tanggalMasuk: document.getElementById("editEmpTanggal").value,
    statusKerja: document.getElementById("editEmpStatus").value,
    lokasiKerja: document.getElementById("editEmpLokasi").value.trim()
  };

  if (window.editEmployeePhotoData) {
    updates.foto = window.editEmployeePhotoData;
  }

  try {
    const batch = firebaseDB.batch();
    batch.update(firebaseDB.collection("karyawan").doc(e.id), updates);

    if (e.uid) {
      batch.update(firebaseDB.collection("users").doc(e.uid), {
        nama: nama
      });
    }

    await batch.commit();
    Object.assign(e, updates);
    save();
    renderAdmin();
    document.getElementById("employeeFeatureModal").innerHTML = "";
    portalNotify("Data karyawan berhasil diperbarui.", "success");
  } catch (err) {
    console.error("EDIT KARYAWAN:", err);
    portalNotify("Data belum berhasil diperbarui. Periksa koneksi dan hak akses.");
  }
}

// CETAK KARTU IDENTITAS
function printEmployeeCard(i) {
  const e = db.employees[i];
  if (!e || !e.uid) return portalNotify("QR karyawan belum tersedia.");

  const qr = makeQr(e.uid, e.id);
  const win = window.open("", "_blank", "width=600,height=750");
  if (!win) return portalNotify("Izinkan pop-up browser untuk mencetak ID Card.");

  win.document.write(`
    <!DOCTYPE html><html><head><title>ID Card ${safe(e.id)}</title>
    <style>
      body{font-family:Arial,sans-serif;display:flex;justify-content:center;padding:30px}
      .card{width:340px;border:2px solid #183b65;border-radius:18px;text-align:center;overflow:hidden;padding-bottom:20px}
      .head{background:#183b65;color:white;padding:18px;font-weight:bold}
      .body{padding:20px}
      .name{font-size:21px;font-weight:bold;margin:12px 0}
      .qr{width:150px;height:150px}
      .id{font-size:16px;font-weight:bold;margin:10px}
      @media print{button{display:none}}
    </style></head><body>
      <div class="card">
        <div class="head">KARTU IDENTITAS KARYAWAN</div>
        <div class="body">
          <div class="name">${safe(e.nama)}</div>
          <div>${safe(e.jabatan || "-")}</div>
          <div>${safe(e.divisi || "-")}</div>
          <div class="id">ID: ${safe(e.id)}</div>
          <img class="qr" src="${qr}">
          <p>IDENTITAS RESMI KARYAWAN</p>
        </div>
      </div>
      <script>window.onload=()=>window.print();<\/script>
    </body></html>`);
  win.document.close();
}

// HAPUS DARI DAFTAR DAN NONAKTIFKAN AKSES
async function deleteEmployee(i) {
  const e = db.employees[i];
  if (!e) return;

  const ok = confirm(
    "Hapus " + e.nama + " dari daftar karyawan?\n\n" +
    "Akses login akan dinonaktifkan. Riwayat absensi dan izin tetap disimpan.\n" +
    "Akun Authentication tidak dihapus permanen oleh tindakan ini."
  );
  if (!ok) return;

  if (!e.uid) {
    return portalNotify("Akun karyawan tidak ditemukan. Hubungi administrator.");
  }

  try {
    const batch = firebaseDB.batch();
    batch.update(firebaseDB.collection("users").doc(e.uid), {
      active: false
    });
    batch.delete(firebaseDB.collection("karyawan").doc(e.id));
    await batch.commit();

    db.employees = db.employees.filter(x => x.id !== e.id);
    save();
    renderAdmin();
    portalNotify("Karyawan dihapus dari daftar dan akses login dinonaktifkan.", "success");
  } catch (err) {
    console.error("HAPUS KARYAWAN:", err);
    portalNotify("Karyawan belum berhasil dihapus. Periksa hak akses HRD.");
  }
}

function startScan() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return portalNotify("Kamera memerlukan browser HTTPS atau localhost.");
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
    portalNotify("Kamera gagal dibuka: " + e.message);
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
    return portalNotify("Silakan scan QR karyawan terlebih dahulu.");
  }

  const id = el("employeeIdLogin").value.trim();
  const password = el("employeePassword").value;

  if (id !== scannedEmployee.employeeId) {
    return portalNotify("ID tidak sesuai dengan QR.");
  }

  if (!password) {
    return portalNotify("Masukkan password karyawan.");
  }

  try {
    const credential = await firebaseAuth.signInWithEmailAndPassword(
      employeeEmail(id), password
    );

    const uid = credential.user.uid;

    if (uid !== scannedEmployee.uid) {
      await firebaseAuth.signOut();
      return portalNotify("QR tidak cocok dengan akun yang login.");
    }

    const profile = await firebaseDB.collection("users")
      .doc(uid).get();

    if (!profile.exists ||
        profile.data().role !== "karyawan" ||
        profile.data().active !== true ||
        profile.data().employeeId !== id) {
      await firebaseAuth.signOut();
      return portalNotify("Akun karyawan tidak aktif atau profil tidak valid.");
    }

    const employeeDoc = await firebaseDB.collection("karyawan")
      .doc(id).get();

    if (!employeeDoc.exists ||
        employeeDoc.data().uid !== uid ||
        employeeDoc.data().active !== true) {
      await firebaseAuth.signOut();
      return portalNotify("Data karyawan tidak ditemukan atau dinonaktifkan.");
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
    portalNotify("Login berhasil. Selamat datang di Portal Karyawan.", "success");

  } catch (e) {
    console.error("LOGIN KARYAWAN:", e);
    portalNotify("ID karyawan atau password tidak sesuai. Silakan coba kembali.");
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
        return portalNotify("Absen masuk terlebih dahulu.");
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
        return portalNotify("Absensi masuk hari ini sudah tercatat.");
      }

      if (!row.masuk) {
        return portalNotify("Absen masuk terlebih dahulu.");
      }

      if (row.pulang) {
        return portalNotify("Absensi pulang sudah tercatat.");
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
    portalNotify(type === "Masuk" ? "Absensi masuk berhasil dicatat. Selamat bekerja!" : "Absensi pulang berhasil dicatat. Hati-hati di perjalanan!");

  } catch (err) {
    console.error(err);
    portalNotify("Absensi belum berhasil diproses. Periksa koneksi internet dan coba kembali.");
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
    return portalNotify("Lengkapi semua data pengajuan.");
  }

  if (selesai < mulai) {
    return portalNotify("Tanggal selesai tidak boleh sebelum tanggal mulai.");
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
    portalNotify("Pengajuan izin berhasil disampaikan kepada HRD. Silakan tunggu konfirmasi.");

  } catch (err) {
    portalNotify("Pengajuan belum berhasil diproses. Silakan coba kembali.");
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
    portalNotify("Status pengajuan belum berhasil diperbarui. Silakan coba kembali.");
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
  if (!f) return portalNotify("Pilih file backup JSON.");

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
      "Data yang tersimpan di server tidak akan dihapus. Lanjutkan?"
    )) return;

    db = obj;
    save();
    portalNotify("Backup lokal berhasil dipulihkan.");
    renderAdmin();

  } catch (e) {
    portalNotify("Gagal impor: " + e.message);
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
