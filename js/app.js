/* Bitácora de apoyo — lógica principal (HTML/JS puro + Supabase) */
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const GRADOS = ["Preescolar", "Primer grado", "Segundo grado", "Tercer grado", "Cuarto grado",
  "Quinto grado", "Sexto grado", "Séptimo grado", "Octavo grado", "Noveno grado"];
const TIPOS = ["Lectura", "Escritura", "Comprensión lectora", "Vocabulario",
  "Comunicación oral", "Regulación emocional", "Habilidades sociales", "Otro"];
const ESTADOS = ["Tranquilo", "Motivado", "Ansioso", "Frustrado", "Desregulado / llorando", "Cansado", "Otro"];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const hoyLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtFecha = f => { if (!f) return ""; const [y, m, d] = f.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("es-HN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }); };
const opts = (arr, sel, vacio) => (vacio ? `<option value="">${esc(vacio)}</option>` : "") + arr.map(x => `<option ${x === sel ? "selected" : ""}>${esc(x)}</option>`).join("");

const state = { user: null, ninos: [], view: "grabar" };

function toast(msg, ms = 3200) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}

/* ============ AUTH ============ */
async function init() {
  const { data } = await sb.auth.getSession();
  await onSession(data.session);
  sb.auth.onAuthStateChange((_e, session) => { if ((session?.user?.id || null) !== (state.user?.id || null)) onSession(session); });
}

async function onSession(session) {
  state.user = session?.user || null;
  $("#login").classList.toggle("hidden", !!state.user);
  $("#app").classList.toggle("hidden", !state.user);
  if (state.user) { await cargarNinos(); go(state.view); }
}

$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("#loginMsg").textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email: $("#loginEmail").value.trim(), password: $("#loginPass").value });
  if (error) $("#loginMsg").textContent = (error.status === 400 || /invalid login/i.test(error.message || ""))
    ? "Correo o contraseña incorrectos."
    : "No se pudo conectar con el servidor. Revisa tu internet e inténtalo otra vez.";
});
$("#btnSalir").addEventListener("click", () => sb.auth.signOut());

/* ============ NAVEGACIÓN ============ */
$$(".tab").forEach(b => b.addEventListener("click", () => go(b.dataset.view)));
function go(view, arg) {
  if (Rec.activo) detener();
  state.view = view;
  $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  if (view === "grabar") vistaGrabar();
  else if (view === "ninos") vistaNinos();
  else if (view === "ficha") vistaFicha(arg);
  else if (view === "resumen") vistaResumen(arg);
  window.scrollTo(0, 0);
}

async function cargarNinos() {
  const { data, error } = await sb.from("ninos").select("*").order("alias");
  if (error) { toast("No se pudieron cargar los niños"); return; }
  state.ninos = data || [];
}
const ninoPorId = id => state.ninos.find(n => n.id === id);

/* ============ GRABAR ============ */
const Rec = { activo: false, recog: null, mr: null, stream: null, chunks: [], blob: null, ext: "m4a", mime: "" };

