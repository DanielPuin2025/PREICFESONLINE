// =====================================================================
// editor-seguro.js  (va DESPUÉS de script.js en index.html)
//
//  1) TEXTO ENRIQUECIDO (Quill) para Profesor/a y Admin: enunciados y
//     opciones con negritas (Ctrl+B), superíndices (x²), subíndices, listas...
//     Se guardan como HTML en columnas TEXT de MySQL.
//     ✏️ Profesores Y administradores pueden elegir cómo definen la respuesta
//     correcta: "elegir la letra" o "escribir el texto (letra aleatoria)".
//     ✏️ Profesores Y administradores pueden marcar que una pregunta "va con
//     el texto de la anterior" para que se mantengan seguidas al barajar.
//  2) MODO EXAMEN SEGURO para Estudiantes: bloquea clic derecho, copiar,
//     pegar, cortar, PrintScreen y atajos de captura; ante un intento de
//     trampa oscurece la pantalla (CSS backdrop-filter).
//  3) EXPULSIÓN INMEDIATA: si el estudiante sale de la ventana del examen
//     (otra pestaña, otra aplicación, minimizar), el examen se anula y vuelve
//     al menú principal.
//
// Este archivo redefine o envuelve algunas funciones globales de script.js
// (agregarBloquePregunta, leerPreguntasDelFormulario, iniciarSesion, etc.),
// por eso NO hay que modificar script.js.
// =====================================================================

// =====================================================================
// 1) TEXTO ENRIQUECIDO
// =====================================================================

// Si el texto trae etiquetas de formato (lo que guarda el editor) se muestra como HTML.
// Las preguntas antiguas (texto plano) se escapan para que caracteres como "<" o "&" se vean tal cual.
const REGEX_HTML_RICO = /<\/?(p|br|strong|b|em|i|u|s|sub|sup|ul|ol|li|blockquote|img)\b[^>]*>/i;

function renderRico(texto) {
    const t = String(texto === null || texto === undefined ? '' : texto);
    if (REGEX_HTML_RICO.test(t)) return t; // el servidor ya lo limpió con sanitize-html
    return escaparHtml(t).replace(/\n/g, '<br>');
}

const FORMATOS_EDITOR = ['bold', 'italic', 'underline', 'strike', 'script', 'list'];

