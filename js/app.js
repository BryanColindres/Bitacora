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
const gradoTxt = (g, sec) => [g, sec ? "sección " + sec : ""].filter(Boolean).join(" · ");
const claveNombre = s => norm(s).replace(/[^a-z0-9]/g, "");
const dePartic = r => [...(r.nino_id ? [r.nino_id] : []), ...(r.nino_ids || [])];
const filtroNino = id => `nino_id.eq.${id},nino_ids.cs.{${id}}`;
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
        <div id="recStatus" class="rec-status">Toca el micrófono, habla y vuelve a tocar para terminar. Ej.: “J.R., cuarto grado, hoy trabajamos…”</div>
        <div id="audioListo" class="audio-listo hidden"></div>
        <label class="check" style="justify-content:center;margin:6px 0 0"><input type="checkbox" id="chkAudio" checked> Grabar audio (la IA lo transcribe y lo guarda)</label>
        <div class="hint">Recomendado. Si lo desmarcas se usa el dictado del navegador, que depende del dispositivo.</div>
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
        <label>Sección
          <input id="fSeccion" type="text" maxlength="12" placeholder="Ej. B" autocomplete="off">
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
  $("#btnLimpiar").addEventListener("click", () => { $("#texto").value = ""; descartarAudio(); });
  $("#btnGuardar").addEventListener("click", guardar);
}