function vistaGrabar() {
  $("#main").innerHTML = `
    <h2>Nuevo registro</h2>
    <div class="card">
      <div class="rec-zone">
        <button id="mic" class="mic" aria-label="Grabar">🎙️</button>
        <div id="recStatus" class="rec-status">Toca el micrófono y di, por ejemplo: “J.R., cuarto grado, hoy trabajamos…”</div>
        <label class="check" style="justify-content:center;margin:6px 0 0"><input type="checkbox" id="chkAudio" checked> Guardar también el audio</label>
        <div class="hint">Si el dictado falla en el iPad, desmarca “Guardar audio” e inténtalo de nuevo.</div>
      </div>
    </div>

    <div class="card">
      <label>Texto dictado (puedes corregirlo o escribirlo)
        <textarea id="texto" placeholder="Aquí aparece lo que dices…"></textarea>
      </label>
      <div class="actions">
        <button id="btnAnalizar" class="btn primary">✨ Ordenar con IA</button>
        <button id="btnLimpiar" class="btn ghost">Limpiar</button>
      </div>
      <p class="hint" style="margin-bottom:0">Usa iniciales o apodos al dictar, no nombres completos.</p>
    </div>

    <div class="card">
      <h3>Datos del registro</h3>
      <div class="row">
        <label>Niño
          <select id="fNino"></select>
        </label>
        <label id="fExtraWrap" class="hidden"><span id="fExtraLbl">Nombre / iniciales</span>
          <input id="fExtra" type="text">
        </label>
        <label>Grado
          <select id="fGrado">${opts(GRADOS, "", "—")}</select>
        </label>
        <label>Fecha
          <input id="fFecha" type="date" value="${hoyLocal()}">
        </label>
        <label>Tipo de actividad
          <select id="fTipo">${opts(TIPOS, "", "—")}</select>
        </label>
        <label>Estado emocional
          <select id="fEstado">${opts(ESTADOS, "", "—")}</select>
        </label>
      </div>
      <label>Actividad realizada
        <textarea id="fActividad" placeholder="Qué se hizo con el niño…"></textarea>
      </label>
      <label class="check"><input type="checkbox" id="fSeg"> Requiere seguimiento</label>
      <label id="fSegWrap" class="hidden">Qué queda pendiente
        <input id="fSegNota" type="text">
      </label>
      <div class="actions">
        <button id="btnGuardar" class="btn primary">💾 Guardar registro</button>
      </div>
    </div>`;

  poblarSelectNino();
  $("#fNino").addEventListener("change", actualizarExtra);
  $("#fSeg").addEventListener("change", () => $("#fSegWrap").classList.toggle("hidden", !$("#fSeg").checked));
  $("#mic").addEventListener("click", () => (Rec.activo ? detener() : iniciar()));
  $("#btnAnalizar").addEventListener("click", analizar);
  $("#btnLimpiar").addEventListener("click", () => { $("#texto").value = ""; Rec.blob = null; Rec.chunks = []; });
  $("#btnGuardar").addEventListener("click", guardar);
}

function poblarSelectNino(sel = "") {
  const activos = state.ninos.filter(n => n.activo);
  $("#fNino").innerHTML = `<option value="">— Elegir —</option>` +
    activos.map(n => `<option value="${n.id}" ${n.id === sel ? "selected" : ""}>${esc(n.alias)}${n.grado ? " · " + esc(n.grado) : ""}</option>`).join("") +
    `<option value="__nuevo__" ${sel === "__nuevo__" ? "selected" : ""}>＋ Niño nuevo…</option>` +
    `<option value="__grupo__" ${sel === "__grupo__" ? "selected" : ""}>👥 Grupo / varios niños</option>`;
  actualizarExtra();
}
function actualizarExtra() {
  const v = $("#fNino").value;
  $("#fExtraWrap").classList.toggle("hidden", v !== "__nuevo__" && v !== "__grupo__");
  $("#fExtraLbl").textContent = v === "__grupo__" ? "Descripción del grupo (ej. Tercer grado)" : "Iniciales o apodo del niño nuevo";
  if (v && v !== "__nuevo__" && v !== "__grupo__") {
    const n = ninoPorId(v); if (n?.grado && !$("#fGrado").value) $("#fGrado").value = n.grado;
  }
}

function aviso(msg) { const s = $("#recStatus"); if (s) s.textContent = msg; }

