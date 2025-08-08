// --- CONFIGURACIÓN Y ESTADO GLOBAL ---
figma.showUI(__html__, { width: 360, height: 580, title: "Asistente de Contenido" });

// Namespace de almacenamiento por documento usando pluginData en el root
function getDocKey(): string {
  let key = figma.root.getPluginData('contentAssistantDocKey');
  if (!key) {
    key = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    figma.root.setPluginData('contentAssistantDocKey', key);
  }
  return key;
}
const STORAGE_KEY = `contentAssistantDecisions:${getDocKey()}`;

// --- FUNCIONES AUXILIARES ---
const esperar = (ms: number) => new Promise(res => setTimeout(res, ms));

// Carga todas las fuentes utilizadas en un TextNode (maneja estilos mixtos)
async function loadFontsInNode(textNode: TextNode) {
  try {
    const segments = textNode.getStyledTextSegments(["fontName"]);
    const unique: FontName[] = [];
    for (const seg of segments) {
      const f = seg.fontName as FontName;
      if (!unique.some(u => u.family === f.family && u.style === f.style)) {
        unique.push(f);
      }
    }
    await Promise.all(unique.map(f => figma.loadFontAsync(f)));
  } catch (e) {
    // Fallback: si falla por algún motivo, intenta con fontName si no es mixed
    if (textNode.fontName && textNode.fontName !== figma.mixed) {
      await figma.loadFontAsync(textNode.fontName as FontName);
    }
  }
}

function getNombreUbicacion(nodo: SceneNode): string {
  let parent = nodo.parent;
  while (parent) {
    if (parent.type === 'FRAME' || parent.type === 'COMPONENT' || parent.type === 'INSTANCE' || parent.type === 'GROUP') {
      return parent.name;
    }
    if (parent.type === 'PAGE') break;
    parent = parent.parent;
  }
  return "Canvas Principal";
}

async function guardarDecision(nodeId: string, termino: string, decision: 'omitido' | 'reemplazado' | 'listo') {
  const decisiones = await figma.clientStorage.getAsync(STORAGE_KEY) || {};
  const errorId = `${nodeId}__${termino}`; // Usamos doble guion bajo para más seguridad
  decisiones[errorId] = { estado: decision };
  await figma.clientStorage.setAsync(STORAGE_KEY, decisiones);
}

// --- MANEJO DE MENSAJES DESDE LA UI ---
figma.ui.onmessage = async (msg) => {

  if (msg.type === 'limpiar-memoria') {
    await figma.clientStorage.setAsync(STORAGE_KEY, {});
    figma.ui.postMessage({ type: 'memoria-limpiada' });
    return;
  }
  
  if (msg.type === 'omitir-error') {
    await guardarDecision(msg.nodeId, msg.termino, 'omitido');
    figma.ui.postMessage({ type: 'decision-guardada', nodeId: msg.nodeId, termino: msg.termino, decision: 'omitido' });
    return;
  }

  if (msg.type === 'marcar-listo') {
    await guardarDecision(msg.nodeId, msg.termino, 'listo');
    figma.ui.postMessage({ type: 'decision-guardada', nodeId: msg.nodeId, termino: msg.termino, decision: 'listo' });
    return;
  }

  if (msg.type === 'reemplazar-texto') {
    const { nodeId, terminoAntiguo, terminoNuevo } = msg;
    const nodo = await figma.getNodeByIdAsync(nodeId) as TextNode;

    if (nodo && nodo.type === 'TEXT') {
      await loadFontsInNode(nodo);
      
      const textoActual = nodo.characters;
      // Creamos un RegExp para reemplazar de forma case-insensitive
      const regex = new RegExp(terminoAntiguo.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
      const textoNuevo = textoActual.replace(regex, terminoNuevo);
      
      nodo.characters = textoNuevo;

      // Guardamos la decisión para no volver a mostrar este error
      await guardarDecision(nodeId, terminoAntiguo, 'reemplazado');

      figma.ui.postMessage({ 
        type: 'decision-guardada',
        nodeId,
        termino: terminoAntiguo,
        decision: 'reemplazado',
        terminoNuevo
      });

      // Navega al nodo tras reemplazar
      figma.currentPage.selection = [nodo];
      figma.viewport.scrollAndZoomIntoView([nodo]);
    }
    return;
  }
  
  if (msg.type === 'revisar-seleccion' || msg.type === 'revisar-todo') {
    figma.ui.postMessage({ type: 'scan-iniciado' });
    
    // ✅ Carga la memoria al iniciar la búsqueda
    const decisionesGuardadas = await figma.clientStorage.getAsync(STORAGE_KEY) || {};

    let textosAAnalizar: TextNode[];

    if (msg.type === 'revisar-seleccion') {
      textosAAnalizar = [];
      for (const nodo of figma.currentPage.selection) {
        if (nodo.type === 'TEXT') textosAAnalizar.push(nodo);
        else if ('findAll' in nodo) textosAAnalizar.push(...(nodo.findAll(n => n.type === 'TEXT') as TextNode[]));
      }
    } else {
      textosAAnalizar = figma.currentPage.findAll(n => n.type === 'TEXT') as TextNode[];
    }

    const erroresEncontrados = [];
    const terminosBuscados = msg.prohibidos
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0);
    
    for (const capaDeTexto of textosAAnalizar) {
      for (const termino of terminosBuscados) {
        const errorId = `${capaDeTexto.id}__${termino}`;
        
        // ✅ Si la decisión ya está en memoria, la salta
  if (decisionesGuardadas[errorId] && (decisionesGuardadas[errorId].estado === 'omitido' || decisionesGuardadas[errorId].estado === 'reemplazado' || decisionesGuardadas[errorId].estado === 'listo')) {
          continue; 
        }

        if (capaDeTexto.characters.toLowerCase().includes(termino)) {
          erroresEncontrados.push({
              nodeId: capaDeTexto.id,
              texto: capaDeTexto.characters.substring(0, 50).replace(/\n/g, ' '),
              error: termino,
              ubicacion: getNombreUbicacion(capaDeTexto)
          });
        }
      }
    }
    
    figma.ui.postMessage({ type: 'scan-finalizado', errores: erroresEncontrados });
    return;
  }
  
  if (msg.type === 'ir-a-nodo') {
    const nodo = await figma.getNodeByIdAsync(msg.nodeId);
    if (nodo) {
      figma.viewport.scrollAndZoomIntoView([nodo]);
      figma.currentPage.selection = [nodo as SceneNode];
    }
  }
};