const BARRA_ENUNCIADO = [
    ['bold', 'italic', 'underline', 'strike'],
    [{ script: 'sub' }, { script: 'super' }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['clean']
];

const BARRA_OPCION = [
    ['bold', 'italic', 'underline'],
    [{ script: 'sub' }, { script: 'super' }],
    ['clean']
];

// Atajos extra: Ctrl + .  -> superíndice (x²)   |   Ctrl + ,  -> subíndice (H₂O)
// (Ctrl+B negrita, Ctrl+I cursiva y Ctrl+U subrayado ya vienen con Quill; en Mac es Cmd)
function atajosDeScript() {
    return {
        superindice: {
            key: 190, shortKey: true,
            handler: function (range, contexto) {
                this.quill.format('script', contexto.format.script === 'super' ? false : 'super', 'user');
                return false;
            }
        },
        subindice: {
            key: 188, shortKey: true,
            handler: function (range, contexto) {
                this.quill.format('script', contexto.format.script === 'sub' ? false : 'sub', 'user');
                return false;
            }
        }
    };
}

// Convierte el <div> indicado en un editor Quill.
// tipo 'enunciado': barra completa. tipo 'opcion': barra corta y una sola línea (Enter no hace nada).
function crearEditorRico(contenedor, tipo, placeholder) {
    if (typeof Quill === 'undefined') {
        throw new Error('Quill no está cargado (revisa la conexión a internet).');
    }

    const atajos = atajosDeScript();
    if (tipo === 'opcion') {
        atajos.unaLinea = { key: 13, handler: function () { return false; } };
    }

    return new Quill(contenedor, {
        theme: 'snow',
        placeholder: placeholder || '',
        formats: FORMATOS_EDITOR,
        modules: {
            toolbar: tipo === 'opcion' ? BARRA_OPCION : BARRA_ENUNCIADO,
            keyboard: { bindings: atajos }
        }
    });
}

// Crea los editores de un grupo de campos dentro de un bloque de pregunta.
// Guarda cada editor en bloque._editores[campo]. No repite los que ya existen.
function iniciarEditoresEn(bloque, selectorGrupo) {
    bloque._editores = bloque._editores || {};

    bloque.querySelectorAll(selectorGrupo + ' .cp-rico[data-campo]').forEach(envoltura => {
        const campo = envoltura.dataset.campo;
        if (bloque._editores[campo]) return;

        bloque._editores[campo] = crearEditorRico(
            envoltura.querySelector('.cp-rico-editor'),
            envoltura.dataset.tipo,
            envoltura.dataset.placeholder
        );
    });
}

// Mueve cada botón "+" (imagen de la opción) DENTRO del área de escritura
// (.ql-container), para poder centrarlo verticalmente con CSS (top: 50%).
// Se puede llamar varias veces sin problema.
function anclarBotonesMas(bloque) {
    bloque.querySelectorAll('.cp-opcion-fila').forEach(fila => {
        const btn = fila.querySelector(':scope > .cp-opcion-agregar');
        const cont = fila.querySelector('.ql-container');
        if (btn && cont) cont.appendChild(btn);
    });
}

// ¿El editor no tiene ningún texto? (un editor vacío de Quill devuelve "<p><br></p>")
function editorVacio(editor) {
    return !editor || editor.getText().trim().length === 0;
}

// HTML que se envía al servidor ('' si el editor está vacío)
function htmlDeEditor(editor) {
    return editorVacio(editor) ? '' : editor.root.innerHTML;
}

// Pone HTML (o texto plano antiguo) dentro de un editor sin mover el cursor ni el scroll
function ponerHtmlEnEditor(editor, contenido) {
    if (!editor) return;
    editor.setContents(editor.clipboard.convert(renderRico(contenido)), 'silent');
}

// --- Reemplazos de funciones de script.js (formulario "Crear prueba") ---
// --- Imagen en cada opción de respuesta ---
let campoOpcionObjetivo = null;   // opción a la que se le está añadiendo la imagen (null = imagen del enunciado)

const abrirModalImagenOriginal = abrirModalImagen;
window.abrirModalImagen = function (elemento) {
    campoOpcionObjetivo = null;   // el "+" del enunciado
    abrirModalImagenOriginal(elemento);
};

function abrirModalImagenOpcion(elemento) {
    const fila = elemento.closest('.cp-opcion-fila');
    abrirModalImagenOriginal(elemento);
    campoOpcionObjetivo = fila ? fila.dataset.opc : null;
}

// Cuando el modal entrega la imagen: si venía de una opción, va a esa opción
const asignarImagenABloqueOriginal = asignarImagenABloque;
window.asignarImagenABloque = function (bloque, dataUrl) {
    if (campoOpcionObjetivo) {
        const campo = campoOpcionObjetivo;
        campoOpcionObjetivo = null;
        asignarImagenOpcion(bloque, campo, dataUrl);
        return;
    }
    asignarImagenABloqueOriginal(bloque, dataUrl);
};

function asignarImagenOpcion(bloque, campo, valor) {
    if (!bloque) return;
    bloque._imagenesOpc = bloque._imagenesOpc || {};
    bloque._imagenesOpc[campo] = valor;

    const fila = bloque.querySelector('.cp-opcion-fila[data-opc="' + campo + '"]');
    if (!fila) return;
    fila.querySelector('.cp-opcion-vista').src = valor;
    fila.querySelector('.cp-opcion-agregar').classList.add('oculto');
    fila.querySelector('.cp-opcion-preview').classList.remove('oculto');
}

function quitarImagenOpcion(elemento) {
    const fila = elemento.closest('.cp-opcion-fila');
    const bloque = elemento.closest('.cp-bloque-pregunta');
    if (!fila || !bloque) return;

    if (bloque._imagenesOpc) delete bloque._imagenesOpc[fila.dataset.opc];
    fila.querySelector('.cp-opcion-vista').src = '';
    fila.querySelector('.cp-opcion-preview').classList.add('oculto');
    fila.querySelector('.cp-opcion-agregar').classList.remove('oculto');
}

// Envuelve cada editor de opción con su botón "+" y su vista previa de imagen
function envolverOpcionesConImagen(bloque) {
    bloque.querySelectorAll('.cp-rico-opcion[data-campo]').forEach(rico => {
        const fila = document.createElement('div');
        fila.className = 'cp-opcion-fila';
        fila.dataset.opc = rico.dataset.campo;
        rico.parentNode.insertBefore(fila, rico);
        fila.appendChild(rico);

        fila.insertAdjacentHTML('beforeend', `
            <div class="cp-opcion-agregar" role="button" tabindex="0"
                 title="Añadir imagen a esta opción" aria-label="Añadir imagen a esta opción"
                 onclick="abrirModalImagenOpcion(this)"
                 onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.click(); }">+</div>
            <div class="cp-opcion-preview oculto">
                <img class="cp-opcion-vista" alt="Imagen de la opción">
                <div class="cp-imagen-acciones">
                    <span class="cp-imagen-cambiar" onclick="abrirModalImagenOpcion(this)">Cambiar imagen</span>
                    <span class="cp-imagen-quitar" onclick="quitarImagenOpcion(this)">✕ Quitar imagen</span>
                </div>
            </div>
        `);
    });
}

// Separa el texto de una opción de su imagen (la imagen viene pegada al final del HTML)
function separarImagenOpcion(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html === null || html === undefined ? '' : html);
    const img = t.content.querySelector('img');
    const src = img ? img.getAttribute('src') : null;
    if (img) img.remove();
    return { html: t.innerHTML, src };
}