async function iniciar() {
  Rec.chunks = []; Rec.blob = null; Rec.activo = true;
  $("#mic").classList.add("on"); $("#mic").textContent = "⏹️";
  aviso("Escuchando… habla con calma, en bloques cortos.");

  if ($("#chkAudio").checked) {
    try {
      Rec.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
      Rec.mr = new MediaRecorder(Rec.stream, mime ? { mimeType: mime } : undefined);
      Rec.mime = Rec.mr.mimeType || "audio/mp4";
      Rec.ext = Rec.mime.includes("mp4") ? "m4a" : "webm";
      Rec.mr.ondataavailable = e => { if (e.data.size) Rec.chunks.push(e.data); };
      Rec.mr.onstop = () => { Rec.blob = new Blob(Rec.chunks, { type: Rec.mime }); };
      Rec.mr.start();
    } catch (e) {
      Rec.mr = null;
      aviso("No pude guardar el audio (solo dictado). Revisa el permiso del micrófono.");
    }
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { aviso("Este navegador no tiene dictado. Escribe el texto a mano."); return; }
  lanzarDictado(SR);
}

function lanzarDictado(SR) {
  const r = new SR();
  r.lang = "es-419"; r.continuous = true; r.interimResults = true;
  let base = $("#texto").value.trim();
  // Chrome en Android reenvía frases acumuladas: se reconstruye todo desde cero
  // en cada evento y se reemplaza (no se agrega) si un resultado extiende al anterior.
  r.onresult = e => {
    const partes = [];
    for (let i = 0; i < e.results.length; i++) {
      const t = e.results[i][0].transcript.trim();
      if (!t) continue;
      const ult = partes[partes.length - 1];
      if (ult !== undefined && norm(t).startsWith(norm(ult))) partes[partes.length - 1] = t;
      else if (ult !== undefined && norm(ult).startsWith(norm(t))) continue;
      else partes.push(t);
    }
    $("#texto").value = (base ? base + " " : "") + partes.join(" ");
    aviso("Escuchando…");
  };
  r.onstart = () => aviso("Conectando con el dictado…");
  r.onaudiostart = () => aviso("Micrófono activo. Di algo…");
  r.onspeechstart = () => aviso("Te escucho…");
  r.onnomatch = () => aviso("No entendí. Intenta hablar más cerca y más despacio.");
  r.onerror = e => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      aviso("El micrófono o el dictado está bloqueado. Revisa el permiso del sitio en el navegador."); detener();
    } else if (e.error === "audio-capture") {
      aviso("No encuentro el micrófono. Cierra otras apps que lo estén usando."); detener();
    } else if (e.error === "network") {
      aviso("El dictado necesita internet. Revisa tu conexión.");
    } else if (e.error !== "no-speech" && e.error !== "aborted") {
      aviso("Dictado: " + e.error);
    }
  };
  r.onend = () => {
    if (!Rec.activo) return;
    base = $("#texto").value.trim();   // al reiniciar, los resultados vuelven a cero
    setTimeout(() => {
      if (!Rec.activo) return;
      try { r.start(); } catch (_) { lanzarDictado(SR); }
    }, 300);
  };
  try { r.start(); } catch (_) { }
  Rec.recog = r;
}

function detener() {
  Rec.activo = false;
  try { Rec.recog?.stop(); } catch (_) { }
  try { if (Rec.mr && Rec.mr.state !== "inactive") Rec.mr.stop(); } catch (_) { }
  Rec.stream?.getTracks().forEach(t => t.stop());
  Rec.recog = null; Rec.stream = null;
  const mic = $("#mic"); if (mic) { mic.classList.remove("on"); mic.textContent = "🎙️"; }
  aviso("Listo. Revisa el texto y toca “Ordenar con IA”.");
}

/* ---- análisis ---- */
function analisisLocal(texto) {
  const t = norm(texto);
  const out = { nombre: null, grupo: null, grado: null, fecha: hoyLocal(), tipo_actividad: null, actividad: texto, estado_emocional: null, seguimiento: false, seguimiento_nota: null };
  const n = state.ninos.find(n => t.includes(norm(n.alias)));
  if (n) out.nombre = n.alias;
  const g = [["primer", "Primer grado"], ["segundo", "Segundo grado"], ["tercer", "Tercer grado"], ["cuarto", "Cuarto grado"],
    ["quinto", "Quinto grado"], ["sexto", "Sexto grado"], ["septimo", "Séptimo grado"], ["octavo", "Octavo grado"], ["noveno", "Noveno grado"]]
    .find(([k]) => new RegExp(k + "\\s+grado").test(t));
  if (g) out.grado = g[1];
  const tipos = [["lectura", "Lectura"], ["escrit", "Escritura"], ["comprens", "Comprensión lectora"], ["vocabulario", "Vocabulario"], ["oral", "Comunicación oral"]];
  const tp = tipos.find(([k]) => t.includes(k)); if (tp) out.tipo_actividad = tp[1];
  if (/llor|desreg|crisis/.test(t)) out.estado_emocional = "Desregulado / llorando";
  else if (/frustr/.test(t)) out.estado_emocional = "Frustrado";
  else if (/ansios|nervios/.test(t)) out.estado_emocional = "Ansioso";
  else if (/motivad|contento|animado/.test(t)) out.estado_emocional = "Motivado";
  else if (/tranquil|calmad/.test(t)) out.estado_emocional = "Tranquilo";
  if (/pendiente|seguimiento|retomar|volver a/.test(t)) out.seguimiento = true;
  if (!n && /(varios|grupo|ninos de)/.test(t)) out.grupo = g ? g[1] : "Grupo";
  return out;
}

