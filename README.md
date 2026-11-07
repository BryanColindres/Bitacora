# Bitácora de apoyo

Página web (HTML/JS puro) para registrar por voz lo que se hace con cada niño.
Dictado en el navegador → IA (Gemini) ordena los datos → se guarda en Supabase con el audio.
Todo en capas gratuitas. Nada que instalar en el iPad: solo se abre el enlace en Safari.

## Estructura
- `index.html`, `css/styles.css`, `js/app.js`, `js/config.js` → la página (va a GitHub Pages)
- `supabase/schema.sql` → tablas, seguridad y bucket de audios
- `supabase/functions/extraer/index.ts` → función que llama a Gemini sin exponer la llave

## Puesta en marcha (una sola vez)

1. **Proyecto Supabase nuevo y gratis** (recomendado, aparte del de Nube Eventos).
2. **SQL**: Supabase → SQL Editor → pegar todo `supabase/schema.sql` → Run.
3. **Usuaria**: Authentication → Users → Add user (correo y contraseña de tu esposa).
   Luego Authentication → Sign In / Providers → desactivar “Allow new users to sign up”
   para que nadie más pueda crear cuentas.
4. **Llave de Gemini (gratis)**: crearla en https://aistudio.google.com/apikey
5. **Función**: Edge Functions → Create function → nombre exacto `extraer` → pegar el
   contenido de `supabase/functions/extraer/index.ts` → Deploy.
   Luego Edge Functions → Secrets → agregar `GEMINI_API_KEY` con tu llave.
   (Opcional: `GEMINI_MODEL` si quieres otro modelo; por defecto `gemini-2.5-flash`.)
6. **Config**: en `js/config.js` poner `SUPABASE_URL` y `SUPABASE_ANON_KEY`
   (Project Settings → API).
7. **Subir a GitHub** y activar GitHub Pages. Ella entra al enlace desde Safari.

## Notas
- Si la IA falla o se acaba la cuota gratis, la página usa reglas simples y ella
  corrige en el formulario; nada se rompe.
- En la capa gratuita de Google, lo enviado puede usarse para mejorar sus productos:
  dictar siempre iniciales o apodos, no nombres completos.
- Probar primero en el iPad institucional que Safari permite el micrófono y el dictado.
  Si el dictado y la grabación de audio chocan, desmarcar “Guardar también el audio”.
- Los audios van a un bucket privado; cada usuaria solo accede a su carpeta.