// Añade un bloque de pregunta nuevo con sus editores
function agregarBloquePregunta(hacerScroll = true) {
    const plantilla = document.getElementById('tpl-pregunta-cp');
    const contenedor = document.getElementById('cp-preguntas');
    if (!plantilla || !contenedor) return;

    contenedor.appendChild(plantilla.content.cloneNode(true));
    const bloque = contenedor.lastElementChild;
    envolverOpcionesConImagen(bloque);

    // El selector "cómo se define la respuesta correcta" (elegir la letra o
    // escribir el texto con letra aleatoria) lo ven profesores Y administradores.
    const selector = bloque.querySelector('.cp-modo-selector');
    if (selector) selector.classList.remove('oculto');

    // ✏️ La casilla "va con la pregunta anterior" ahora también la ven los profesores:
    // ya no se oculta según el rol.

    try {
        iniciarEditoresEn(bloque, '.cp-enunciado-caja');
        iniciarEditoresEn(bloque, '.cp-modo-letra');
        anclarBotonesMas(bloque);   // centra el "+" dentro del área de escritura
    } catch (err) {
        console.error('⚠️ No se pudo cargar el editor de texto:', err);
        mostrarAviso('⚠️ No se pudo cargar el editor de texto. Revisa tu conexión a internet y recarga la página.');
    }

    renumerarBloquesPregunta();

    if (hacerScroll && bloque) {
        bloque.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// Cambia entre "elegir la letra" y "escribir el texto (letra aleatoria)".
// Los editores del modo aleatorio se crean la primera vez que se usa ese modo.
function cambiarModoRespuesta(select) {
    const bloque = select.closest('.cp-bloque-pregunta');
    if (!bloque) return;

    const aleatoria = select.value === 'aleatoria';
    bloque.querySelector('.cp-modo-letra').classList.toggle('oculto', aleatoria);
    bloque.querySelector('.cp-modo-aleatoria').classList.toggle('oculto', !aleatoria);

    if (aleatoria) {
        try {
            iniciarEditoresEn(bloque, '.cp-modo-aleatoria');
            anclarBotonesMas(bloque);   // centra el "+" de las opciones del modo aleatorio
        } catch (err) {
            console.error('⚠️ No se pudo cargar el editor de texto:', err);
        }
    }

    // La lista de la letra correcta solo es obligatoria en el modo "letra"
    bloque.querySelector('.cp-correcta').required = !aleatoria;
}

// Lee todos los bloques y arma la lista que se envía al servidor (HTML de cada editor).
// El modo de la respuesta ('letra' o 'aleatoria') se lee del selector de cada
// pregunta para cualquier rol.
function leerPreguntasDelFormulario() {
    const bloques = document.querySelectorAll('#cp-preguntas .cp-bloque-pregunta');

    return Array.from(bloques).map(b => {
        const ed = b._editores || {};
        const base = {
            id: b._preguntaId || null,
            enunciado: htmlDeEditor(ed.enunciado),
            imagen: b._imagen || null,
            // true si la pregunta va pegada a la anterior (admin y profesor)
            con_anterior: !!(b.querySelector('.cp-con-anterior-check') && b.querySelector('.cp-con-anterior-check').checked)
        };

        const selectorModo = b.querySelector('.cp-modo-respuesta');
        const modo = selectorModo ? selectorModo.value : 'letra';

        // Solo se envían las imágenes de las opciones del modo que está activo
        const camposModo = modo === 'aleatoria' ? ['texto_correcta', 'inc1', 'inc2', 'inc3'] : ['a', 'b', 'c', 'd'];
        const imagenes_opciones = {};
        camposModo.forEach(c => {
            if (b._imagenesOpc && b._imagenesOpc[c]) imagenes_opciones[c] = b._imagenesOpc[c];
        });

        if (modo === 'aleatoria') {
            return {
                ...base,
                modo: 'aleatoria',
                texto_correcta: htmlDeEditor(ed.texto_correcta),
                incorrectas: [htmlDeEditor(ed.inc1), htmlDeEditor(ed.inc2), htmlDeEditor(ed.inc3)],
                imagenes_opciones
            };
        }

        return {
            ...base,
            modo: 'letra',
            opcion_a: htmlDeEditor(ed.a),
            opcion_b: htmlDeEditor(ed.b),
            opcion_c: htmlDeEditor(ed.c),
            opcion_d: htmlDeEditor(ed.d),
            respuesta_correcta: b.querySelector('.cp-correcta').value,
            imagenes_opciones
        };
    });
}

// Llena el formulario con las preguntas que ya existían (para editarlas)
function llenarBloquesDesdePreguntas(preguntas) {
    const contenedor = document.getElementById('cp-preguntas');
    contenedor.innerHTML = '';

    preguntas.forEach(q => {
        agregarBloquePregunta(false);
        const bloque = contenedor.lastElementChild;
        const ed = bloque._editores;
        if (!ed) return;

        bloque._preguntaId = q.id;

        // Marca la casilla si la pregunta iba con la anterior
        const casillaAnterior = bloque.querySelector('.cp-con-anterior-check');
        if (casillaAnterior) casillaAnterior.checked = !!Number(q.con_anterior);

        ponerHtmlEnEditor(ed.enunciado, q.enunciado);

        if (Number(q.aleatoria)) {
            // Pregunta aleatoria: se abre en modo "escribir el texto (letra aleatoria)"
            const selector = bloque.querySelector('.cp-modo-respuesta');
            selector.value = 'aleatoria';
            cambiarModoRespuesta(selector); // crea los editores de este modo

            const opciones = { A: q.opcion_a, B: q.opcion_b, C: q.opcion_c, D: q.opcion_d };
            const camposIncorrectas = ['inc1', 'inc2', 'inc3'];
            let k = 0;

            ['A', 'B', 'C', 'D'].forEach(letra => {
                const campo = letra === q.respuesta_correcta ? 'texto_correcta' : camposIncorrectas[k++];
                const partes = separarImagenOpcion(opciones[letra]);
                ponerHtmlEnEditor(bloque._editores[campo], partes.html);
                if (partes.src) asignarImagenOpcion(bloque, campo, partes.src);
            });
        } else {
            // Pregunta fija: modo "elegir la letra"
            [['a', q.opcion_a], ['b', q.opcion_b], ['c', q.opcion_c], ['d', q.opcion_d]].forEach(([campo, html]) => {
                const partes = separarImagenOpcion(html);
                ponerHtmlEnEditor(ed[campo], partes.html);
                if (partes.src) asignarImagenOpcion(bloque, campo, partes.src);
            });
            bloque.querySelector('.cp-correcta').value = q.respuesta_correcta;
        }

        if (q.imagen) asignarImagenABloque(bloque, q.imagen);
    });

    if (preguntas.length === 0) agregarBloquePregunta(false);
}

// --- Reemplazos de funciones de script.js (mostrar preguntas con formato) ---

// Opción de respuesta: la letra en negrilla y el texto con su formato (x², negritas...)
function escribirOpcionEn(prefijoId, letra, texto) {
    const el = document.getElementById(prefijoId + letra);
    el.innerHTML = '';

    const spanLetra = document.createElement('span');
    spanLetra.className = 'prueba-opcion-letra';
    spanLetra.textContent = letra + '.';

    const cuerpo = document.createElement('div');
    cuerpo.className = 'prueba-opcion-texto';
    cuerpo.innerHTML = renderRico(texto);

    el.appendChild(spanLetra);
    el.appendChild(cuerpo);
}

// Enunciado con formato (el resto de renderizarPregunta se conserva tal cual)
const renderizarPreguntaOriginal = renderizarPregunta;
window.renderizarPregunta = function () {
    renderizarPreguntaOriginal();
    const pregunta = preguntasMateriaActual[indicePreguntaActual];
    if (pregunta) {
        document.getElementById('prueba-enunciado').innerHTML = renderRico(pregunta.enunciado);
    }
};

const renderizarPreguntaPPOriginal = renderizarPreguntaPP;
window.renderizarPreguntaPP = function () {
    renderizarPreguntaPPOriginal();
    const pregunta = ppPreguntas[ppIndice];
    if (pregunta) {
        document.getElementById('pp-enunciado').innerHTML = renderRico(pregunta.enunciado);
    }
};

// Detalle pregunta por pregunta del historial (con formato)
async function verPreguntasMateria(resultadoId, materia) {
    document.querySelectorAll('.dropdown-materias').forEach(d => d.classList.add('oculto'));

    const modal = document.getElementById('modal-detalle');
    const cuerpo = document.getElementById('modal-detalle-cuerpo');
    document.getElementById('modal-detalle-titulo').innerText = materia;
    cuerpo.innerHTML = '<p class="dropdown-cargando">Cargando preguntas...</p>';
    modal.classList.remove('oculto');

    try {
        const url = `/api/resultado-preguntas?resultado_id=${resultadoId}&materia=${encodeURIComponent(materia)}&correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();
        const preguntas = datos.preguntas || [];

        if (preguntas.length === 0) {
            cuerpo.innerHTML = '<p class="dropdown-cargando">No hay preguntas registradas para esta materia.</p>';
            return;
        }

        cuerpo.innerHTML = preguntas.map((p, i) => {
            const opciones = { A: p.opcion_a, B: p.opcion_b, C: p.opcion_c, D: p.opcion_d };
            const opcionesHtml = Object.entries(opciones).map(([letra, texto]) => {
                let clase = 'detalle-opcion';
                if (letra === p.respuesta_correcta) clase += ' opcion-correcta';
                if (letra === p.opcion_elegida && letra !== p.respuesta_correcta) clase += ' opcion-incorrecta';
                return `<div class="${clase}">${letra}. ${renderRico(texto)}</div>`;
            }).join('');

            const estado = p.es_correcta
                ? '<span class="detalle-estado detalle-estado-ok">✔ Correcta</span>'
                : '<span class="detalle-estado detalle-estado-mal">✘ Incorrecta</span>';

            const imagenHtml = p.imagen
                ? `<img src="${escaparHtml(p.imagen)}" alt="Imagen de la pregunta" class="detalle-pregunta-imagen">`
                : '';

            return `
                <div class="detalle-pregunta-card">
                    <p class="detalle-pregunta-numero">Pregunta ${i + 1} ${estado}</p>
                    ${imagenHtml}
                    <div class="detalle-pregunta-enunciado">${renderRico(p.enunciado)}</div>
                    <div class="detalle-opciones">${opcionesHtml}</div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('⚠️ No se pudieron cargar las preguntas de la materia:', err);
        cuerpo.innerHTML = '<p class="dropdown-cargando">Error al cargar las preguntas.</p>';
    }
}

// =====================================================================
// 2) MODO EXAMEN SEGURO (solo estudiantes)
// =====================================================================
const ModoExamen = {
    activo: false,
    tipo: null,        // 'nivel' (prueba de un nivel B/A/S) o 'pp' (prueba de profesor)
    referencia: null,  // por ejemplo "B-S1" o el id de la prueba de profesor
    temporizadorEscudo: null
};

function activarModoExamen(tipo, referencia) {
    if (rolActual !== 'estudiante') return;

    ModoExamen.activo = true;
    ModoExamen.tipo = tipo;
    ModoExamen.referencia = String(referencia === undefined ? '' : referencia);

    document.body.classList.add('modo-examen');
    if (window.getSelection) window.getSelection().removeAllRanges();
}

function desactivarModoExamen() {
    ModoExamen.activo = false;
    ModoExamen.tipo = null;
    ModoExamen.referencia = null;

    document.body.classList.remove('modo-examen');
    clearTimeout(ModoExamen.temporizadorEscudo);
    const escudo = document.getElementById('escudo-examen');
    if (escudo) escudo.classList.remove('activo');
}

// Oscurece y desenfoca toda la pantalla unos segundos (CSS: backdrop-filter blur + brightness)
function activarEscudo(motivo) {
    if (!ModoExamen.activo) return;

    const escudo = document.getElementById('escudo-examen');
    if (!escudo) return;

    document.getElementById('escudo-motivo').textContent = motivo || '';
    escudo.classList.add('activo');

    clearTimeout(ModoExamen.temporizadorEscudo);
    ModoExamen.temporizadorEscudo = setTimeout(() => escudo.classList.remove('activo'), 3000);
}

// Intenta vaciar el portapapeles (tras PrintScreen, la captura queda copiada en él)
function vaciarPortapapeles() {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(' ').catch(() => {});
        }
    } catch (e) { /* algunos navegadores no lo permiten */ }
}