async function analizar() {
  if (Rec.activo) detener();
  const texto = $("#texto").value.trim();
  if (!texto) { toast("Primero dicta o escribe algo."); return; }
  const btn = $("#btnAnalizar"); btn.disabled = true; btn.textContent = "Ordenando…";
  let datos;
  try {
    const { data, error } = await sb.functions.invoke("extraer", { body: { texto, ninos: state.ninos.map(n => n.alias), hoy: hoyLocal() } });
    if (error || !data || data.error) throw error || new Error(data?.error);
    datos = data;
  } catch (e) {
    datos = analisisLocal(texto);
    toast("La IA no respondió; usé reglas simples. Revisa los datos.", 4500);
  }
  rellenar(datos, texto);
  btn.disabled = false; btn.textContent = "✨ Ordenar con IA";
}

function rellenar(d, texto) {
  const match = d.nombre ? state.ninos.find(n => norm(n.alias) === norm(d.nombre)) : null;
  if (match) { poblarSelectNino(match.id); }
  else if (d.nombre) { poblarSelectNino("__nuevo__"); $("#fExtra").value = d.nombre; }
  else if (d.grupo) { poblarSelectNino("__grupo__"); $("#fExtra").value = d.grupo; }
  else poblarSelectNino("");
  const setSel = (id, v, lista) => { $(id).value = lista.includes(v) ? v : ""; };
  setSel("#fGrado", d.grado, GRADOS);
  if (!$("#fGrado").value && match?.grado) $("#fGrado").value = match.grado;
  setSel("#fTipo", d.tipo_actividad, TIPOS);
  setSel("#fEstado", d.estado_emocional, ESTADOS);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d.fecha || "")) $("#fFecha").value = d.fecha;
  $("#fActividad").value = d.actividad || texto;
  $("#fSeg").checked = !!d.seguimiento;
  $("#fSegWrap").classList.toggle("hidden", !d.seguimiento);
  $("#fSegNota").value = d.seguimiento_nota || "";
  $("#fActividad").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function guardar() {
  if (Rec.activo) detener();
  const btn = $("#btnGuardar");
  const actividad = $("#fActividad").value.trim();
  const sel = $("#fNino").value;
  const extra = $("#fExtra").value.trim();
  if (!actividad) { toast("Falta describir la actividad."); return; }
  if (!sel) { toast("Elige un niño o un grupo."); return; }
  if ((sel === "__nuevo__" || sel === "__grupo__") && !extra) { toast("Escribe el nombre o el grupo."); return; }
  btn.disabled = true; btn.textContent = "Guardando…";

  try {
    let nino_id = null, grupo = null;
    if (sel === "__nuevo__") {
      const { data, error } = await sb.from("ninos").insert({ alias: extra, grado: $("#fGrado").value || null }).select().single();
      if (error) throw error;
      nino_id = data.id; await cargarNinos();
    } else if (sel === "__grupo__") grupo = extra;
    else nino_id = sel;

    let audio_path = null;
    if (Rec.blob && $("#chkAudio").checked) {
      audio_path = `${state.user.id}/${Date.now()}.${Rec.ext}`;
      const { error } = await sb.storage.from("audios").upload(audio_path, Rec.blob, { contentType: Rec.mime || "audio/mp4" });
      if (error) { audio_path = null; toast("Guardé el registro, pero el audio no se pudo subir."); }
    }

    const { error } = await sb.from("registros").insert({
      nino_id, grupo, grado: $("#fGrado").value || null, fecha: $("#fFecha").value || hoyLocal(),
      tipo_actividad: $("#fTipo").value || null, actividad, estado_emocional: $("#fEstado").value || null,
      seguimiento: $("#fSeg").checked, seguimiento_nota: $("#fSegNota").value.trim() || null,
      transcripcion: $("#texto").value.trim() || null, audio_path,
    });
    if (error) throw error;
    Rec.blob = null; Rec.chunks = [];
    toast("✅ Registro guardado");
    vistaGrabar();
  } catch (e) {
    console.error(e);
    toast("No se pudo guardar: " + (e.message || "error"), 5000);
    btn.disabled = false; btn.textContent = "💾 Guardar registro";
  }
}

