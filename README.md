# emulator-mcp

MCP para que los agentes de programación vean **la misma página en varios tamaños**, interactúen y comprueben el resultado sin perder el estado entre llamadas.

- Pantallas persistentes: móviles, tablets y escritorio.
- Panel local lado a lado con capturas actualizadas cada 3 segundos.
- Scroll, navegación, clics y escritura en todas las pantallas o en una concreta.
- Capturas para modelos con visión, árbol accesible, auditoría responsive y eventos de consola/red.
- Chrome o Edge local. Sin claves API, sin servicio remoto ni descarga automática de navegadores.

## Installation

Necesitás **Node.js 20 o superior con npm/npx** y **Chrome o Microsoft Edge**. El MCP trabaja en la computadora donde lo ejecuta tu agente. Tu aplicación debe estar iniciada y ser accesible desde esa computadora.

El comando corto descarga el paquete desde el registro npm. No necesitás clonar el repositorio ni instalar Git. Ejecutá los instaladores desde la carpeta de la aplicación que quieras revisar.

### Conectar directamente como servidor MCP

Para Claude Code:

```bash
claude mcp add emulator -- npx -y emulator-mcp
```

Para Codex:

```bash
codex mcp add emulator -- npx -y emulator-mcp
```

En OpenCode, fusioná este bloque con tu configuración:

```json
{
  "mcp": {
    "emulator": {
      "type": "local",
      "command": ["npx", "-y", "emulator-mcp"],
      "enabled": true,
      "timeout": 60000
    }
  }
}
```