// Devuelve el motivo si la combinación de teclas está prohibida, o null si se permite
function motivoDeTecla(e) {
    const ctrl = e.ctrlKey || e.metaKey;

    if (e.key === 'PrintScreen' || e.code === 'PrintScreen') return 'Intento de captura de pantalla';
    if (e.key === 'F12') return 'Intento de abrir las herramientas del navegador';

    // Capturas de pantalla: Cmd+Shift+3/4/5 (Mac) y Win+Shift+S (Windows)
    if (e.metaKey && e.shiftKey && ['Digit3', 'Digit4', 'Digit5', 'KeyS'].includes(e.code)) {
        return 'Intento de captura de pantalla';
    }

    // Herramientas de desarrollo: Ctrl+Shift+I / J / C
    if (ctrl && e.shiftKey && ['KeyI', 'KeyJ', 'KeyC'].includes(e.code)) {
        return 'Intento de abrir las herramientas del navegador';
    }

    if (ctrl && !e.shiftKey) {
        if (e.code === 'KeyC') return 'Copiar está deshabilitado';
        if (e.code === 'KeyX') return 'Cortar está deshabilitado';
        if (e.code === 'KeyV') return 'Pegar está deshabilitado';
        if (['KeyA', 'KeyP', 'KeyS', 'KeyU', 'KeyF'].includes(e.code)) return 'Atajo de teclado no permitido';
    }

    // Otras formas de copiar / pegar / cortar
    if (e.code === 'Insert' && (ctrl || e.shiftKey)) return 'Copiar y pegar están deshabilitados';
    if (e.code === 'Delete' && e.shiftKey) return 'Cortar está deshabilitado';

    return null;
}