/* ============ NIÑOS ============ */
async function vistaNinos() {
  $("#main").innerHTML = `<h2>Niños</h2><p class="muted">Cargando…</p>`;
  const { data: regs } = await sb.from("registros").select("nino_id,fecha,seguimiento,seguimiento_hecho");
  const stats = {};
  (regs || []).forEach(r => {
    if (!r.nino_id) return;
    const s = stats[r.nino_id] ||= { n: 0, ult: "", pend: 0 };
    s.n++; if (r.fecha > s.ult) s.ult = r.fecha;
    if (r.seguimiento && !r.seguimiento_hecho) s.pend++;
  });
  const lista = state.ninos;
  $("#main").innerHTML = `
    <h2>Niños</h2>
    <div class="card">
      <h3>Agregar niño</h3>
      <div class="row">
        <label>Iniciales o apodo<input id="nAlias" type="text" placeholder="Ej. J.R."></label>
        <label>Grado<select id="nGrado">${opts(GRADOS, "", "—")}</select></label>
      </div>
      <button id="nAdd" class="btn primary">Agregar</button>
    </div>
    <div class="grid">
      ${lista.map(n => {
        const s = stats[n.id] || { n: 0, ult: "", pend: 0 };
        return `<div class="card nino" data-id="${n.id}" style="${n.activo ? "" : "opacity:.55"}">
          <div class="avatar">${esc(n.alias.slice(0, 2).toUpperCase())}</div>
          <h3>${esc(n.alias)}</h3>
          <div class="muted">${esc(n.grado || "Sin grado")}</div>
          <div style="margin-top:8px">
            <span class="pill">${s.n} registro${s.n === 1 ? "" : "s"}</span>
            ${s.pend ? `<span class="pill warn">${s.pend} pendiente${s.pend === 1 ? "" : "s"}</span>` : ""}
            ${s.ult ? `<div class="hint" style="margin-top:6px">Último: ${fmtFecha(s.ult)}</div>` : ""}
          </div></div>`;
      }).join("") || `<p class="muted">Aún no hay niños. Agrega uno arriba o guarda un registro y se crea solo.</p>`}
    </div>`;
  $("#nAdd").addEventListener("click", async () => {
    const alias = $("#nAlias").value.trim(); if (!alias) { toast("Escribe las iniciales o el apodo."); return; }
    const { error } = await sb.from("ninos").insert({ alias, grado: $("#nGrado").value || null });
    if (error) { toast("No se pudo agregar."); return; }
    await cargarNinos(); toast("Niño agregado"); vistaNinos();
  });
  $$(".nino").forEach(c => c.addEventListener("click", () => go("ficha", c.dataset.id)));
}

