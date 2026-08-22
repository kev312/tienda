// api/chat.js
//
// Función serverless de Vercel (Edge Function) que hace de puente entre el
// widget de chat de index.html y la API de Claude (Anthropic).
//
// IMPORTANTE: la API key de Anthropic vive SOLO aquí, como variable de
// entorno del servidor. Nunca debe copiarse dentro de index.html ni de
// ningún archivo que se sirva al navegador: cualquier clave puesta en el
// frontend queda visible para cualquiera que abra las herramientas de
// desarrollador y puede ser robada y usada por terceros.
//
// Despliegue en Vercel:
//   1. En el dashboard del proyecto -> Settings -> Environment Variables
//      añade ANTHROPIC_API_KEY con tu clave (empieza por "sk-ant-...").
//   2. Vuelve a desplegar. Vercel detecta automáticamente cualquier
//      archivo dentro de /api como función serverless, no hace falta
//      configuración extra en un proyecto estático como este.

export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `Eres el asistente virtual de Streetwear Store, una tienda online de zapatillas y ropa urbana.

Marcas disponibles en el catalogo y su seccion (usa SIEMPRE estas rutas, son relativas a la raiz del sitio):
- Nike -> html/nike.html
- Jordan -> html/jordan.html
- Adidas -> html/adidas.html
- Corteiz -> html/corteiz.html
- New Balance -> html/nb.html
- Syna -> html/syna.html
- Trapstar -> html/trapstar.html
- Stussy -> html/stussy.html
- Bape -> html/bape.html
- Otras marcas -> html/otras.html

Reglas:
- Responde siempre en español, en texto plano corto (2-4 frases), sin markdown ni asteriscos.
- Si preguntan por una marca o producto del catalogo, dilo claramente e indica en que seccion encontrarlo.
- Si preguntan por algo que no esta en el catalogo (otra marca, un precio exacto, stock o plazos de envio concretos), NO lo inventes. Ofrece contactar por email (streetwearstorex1@gmail.com) o Instagram (@streetwear.store01).
- Nunca inventes precios, tallas disponibles, stock ni plazos de entrega que no te hayan dado explicitamente.
- Se cercano y directo, como un dependiente de tienda joven pero profesional.`;

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Metodo no permitido' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Falta la variable de entorno ANTHROPIC_API_KEY');
    return new Response(JSON.stringify({ error: 'Asistente no configurado' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'JSON invalido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 500) : '';
  if (!message) {
    return new Response(JSON.stringify({ error: 'Mensaje vacio' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // El historial lo manda el propio cliente (ver chatHistory en index.html);
  // lo acotamos y saneamos igualmente por si acaso.
  const rawHistory = Array.isArray(body.history) ? body.history.slice(-20) : [];
  const messages = rawHistory
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 1000) }));
  messages.push({ role: 'user', content: message });

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages
      })
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Error de la API de Anthropic:', anthropicRes.status, errText);
      return new Response(JSON.stringify({ error: 'El asistente no esta disponible ahora mismo' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await anthropicRes.json();
    const reply = (data.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim();

    return new Response(JSON.stringify({ reply: reply || 'Lo siento, no he podido procesar tu mensaje.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Error llamando a la API de Anthropic:', err);
    return new Response(JSON.stringify({ error: 'Error de conexion con el asistente' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