(function iniciarBloqueosDeExamen() {
    const usarCaptura = { capture: true };

    // Clic derecho
    document.addEventListener('contextmenu', e => {
        if (!ModoExamen.activo) return;
        e.preventDefault();
        activarEscudo('El clic derecho está deshabilitado');
    }, usarCaptura);

    // Copiar, cortar, pegar
    ['copy', 'cut', 'paste'].forEach(evento => {
        document.addEventListener(evento, e => {
            if (!ModoExamen.activo) return;
            e.preventDefault();
            if (e.clipboardData) e.clipboardData.setData('text/plain', '');
            activarEscudo(evento === 'paste' ? 'Pegar está deshabilitado'
                : evento === 'cut' ? 'Cortar está deshabilitado' : 'Copiar está deshabilitado');
        }, usarCaptura);
    });

    // Arrastrar / seleccionar contenido
    ['dragstart', 'selectstart'].forEach(evento => {
        document.addEventListener(evento, e => {
            if (ModoExamen.activo) e.preventDefault();
        }, usarCaptura);
    });

    // Teclas prohibidas
    document.addEventListener('keydown', e => {
        if (!ModoExamen.activo) return;
        const motivo = motivoDeTecla(e);
        if (!motivo) return;

        e.preventDefault();
        e.stopImmediatePropagation();
        if (motivo.includes('captura')) vaciarPortapapeles();
        activarEscudo(motivo);
    }, usarCaptura);

    // En Windows, PrintScreen suele llegar solo como "keyup"
    document.addEventListener('keyup', e => {
        if (!ModoExamen.activo) return;
        if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
            vaciarPortapapeles();
            activarEscudo('Intento de captura de pantalla');
        }
    }, usarCaptura);

    // Imprimir / guardar como PDF
    window.addEventListener('beforeprint', () => activarEscudo('Imprimir está deshabilitado'));
})();