/* ============ FICHA ============ */
async function vistaFicha(id) {
  const n = ninoPorId(id); if (!n) return go("ninos");
  $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.view === "ninos"));
  $("#main").innerHTML = `<p class="muted">Cargando…</p>`;
  const { data: regs, error } = await sb.from("registros").select("*").eq("nino_id", id).order("fecha", { ascending: false }).order("created_at", { ascending: false });
  if (error) { toast("No se pudieron cargar los registros"); return; }
  $("#main").innerHTML = `
    <button class="btn ghost small no-print" id="back">← Niños</button>
    <div class="card" style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
        <div><h2 style="margin:0">${esc(n.alias)}</h2><div class="muted">${esc(n.grado || "Sin grado")}</div></div>
        <div class="actions no-print">
          <button id="verResumen" class="btn primary small">📊 Ver resumen</button>
          <button id="editNino" class="btn small">Editar</button>
          <button id="archNino" class="btn ghost small">${n.activo ? "Archivar" : "Reactivar"}</button>
        </div>
      </div>
      ${n.notas ? `<p>${esc(n.notas)}</p>` : ""}
    </div>
    <h3>Línea de tiempo (${regs.length})</h3>
    <div class="timeline">${regs.map(entradaHTML).join("") || `<p class="muted">Sin registros todavía.</p>`}</div>`;
  $("#back").addEventListener("click", () => go("ninos"));
  $("#verResumen").addEventListener("click", () => go("resumen", id));
  $("#editNino").addEventListener("click", async () => {
    const alias = prompt("Iniciales o apodo:", n.alias); if (alias === null) return;
    const grado = prompt("Grado (ej. Cuarto grado):", n.grado || ""); if (grado === null) return;
    const notas = prompt("Notas generales (opcional):", n.notas || ""); if (notas === null) return;
    const { error } = await sb.from("ninos").update({ alias: alias.trim() || n.alias, grado: grado.trim() || null, notas: notas.trim() || null }).eq("id", id);
    if (error) { toast("No se pudo editar."); return; }
    await cargarNinos(); vistaFicha(id);
  });
  $("#archNino").addEventListener("click", async () => {
    await sb.from("ninos").update({ activo: !n.activo }).eq("id", id); await cargarNinos(); vistaFicha(id);
  });
  enlazarEntradas(() => vistaFicha(id));
}

function entradaHTML(r) {
  const quien = r.nino_id ? (ninoPorId(r.nino_id)?.alias || "") : (r.grupo ? "👥 " + r.grupo : "");
  return `<div class="card entry" data-id="${r.id}" data-audio="${esc(r.audio_path || "")}">
    <div class="date">${fmtFecha(r.fecha)}${quien ? " · " + esc(quien) : ""}</div>
    <div>${esc(r.actividad)}</div>
    <div style="margin-top:8px">
      ${r.tipo_actividad ? `<span class="pill">${esc(r.tipo_actividad)}</span>` : ""}
      ${r.estado_emocional ? `<span class="pill accent">${esc(r.estado_emocional)}</span>` : ""}
      ${r.grado ? `<span class="pill">${esc(r.grado)}</span>` : ""}
      ${r.seguimiento ? `<span class="pill ${r.seguimiento_hecho ? "" : "warn"}">${r.seguimiento_hecho ? "✔ Seguimiento hecho" : "Seguimiento pendiente"}${r.seguimiento_nota ? ": " + esc(r.seguimiento_nota) : ""}</span>` : ""}
    </div>
    <div class="actions no-print" style="margin-top:10px">
      ${r.audio_path ? `<button class="btn small" data-act="audio">▶ Escuchar audio</button>` : ""}
      ${r.seguimiento && !r.seguimiento_hecho ? `<button class="btn small" data-act="hecho">Marcar seguimiento hecho</button>` : ""}
      <button class="btn danger small" data-act="borrar">Borrar</button>
    </div>
    <div class="audio-slot"></div>
  </div>`;
}

function enlazarEntradas(refrescar) {
  $$(".entry").forEach(el => {
    const id = el.dataset.id;
    el.addEventListener("click", async ev => {
      const act = ev.target.dataset?.act; if (!act) return;
      if (act === "audio") {
        const { data, error } = await sb.storage.from("audios").createSignedUrl(el.dataset.audio, 3600);
        if (error) { toast("No se pudo abrir el audio."); return; }
        $(".audio-slot", el).innerHTML = `<audio controls autoplay src="${data.signedUrl}"></audio>`;
      } else if (act === "hecho") {
        await sb.from("registros").update({ seguimiento_hecho: true }).eq("id", id); refrescar();
      } else if (act === "borrar") {
        if (!confirm("¿Borrar este registro? No se puede deshacer.")) return;
        if (el.dataset.audio) await sb.storage.from("audios").remove([el.dataset.audio]);
        await sb.from("registros").delete().eq("id", id); toast("Registro borrado"); refrescar();
      }
    });
  });
}

