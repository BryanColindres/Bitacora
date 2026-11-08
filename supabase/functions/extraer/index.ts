const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIPOS = ["Lectura", "Escritura", "Comprensión lectora", "Vocabulario",
  "Comunicación oral", "Regulación emocional", "Habilidades sociales", "Otro"];
const ESTADOS = ["Tranquilo", "Motivado", "Ansioso", "Frustrado",
  "Desregulado / llorando", "Cansado", "Otro"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function gemini(key: string, model: string, parts: unknown[], config: Record<string, unknown>) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: config }),
    },
  );
  if (!r.ok) {
    const detalle = await r.text();
    return { error: json({ error: "Gemini respondió con error", status: r.status, detalle: detalle.slice(0, 300) }, 502) };
  }
  const data = await r.json();
  return { texto: data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const body = await req.json();
    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return json({ error: "Falta GEMINI_API_KEY en los secretos" }, 500);
    const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";

    /* ---------- Modo resumen: párrafo "Resumen del proceso" para el informe ---------- */
    if (body.modo === "resumen") {
      const regs = Array.isArray(body.registros) ? body.registros.slice(-80) : [];
      if (!regs.length) return json({ error: "No hay registros para resumir" }, 400);
      const prompt = `Eres un asistente de una maestra de apoyo de aprendizaje en español.
Con las notas de "${String(body.titulo ?? "").slice(0, 80)}" del período ${String(body.periodo ?? "").slice(0, 60)}, redacta el "Resumen del proceso" de un informe.
Reglas:
- 1 o 2 párrafos breves (máximo 130 palabras en total), tono profesional y objetivo, tercera persona.
- Usa SOLO lo que dicen las notas. No inventes logros, causas ni diagnósticos.
- No menciones estados emocionales ni de ánimo.
- Usa los nombres o iniciales tal como aparecen en las notas; no agregues nombres.
- Cuenta cuántas sesiones hubo, qué se trabajó, avances solo si las notas los indican, dificultades si las hay y seguimientos pendientes.
- Devuelve SOLO el texto plano, sin títulos, listas ni formato.

Notas (JSON):
${JSON.stringify(regs).slice(0, 24000)}`;
      const g = await gemini(key, model, [{ text: prompt }], { temperature: 0.3 });
      if (g.error) return g.error;
      const resumen = String(g.texto).replace(/\*\*/g, "").trim();
      if (!resumen) return json({ error: "Gemini no devolvió texto" }, 502);
      return json({ resumen });
    }

    /* ---------- Modo normal: transcribir y ordenar una nota ---------- */
    const { texto = "", ninos = [], hoy, audio, mime } = body;
    if (typeof texto !== "string" || (!texto && !audio)) return json({ error: "Falta el texto o el audio" }, 400);

    const prompt = `Eres un asistente que ordena notas de una maestra de apoyo de aprendizaje en español.
Lee el dictado (texto y/o audio adjunto) y devuelve SOLO un JSON con estas claves:
- transcripcion: transcripción fiel de lo dicho en el audio (o el texto recibido si no hay audio).
- nombre: nombre, iniciales o apodo del niño mencionado si trabajó con UN solo niño (null si fue con varios). Si coincide con uno de la lista de niños registrados, usa EXACTAMENTE ese texto de la lista.
- grupal: true si trabajó con varios niños a la vez (ej. "se trabajó con JC, BA y el niño tal"), si no false.
- participantes: si es grupal, los nombres/iniciales de los niños mencionados separados por coma (ej. "JC, BA"), si no null.
- grado: grado escolar mencionado (ej. "Quinto grado"), o null.
- seccion: sección del grado si la menciona (ej. "B", "A", "Azul"), o null. Solo la letra o nombre, sin la palabra "sección".
- fecha: fecha en formato YYYY-MM-DD si la menciona; si dice "hoy" o no la menciona, usa ${hoy ?? "null"}.
- tipo_actividad: una de ${JSON.stringify(TIPOS)}.
- actividad: descripción breve (1-3 oraciones) de LO QUE SE HIZO, en tono profesional. IMPORTANTE: NO menciones el nombre ni las iniciales del niño o de los niños, ni el grado ni la sección, ni frases como "se trabajó con el niño X": esos datos van en los otros campos. Empieza directamente por la actividad. Ejemplo: en vez de "Se trabajó con el niño JC en lectura de sílabas" escribe "Lectura de sílabas trabadas con apoyo visual; logró leer seis palabras sin ayuda". No inventes datos.
- estado_emocional: uno de ${JSON.stringify(ESTADOS)}, o null si no se menciona.
- seguimiento: true si queda algo pendiente o por retomar, si no false.
- seguimiento_nota: qué queda pendiente, o null.

Niños registrados: ${JSON.stringify(ninos)}

Dictado escrito (puede estar vacío si solo hay audio):
"""${texto.slice(0, 4000)}"""`;

    const g = await gemini(
      key, model,
      [{ text: prompt }, ...(audio ? [{ inlineData: { mimeType: mime || "audio/mp4", data: audio } }] : [])],
      { responseMimeType: "application/json", temperature: 0.1 },
    );
    if (g.error) return g.error;
    let out: Record<string, unknown>;
    try {
      out = JSON.parse(g.texto || "{}");
    } catch {
      return json({ error: "Respuesta no válida de Gemini" }, 502);
    }
    return json(out);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