// =====================================================================
// 3) EXPULSIÓN INMEDIATA AL PERDER EL FOCO
// =====================================================================

// Avisa al servidor (tabla incidentes_examen). Si falla, no importa: el examen se anula igual.
function registrarIncidenteExamen(tipo, referencia, motivo) {
    try {
        fetch('/api/examen/incidente', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo: usuarioActual.correo, tipo, referencia, motivo }),
            keepalive: true
        }).catch(() => {});
    } catch (e) { /* ignorar */ }
}

// Anula el examen en curso: descarta las respuestas y regresa al menú principal del estudiante
function expulsarDelExamen(motivo) {
    if (!ModoExamen.activo) return; // ya se expulsó (evita disparar dos veces con blur + visibilitychange)

    const tipo = ModoExamen.tipo;
    const referencia = ModoExamen.referencia;

    desactivarModoExamen();
    registrarIncidenteExamen(tipo, referencia, motivo);

    // Descarta el progreso (no se guarda nada en el servidor)
    if (tipo === 'nivel') {
        salirDePrueba();
        volverANiveles();
    } else {
        salirDePruebaPP();
    }

    // Menú principal del estudiante (los niveles B / A / S)
    mostrarSeccion('pruebas');

    mostrarAviso('⛔ Examen anulado.\n\nSaliste de la ventana del examen (' + motivo + '). Tus respuestas no se guardaron.');
}