/* ============ RESUMEN ============ */
async function vistaResumen(ninoId) {
  const f = state.filtros = state.filtros || {};
  if (ninoId) f.nino = ninoId;
  if (!f.desde) { const d = new Date(); d.setMonth(d.getMonth() - 3); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); f.desde = d.toISOString().slice(0, 10); }
  if (!f.hasta) f.hasta = hoyLocal();
  f.nino = f.nino || ""; f.grado = f.grado || ""; f.tipo = f.tipo || "";

  $("#main").innerHTML = `
    <h2>Resumen</h2>
    <div class="card no-print">
      <div class="row">
        <label>Niño<select id="rNino"><option value="">Todos</option>${state.ninos.map(n => `<option value="${n.id}" ${n.id === f.nino ? "selected" : ""}>${esc(n.alias)}</option>`).join("")}</select></label>
        <label>Grado<select id="rGrado">${opts(GRADOS, f.grado, "Todos")}</select></label>
        <label>Tipo<select id="rTipo">${opts(TIPOS, f.tipo, "Todos")}</select></label>
        <label>Desde<input id="rDesde" type="date" value="${f.desde}"></label>
        <label>Hasta<input id="rHasta" type="date" value="${f.hasta}"></label>
      </div>
      <div class="actions">
        <button id="rAplicar" class="btn primary">Aplicar</button>
        <button id="rImprimir" class="btn">🖨️ Imprimir / PDF</button>
      </div>
    </div>
    <div id="rCuerpo"><p class="muted">Cargando…</p></div>`;
  $("#rAplicar").addEventListener("click", () => {
    Object.assign(f, { nino: $("#rNino").value, grado: $("#rGrado").value, tipo: $("#rTipo").value, desde: $("#rDesde").value, hasta: $("#rHasta").value });
    vistaResumen();
  });
  $("#rImprimir").addEventListener("click", () => window.print());

  let q = sb.from("registros").select("*").gte("fecha", f.desde).lte("fecha", f.hasta).order("fecha", { ascending: false }).order("created_at", { ascending: false });
  if (f.nino) q = q.eq("nino_id", f.nino);
  if (f.grado) q = q.eq("grado", f.grado);
  if (f.tipo) q = q.eq("tipo_actividad", f.tipo);
  const { data: regs, error } = await q;
  if (error) { $("#rCuerpo").innerHTML = `<p class="muted">No se pudo cargar.</p>`; return; }

  const conteo = (campo) => { const m = {}; regs.forEach(r => { if (r[campo]) m[r[campo]] = (m[r[campo]] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const barras = (lista, alt) => { const max = Math.max(1, ...lista.map(x => x[1])); return lista.map(([k, v]) => `<div class="bar ${alt ? "alt" : ""}"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${(v / max) * 100}%"></div></div><b>${v}</b></div>`).join("") || `<p class="muted">Sin datos.</p>`; };
  const ninosAtendidos = new Set(regs.filter(r => r.nino_id).map(r => r.nino_id)).size;
  const pendientes = regs.filter(r => r.seguimiento && !r.seguimiento_hecho).length;
  const titulo = f.nino ? `Avance de ${esc(ninoPorId(f.nino)?.alias || "")}` : "Resumen general";

  $("#rCuerpo").innerHTML = `
    <h3>${titulo} · ${fmtFecha(f.desde)} – ${fmtFecha(f.hasta)}</h3>
    <div class="stats">
      <div class="stat"><b>${regs.length}</b>Registros</div>
      <div class="stat"><b>${ninosAtendidos}</b>Niños atendidos</div>
      <div class="stat"><b>${regs.filter(r => r.audio_path).length}</b>Con audio</div>
      <div class="stat"><b>${pendientes}</b>Seguimientos pendientes</div>
    </div>
    <div class="row">
      <div class="card"><h3>Tipos de actividad</h3><div class="bars">${barras(conteo("tipo_actividad"))}</div></div>
      <div class="card"><h3>Estado emocional</h3><div class="bars">${barras(conteo("estado_emocional"), true)}</div></div>
    </div>
    <h3>Detalle</h3>
    <div class="timeline">${regs.map(entradaHTML).join("") || `<p class="muted">No hay registros con estos filtros.</p>`}</div>`;
  enlazarEntradas(() => vistaResumen());
}

init();
