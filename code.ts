// --- CONFIGURACIÓN Y ESTADO GLOBAL ---
figma.showUI(__html__, { width: 360, height: 580, title: "Asistente de Contenido" });

const STORAGE_KEY = 'contentAssistantDecisions';

// --- FUNCIONES AUXILIARES ---
const esperar = (ms: number) => new Promise(res => setTimeout(res, ms));

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

async function guardarDecision(nodeId: string, termino: string, decision: 'omitido' | 'reemplazado') {
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

  if (msg.type === 'reemplazar-texto') {
    const { nodeId, terminoAntiguo, terminoNuevo } = msg;
    const nodo = await figma.getNodeByIdAsync(nodeId) as TextNode;

    if (nodo && nodo.type === 'TEXT') {
      await figma.loadFontAsync(nodo.fontName as FontName);
      
      const textoActual = nodo.characters;
      // Creamos un RegExp para reemplazar de forma case-insensitive
      const regex = new RegExp(terminoAntiguo.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
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
        if (decisionesGuardadas[errorId] && (decisionesGuardadas[errorId].estado === 'omitido' || decisionesGuardadas[errorId].estado === 'reemplazado')) {
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