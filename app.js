"use strict";

const DBKEY="portalKaryawanOffline_v2";
let db=JSON.parse(localStorage.getItem(DBKEY)||"null")||{admin:null,employees:[],leaves:[],attendance:[]};
let currentEmployee=null, scannedEmployee=null, cameraStream=null, scanTimer=null;

function save(){localStorage.setItem(DBKEY,JSON.stringify(db))}
function el(id){return document.getElementById(id)}
function safe(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function show(id){["setupScreen","loginScreen","registerScreen","adminScreen","employeeScreen"].forEach(x=>el(x).classList.add("hidden"));el(id).classList.remove("hidden")}
function showRegister(){show("registerScreen")}
function randomToken(){const a=new Uint8Array(24);crypto.getRandomValues(a);return [...a].map(x=>x.toString(16).padStart(2,"0")).join("")}
function randomPin(){return String(Math.floor(100000+Math.random()*900000))}
async function hashPin(pin){if(!crypto.subtle)throw Error("Fitur keamanan PIN membutuhkan browser yang mendukung Web Crypto dan konteks aman (HTTPS atau localhost).");const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(pin));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
function today(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function timeNow(){return new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})}
function qrData(token){return JSON.stringify({app:"CEKKARYAWAN_OFFLINE",token})}
function makeQr(token){const q=qrcode(0,"M");q.addData(qrData(token));q.make();return q.createDataURL(6,4)}
function init(){show("loginScreen")}
async function setupAdmin(){
 const name=el("setupName").value.trim(),pin=el("setupPin").value.trim();
 if(!name||!/^\d{6,12}$/.test(pin))return alert("Isi nama HRD dan PIN 6–12 angka.");
 try{db.admin={name,pinHash:await hashPin(pin)};save();el("setupPin").value="";alert("Akun HRD berhasil dibuat. Simpan PIN dengan aman.");show("loginScreen")}catch(e){alert(e.message)}
}
async function adminLogin(){
 const email=el("adminEmail").value.trim();
 const password=el("adminPassword").value;

 if(!email || !password){
  return alert("Masukkan email dan password HRD.");
 }

 try{
  const credential=await firebaseAuth.signInWithEmailAndPassword(email,password);
  const uid=credential.user.uid;

  const profile=await firebaseDB.collection("pengguna").doc(uid).get();
  const data=profile.exists ? profile.data() : {};

  console.log("UID LOGIN:", uid);
  console.log("DOKUMEN HRD ADA:", profile.exists);
  console.log("DATA PROFIL HRD:", data);
  console.log("PERAN:", JSON.stringify(data.peran));
  console.log("AKTIF:", JSON.stringify(data.aktif));

  if(!profile.exists ||
     data.peran !== "hrd" ||
     data.aktif !== true){
    const detail =
      "PEMERIKSAAN PROFIL HRD\\n" +
      "Project: " + firebase.app().options.projectId + "\\n" +
      "UID login: " + uid + "\\n" +
      "Dokumen ditemukan: " + profile.exists + "\\n" +
      "Peran: " + JSON.stringify(data.peran) + "\\n" +
      "Aktif: " + JSON.stringify(data.aktif);
    await firebaseAuth.signOut();
    return alert(detail);
  }

  el("adminPassword").value="";
  renderAdmin();
  show("adminScreen");

 }catch(e){
  console.error("LOGIN HRD DETAIL:", {
    code: e.code,
    message: e.message,
    name: e.name
  });
  alert("Login HRD gagal. Kode: "+(e.code || "tidak diketahui")+" | "+e.message);
 }
}
async function registerHrd(){
 const name=el("registerName").value.trim();
 const email=el("registerEmail").value.trim();
 const password=el("registerPassword").value;
 const confirm=el("registerConfirm").value;

 if(!name || !email || !password || !confirm){
  return alert("Semua kolom wajib diisi.");
 }
 if(password.length < 6){
  return alert("Password minimal 6 karakter.");
 }
 if(password !== confirm){
  return alert("Konfirmasi password tidak sama.");
 }

 try{
  const credential=await firebaseAuth.createUserWithEmailAndPassword(email,password);
  const uid=credential.user.uid;

  try{
   await credential.user.updateProfile({displayName:name});
  }catch(profileError){
   console.warn("Nama profil belum tersimpan:",profileError);
  }

  await firebaseAuth.signOut();

  ["registerName","registerEmail","registerPassword","registerConfirm"].forEach(id=>el(id).value="");

  alert("Pendaftaran berhasil. UID: "+uid+"\\n\\nAkun belum memiliki akses HRD. Hubungi HRD utama untuk persetujuan.");
  show("loginScreen");

 }catch(e){
  console.error("Pendaftaran HRD:",e);
  let message=e.message;
  if(e.code==="auth/email-already-in-use") message="Email sudah terdaftar. Gunakan email lain.";
  if(e.code==="auth/invalid-email") message="Format email tidak valid.";
  if(e.code==="auth/weak-password") message="Password terlalu lemah. Gunakan minimal 6 karakter.";
  alert("Pendaftaran gagal: "+message);
 }
}

