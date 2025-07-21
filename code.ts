// --- CONFIGURACIÓN Y ESTADO GLOBAL ---
figma.showUI(__html__, { width: 340, height: 540, title: "Asistente de Contenido" });

let seguimientoActivo = true;

// --- FUNCIONES AUXILIARES ---
const esperar = (ms: number) => new Promise(res => setTimeout(res, ms));

function getNombreUbicacion(nodo: SceneNode): string {
  let parent = nodo.parent;
  while (parent) {
    if (parent.type === 'FRAME' || parent.type === 'COMPONENT' || parent.type === 'INSTANCE' || parent.type === 'GROUP') {
      return parent.name;
    }
    if (parent.type === 'PAGE') {
      break;
    }
    parent = parent.parent;
  }
  return "Canvas Principal";
}

function revisarTexto(nodo: TextNode, prohibidosString: string): string | null {
  const textoUsuario = nodo.characters.toLowerCase();
  if (!prohibidosString || prohibidosString.trim() === '') return null;
  const terminosProhibidos = prohibidosString
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0);

  for (const termino of terminosProhibidos) {
    if (textoUsuario.includes(termino)) {
      return termino;
    }
  }
  return null;
}

// --- MANEJO DE MENSAJES DESDE LA UI ---
figma.ui.onmessage = async (msg) => {

  if (msg.type === 'actualizar-seguimiento') {
    seguimientoActivo = msg.estado;
    return;
  }
  
  // ✅ LÓGICA ACTUALIZADA PARA REVISAR SELECCIÓN
  if (msg.type === 'revisar-seleccion') {
    const seleccion = figma.currentPage.selection;
    if (seleccion.length === 0) {
      figma.ui.postMessage({
        type: 'scan-finalizado',
        errores: [],
        mensaje: 'Debes seleccionar al menos un frame o texto.'
      });
      return;
    }
    
    figma.ui.postMessage({ type: 'scan-iniciado' });
    await esperar(100);

    let textosAAnalizar: TextNode[] = [];
    
    // Itera sobre cada elemento seleccionado
    for (const nodo of seleccion) {
      if (nodo.type === 'TEXT') {
        textosAAnalizar.push(nodo);
      } else if ('findAll' in nodo) { // Si es un contenedor (Frame, Group, etc.)
        const textosInternos = nodo.findAll(n => n.type === 'TEXT') as TextNode[];
        textosAAnalizar.push(...textosInternos);
      }
    }

    const erroresEncontrados = [];
    for (const capaDeTexto of textosAAnalizar) {
        const error = revisarTexto(capaDeTexto, msg.prohibidos);
        if (error) {
            erroresEncontrados.push({
                nodeId: capaDeTexto.id,
                texto: capaDeTexto.characters.substring(0, 50).replace(/\n/g, ' '),
                error: error,
                ubicacion: getNombreUbicacion(capaDeTexto)
            });
        }
    }

    // Reutiliza el mismo mensaje de finalización para mostrar una lista
    figma.ui.postMessage({ type: 'scan-finalizado', errores: erroresEncontrados });
  }

  if (msg.type === 'revisar-todo') {
    figma.ui.postMessage({ type: 'scan-iniciado' });
    await esperar(100); 

    seguimientoActivo = msg.seguimiento; 
    const todosLosTextos = figma.currentPage.findAll(n => n.type === 'TEXT') as TextNode[];
    const erroresEncontrados = [];

    for (const capaDeTexto of todosLosTextos) {
      const error = revisarTexto(capaDeTexto, msg.prohibidos);
      if (error) {
        erroresEncontrados.push({
          nodeId: capaDeTexto.id,
          texto: capaDeTexto.characters.substring(0, 50).replace(/\n/g, ' '),
          error: error,
          ubicacion: getNombreUbicacion(capaDeTexto)
        });
      }
      
      if (seguimientoActivo) {
        figma.viewport.scrollAndZoomIntoView([capaDeTexto]);
        await esperar(1000); 
      } else {
        await esperar(0); 
      }
    }
    
    figma.ui.postMessage({ type: 'scan-finalizado', errores: erroresEncontrados });
  }
  
  if (msg.type === 'ir-a-nodo') {
    const nodo = await figma.getNodeByIdAsync(msg.nodeId);
    if (nodo) {
      figma.viewport.scrollAndZoomIntoView([nodo]);
      figma.currentPage.selection = [nodo as SceneNode];
    }
  }
};