Los clientes con formato `mcpServers` pueden usar el bloque de [otros clientes](#otros-clientes-mcp-locales). Reiniciá el cliente y pedile al agente que abra tu URL con `open_responsive_session`.

También podés usar los instaladores siguientes para escribir la configuración del proyecto automáticamente.

### OpenCode

```bash
npx -y emulator-mcp install opencode
```

Agrega el servidor local a `opencode.json` o al `opencode.jsonc` existente. Después reiniciá OpenCode y comprobá la conexión con `opencode mcp list`.

### Cursor

```bash
npx -y emulator-mcp install cursor
```

Escribe `.cursor/mcp.json` en el proyecto. Recargá Cursor y habilitá el servidor en sus ajustes MCP si te lo solicita.

### Claude Code

```bash
npx -y emulator-mcp install claude-code
```

Agrega el servidor a `.mcp.json` del proyecto. Abrí Claude Code para aprobar el servidor cuando lo solicite. También podés usar su comando nativo para instalación a nivel usuario:

```bash
claude mcp add --scope user --transport stdio emulator-mcp -- npx -y emulator-mcp
```

### Codex

Usá su comando nativo; requiere que la CLI de Codex esté instalada:

```bash
codex mcp add emulator-mcp -- npx -y emulator-mcp
```

Después reiniciá o reconectá Codex y verificá que aparezca el servidor.

### VS Code (configuración local compatible)

```bash
npx -y emulator-mcp install vscode
```

Escribe el formato `servers` en `.vscode/mcp.json`. Su disponibilidad depende del agente/harness activo en VS Code; las configuraciones actuales de Copilot también permiten agregar un servidor mediante **MCP: Add Server → Command (stdio)** usando el comando de ejecución que figura abajo.

### Otros clientes MCP locales

Comando del servidor: `npx`. Argumentos:

```json
["-y", "emulator-mcp"]
```

Si tu cliente usa `mcpServers`, fusioná este bloque con su configuración:

```json
{
  "mcpServers": {
    "emulator-mcp": {
      "command": "npx",
      "args": ["-y", "emulator-mcp"]
    }
  }
}
```

En Windows, algunos clientes requieren `command: "cmd"` con argumentos `["/c", "npx", "-y", "emulator-mcp"]` para encontrar el ejecutable de npx. No cambies esto si tu cliente ya conecta correctamente.

El instalador conserva comentarios JSONC y otros servidores, respalda los archivos existentes y se niega a reemplazar una entrada `emulator-mcp` diferente. `install opencode --dry-run` muestra la configuración sin escribirla. La primera ejecución necesita conexión para descargar el paquete y sus dependencias; las siguientes aprovechan la caché de npm. La instalación registra el servidor; no comprueba por sí sola la conexión del agente ni acepta sus avisos de confianza.

## Primer uso

Pedile al agente:

> Usá emulator-mcp para abrir http://localhost:3000 en iPhone SE, iPad y laptop. Mostrame el enlace del panel, revisá la página por secciones haciendo scroll, compará las capturas y corregí los problemas responsive. Volvé a capturar para verificar.

El agente puede seguir este flujo:

1. `open_responsive_session`: abre la URL en varios dispositivos.
2. Abre o comparte el `dashboardUrl` devuelto para que puedas mirar el panel.
3. `observe_responsive_session` con `dom:true` y `returnImages:true`: obtiene elementos accesibles y capturas.
4. `interact_responsive_session`: hace scroll, clics o escribe. El estado persiste entre llamadas.
5. Tras modificar código, `navigate_responsive_session` dirige todas a la URL de la aplicación.
6. `close_responsive_session`: libera las pantallas cuando termine.

El modelo debe admitir imágenes para interpretar las capturas. Con modelos de texto puede usar el árbol accesible, evaluaciones y la auditoría. Las herramientas no deciden ni corrigen código solas: esa tarea corresponde al agente.

## Demo sin configurar un agente

```bash
npx -y emulator-mcp demo
```

Imprime un enlace al panel con la página de prueba incluida. Para tu aplicación ya iniciada:

```bash
npx -y emulator-mcp demo http://localhost:3000
```

Mantené ese proceso abierto y usá Ctrl+C para cerrar la demo.

## Herramientas

| Herramienta | Uso |
| --- | --- |
| `open_responsive_session` | Abre la misma URL en varios tamaños; devuelve IDs y enlace al panel |
| `list_responsive_sessions` | Recupera las sesiones y URLs actuales del proceso |
| `observe_responsive_session` | PNG por tamaño, DOM accesible opcional, auditoría y eventos |
| `navigate_responsive_session` | Navega todas a una URL conservando sus contextos y cookies |
| `interact_responsive_session` | Repite pasos en todas o actúa sobre un `screenId` |
| `close_responsive_session` | Cierra páginas y panel |
| `list_devices` | Catálogo de dispositivos y resoluciones |
| `screenshot_on` | Captura y auditoría puntual de un dispositivo |
| `preview_devices` | Capturas puntuales en varios tamaños |
| `check_responsive` | Auditoría responsive sin imágenes |
| `interact_on` | Flujo completo dentro de una llamada temporal |
| `emulator_status` | Navegador, directorio de capturas y diagnóstico |

Las herramientas puntuales cierran sus páginas al terminar. Las sesiones persistentes admiten hasta 6 tamaños y 3 sesiones por proceso. Por defecto: iPhone SE, iPhone 15 Pro Max, iPad Pro 11 y laptop.

### Ejemplos de argumentos MCP

Abrir una comparación:

```json
{"url":"http://localhost:3000","devices":["iphone-se","ipad-pro-11","laptop"]}
```

Observar con imágenes y auditoría (reemplazá ID por el `sessionId` devuelto):

```json
{"sessionId":"ID","dom":true,"audit":true,"returnImages":true}
```

Scroll hasta una sección en todas las pantallas:

```json
{"sessionId":"ID","screenId":"all","steps":[{"action":"scroll","selector":"#contacto"}]}
```

También admite `{"action":"scroll","to":"bottom"}`, `to:"top"` o `y:800`. Usá un elemento para comparar la misma sección cuando su posición cambia según el tamaño.

Acciones: `navigate`, `click`, `tap`, `dblclick`, `hover`, `type`, `press`, `scroll`, `wait_for`, `screenshot`, `get_text`, `count`, `eval`, `assert`, `back`, `reload`. Los localizadores admiten selector, testId, label, placeholder, role + name, alt o text. Las sesiones mantienen sus tamaños fijos; `set_viewport` solo está disponible en `interact_on`.

## Comportamiento y límites

- El panel muestra capturas de la región visible; se actualiza cada 3 segundos mientras está abierto. Permite ajustar la escala y pausar. Las acciones, incluido scroll, se ejecutan desde el MCP; el panel no transmite clics ni rueda del mouse a las páginas.
- `fullPage:true` en la observación guarda capturas de toda la página. En páginas largas pueden superar el límite de imágenes de la respuesta; el archivo sigue disponible por su ruta.
- Cada tamaño tiene cookies, almacenamiento y scroll independientes. Se inicia en la misma URL, pero un flujo puede terminar en rutas distintas. Para un menú que solo existe en móvil, actuá sobre ese `screenId`.
- Las sesiones viven dentro de un proceso MCP y desaparecen al cerrarlo. Dos agentes que ejecutan procesos separados tienen sesiones independientes.
- Emula páginas y aplicaciones web; no ejecuta Android, iOS ni aplicaciones nativas. Los perfiles iPhone se renderizan en Chromium, no en Safari real.
- La auditoría usa heurísticas; los resultados necesitan revisión visual. Aprobarla no equivale a una certificación de accesibilidad ni a validar producción.
- El panel escucha en `127.0.0.1` con una ruta aleatoria por sesión. No necesita iframes ni quitar CSP/X-Frame-Options. El enlace del panel es una vista local, no un endpoint MCP remoto.
- El agente puede ejecutar acciones reales en la web abierta. Usá cuentas y entornos adecuados para tus pruebas.

## Configuración

| Variable | Uso |
| --- | --- |
| `EMULATOR_MCP_BROWSER` | Orden de navegadores: `chrome,msedge,chromium` |
| `EMULATOR_MCP_HEADED` | Si está definida, muestra las ventanas del navegador |
| `EMULATOR_MCP_CAPTURE_DIR` | Directorio personalizado para PNG |

La CLI guarda capturas en `~/.emulator-mcp/captures`. El módulo `src/index.cjs`, usado directamente durante desarrollo, conserva el directorio `captures/` del proyecto. Para usar Chromium de Playwright, instalalo explícitamente con `npx playwright install chromium` desde una copia del proyecto y ajustá `EMULATOR_MCP_BROWSER=chromium`.

## Desarrollo y pruebas

```bash
git clone https://github.com/damipineda/emulator-mcp.git
cd emulator-mcp
npm ci
npm run smoke
npm test
npm run demo
npm pack --dry-run
```

Las pruebas cubren registro de herramientas, capturas y auditoría con Chrome/Edge, interacción, sesiones por transporte MCP stdio e instalación con preservación de configuraciones. No constituyen una prueba de cada interfaz de agente: conectá y ejecutá una herramienta desde tu cliente para verificar su integración.

## Referencias y licencia

Inspirado en [Mobile-Simulator](https://github.com/talah221/Mobile-Simulator). Su extensión y sus assets no se redistribuyen; este proyecto usa contextos de navegador controlados por [Playwright](https://playwright.dev/). Ver [NOTICE.md](NOTICE.md).

Formatos de integración consultados: [OpenCode](https://opencode.ai/docs/mcp-servers/), [Cursor](https://cursor.com/docs/mcp), [Claude Code](https://code.claude.com/docs/en/mcp), [Codex](https://developers.openai.com/codex/mcp), [VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

Licencia MIT. [Código fuente en GitHub](https://github.com/damipineda/emulator-mcp) y [paquete público en npm](https://www.npmjs.com/package/emulator-mcp).

## Publicación del mantenedor

```bash
npm login
npm run test:package
npm publish --access public
```

Después de publicar, verificar `npm view emulator-mcp version` y ejecutar `node test/package.cjs emulator-mcp`. Los usuarios no necesitan una cuenta npm para descargar el paquete público.

### Versión GitHub disponible

La versión anterior distribuida directamente desde GitHub sigue disponible:

```bash
npx -y --package=https://github.com/damipineda/emulator-mcp/archive/refs/tags/v0.2.0.tar.gz emulator-mcp
```