// Cambiar de pestaña, minimizar o bloquear la pantalla
document.addEventListener('visibilitychange', () => {
    if (document.hidden) expulsarDelExamen('cambiaste de pestaña o minimizaste el navegador');
});

// La ventana pierde el foco (otra aplicación, barra de direcciones/buscador, herramientas del navegador...)
window.addEventListener('blur', () => expulsarDelExamen('la ventana del examen perdió el foco'));
window.addEventListener('pagehide', () => expulsarDelExamen('saliste de la página del examen'));

// Respaldo: algunos navegadores no disparan "blur" en todos los casos
setInterval(() => {
    if (ModoExamen.activo && !document.hasFocus()) {
        expulsarDelExamen('la ventana del examen perdió el foco');
    }
}, 400);

// =====================================================================
// Conexión con el flujo de script.js: activar el modo al empezar un examen
// y desactivarlo al terminar o salir de él.
// =====================================================================
(function envolverFlujoDeExamen() {
    // Prueba de un nivel (B / A / S)
    const iniciarSesionOriginal = window.iniciarSesion;
    window.iniciarSesion = function (numero) {
        iniciarSesionOriginal(numero);
        activarModoExamen('nivel', nivelActual + '-P' + pruebaActual + '-S' + numero);
    };

    const salirDePruebaOriginal = window.salirDePrueba;
    window.salirDePrueba = function () {
        desactivarModoExamen();
        salirDePruebaOriginal();
    };

    // Prueba de un profesor
    const iniciarPruebaPPOriginal = window.iniciarPruebaPP;
    window.iniciarPruebaPP = async function (idPrueba) {
        await iniciarPruebaPPOriginal(idPrueba);
        const vista = document.getElementById('vista-prueba-pp');
        if (ppPrueba && vista && !vista.classList.contains('oculto')) {
            activarModoExamen('pp', ppPrueba.id);
        }
    };

    const salirDePruebaPPOriginal = window.salirDePruebaPP;
    window.salirDePruebaPP = function () {
        desactivarModoExamen();
        salirDePruebaPPOriginal();
    };
})();