// Supabase Edge Function: extraer
// Recibe el texto dictado y devuelve los datos ordenados usando Gemini (capa gratuita).
// La llave GEMINI_API_KEY vive como secreto en Supabase; nunca en el código de la página.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIPOS = [
  "Lectura", "Escritura", "Comprensión lectora", "Vocabulario",
  "Comunicación oral", "Regulación emocional", "Habilidades sociales", "Otro",
];
const ESTADOS = [
  "Tranquilo", "Motivado", "Ansioso", "Frustrado", "Desregulado / llorando", "Cansado", "Otro",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const { texto = "", ninos = [], hoy, audio, mime } = await req.json();
    if (typeof texto !== "string" || (!texto && !audio)) return json({ error: "Falta el texto o el audio" }, 400);

    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return json({ error: "Falta GEMINI_API_KEY en los secretos" }, 500);
    const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";

    const prompt = `Eres un asistente que ordena notas de una maestra de apoyo de aprendizaje en español.
Lee el dictado (texto y/o audio adjunto) y devuelve SOLO un JSON con estas claves:
- transcripcion: transcripción fiel de lo dicho en el audio (o el texto recibido si no hay audio).
- nombre: nombre, iniciales o apodo del niño mencionado (null si habla de un grupo o no hay). Si coincide con uno de la lista de niños registrados, usa EXACTAMENTE ese texto de la lista.
- grupo: descripción si habla de varios niños (ej. "Tercer grado"), si no null.
- grado: grado escolar mencionado (ej. "Cuarto grado"), o null.
- fecha: fecha en formato YYYY-MM-DD si la menciona; si dice "hoy" o no la menciona, usa ${hoy ?? "null"}.
- tipo_actividad: una de ${JSON.stringify(TIPOS)}.
- actividad: resumen claro y breve (1-3 oraciones) de lo que se hizo, en tercera persona y tono profesional. No inventes datos.
- estado_emocional: uno de ${JSON.stringify(ESTADOS)}, o null si no se menciona.
- seguimiento: true si queda algo pendiente o por retomar, si no false.
- seguimiento_nota: qué queda pendiente, o null.

Niños registrados: ${JSON.stringify(ninos)}

Dictado escrito (puede estar vacío si solo hay audio):
"""${texto.slice(0, 4000)}"""`;

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, ...(audio ? [{ inlineData: { mimeType: mime || "audio/mp4", data: audio } }] : [])] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
        }),
      },
    );

    if (!r.ok) {
      const detalle = await r.text();
      return json({ error: "Gemini respondió con error", status: r.status, detalle: detalle.slice(0, 300) }, 502);
    }

    const data = await r.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    let out: Record<string, unknown>;
    try {
      out = JSON.parse(raw);
    } catch {
      return json({ error: "Respuesta no válida de Gemini" }, 502);
    }
    return json(out);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
