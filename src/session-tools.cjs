const { z } = require('zod');
const fs = require('node:fs');
const sessions = require('./sessions.cjs');
const steps = require('./step-schema.cjs');

module.exports = function registerSessionTools(server) {
  function register(name, description, inputSchema, action, readOnly = false) {
    server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: readOnly, openWorldHint: true } }, async args => {
      try {
        const payload = await action(args);
        const content = [{ type: 'text', text: JSON.stringify(payload, null, 2) }];
        if (args.returnImages) {
          let budget = 10 * 1024 * 1024;
          for (const screen of payload.screens || []) {
            const capture = screen.capture;
            if (!capture || capture.bytes > budget) continue;
            budget -= capture.bytes;
            content.push({ type: 'text', text: `screenId: ${screen.screenId}, device: ${screen.device}` });
            content.push({ type: 'image', data: fs.readFileSync(capture.path).toString('base64'), mimeType: 'image/png' });
          }
        }
        return { content };
      } catch (err) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
    });
  }
  const sessionId = z.string().describe('ID devuelto por open_responsive_session; permanece valido hasta cerrar la sesion o detener el MCP');
  register('open_responsive_session',
    'Abre la MISMA URL en varios tamaños y mantiene las paginas entre llamadas MCP. Devuelve sessionId, screenIds y dashboardUrl: abre ese enlace para ver capturas lado a lado actualizadas cada 3 segundos. Cada pantalla mantiene su propio estado web. No requiere iframes ni quitar cabeceras de seguridad.',
    { url: z.string(), devices: z.array(z.string()).min(1).max(6).optional(), locale: z.string().optional(), colorScheme: z.enum(['light', 'dark', 'no-preference']).optional() },
    args => sessions.open(args));
  register('list_responsive_sessions',
    'Lista las comparaciones responsive abiertas en este proceso MCP, con sus sessionIds, screenIds, tamaños, URLs actuales y enlace al panel visual. Las sesiones conservan su estado entre llamadas y desaparecen al detener el servidor.',
    {}, () => ({ sessions: sessions.list() }), true);
  register('observe_responsive_session',
    'Observa las pantallas abiertas sin recargarlas: guarda un PNG por tamaño y devuelve estado, URLs y eventos recientes de consola/red. Pide dom para obtener el arbol accesible, audit para revisar el layout y returnImages para que el agente vea las capturas dentro de la respuesta MCP.',
    { sessionId, audit: z.boolean().optional(), dom: z.boolean().optional(), fullPage: z.boolean().optional(), returnImages: z.boolean().optional() },
    args => sessions.observe(args.sessionId, args), true);
  register('navigate_responsive_session',
    'Navega TODAS las pantallas de una comparacion a la misma URL, conservando sus contextos, cookies y tamaños. Para recargar todas tras modificar el codigo, vuelve a pasar la URL. Devuelve resultado por pantalla y errores sin ocultar fallos parciales.',
    { sessionId, url: z.string() }, args => sessions.navigate(args.sessionId, args.url));
  register('interact_responsive_session',
    'Ejecuta pasos en una pantalla o repite la secuencia en todas (screenId="all", predeterminado). Mantiene el estado para la proxima llamada. Usa localizadores semanticos porque el DOM puede variar segun el tamaño. Si un menu solo existe en movil, actua sobre ese screenId. Devuelve cada fallo por pantalla; despues usa observe_responsive_session para ver el resultado.',
    { sessionId, screenId: z.string().default('all'), steps },
    args => sessions.interact(args.sessionId, args.screenId, args.steps));
  register('close_responsive_session',
    'Cierra una comparacion responsive completa: libera sus paginas, contextos y servidor del panel visual. Usa esta herramienta al terminar para no acumular navegadores. Las capturas guardadas permanecen disponibles en disco.',
    { sessionId }, args => sessions.close(args.sessionId));
};