function logout(){stopScan();currentEmployee=null;scannedEmployee=null;show("loginScreen")}
function renderAdmin(){
 el("totalEmployees").textContent=db.employees.length;
 el("totalPending").textContent=db.leaves.filter(x=>x.status==="Menunggu").length;
 el("employeeList").innerHTML=db.employees.length?db.employees.map((e,i)=>`<div class="item"><b>${safe(e.nama)}</b><br>ID: ${safe(e.id)} • ${safe(e.jabatan)} • ${safe(e.divisi)}<br><span class="status ${e.active?"ok":"no"}">${e.active?"Aktif":"Belum aktivasi"}</span><div class="actions"><button class="smallbtn secondary" onclick="showEmployeeQr(${i})">QR / PIN BARU</button><button class="smallbtn danger" onclick="toggleEmployee(${i})">${e.status==="Nonaktif"?"Aktifkan":"Nonaktifkan"}</button></div><div id="qrEmployee${i}"></div></div>`).join(""):"<p class='muted'>Belum ada karyawan.</p>";
 el("adminLeaveList").innerHTML=db.leaves.length?[...db.leaves].reverse().map((x)=>{let e=db.employees.find(a=>a.id===x.employeeId);return `<div class="item"><b>${safe(e?.nama||x.employeeId)}</b> • ${safe(x.jenis)}<br>${safe(x.mulai)} s/d ${safe(x.selesai)}<br>${safe(x.alasan)}<br><span class="status ${x.status==="Disetujui"?"ok":x.status==="Ditolak"?"no":""}">${safe(x.status)}</span>${x.status==="Menunggu"?`<div class="actions"><button class="smallbtn green" onclick="updateLeave('${x.id}','Disetujui')">Setujui</button><button class="smallbtn danger" onclick="updateLeave('${x.id}','Ditolak')">Tolak</button></div>`:""}</div>`}).join(""):"<p class='muted'>Belum ada pengajuan.</p>";
 el("adminAttendanceList").innerHTML=db.attendance.length?[...db.attendance].reverse().slice(0,50).map(a=>{let e=db.employees.find(x=>x.id===a.employeeId);return `<div class="item"><b>${safe(e?.nama||a.employeeId)}</b><br>${safe(a.tanggal)} • Masuk: ${safe(a.masuk||"-")} • Pulang: ${safe(a.pulang||"-")}</div>`}).join(""):"<p class='muted'>Belum ada catatan absensi.</p>";
}
function addEmployee(){
 const id=el("newId").value.trim(),nama=el("newName").value.trim(),jabatan=el("newTitle").value.trim(),divisi=el("newDivision").value.trim();
 if(!id||!nama)return alert("ID dan nama karyawan wajib diisi.");
 if(db.employees.some(x=>x.id.toLowerCase()===id.toLowerCase()))return alert("ID karyawan sudah digunakan.");
 const token=randomToken(),pin=randomPin();
 db.employees.push({id,nama,jabatan,divisi,status:"Aktif",active:false,token,activationHash:null});
 const emp=db.employees[db.employees.length-1];
 hashPin(pin).then(h=>{emp.activationHash=h;save();renderAdmin();showNewQr(emp,pin)}).catch(e=>alert(e.message));
 ["newId","newName","newTitle","newDivision"].forEach(x=>el(x).value="");
}
function showNewQr(emp,pin){
 el("newQrResult").innerHTML=`<hr><div class="center"><h4>QR Karyawan Berhasil Dibuat</h4><img class="qrimg" src="${makeQr(emp.token)}"><b>${safe(emp.nama)}</b><br>ID: ${safe(emp.id)}<p>PIN aktivasi: <strong style="font-size:24px">${pin}</strong></p><p class="small">Berikan QR dan PIN ini secara langsung kepada karyawan. PIN aktivasi hanya berlaku satu kali.</p><button class="secondary" onclick="window.print()">CETAK KARTU / QR</button></div>`;
}
function showEmployeeQr(i){
 const e=db.employees[i];if(!e)return;
 const pin=randomPin();e.active=false;e.activationHash=null;e.token=randomToken();
 hashPin(pin).then(h=>{e.activationHash=h;save();el("qrEmployee"+i).innerHTML=`<div class="center"><img class="qrimg" src="${makeQr(e.token)}"><b>PIN aktivasi baru: ${pin}</b><p class="small">QR sebelumnya tidak berlaku. Berikan QR dan PIN baru kepada karyawan.</p></div>`}).catch(x=>alert(x.message));
}
function toggleEmployee(i){const e=db.employees[i];e.status=e.status==="Nonaktif"?"Aktif":"Nonaktif";save();renderAdmin()}
function updateLeave(id,status){const x=db.leaves.find(a=>a.id===id);if(!x)return;x.status=status;save();renderAdmin()}
function startScan(){
 if(!navigator.mediaDevices?.getUserMedia)return alert("Kamera tidak tersedia. Gunakan browser yang mendukung kamera pada HTTPS atau localhost.");
 const video=el("camera");video.classList.remove("hidden");el("stopScan").classList.remove("hidden");
 navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false}).then(stream=>{
 cameraStream=stream;video.srcObject=stream;video.play();
 const canvas=el("scanCanvas"),ctx=canvas.getContext("2d",{willReadFrequently:true});
 function tick(){
  if(!cameraStream)return;
  if(video.readyState===video.HAVE_ENOUGH_DATA){
   canvas.width=video.videoWidth;canvas.height=video.videoHeight;ctx.drawImage(video,0,0,canvas.width,canvas.height);
   const image=ctx.getImageData(0,0,canvas.width,canvas.height);
   const code=jsQR(image.data,image.width,image.height,{inversionAttempts:"dontInvert"});
   if(code){try{const obj=JSON.parse(code.data);if(obj.app==="CEKKARYAWAN_OFFLINE"&&obj.token){stopScan();handleScanned(obj.token);return}}catch(e){}}
  }
  scanTimer=requestAnimationFrame(tick);
 }
 tick();
 }).catch(e=>{stopScan();alert("Kamera gagal dibuka: "+e.message)});
}
function stopScan(){if(scanTimer)cancelAnimationFrame(scanTimer);scanTimer=null;if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}el("camera").classList.add("hidden");el("stopScan").classList.add("hidden")}
function handleScanned(token){
 const e=db.employees.find(x=>x.token===token);
 if(!e)return alert("QR tidak terdaftar pada perangkat ini.");
 if(e.status==="Nonaktif")return alert("Akun karyawan sedang dinonaktifkan HRD.");
 scannedEmployee=e;
 el("employeeLoginBox").classList.remove("hidden");
 el("scanInfo").textContent=e.nama+" • "+e.id;
 if(!e.active){el("scanTitle").textContent="Aktivasi Akun Karyawan";el("activationFields").classList.remove("hidden");el("employeeLoginFields").classList.add("hidden")}
 else{el("scanTitle").textContent="Login Karyawan";el("activationFields").classList.add("hidden");el("employeeLoginFields").classList.remove("hidden")}
}
async function activateEmployee(){
 if(!scannedEmployee)return;
 const activation=el("activationPin").value.trim(),p=el("newEmployeePin").value.trim(),r=el("repeatEmployeePin").value.trim();
 if(!/^\d{6,12}$/.test(p))return alert("PIN pribadi harus 6–12 angka.");
 if(p!==r)return alert("Konfirmasi PIN tidak sama.");
 try{
  if(await hashPin(activation)!==scannedEmployee.activationHash)return alert("PIN aktivasi salah.");
  scannedEmployee.pinHash=await hashPin(p);scannedEmployee.active=true;scannedEmployee.activationHash=null;save();
  ["activationPin","newEmployeePin","repeatEmployeePin"].forEach(x=>el(x).value="");
  alert("Aktivasi berhasil. Silakan scan QR kembali untuk login.");el("employeeLoginBox").classList.add("hidden");scannedEmployee=null;
 }catch(e){alert(e.message)}
}
async function employeeLogin(){
 if(!scannedEmployee)return;
 try{if(await hashPin(el("employeePin").value.trim())!==scannedEmployee.pinHash)return alert("PIN karyawan salah.");currentEmployee=scannedEmployee;el("employeePin").value="";renderEmployee();show("employeeScreen")}catch(e){alert(e.message)}
}
function renderEmployee(){
 const e=currentEmployee;if(!e)return;
 el("employeeWelcome").textContent="Halo, "+e.nama;
 el("employeeProfile").innerHTML=`ID: ${safe(e.id)}<br>Jabatan: ${safe(e.jabatan||"-")}<br>Divisi: ${safe(e.divisi||"-")}`;
 const mine=db.attendance.filter(x=>x.employeeId===e.id);
 const leaves=db.leaves.filter(x=>x.employeeId===e.id);
 el("myAttendance").textContent=mine.length;el("myLeaves").textContent=leaves.length;
 const todayRow=mine.find(x=>x.tanggal===today());
 el("todayAttendance").textContent=todayRow?`Tanggal ${todayRow.tanggal} • Masuk ${todayRow.masuk||"-"} • Pulang ${todayRow.pulang||"-"}`:"Belum ada absensi hari ini.";
 el("myLeaveList").innerHTML=leaves.length?[...leaves].reverse().map(x=>`<div class="item"><b>${safe(x.jenis)}</b><br>${safe(x.mulai)} s/d ${safe(x.selesai)}<br>${safe(x.alasan)}<br><span class="status ${x.status==="Disetujui"?"ok":x.status==="Ditolak"?"no":""}">${safe(x.status)}</span></div>`).join(""):"<p class='muted'>Belum ada pengajuan.</p>";
 el("myAttendanceList").innerHTML=mine.length?[...mine].reverse().map(x=>`<div class="item">${safe(x.tanggal)} • Masuk ${safe(x.masuk||"-")} • Pulang ${safe(x.pulang||"-")}</div>`).join(""):"<p class='muted'>Belum ada riwayat absensi.</p>";
}
function markAttendance(type){
 const e=currentEmployee;if(!e)return;
 let row=db.attendance.find(x=>x.employeeId===e.id&&x.tanggal===today());
 if(!row){row={employeeId:e.id,tanggal:today(),masuk:"",pulang:""};db.attendance.push(row)}
 if(type==="Masuk"){if(row.masuk)return alert("Absensi masuk hari ini sudah tercatat.");row.masuk=timeNow()}
 else{if(!row.masuk)return alert("Absen masuk terlebih dahulu.");if(row.pulang)return alert("Absensi pulang sudah tercatat.");row.pulang=timeNow()}
 save();renderEmployee();alert("Absensi "+type+" berhasil disimpan.");
}
function submitLeave(){
 const jenis=el("leaveType").value,mulai=el("leaveStart").value,selesai=el("leaveEnd").value,alasan=el("leaveReason").value.trim();
 if(!mulai||!selesai||!alasan)return alert("Lengkapi semua data pengajuan.");
 if(selesai<mulai)return alert("Tanggal selesai tidak boleh sebelum tanggal mulai.");
 db.leaves.push({id:randomToken().slice(0,16),employeeId:currentEmployee.id,jenis,mulai,selesai,alasan,status:"Menunggu",createdAt:new Date().toISOString()});
 save();el("leaveReason").value="";renderEmployee();alert("Pengajuan tersimpan. Menunggu pemeriksaan HRD pada perangkat ini.");
}
function exportBackup(){
 const blob=new Blob([JSON.stringify(db,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download="backup_portal_karyawan.json";a.click();URL.revokeObjectURL(url);
}
async function importBackup(){
 const f=el("backupFile").files[0];if(!f)return alert("Pilih file backup JSON.");
 try{const obj=JSON.parse(await f.text());if(!obj||!Array.isArray(obj.employees)||!Array.isArray(obj.leaves)||!Array.isArray(obj.attendance))throw Error("Format backup tidak sesuai.");
 if(!confirm("Impor akan mengganti seluruh data pada perangkat ini. Lanjutkan?"))return;
 db=obj;save();alert("Backup berhasil dipulihkan.");renderAdmin();
 }catch(e){alert("Gagal impor: "+e.message)}
}
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}))}
init();