function poblarSelectNino(sel = "") {
  $("#fNino").innerHTML = `<option value="">— Elegir —</option>` +
    state.ninos.map(n => `<option value="${n.id}" ${n.id === sel ? "selected" : ""}>${esc(n.alias)}${gradoTxt(n.grado, n.seccion) ? " · " + esc(gradoTxt(n.grado, n.seccion)) : ""}</option>`).join("") +
    `<option value="__nuevo__" ${sel === "__nuevo__" ? "selected" : ""}>＋ Niño nuevo…</option>` +
    `<option value="__grupo__" ${sel === "__grupo__" ? "selected" : ""}>👥 Grupal (varios niños)</option>`;
  actualizarExtra();
}
function actualizarExtra() {
  const v = $("#fNino").value;
  $("#fExtraWrap").classList.toggle("hidden", v !== "__nuevo__" && v !== "__grupo__");
  $("#fExtraLbl").textContent = v === "__grupo__" ? "Niños que participaron (iniciales, separadas por coma). Se guarda también en el libro de cada uno" : "Iniciales o apodo del niño nuevo";
  if (v && v !== "__nuevo__" && v !== "__grupo__") {
    const n = ninoPorId(v);
    if (n?.grado && !$("#fGrado").value) $("#fGrado").value = n.grado;
    if (n?.seccion && !$("#fSeccion").value) $("#fSeccion").value = n.seccion;
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
      Rec.mr.onstop = () => { Rec.blob = new Blob(Rec.chunks, { type: Rec.mime }); mostrarAudioListo(); };
      Rec.mr.start();
    } catch (e) {
      Rec.mr = null;
      aviso("No pude guardar el audio (solo dictado). Revisa el permiso del micrófono.");
    }
  }

  if (Rec.mr) {
    Rec.t0 = Date.now();
    const pinta = () => { const t = Math.round((Date.now() - Rec.t0) / 1000); aviso(`🔴 Grabando… ${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")} · toca el botón para terminar`); };
    pinta(); Rec.tick = setInterval(pinta, 500);
    return;
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

function descartarAudio() {
  Rec.blob = null; Rec.chunks = [];
  if (Rec.url) { URL.revokeObjectURL(Rec.url); Rec.url = null; }
  const box = $("#audioListo"); if (box) { box.classList.add("hidden"); box.innerHTML = ""; }
}

function mostrarAudioListo() {
  const box = $("#audioListo"); if (!box || !Rec.blob) return;
  if (Rec.url) URL.revokeObjectURL(Rec.url);
  Rec.url = URL.createObjectURL(Rec.blob);
  const seg = Math.max(1, Math.round((Date.now() - (Rec.t0 || Date.now())) / 1000));
  box.classList.remove("hidden");
  box.innerHTML = `<div class="audio-listo-t">✅ Audio grabado · ${seg} s</div>
    <audio controls src="${Rec.url}"></audio>
    <button type="button" class="btn ghost small" id="descAudio">Descartar y grabar de nuevo</button>`;
  $("#descAudio").addEventListener("click", () => { descartarAudio(); aviso("Audio descartado."); });
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function detener() {
  clearInterval(Rec.tick);
  const conAudio = !!Rec.mr;
  Rec.activo = false;
  try { Rec.recog?.stop(); } catch (_) { }
  try { if (Rec.mr && Rec.mr.state !== "inactive") Rec.mr.stop(); } catch (_) { }
  Rec.stream?.getTracks().forEach(t => t.stop());
  Rec.recog = null; Rec.stream = null;
  const mic = $("#mic"); if (mic) { mic.classList.remove("on"); mic.textContent = "🎙️"; }
  aviso(conAudio ? "Audio listo. Toca “Ordenar con IA” para transcribir y ordenar." : "Listo. Revisa el texto y toca “Ordenar con IA”.");
}

/* ---- análisis ---- */
// Quita "se trabajó con el niño JC en…" del inicio: ese dato ya va en su campo.
function limpiarActividad(txt) {
  const m = String(txt).match(/^\s*(?:hoy\s+)?(?:se\s+)?(?:trabaj[óo]|trabajamos|trabaj[eé]|hicimos|realiz[oó])\s+(?:con\s+(?:el|la|los|las)?\s*(?:ni[ñn][oa]s?|estudiantes?|alumn[oa]s?)?\s*[^,.;]{1,60}?\s+)?(?:en\s+|sobre\s+)/i);
  if (!m || m[0].length > 90) return txt;
  const r = String(txt).slice(m[0].length).trim();
  return r ? r.charAt(0).toUpperCase() + r.slice(1) : txt;
}


function analisisLocal(texto) {
  const t = norm(texto);
  const out = { nombre: null, grupal: false, participantes: null, seccion: null, grado: null, fecha: hoyLocal(), tipo_actividad: null, actividad: limpiarActividad(texto), estado_emocional: null, seguimiento: false, seguimiento_nota: null };
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
  const sec = t.match(/seccion\s+([a-z0-9]+)/); if (sec) out.seccion = sec[1].toUpperCase();
  if (!n && /(varios|grupal|grupo|ninos de|con los ninos)/.test(t)) out.grupal = true;
  return out;
}

async function analizar() {
  if (Rec.activo) detener();
  const texto = $("#texto").value.trim();
  if (!texto && !Rec.blob) { toast("Primero graba, dicta o escribe algo."); return; }
  const btn = $("#btnAnalizar"); btn.disabled = true; btn.textContent = "Ordenando…";
  let datos;
  try {
    const body = { texto, ninos: state.ninos.map(n => n.alias), hoy: hoyLocal() };
    if (Rec.blob) {
      if (Rec.blob.size > 8 * 1024 * 1024) throw new Error("audio muy largo");
      body.audio = await blobABase64(Rec.blob);
      body.mime = (Rec.mime || "audio/mp4").split(";")[0];
    }
    const { data, error } = await sb.functions.invoke("extraer", { body });
    if (error || !data || data.error) throw new Error(await motivoIA(error, data));
    datos = data;
  } catch (e) {
    const motivo = e.message || "error desconocido";
    aviso("IA: " + motivo);
    if (!texto) {
      toast("La IA no pudo transcribir: " + motivo + ". Escribe la nota y guarda; el audio se guarda igual.", 9000);
      btn.disabled = false; btn.textContent = "✨ Ordenar con IA";
      return;
    }
    datos = analisisLocal(texto);
    toast("La IA no respondió (" + motivo + "). Usé reglas simples; revisa los datos.", 7000);
  }
  rellenar(datos, texto);
  btn.disabled = false; btn.textContent = "✨ Ordenar con IA";
}

function blobABase64(blob) {
  return new Promise((ok, mal) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(",")[1]);
    fr.onerror = () => mal(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function motivoIA(error, data) {
  try {
    if (data?.error) return data.error + (data.detalle ? " — " + String(data.detalle).slice(0, 160) : "");
    const r = error?.context;
    if (r && typeof r.status === "number") {
      if (r.status === 404) return "la función “extraer” no existe todavía en Supabase";
      const j = await r.json().catch(() => null);
      return (j?.error || "error " + r.status) + (j?.detalle ? " — " + String(j.detalle).slice(0, 160) : "");
    }
    if (error?.name === "FunctionsFetchError" || /Failed to send a request/i.test(error?.message || ""))
      return "no se pudo contactar la función “extraer”: casi seguro aún no está creada en Supabase";
    return error?.message || "sin conexión con Supabase";
  } catch (_) { return "error desconocido"; }
}

function rellenar(d, texto) {
  if (d.transcripcion && !$("#texto").value.trim()) { $("#texto").value = d.transcripcion; texto = d.transcripcion; }
  const match = d.nombre ? state.ninos.find(n => norm(n.alias) === norm(d.nombre)) : null;
  if (match) { poblarSelectNino(match.id); }
  else if (d.grupal || d.grupo) { poblarSelectNino("__grupo__"); $("#fExtra").value = d.participantes || ""; }
  else if (d.nombre) { poblarSelectNino("__nuevo__"); $("#fExtra").value = d.nombre; }
  else poblarSelectNino("");
  const setSel = (id, v, lista) => { $(id).value = lista.includes(v) ? v : ""; };
  setSel("#fGrado", d.grado, GRADOS);
  if (!$("#fGrado").value && match?.grado) $("#fGrado").value = match.grado;
  $("#fSeccion").value = d.seccion ? String(d.seccion).replace(/^secci[oó]n\s+/i, "").trim() : (match?.seccion || "");
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
  if (!actividad) { toast(Rec.blob ? "Falta la actividad: toca “Ordenar con IA” o escríbela. El audio se guarda igual." : "Falta describir la actividad."); return; }
  if (!sel) { toast("Elige un niño o un grupo."); return; }
  const grado = $("#fGrado").value || null, seccion = $("#fSeccion").value.trim() || null;
  if (sel === "__nuevo__" && !extra) { toast("Escribe las iniciales o el apodo del niño."); return; }
  if (sel === "__grupo__" && !grado) { toast("Para un registro grupal elige el grado (y la sección si tiene)."); return; }
  btn.disabled = true; btn.textContent = "Guardando…";

  try {
    let nino_id = null, grupo = null, grupal = false, participantes = null, nino_ids = [], creados = [];
    if (sel === "__nuevo__") {
      const { data, error } = await sb.from("ninos").insert({ alias: extra, grado, seccion }).select().single();
      if (error) throw error;
      nino_id = data.id; await cargarNinos();
    } else if (sel === "__grupo__") {
      grupal = true; participantes = extra || null; grupo = "Grupal · " + gradoTxt(grado, seccion);
      const res = await resolverParticipantes(extra, grado, seccion);
      nino_ids = res.ids; creados = res.creados;
    } else nino_id = sel;

    let audio_path = null;
    if (Rec.blob && $("#chkAudio").checked) {
      audio_path = `${state.user.id}/${Date.now()}.${Rec.ext}`;
      const { error } = await sb.storage.from("audios").upload(audio_path, Rec.blob, { contentType: Rec.mime || "audio/mp4" });
      if (error) { audio_path = null; toast("Guardé el registro, pero el audio no se pudo subir."); }
    }

    const { error } = await sb.from("registros").insert({
      nino_id, grupo, grupal, participantes, nino_ids, grado, seccion, fecha: $("#fFecha").value || hoyLocal(),
      tipo_actividad: $("#fTipo").value || null, actividad, estado_emocional: $("#fEstado").value || null,
      seguimiento: $("#fSeg").checked, seguimiento_nota: $("#fSegNota").value.trim() || null,
      transcripcion: $("#texto").value.trim() || null, audio_path,
    });
    if (error) throw error;
    Rec.blob = null; Rec.chunks = [];
    const aviso2 = grupal && nino_ids.length
      ? `✅ Guardado en el libro grupal y en el de ${nino_ids.length} niño${nino_ids.length === 1 ? "" : "s"}${creados.length ? " (nuevos: " + creados.join(", ") + ")" : ""}`
      : (audio_path ? "✅ Registro guardado con su audio" : "✅ Registro guardado");
    toast(aviso2, creados.length ? 6500 : 3200);
    vistaGrabar();
  } catch (e) {
    console.error(e);
    toast("No se pudo guardar: " + (e.message || "error"), 5000);
    btn.disabled = false; btn.textContent = "💾 Guardar registro";
  }
}

/* Relaciona "JC, BA y MR" con los niños registrados; crea los que no existan */
async function resolverParticipantes(texto, grado, seccion) {
  const nombres = [...new Map(String(texto || "").split(/[,;]|\sy\s/i).map(x => x.trim()).filter(Boolean).map(x => [claveNombre(x), x])).values()];
  const ids = [], creados = [];
  for (const nombre of nombres) {
    const k = claveNombre(nombre); if (!k) continue;
    const cand = state.ninos.filter(n => claveNombre(n.alias) === k);
    let n = cand.find(c => (c.grado || "") === (grado || "") && (c.seccion || "") === (seccion || "")) || cand[0];
    if (!n) {
      const { data, error } = await sb.from("ninos").insert({ alias: nombre, grado, seccion }).select().single();
      if (error) throw error;
      n = data; creados.push(nombre);
    }
    if (!ids.includes(n.id)) ids.push(n.id);
  }
  if (creados.length) await cargarNinos();
  return { ids, creados };
}

/* ============ NIÑOS ============ */
async function vistaNinos() {
  $("#main").innerHTML = `<h2>Niños</h2><p class="muted">Cargando…</p>`;
  const { data: regs } = await sb.from("registros").select("nino_id,nino_ids,fecha,seguimiento,seguimiento_hecho");
  const stats = {};
  (regs || []).forEach(r => {
    dePartic(r).forEach(nid => {
      const s = stats[nid] ||= { n: 0, ult: "", pend: 0 };
      s.n++; if (r.fecha > s.ult) s.ult = r.fecha;
      if (r.seguimiento && !r.seguimiento_hecho) s.pend++;
    });
  });
  const lista = state.ninos;
  $("#main").innerHTML = `
    <h2>Niños</h2>
    <div class="card">
      <h3>Agregar niño</h3>
      <div class="row">
        <label>Iniciales o apodo<input id="nAlias" type="text" placeholder="Ej. J.R."></label>
        <label>Grado<select id="nGrado">${opts(GRADOS, "", "—")}</select></label>
        <label>Sección<input id="nSeccion" type="text" maxlength="12" placeholder="Ej. B" autocomplete="off"></label>
      </div>
      <button id="nAdd" class="btn primary">Agregar</button>
    </div>
    <div class="grid">
      ${lista.map(n => {
        const s = stats[n.id] || { n: 0, ult: "", pend: 0 };
        return `<div class="card nino" data-id="${n.id}">
          <div class="avatar">${esc(n.alias.slice(0, 2).toUpperCase())}</div>
          <h3>${esc(n.alias)}</h3>
          <div class="muted">${esc(gradoTxt(n.grado, n.seccion) || "Sin grado")}</div>
          <div style="margin-top:8px">
            <span class="pill">${s.n} registro${s.n === 1 ? "" : "s"}</span>
            ${s.pend ? `<span class="pill warn">${s.pend} pendiente${s.pend === 1 ? "" : "s"}</span>` : ""}
            ${s.ult ? `<div class="hint" style="margin-top:6px">Último: ${fmtFecha(s.ult)}</div>` : ""}
          </div></div>`;
      }).join("") || `<p class="muted">Aún no hay niños. Agrega uno arriba o guarda un registro y se crea solo.</p>`}
    </div>`;
  $("#nAdd").addEventListener("click", async () => {
    const alias = $("#nAlias").value.trim(); if (!alias) { toast("Escribe las iniciales o el apodo."); return; }
    const { error } = await sb.from("ninos").insert({ alias, grado: $("#nGrado").value || null, seccion: $("#nSeccion").value.trim() || null });
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
  const { data: regs, error } = await sb.from("registros").select("*").or(filtroNino(id)).order("fecha", { ascending: false }).order("created_at", { ascending: false });
  if (error) { toast("No se pudieron cargar los registros"); return; }
  $("#main").innerHTML = `
    <button class="btn ghost small no-print" id="back">← Niños</button>
    <div class="card" style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
        <div><h2 style="margin:0">${esc(n.alias)}</h2><div class="muted">${esc(gradoTxt(n.grado, n.seccion) || "Sin grado")}</div></div>
        <div class="actions no-print">
          <button id="verResumen" class="btn primary small">📊 Ver resumen</button>
          <button id="editNino" class="btn small">Editar</button>
          <button id="delNino" class="btn danger small">Eliminar</button>
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
    const seccion = prompt("Sección (ej. B), puede quedar vacía:", n.seccion || ""); if (seccion === null) return;
    const notas = prompt("Notas generales (opcional):", n.notas || ""); if (notas === null) return;
    const { error } = await sb.from("ninos").update({ alias: alias.trim() || n.alias, grado: grado.trim() || null, seccion: seccion.trim() || null, notas: notas.trim() || null }).eq("id", id);
    if (error) { toast("No se pudo editar."); return; }
    await cargarNinos(); vistaFicha(id);
  });
  $("#delNino").addEventListener("click", async () => {
    const propios = regs.filter(r => r.nino_id === id), grupales = regs.filter(r => r.nino_id !== id);
    if (!confirm(`¿Eliminar a ${n.alias}?\n\nTambién se borrarán sus ${propios.length} registro${propios.length === 1 ? "" : "s"} individuales y sus audios.${grupales.length ? `\nLos ${grupales.length} registros grupales se conservan en el libro grupal.` : ""}\nNo se puede deshacer.`)) return;
    const audios = propios.map(r => r.audio_path).filter(Boolean);
    if (audios.length) await sb.storage.from("audios").remove(audios);
    for (const g of grupales) await sb.from("registros").update({ nino_ids: (g.nino_ids || []).filter(x => x !== id) }).eq("id", g.id);
    const { error: e1 } = await sb.from("registros").delete().eq("nino_id", id);
    const { error: e2 } = e1 ? { error: e1 } : await sb.from("ninos").delete().eq("id", id);
    if (e2) { toast("No se pudo eliminar."); return; }
    await cargarNinos(); toast("Niño eliminado"); go("ninos");
  });
  enlazarEntradas(() => vistaFicha(id));
}

function entradaHTML(r) {
  const quien = r.nino_id ? (ninoPorId(r.nino_id)?.alias || "") : (r.grupal || r.grupo) ? "👥 " + (r.grupo || "Grupal") + (r.participantes ? " (" + r.participantes + ")" : "") : "";
  return `<div class="card entry" data-id="${r.id}" data-audio="${esc(r.audio_path || "")}" data-grupal="${r.grupal ? 1 : ""}">
    <div class="date">${fmtFecha(r.fecha)}${quien ? " · " + esc(quien) : ""}</div>
    <div>${esc(r.actividad)}</div>
    <div style="margin-top:8px">
      ${r.tipo_actividad ? `<span class="pill">${esc(r.tipo_actividad)}</span>` : ""}
      ${r.estado_emocional ? `<span class="pill accent">${esc(r.estado_emocional)}</span>` : ""}
      ${r.grado ? `<span class="pill">${esc(gradoTxt(r.grado, r.seccion))}</span>` : ""}
      ${r.seguimiento ? `<span class="pill ${r.seguimiento_hecho ? "" : "warn"}">${r.seguimiento_hecho ? "✔ Seguimiento hecho" : "Seguimiento pendiente"}${r.seguimiento_nota ? ": " + esc(r.seguimiento_nota) : ""}</span>` : ""}
    </div>
    <div class="actions no-print" style="margin-top:10px">
      ${r.audio_path ? `<button class="btn small" data-act="audio">▶ Escuchar audio</button>` : ""}
      ${r.seguimiento && !r.seguimiento_hecho ? `<button class="btn small" data-act="hecho">Marcar seguimiento hecho</button>` : ""}
      <button class="btn small" data-act="editar">✏️ Editar</button>
      <button class="btn danger small" data-act="borrar">Borrar</button>
    </div>
    <div class="audio-slot"></div>
  </div>`;
}

async function editarRegistro(id, refrescar) {
  const { data: r, error } = await sb.from("registros").select("*").eq("id", id).single();
  if (error || !r) { toast("No se pudo abrir el registro."); return; }
  const op = (lista, v) => lista.map(x => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("");
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">
    <h3>Editar registro</h3>
    ${r.grupal ? `<p class="hint">Es un registro grupal: el cambio se ve en el libro grupal y en el de cada niño que participó.</p>` : ""}
    <label>Fecha<input id="eFecha" type="date" value="${esc(r.fecha || "")}"></label>
    <label>Tipo de actividad<select id="eTipo"><option value="">—</option>${op(TIPOS, r.tipo_actividad)}</select></label>
    <label>Estado emocional<select id="eEstado"><option value="">—</option>${op(ESTADOS, r.estado_emocional)}</select></label>
    <label>Actividad realizada<textarea id="eAct" rows="6">${esc(r.actividad || "")}</textarea></label>
    <label class="check"><input id="eSeg" type="checkbox" ${r.seguimiento ? "checked" : ""}> Queda seguimiento pendiente</label>
    <label id="eSegWrap" class="${r.seguimiento ? "" : "hidden"}">¿Qué queda pendiente?<input id="eSegNota" type="text" value="${esc(r.seguimiento_nota || "")}"></label>
    <p id="eMsg" class="msg"></p>
    <div class="actions">
      <button type="button" id="eOk" class="btn primary">Guardar cambios</button>
      <button type="button" id="eNo" class="btn ghost">Cancelar</button>
    </div></div>`;
  document.body.appendChild(bg);
  const q = sel => bg.querySelector(sel);
  q("#eSeg").addEventListener("change", e => q("#eSegWrap").classList.toggle("hidden", !e.target.checked));
  q("#eNo").addEventListener("click", () => bg.remove());
  bg.addEventListener("click", e => { if (e.target === bg) bg.remove(); });
  q("#eOk").addEventListener("click", async () => {
    const actividad = q("#eAct").value.trim();
    if (!actividad) { q("#eMsg").textContent = "La actividad no puede quedar vacía."; return; }
    if (!q("#eFecha").value) { q("#eMsg").textContent = "Falta la fecha."; return; }
    const seg = q("#eSeg").checked;
    q("#eOk").disabled = true;
    const { error } = await sb.from("registros").update({
      fecha: q("#eFecha").value, tipo_actividad: q("#eTipo").value || null, estado_emocional: q("#eEstado").value || null,
      actividad, seguimiento: seg, seguimiento_nota: seg ? (q("#eSegNota").value.trim() || null) : null,
      seguimiento_hecho: seg ? !!r.seguimiento_hecho : false,
    }).eq("id", id);
    if (error) { q("#eOk").disabled = false; q("#eMsg").textContent = "No se pudo guardar. Intenta de nuevo."; return; }
    bg.remove(); toast("Cambios guardados"); refrescar();
  });
}

function enlazarEntradas(refrescar) {
  $$(".entry[data-id], .reg[data-id]").forEach(el => {
    const id = el.dataset.id;
    el.addEventListener("click", async ev => {
      const act = ev.target.dataset?.act; if (!act) return;
      if (act === "audio") {
        const { data, error } = await sb.storage.from("audios").createSignedUrl(el.dataset.audio, 3600);
        if (error) { toast("No se pudo abrir el audio."); return; }
        $(".audio-slot", el).innerHTML = `<audio controls autoplay src="${data.signedUrl}"></audio>`;
      } else if (act === "hecho") {
        await sb.from("registros").update({ seguimiento_hecho: true }).eq("id", id); refrescar();
      } else if (act === "editar") {
        await editarRegistro(id, refrescar);
      } else if (act === "borrar") {
        if (!confirm(el.dataset.grupal ? "Este registro es grupal: se borrará del libro grupal y del libro de todos los niños que participaron. ¿Seguir?" : "¿Borrar este registro? No se puede deshacer.")) return;
        if (el.dataset.audio) await sb.storage.from("audios").remove([el.dataset.audio]);
        await sb.from("registros").delete().eq("id", id); toast("Registro borrado"); refrescar();
      }
    });
  });
}

/* ============ RESUMEN (libros por niño y grupales) ============ */
const PORTADAS = [
  { a: "#2f6256", b: "#4f9382" }, { a: "#8c2f39", b: "#bd5a64" }, { a: "#27466e", b: "#4f7fb3" },
  { a: "#a86f12", b: "#dca444" }, { a: "#5b3a73", b: "#8c68ab" }, { a: "#b2512f", b: "#dd8057" },
  { a: "#23606c", b: "#4aa0ae" }, { a: "#4d5a2a", b: "#82954a" },
];
const colorDe = id => {
  let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PORTADAS[h % PORTADAS.length];
};
const portadaStyle = id => { const c = colorDe(id); return `--c1:${c.a};--c2:${c.b}`; };
const fmtCorta = f => { if (!f) return ""; const [y, m, d] = f.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("es-HN", { day: "numeric", month: "short", year: "numeric" }); };
const fmtLarga = f => { if (!f) return ""; const [y, m, d] = f.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("es-HN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); };
const cap = s => (s || "").charAt(0).toUpperCase() + (s || "").slice(1);

/* Un "libro" es un niño o un grupo (grado + sección). Los grupos usan la clave g|grado|seccion */
const claveGrupo = (g, s) => `g|${g || ""}|${s || ""}`;
function entidad(id) {
  if (!id) return null;
  if (String(id).startsWith("g|")) {
    const [, g, s] = id.split("|");
    const sub = gradoTxt(g, s) || "Sin grado";
    return { id, grupal: true, nombre: "Grupal", grado: g, seccion: s, sub, titulo: "Grupal · " + sub };
  }
  const n = ninoPorId(id);
  return n ? { id, grupal: false, nombre: n.alias, grado: n.grado, seccion: n.seccion, sub: gradoTxt(n.grado, n.seccion), titulo: n.alias } : null;
}
const quienDe = r => r.nino_id ? (ninoPorId(r.nino_id)?.alias || "") : (r.grupal || r.grupo) ? "Grupal · " + (gradoTxt(r.grado, r.seccion) || "sin grado") : "";

const libro = { id: null, pg: 0, pages: [], ancho: false, timer: null };
let ultimoInforme = null;   // { ent, regs, f } para el botón de Word

const conteoDe = (regs, campo) => {
  const m = {}; regs.forEach(r => { if (r[campo]) m[r[campo]] = (m[r[campo]] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
};
const barrasHTML = (lista, alt) => {
  const max = Math.max(1, ...lista.map(x => x[1]));
  return lista.map(([k, v]) => `<div class="bar ${alt ? "alt" : ""}"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${(v / max) * 100}%"></div></div><b>${v}</b></div>`).join("") || `<p class="muted">Sin datos.</p>`;
};
const statsHTML = (regs, cls = "") => {
  const atendidos = new Set(regs.flatMap(dePartic)).size;
  const pend = regs.filter(r => r.seguimiento && !r.seguimiento_hecho).length;
  return `<div class="stats ${cls}">
    <div class="stat"><b>${regs.length}</b>Registros</div>
    <div class="stat"><b>${atendidos}</b>Niños atendidos</div>
    <div class="stat"><b>${regs.filter(r => r.audio_path).length}</b>Con audio</div>
    <div class="stat"><b>${pend}</b>Seguimientos pendientes</div></div>`;
};

async function vistaResumen(ninoId) {
  const f = state.filtros = state.filtros || {};
  if (ninoId) f.nino = ninoId;
  if (!f.desde) { const d = new Date(); d.setMonth(d.getMonth() - 3); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); f.desde = d.toISOString().slice(0, 10); }
  if (!f.hasta) f.hasta = hoyLocal();
  f.nino = f.nino || ""; f.grado = f.grado || ""; f.tipo = f.tipo || "";

  // grupos existentes (para la lista de libros y el filtro)
  const { data: gs } = await sb.from("registros").select("grado,seccion").eq("grupal", true);
  const grupos = [...new Map((gs || []).map(r => [claveGrupo(r.grado, r.seccion), r])).keys()]
    .sort((a, b) => GRADOS.indexOf(a.split("|")[1]) - GRADOS.indexOf(b.split("|")[1]) || a.localeCompare(b));
  state.grupos = grupos;

  $("#main").innerHTML = `
    <h2 class="no-print">Resumen</h2>
    <details class="card no-print filtros">
      <summary>🔎 Filtros</summary>
      <div class="row">
        <label>Libro<select id="rNino"><option value="">Todos (biblioteca)</option>
          ${state.ninos.map(n => `<option value="${n.id}" ${n.id === f.nino ? "selected" : ""}>${esc(n.alias)}</option>`).join("")}
          ${grupos.length ? `<optgroup label="Grupales">${grupos.map(k => `<option value="${esc(k)}" ${k === f.nino ? "selected" : ""}>${esc(entidad(k).titulo)}</option>`).join("")}</optgroup>` : ""}
        </select></label>
        <label>Grado<select id="rGrado">${opts(GRADOS, f.grado, "Todos")}</select></label>
        <label>Tipo<select id="rTipo">${opts(TIPOS, f.tipo, "Todos")}</select></label>
        <label>Desde<input id="rDesde" type="date" value="${f.desde}"></label>
        <label>Hasta<input id="rHasta" type="date" value="${f.hasta}"></label>
      </div>
      <div class="actions">
        <button id="rAplicar" class="btn primary">Aplicar</button>
        <button id="rImprimir" class="btn">📄 Descargar Word</button>
      </div>
    </details>
    <div id="rCuerpo"><p class="muted">Cargando…</p></div>`;
  $("#rAplicar").addEventListener("click", () => {
    Object.assign(f, { nino: $("#rNino").value, grado: $("#rGrado").value, tipo: $("#rTipo").value, desde: $("#rDesde").value, hasta: $("#rHasta").value });
    vistaResumen();
  });
  $("#rNino").addEventListener("change", () => { f.nino = $("#rNino").value; vistaResumen(); });
  $("#rImprimir").addEventListener("click", descargarInforme);

  const ent = entidad(f.nino);
  const { data: regs, error } = await traerRegistros(ent, f.desde, f.hasta, f);
  if (error) { $("#rCuerpo").innerHTML = `<p class="muted">No se pudo cargar.</p>`; return; }

  if (ent) renderLibro(regs, f, ent);
  else { f.nino = ""; libro.id = null; renderGeneral(regs, f); }
}

function traerRegistros(ent, desde, hasta, filtros) {
  let q = sb.from("registros").select("*").gte("fecha", desde).lte("fecha", hasta).order("fecha", { ascending: false }).order("created_at", { ascending: false });
  if (ent?.grupal) {
    q = q.eq("grupal", true);
    q = ent.grado ? q.eq("grado", ent.grado) : q.is("grado", null);
    q = ent.seccion ? q.eq("seccion", ent.seccion) : q.is("seccion", null);
  } else if (ent) q = q.or(filtroNino(ent.id));
  if (filtros?.grado) q = q.eq("grado", filtros.grado);
  if (filtros?.tipo) q = q.eq("tipo_actividad", filtros.tipo);
  return q;
}

/* ---- biblioteca (todos) ---- */
function renderGeneral(regs, f) {
  ultimoInforme = { ent: null, regs, f };
  const porNino = {}, porGrupo = {};
  regs.forEach(r => {
    dePartic(r).forEach(nid => { porNino[nid] = (porNino[nid] || 0) + 1; });
    if (!r.nino_id && (r.grupal || r.grupo)) { const k = claveGrupo(r.grado, r.seccion); porGrupo[k] = (porGrupo[k] || 0) + 1; }
  });
  const libros = [
    ...(state.grupos || []).map(k => ({ id: k, nombre: "Grupal", sub: entidad(k).sub, grado: entidad(k).grado || "", grupal: true, n: porGrupo[k] || 0 })),
    ...state.ninos.map(n => ({ id: n.id, nombre: n.alias, sub: gradoTxt(n.grado, n.seccion), grado: n.grado || "", grupal: false, n: porNino[n.id] || 0 })),
  ];
  const bib = state.bib = state.bib || { q: "", c: "" };
  const gradosHay = GRADOS.filter(g => libros.some(b => b.grado === g));
  const chip = (v, t) => `<button type="button" class="chip ${bib.c === v ? "on" : ""}" data-c="${esc(v)}">${esc(t)}</button>`;
  $("#rCuerpo").innerHTML = `
    <h3 class="no-print">Biblioteca</h3>
    <div class="bib-tools no-print">
      <input id="bibQ" type="search" placeholder="🔎 Buscar niño o grupo…" value="${esc(bib.q)}" autocomplete="off">
      <div class="chips">${chip("", "Todos")}${chip("__nino", "Niños")}${chip("__grupal", "Grupales")}${gradosHay.map(g => chip(g, g.replace(" grado", ""))).join("")}</div>
      <p id="bibN" class="muted"></p>
    </div>
    <div class="shelf no-print">
      ${libros.map(b => `<button class="mini" data-id="${esc(b.id)}" data-q="${esc(norm(b.nombre + " " + b.sub))}" data-g="${esc(b.grado)}" data-t="${b.grupal ? "__grupal" : "__nino"}" style="${portadaStyle(b.id)}">
        <span class="mini-spine"></span>
        <span class="mini-name">${esc(b.nombre)}</span>
        <span class="mini-sub">${esc(b.sub)}</span>
        <span class="mini-n">${b.n} registro${b.n === 1 ? "" : "s"}</span>
      </button>`).join("") || `<p class="muted">Aún no hay libros. Agrega niños en la pestaña Niños o guarda un registro.</p>`}
    </div>
    <div id="bibPager" class="bib-pager no-print">
      <button type="button" id="bibPrev" class="btn small">◀ Anterior</button>
      <span id="bibInd" class="muted"></span>
      <button type="button" id="bibNext" class="btn small">Siguiente ▶</button>
    </div>
    <div class="no-print" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <h3 style="margin:0">Resumen general · ${fmtCorta(f.desde)} – ${fmtCorta(f.hasta)}</h3>
      <button id="imprimirGen" class="btn primary small">📄 Descargar Word</button>
    </div>
    ${statsHTML(regs)}
    <div class="row">
      <div class="card"><h3>Tipos de actividad</h3><div class="bars">${barrasHTML(conteoDe(regs, "tipo_actividad"))}</div></div>
      <div class="card"><h3>Estado emocional</h3><div class="bars">${barrasHTML(conteoDe(regs, "estado_emocional"), true)}</div></div>
    </div>
    <h3>Detalle</h3>
    <div class="timeline">${regs.map(entradaHTML).join("") || `<p class="muted">No hay registros con estos filtros.</p>`}</div>`;
  $("#imprimirGen").addEventListener("click", descargarInforme);
  $$(".mini").forEach(b => b.addEventListener("click", () => { f.nino = b.dataset.id; vistaResumen(); }));
  const POR_PAG = 9;
  const filtrarBib = () => {
    const q = norm(bib.q.trim());
    const ok = [...$$(".mini")].filter(b => (!q || b.dataset.q.includes(q)) && (!bib.c || b.dataset.t === bib.c || b.dataset.g === bib.c));
    const pags = Math.max(1, Math.ceil(ok.length / POR_PAG));
    bib.p = Math.min(Math.max(0, bib.p || 0), pags - 1);
    const visibles = new Set(ok.slice(bib.p * POR_PAG, bib.p * POR_PAG + POR_PAG));
    $$(".mini").forEach(b => b.classList.toggle("hidden", !visibles.has(b)));
    $$(".bib-tools .chip").forEach(c => c.classList.toggle("on", c.dataset.c === bib.c));
    $("#bibN").textContent = ok.length === libros.length ? `${libros.length} libros · toca uno para abrirlo` : `${ok.length} de ${libros.length} libros`;
    $("#bibPager").classList.toggle("hidden", pags <= 1);
    $("#bibInd").textContent = `Página ${bib.p + 1} de ${pags}`;
    $("#bibPrev").disabled = bib.p <= 0; $("#bibNext").disabled = bib.p >= pags - 1;
  };
  $("#bibQ").addEventListener("input", e => { bib.q = e.target.value; bib.p = 0; filtrarBib(); });
  $$(".bib-tools .chip").forEach(c => c.addEventListener("click", () => { bib.c = c.dataset.c; bib.p = 0; filtrarBib(); }));
  $("#bibPrev").addEventListener("click", () => { bib.p--; filtrarBib(); });
  $("#bibNext").addEventListener("click", () => { bib.p++; filtrarBib(); });
  filtrarBib();
  enlazarEntradas(() => vistaResumen());
}

/* ---- libro (niño o grupo) ---- */
function paginaRegistro(r, acc) {
  const meta = [r.tipo_actividad, r.estado_emocional ? "ánimo: " + r.estado_emocional.toLowerCase() : ""].filter(Boolean).join(" · ");
  const seg = r.seguimiento ? (r.seguimiento_hecho ? "✔ Seguimiento hecho" : "★ Pendiente") + (r.seguimiento_nota ? ": " + r.seguimiento_nota : "") : "";
  return `<div class="reg" data-id="${r.id}" data-audio="${esc(r.audio_path || "")}" data-grupal="${r.grupal ? 1 : ""}">
    <div class="reg-date">${esc(fmtLarga(r.fecha))}</div>
    ${r.participantes ? `<div class="reg-meta">${r.grupal && !String(libro.id).startsWith("g|") ? "Trabajo grupal · " : ""}Participaron: ${esc(r.participantes)}</div>` : ""}
    <p class="reg-text">${esc(r.actividad)}</p>
    ${meta ? `<div class="reg-meta">${esc(meta)}</div>` : ""}
    ${seg ? `<div class="reg-seg ${r.seguimiento_hecho ? "ok" : ""}">${esc(seg)}</div>` : ""}
    ${acc ? `<div class="reg-tools">
      ${r.audio_path ? `<button class="btn small" data-act="audio">▶ Escuchar audio</button>` : ""}
      ${r.seguimiento && !r.seguimiento_hecho ? `<button class="btn small" data-act="hecho">Marcar seguimiento hecho</button>` : ""}
      <button class="btn small" data-act="editar">✏️ Editar</button>
      <button class="btn danger small" data-act="borrar">Borrar</button>
    </div><div class="audio-slot"></div>` : ""}
  </div>`;
}

function renderLibro(regs, f, n) {
  ultimoInforme = { ent: n, regs, f };
  const nuevo = libro.id !== n.id;
  libro.id = n.id;
  if (nuevo) libro.pg = 0;
  libro.ancho = window.innerWidth >= 860;
  const cron = [...regs].reverse();              // del más antiguo al más reciente, como un diario
  libro.pages = [
    ...cron.map(r => paginaRegistro(r, true)),
    ...(cron.length ? [] : [`<div class="reg-empty">Todavía no hay nada escrito en ${esc(n.titulo)} en estas fechas.</div>`]),
  ];

  $("#rCuerpo").innerHTML = `
    <div class="libro-wrap no-print" style="${portadaStyle(n.id)}">
      <div class="stage ${libro.ancho ? "wide" : ""}" id="stage">
        <div class="spread" id="spread"></div>
        <div class="cover ${nuevo ? "" : "gone"}" id="cover">
          <div class="cover-spine"></div>
          <div class="cover-inner">
            <div class="cover-kicker">Bitácora de apoyo</div>
            <div class="cover-rule"></div>
            <h2 class="cover-name">${esc(n.nombre)}</h2>
            <div class="cover-grade">${esc(n.sub)}</div>
            <div class="cover-period">${fmtCorta(f.desde)} – ${fmtCorta(f.hasta)}</div>
            <div class="cover-tap">Toca para abrir</div>
          </div>
          <div class="cover-ribbon"></div>
        </div>
      </div>
      <div class="libro-nav">
        <button class="btn" id="pgPrev" aria-label="Página anterior">◀</button>
        <span id="pgInd" class="muted"></span>
        <button class="btn" id="pgNext" aria-label="Página siguiente">▶</button>
      </div>
      <div class="actions" style="justify-content:center">
        <button id="imprimirLibro" class="btn primary small">📄 Descargar informe (Word)</button>
        <button id="cerrarLibro" class="btn ghost small">📚 Cerrar libro</button>
      </div>
    </div>`;

  pintarLibro();
  if (nuevo) $(".libro-wrap").scrollIntoView({ behavior: "smooth", block: "start" });
  $("#pgPrev").addEventListener("click", () => pasar(-1));
  $("#pgNext").addEventListener("click", () => pasar(1));
  $("#imprimirLibro").addEventListener("click", descargarInforme);
  $("#cerrarLibro").addEventListener("click", () => { f.nino = ""; libro.id = null; vistaResumen(); });

  const cover = $("#cover");
  const abrir = () => {
    if (cover.classList.contains("open")) return;
    clearTimeout(libro.timer);
    cover.classList.add("open");
    setTimeout(() => cover.classList.add("gone"), 1000);
  };
  if (!cover.classList.contains("gone")) {
    cover.addEventListener("click", abrir);
    libro.timer = setTimeout(abrir, 700);
  }

  let x0 = null, y0 = 0;
  const st = $("#stage");
  st.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  st.addEventListener("touchend", e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) pasar(dx < 0 ? 1 : -1);
  }, { passive: true });
}

function pasar(d) {
  const paso = libro.ancho ? 2 : 1;
  const nuevo = libro.pg + d * paso;
  if (nuevo < 0 || nuevo >= libro.pages.length) return;
  libro.pg = nuevo;
  pintarLibro(d > 0 ? "next" : "prev");
}

function pintarLibro(dir) {
  const L = libro, paso = L.ancho ? 2 : 1;
  L.pg = Math.max(0, Math.min(L.pg, L.pages.length - 1));
  if (L.ancho) L.pg -= L.pg % 2;
  const idx = L.ancho ? [L.pg, L.pg + 1] : [L.pg];
  const sp = $("#spread");
  sp.className = "spread" + (L.ancho ? " wide" : "") + (dir ? " turn-" + dir : "");
  sp.innerHTML = idx.map(i => i < L.pages.length
    ? `<div class="sheet">${L.pages[i]}<div class="pg-num">${i + 1}</div></div>`
    : `<div class="sheet blank"></div>`).join("");
  $("#pgInd").textContent = (L.ancho ? `${L.pg + 1}–${Math.min(L.pg + 2, L.pages.length)}` : `${L.pg + 1}`) + ` de ${L.pages.length}`;
  $("#pgPrev").disabled = L.pg <= 0;
  $("#pgNext").disabled = L.pg + paso >= L.pages.length;
  enlazarEntradas(() => vistaResumen());
}

document.addEventListener("keydown", e => {
  if (state.view !== "resumen" || !$("#spread")) return;
  if (e.key === "ArrowRight") pasar(1); else if (e.key === "ArrowLeft") pasar(-1);
});

/* ============ INFORME EN WORD (.docx editable) ============ */
function cargarDocx() {
  if (window.docx) return Promise.resolve();
  return new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = "js/vendor/docx.js?v=1";
    s.onload = ok; s.onerror = () => mal(new Error("no se pudo cargar el generador de Word"));
    document.head.appendChild(s);
  });
}

const fechaISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function pedirPeriodo(desde, hasta) {
  return new Promise(ok => {
    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">
      <h3>¿De qué período es el informe?</h3>
      <div class="presets">
        <button type="button" class="btn small" data-p="mes">Este mes</button>
        <button type="button" class="btn small" data-p="pasado">Mes pasado</button>
        <button type="button" class="btn small" data-p="tres">Últimos 3 meses</button>
        <button type="button" class="btn small" data-p="anio">Todo el año</button>
      </div>
      <div class="row">
        <label>Desde<input id="pDesde" type="date" value="${desde}"></label>
        <label>Hasta<input id="pHasta" type="date" value="${hasta}"></label>
      </div>
      <p id="pMsg" class="msg"></p>
      <div class="actions">
        <button type="button" id="pOk" class="btn primary">📄 Descargar Word</button>
        <button type="button" id="pNo" class="btn ghost">Cancelar</button>
      </div></div>`;
    document.body.appendChild(bg);
    const cerrar = v => { bg.remove(); ok(v); };
    const hoy = new Date();
    const rangos = {
      mes: [new Date(hoy.getFullYear(), hoy.getMonth(), 1), hoy],
      pasado: [new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1), new Date(hoy.getFullYear(), hoy.getMonth(), 0)],
      tres: [new Date(hoy.getFullYear(), hoy.getMonth() - 3, hoy.getDate()), hoy],
      anio: [new Date(hoy.getFullYear(), 0, 1), hoy],
    };
    $$("[data-p]", bg).forEach(b => b.addEventListener("click", () => {
      const [a, z] = rangos[b.dataset.p];
      $("#pDesde", bg).value = fechaISO(a); $("#pHasta", bg).value = fechaISO(z);
    }));
    $("#pOk", bg).addEventListener("click", () => {
      const d = $("#pDesde", bg).value, h = $("#pHasta", bg).value;
      if (!d || !h) { $("#pMsg", bg).textContent = "Elige las dos fechas."; return; }
      if (d > h) { $("#pMsg", bg).textContent = "“Desde” no puede ser después de “Hasta”."; return; }
      cerrar({ desde: d, hasta: h });
    });
    $("#pNo", bg).addEventListener("click", () => cerrar(null));
    bg.addEventListener("click", e => { if (e.target === bg) cerrar(null); });
  });
}

async function resumenIA(ent, regs, per) {
  const registros = [...regs].reverse().map(r => ({
    fecha: r.fecha, tipo: r.tipo_actividad, actividad: r.actividad,
    ...(ent ? {} : { con: quienDe(r) }),
    seguimiento: r.seguimiento ? (r.seguimiento_hecho ? "realizado" : "pendiente") + (r.seguimiento_nota ? ": " + r.seguimiento_nota : "") : null,
  }));
  const { data, error } = await sb.functions.invoke("extraer", { body: {
    modo: "resumen", titulo: ent ? ent.titulo : "todos los niños",
    periodo: `${fmtCorta(per.desde)} – ${fmtCorta(per.hasta)}`, registros } });
  if (error) throw new Error("no se pudo contactar la IA");
  if (!data || data.error || !data.resumen) throw new Error((data && data.error) || "respuesta vacía");
  return data.resumen;
}

async function descargarInforme() {
  if (!ultimoInforme) { toast("Espera a que cargue el resumen."); return; }
  try {
    const { ent, f } = ultimoInforme;
    const per = await pedirPeriodo(f.desde, f.hasta);
    if (!per) return;
    toast("Preparando el informe…", 8000);
    const [, { data: regs, error }] = await Promise.all([cargarDocx(), traerRegistros(ent, per.desde, per.hasta, null)]);
    if (error) throw error;
    let resumen = null, motivo = "";
    if (regs.length) {
      toast("Redactando el resumen con IA…", 15000);
      try { resumen = await resumenIA(ent, regs, per); }
      catch (e) { console.warn("Resumen IA:", e); motivo = " (sin resumen de IA: " + (e.message || "error") + ")"; }
    }
    const nombre = await armarWord(ent, regs, per, resumen);
    toast("📄 Descargado: " + nombre + motivo, 6000);
  } catch (e) {
    console.error(e);
    toast("No se pudo crear el Word: " + (e.message || "error"), 6000);
  }
}

async function armarWord(ent, regs, f, resumen) {
  const D = window.docx;
  const col = (ent ? colorDe(ent.id) : PORTADAS[0]).a.slice(1).toUpperCase();
  const cron = [...regs].reverse();
  const hoy = new Date().toLocaleDateString("es-HN", { day: "numeric", month: "long", year: "numeric" });
  const titulo = ent ? ent.titulo : "Informe general";
  const sub = (ent && !ent.grupal && ent.sub ? ent.sub + " · " : "") + `Período: ${fmtCorta(f.desde)} – ${fmtCorta(f.hasta)}`;

  const T = (text, o = {}) => new D.TextRun({ text, font: "Calibri", ...o });
  const P = (children, o = {}) => new D.Paragraph({ children, ...o });

  const tipos = conteoDe(regs, "tipo_actividad").map(([k, v]) => `${k} (${v})`).join(", ") || "—";
  const pend = regs.filter(r => r.seguimiento && !r.seguimiento_hecho).length;
  const filas = [["Registros", String(regs.length)]];
  if (!ent) filas.push(["Niños atendidos", String(new Set(regs.flatMap(dePartic)).size)]);
  if (ent?.grupal) {
    const parts = [...new Set(regs.flatMap(r => (r.participantes || "").split(/[,;]/).map(x => x.trim()).filter(Boolean)))];
    filas.push(["Participantes", parts.join(", ") || "—"]);
  }
  filas.push(["Seguimientos pendientes", String(pend)], ["Actividades trabajadas", tipos]);   // sin estado emocional

  const celda = (texto, w, negrita) => new D.TableCell({
    width: { size: w, type: D.WidthType.PERCENTAGE },
    shading: { type: D.ShadingType.CLEAR, fill: negrita ? "F2F2F2" : "FFFFFF", color: "auto" },
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    children: [P([T(texto, { bold: negrita, size: 21 })])],
  });
  const tabla = new D.Table({
    width: { size: 100, type: D.WidthType.PERCENTAGE },
    rows: filas.map(([k, v]) => new D.TableRow({ children: [celda(k, 30, true), celda(v, 70, false)] })),
  });

  const borde = { left: { style: D.BorderStyle.SINGLE, size: 18, color: col, space: 8 } };
  const entradas = cron.flatMap(r => {
    const quien = ent ? "" : quienDe(r);
    const meta = [r.tipo_actividad, ent && !ent.grupal && r.grupal ? "Trabajo grupal" : ""].filter(Boolean).join(" · ");
    const lineas = String(r.actividad || "").split("\n");
    const out = [
      P([T(cap(fmtLarga(r.fecha)) + (quien ? " · " + quien : ""), { bold: true, size: 23 })], { spacing: { before: 220, after: 20 }, keepNext: true, indent: { left: 180 }, border: borde }),
    ];
    if (meta) out.push(P([T(meta, { size: 19, color: "000000" })], { keepNext: true, indent: { left: 180 }, border: borde }));
    if (r.participantes) out.push(P([T("Participaron: " + r.participantes, { size: 20, color: "000000" })], { keepNext: true, indent: { left: 180 }, border: borde }));
    out.push(P(lineas.map((l, i) => T(l, { size: 22, break: i ? 1 : 0 })), { spacing: { after: 40 }, indent: { left: 180 }, border: borde }));
    if (r.seguimiento) out.push(P([T(`Seguimiento ${r.seguimiento_hecho ? "realizado" : "pendiente"}${r.seguimiento_nota ? ": " + r.seguimiento_nota : ""}`, { italics: true, size: 21, color: "000000" })], { indent: { left: 180 }, border: borde }));
    return out;
  });

  const doc = new D.Document({
    creator: "Bitácora de apoyo",
    title: titulo,
    styles: { default: { document: { run: { font: "Calibri", size: 22, color: "000000" } } },
      paragraphStyles: [{ id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Calibri", size: 28, bold: true, color: "000000" } }] },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
      children: [
        P([T("INFORME DE PROCESO · APOYO DE APRENDIZAJE EN ESPAÑOL", { bold: true, size: 18, color: "000000" })]),
        P([T(titulo, { bold: true, size: 52, color: "000000" })], { spacing: { after: 60 } }),
        P([T(sub, { size: 22, color: "000000" })]),
        ...(typeof CONFIG !== "undefined" && CONFIG.DOCENTE ? [P([T("Docente de apoyo: " + CONFIG.DOCENTE, { size: 22, color: "000000" })])] : []),
        P([T(`Generado el ${hoy} · Documento confidencial`, { size: 20, color: "000000" })], { spacing: { after: 240 }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 12, color: col, space: 6 } } }),
        tabla,
        ...(resumen ? [
          P([T("Resumen del proceso", { bold: true, size: 28, color: "000000" })], { spacing: { before: 340, after: 120 }, heading: D.HeadingLevel.HEADING_2 }),
          ...String(resumen).split(/\n{2,}|\n/).map(x => x.trim()).filter(Boolean).map(x => P([T(x, { size: 22 })], { spacing: { after: 100 }, alignment: D.AlignmentType.JUSTIFIED })),
        ] : []),
        P([T("Registro de actividades", { bold: true, size: 28, color: "000000" })], { spacing: { before: 340, after: 120 }, heading: D.HeadingLevel.HEADING_2 }),
        ...(entradas.length ? entradas : [P([T("No hay registros en este período.", { size: 22 })])]),
      ],
    }],
  });

  const blob = await D.Packer.toBlob(doc);
  const slug = titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const nombre = `${/^Informe/.test(slug) ? slug : "Informe_" + slug}_${hoyLocal()}.docx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return nombre;
}

init();
