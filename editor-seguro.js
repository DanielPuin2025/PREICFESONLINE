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
//     ✏️ En la materia Inglés se puede elegir el TIPO de pregunta:
//        4 opciones (A-D), 3 opciones (A-C) o emparejamiento con un banco
//        de 2 a 8 palabras (A-H).
//     ✏️ En el emparejamiento, cada palabra del banco se muestra
//        como una opción vertical ("A. palabra"), igual que Lectura Crítica.
//  2) MODO EXAMEN SEGURO para Estudiantes: bloquea clic derecho, copiar,
//     pegar, cortar, PrintScreen y atajos de captura; ante un intento de
//     trampa oscurece la pantalla (CSS backdrop-filter).
//  3) EXPULSIÓN AL PERDER EL FOCO:
//        - Computador: inmediata (otra pestaña, otra aplicación, minimizar).
//        - ✏️ NUEVO — Celular/tableta: se da una TOLERANCIA de 4 segundos.
//          Si el estudiante vuelve antes (notificación, llamada, roce del
//          selector de apps) el examen continúa y se registra una
//          "salida breve". Si pasa de 4 segundos fuera, el examen se anula.
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

    // La casilla "va con la pregunta anterior" también la ven los profesores:
    // ya no se oculta según el rol.

    try {
        iniciarEditoresEn(bloque, '.cp-enunciado-caja');
        iniciarEditoresEn(bloque, '.cp-modo-letra');
        anclarBotonesMas(bloque);   // centra el "+" dentro del área de escritura
    } catch (err) {
        console.error('⚠️ No se pudo cargar el editor de texto:', err);
        mostrarAviso('⚠️ No se pudo cargar el editor de texto. Revisa tu conexión a internet y recarga la página.');
    }

    actualizarVisibilidadTipos();   // el selector de tipo solo se ve en Inglés
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
        // 3 opciones / emparejamiento
        prepararOpcionesEspeciales(pregunta, 'prueba-opcion-', 'prueba-banco', respuestasMap[pregunta.id] || null);
    }
};

const renderizarPreguntaPPOriginal = renderizarPreguntaPP;
window.renderizarPreguntaPP = function () {
    renderizarPreguntaPPOriginal();
    const pregunta = ppPreguntas[ppIndice];
    if (pregunta) {
        document.getElementById('pp-enunciado').innerHTML = renderRico(pregunta.enunciado);
        // 3 opciones / emparejamiento
        prepararOpcionesEspeciales(pregunta, 'pp-opcion-', 'pp-banco', ppRespuestas[pregunta.id] || null);
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
            // Según el tipo, se muestran 3, 4 o las palabras del banco
            const info = infoPregunta(p);
            let lista;
            if (info.tipo === 'banco') {
                lista = info.banco.map((w, k) => [LETRAS_BANCO[k], escaparHtml(w)]);
            } else {
                const todas = [['A', p.opcion_a], ['B', p.opcion_b], ['C', p.opcion_c], ['D', p.opcion_d]];
                lista = (info.tipo === 'tres' ? todas.slice(0, 3) : todas).map(([l, t]) => [l, renderRico(t)]);
            }
            const opcionesHtml = lista.map(([letra, html]) => {
                let clase = 'detalle-opcion';
                if (letra === p.respuesta_correcta) clase += ' opcion-correcta';
                if (letra === p.opcion_elegida && letra !== p.respuesta_correcta) clase += ' opcion-incorrecta';
                return `<div class="${clase}">${letra}. ${html}</div>`;
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
// TIPOS DE PREGUNTA DE INGLÉS: 3 opciones y emparejamiento (banco)
//
// Cómo se guarda (sin columnas nuevas en la base de datos):
//   - 3 opciones: opcion_d queda vacía.
//   - Emparejamiento: opcion_a = "BANCO::" + lista JSON de palabras;
//     opcion_b, c y d quedan vacías. La letra correcta va en respuesta_correcta
//     (de A hasta H).
// =====================================================================
const PREFIJO_BANCO = 'BANCO::';
const LETRAS_BANCO = 'ABCDEFGH';

// Detecta el tipo de una pregunta a partir de lo que viene del servidor
function infoPregunta(p) {
    const a = String(p.opcion_a === null || p.opcion_a === undefined ? '' : p.opcion_a);
    if (a.startsWith(PREFIJO_BANCO)) {
        try {
            const banco = JSON.parse(a.slice(PREFIJO_BANCO.length));
            if (Array.isArray(banco)) return { tipo: 'banco', banco };
        } catch (e) { /* si falla, se trata como pregunta normal */ }
    }
    const d = String(p.opcion_d === null || p.opcion_d === undefined ? '' : p.opcion_d).trim();
    if (d === '') return { tipo: 'tres' };
    return { tipo: 'cuatro' };
}

function escaparTextoSimple(t) {
    return String(t === null || t === undefined ? '' : t)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function textoDeHtml(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html === null || html === undefined ? '' : html);
    return (t.content.textContent || '').trim();
}

// ---------- Formulario "Crear prueba" ----------
function materiaActualCP() {
    const el = document.getElementById(rolActual === 'admin' ? 'cp-materia-nivel' : 'cp-materia');
    return el ? el.value : '';
}

// El selector de tipo solo se ve si la materia es Inglés
function actualizarVisibilidadTipos() {
    const ingles = materiaActualCP() === 'Inglés';
    document.querySelectorAll('#cp-preguntas .cp-bloque-pregunta').forEach(b => {
        const cont = b.querySelector('.cp-tipo-selector');
        const sel = b.querySelector('.cp-tipo-pregunta');
        if (!cont || !sel) return;
        cont.classList.toggle('oculto', !ingles);
        if (!ingles && sel.value !== 'cuatro') {
            sel.value = 'cuatro';
            cambiarTipoPregunta(sel);
        }
    });
}

['cp-materia', 'cp-materia-nivel', 'cp-sesion'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', actualizarVisibilidadTipos);
});

function cambiarTipoPregunta(select) {
    const bloque = select.closest('.cp-bloque-pregunta');
    if (!bloque) return;

    const tipo = select.value;
    const esBanco = tipo === 'banco';

    bloque.querySelector('.cp-enunciado-caja').classList.toggle('oculto', esBanco);
    bloque.querySelector('.cp-banco').classList.toggle('oculto', !esBanco);

    // 3 opciones y emparejamiento solo usan "elegir la letra"
    const modo = bloque.querySelector('.cp-modo-respuesta');
    if (tipo !== 'cuatro') modo.value = 'letra';
    cambiarModoRespuesta(modo);

    bloque.querySelector('.cp-modo-selector').classList.toggle('oculto', tipo !== 'cuatro');
    bloque.querySelector('.cp-modo-letra').classList.toggle('oculto', esBanco || modo.value === 'aleatoria');
    if (esBanco) bloque.querySelector('.cp-modo-aleatoria').classList.add('oculto');

    // En 3 opciones se oculta la D
    const filaD = bloque.querySelector('.cp-opcion-fila[data-opc="d"]');
    if (filaD) filaD.classList.toggle('oculto', tipo === 'tres');

    const correcta = bloque.querySelector('.cp-correcta');
    const optD = correcta.querySelector('option[value="D"]');
    if (optD) { optD.disabled = tipo === 'tres'; optD.hidden = tipo === 'tres'; }
    if (tipo === 'tres' && correcta.value === 'D') correcta.value = '';
    correcta.required = !esBanco && modo.value !== 'aleatoria';

    if (esBanco && bloque.querySelectorAll('.cp-banco-palabra').length === 0) {
        for (let i = 0; i < 3; i++) agregarPalabraEn(bloque, '');
        agregarFraseEn(bloque);
    }
}

// ---------- Banco de palabras ----------
function renumerarBanco(bloque) {
    const palabras = bloque.querySelectorAll('.cp-banco-palabra');
    palabras.forEach((fila, i) => {
        fila.querySelector('.cp-banco-letra').textContent = LETRAS_BANCO[i];
    });

    const permitidas = LETRAS_BANCO.slice(0, palabras.length);
    bloque.querySelectorAll('.cp-frase-correcta').forEach(sel => {
        const previa = sel.value;
        sel.innerHTML = '<option value="" disabled>Resp.</option>' +
            permitidas.split('').map(l => `<option value="${l}">${l}</option>`).join('');
        sel.value = (previa && permitidas.includes(previa)) ? previa : '';
    });
}

function agregarPalabraEn(bloque, texto) {
    const cont = bloque.querySelector('.cp-banco-palabras');
    if (cont.children.length >= 8) {
        mostrarAviso('El banco puede tener máximo 8 palabras (A-H).');
        return;
    }
    const fila = document.createElement('div');
    fila.className = 'cp-banco-palabra';
    fila.innerHTML = `
        <span class="cp-banco-letra"></span>
        <input type="text" class="cp-banco-input" maxlength="100" placeholder="Palabra" autocomplete="off"
               onkeydown="if (event.key === 'Enter') event.preventDefault()">
        <span class="cp-banco-quitar" title="Quitar palabra" onclick="quitarPalabraBanco(this)">✕</span>`;
    fila.querySelector('input').value = texto || '';
    cont.appendChild(fila);
    renumerarBanco(bloque);
}

function quitarPalabraBanco(el) {
    const bloque = el.closest('.cp-bloque-pregunta');
    const fila = el.closest('.cp-banco-palabra');
    if (!bloque || !fila) return;

    const lista = Array.from(bloque.querySelectorAll('.cp-banco-palabra'));
    if (lista.length <= 2) {
        mostrarAviso('El banco necesita al menos 2 palabras.');
        return;
    }

    // Las frases que apuntaban a letras posteriores se corren una letra
    const i = lista.indexOf(fila);
    bloque.querySelectorAll('.cp-frase-correcta').forEach(sel => {
        if (!sel.value) return;
        const k = LETRAS_BANCO.indexOf(sel.value);
        if (k === i) sel.value = '';
        else if (k > i) sel.value = LETRAS_BANCO[k - 1];
    });

    fila.remove();
    renumerarBanco(bloque);
}

function agregarFraseEn(bloque, datos) {
    const cont = bloque.querySelector('.cp-banco-frases');
    const fila = document.createElement('div');
    fila.className = 'cp-banco-frase';
    fila.innerHTML = `
        <input type="text" class="cp-frase-texto" maxlength="500" autocomplete="off"
               placeholder="Frase (ej: It is a yellow fruit and monkeys love it.)"
               onkeydown="if (event.key === 'Enter') event.preventDefault()">
        <select class="cp-frase-correcta" aria-label="Letra correcta"></select>
        <span class="cp-banco-quitar" title="Quitar frase" onclick="quitarFraseBanco(this)">✕</span>`;

    if (datos) {
        fila.querySelector('.cp-frase-texto').value = datos.texto || '';
        fila._preguntaId = datos.id || null;
    }
    cont.appendChild(fila);
    renumerarBanco(bloque);
    if (datos && datos.correcta) fila.querySelector('.cp-frase-correcta').value = datos.correcta;
}

function quitarFraseBanco(el) {
    const bloque = el.closest('.cp-bloque-pregunta');
    const fila = el.closest('.cp-banco-frase');
    if (!bloque || !fila) return;
    if (bloque.querySelectorAll('.cp-banco-frase').length <= 1) {
        mostrarAviso('El emparejamiento necesita al menos una frase.');
        return;
    }
    fila.remove();
}

function clickAgregarPalabra(btn) { agregarPalabraEn(btn.closest('.cp-bloque-pregunta'), ''); }
function clickAgregarFrase(btn) { agregarFraseEn(btn.closest('.cp-bloque-pregunta')); }

// ---------- Leer el formulario ----------
// Lee todos los bloques y arma la lista que se envía al servidor (HTML de cada editor).
// Un bloque de emparejamiento genera varias preguntas (una por frase).
function leerPreguntasDelFormulario() {
    const bloques = document.querySelectorAll('#cp-preguntas .cp-bloque-pregunta');

    return Array.from(bloques).flatMap(b => {
        const ed = b._editores || {};
        const selTipo = b.querySelector('.cp-tipo-pregunta');
        const tipo = selTipo ? selTipo.value : 'cuatro';
        const conAnterior = !!(b.querySelector('.cp-con-anterior-check') && b.querySelector('.cp-con-anterior-check').checked);

        // EMPAREJAMIENTO
        if (tipo === 'banco') {
            const banco = Array.from(b.querySelectorAll('.cp-banco-palabras .cp-banco-input')).map(i => i.value.trim());
            const filas = Array.from(b.querySelectorAll('.cp-banco-frases .cp-banco-frase'));

            if (filas.length === 0) {
                return [{ id: null, tipo: 'banco', enunciado: '', banco, respuesta_correcta: '', con_anterior: false }];
            }
            return filas.map((fila, i) => ({
                id: fila._preguntaId || null,
                tipo: 'banco',
                enunciado: '<p>' + escaparTextoSimple(fila.querySelector('.cp-frase-texto').value.trim()) + '</p>',
                banco,
                respuesta_correcta: fila.querySelector('.cp-frase-correcta').value,
                // la primera frase usa la casilla del bloque; las demás van pegadas a la anterior
                con_anterior: i === 0 ? conAnterior : true
            }));
        }

        const base = {
            id: b._preguntaId || null,
            tipo,
            enunciado: htmlDeEditor(ed.enunciado),
            imagen: b._imagen || null,
            // true si la pregunta va pegada a la anterior (admin y profesor)
            con_anterior: conAnterior
        };

        // La letra aleatoria solo existe en las preguntas de 4 opciones
        const selectorModo = b.querySelector('.cp-modo-respuesta');
        const modo = (tipo === 'cuatro' && selectorModo) ? selectorModo.value : 'letra';

        // Solo se envían las imágenes de las opciones del modo que está activo
        const camposModo = modo === 'aleatoria' ? ['texto_correcta', 'inc1', 'inc2', 'inc3'] : ['a', 'b', 'c', 'd'];
        const imagenes_opciones = {};
        camposModo.forEach(c => {
            if (b._imagenesOpc && b._imagenesOpc[c]) imagenes_opciones[c] = b._imagenesOpc[c];
        });
        if (tipo === 'tres') delete imagenes_opciones.d;

        if (modo === 'aleatoria') {
            return [{
                ...base,
                modo: 'aleatoria',
                texto_correcta: htmlDeEditor(ed.texto_correcta),
                incorrectas: [htmlDeEditor(ed.inc1), htmlDeEditor(ed.inc2), htmlDeEditor(ed.inc3)],
                imagenes_opciones
            }];
        }

        return [{
            ...base,
            modo: 'letra',
            opcion_a: htmlDeEditor(ed.a),
            opcion_b: htmlDeEditor(ed.b),
            opcion_c: htmlDeEditor(ed.c),
            opcion_d: tipo === 'tres' ? '' : htmlDeEditor(ed.d),
            respuesta_correcta: b.querySelector('.cp-correcta').value,
            imagenes_opciones
        }];
    });
}

// ---------- Llenar el formulario con preguntas que ya existían (para editarlas) ----------
function llenarBloquesDesdePreguntas(preguntas) {
    const contenedor = document.getElementById('cp-preguntas');
    contenedor.innerHTML = '';

    let bloqueBanco = null;   // bloque de emparejamiento que se está llenando
    let bancoJson = null;

    preguntas.forEach(q => {
        const info = infoPregunta(q);

        // --- Emparejamiento: las frases consecutivas con el mismo banco forman un solo bloque ---
        if (info.tipo === 'banco') {
            const json = JSON.stringify(info.banco);
            const frase = { id: q.id, texto: textoDeHtml(q.enunciado), correcta: q.respuesta_correcta };

            if (bloqueBanco && Number(q.con_anterior) && json === bancoJson) {
                agregarFraseEn(bloqueBanco, frase);
                return;
            }

            agregarBloquePregunta(false);
            const bloque = contenedor.lastElementChild;
            const sel = bloque.querySelector('.cp-tipo-pregunta');
            sel.value = 'banco';
            cambiarTipoPregunta(sel);
            bloque.querySelector('.cp-banco-palabras').innerHTML = '';
            bloque.querySelector('.cp-banco-frases').innerHTML = '';
            info.banco.forEach(w => agregarPalabraEn(bloque, w));
            agregarFraseEn(bloque, frase);

            const casilla = bloque.querySelector('.cp-con-anterior-check');
            if (casilla) casilla.checked = !!Number(q.con_anterior);

            bloqueBanco = bloque;
            bancoJson = json;
            return;
        }

        bloqueBanco = null;
        bancoJson = null;

        // --- 3 o 4 opciones ---
        agregarBloquePregunta(false);
        const bloque = contenedor.lastElementChild;
        const ed = bloque._editores;
        if (!ed) return;

        bloque._preguntaId = q.id;

        if (info.tipo === 'tres') {
            const selTipo = bloque.querySelector('.cp-tipo-pregunta');
            selTipo.value = 'tres';
            cambiarTipoPregunta(selTipo);
        }

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
    actualizarVisibilidadTipos();
}

// ---------- Lo que ve el estudiante ----------
function marcarSeleccion(prefijo, letra) {
    document.querySelectorAll('[id^="' + prefijo + '"]').forEach(el => {
        el.classList.toggle('seleccionada', el.id === prefijo + letra);
    });
}

function obtenerBancoEl(id, contenedorOpciones) {
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.className = 'prueba-banco oculto';
        contenedorOpciones.parentNode.insertBefore(el, contenedorOpciones);
    }
    return el;
}

// Ajusta cuántas opciones se ven (3, 4 u 8).
// En el emparejamiento, cada palabra del banco se muestra como una opción normal
// ("A. palabra"), en lista vertical igual que Lectura Crítica. Ya no se usa el
// recuadro del banco en fila ni los botones circulares.
function prepararOpcionesEspeciales(pregunta, prefijo, idBanco, elegida) {
    const info = infoPregunta(pregunta);
    const contenedor = document.getElementById(prefijo + 'A').parentNode;
    contenedor.querySelectorAll('.prueba-opcion-extra').forEach(e => e.remove());

    let letras = ['A', 'B', 'C', 'D'];
    if (info.tipo === 'tres') letras = ['A', 'B', 'C'];
    if (info.tipo === 'banco') letras = LETRAS_BANCO.slice(0, info.banco.length).split('');

    // Sin modo en fila y sin recuadro aparte del banco
    contenedor.classList.remove('modo-banco');
    const bancoEl = obtenerBancoEl(idBanco, contenedor);
    bancoEl.innerHTML = '';
    bancoEl.classList.add('oculto');

    letras.forEach((l, i) => {
        let el = document.getElementById(prefijo + l);
        if (!el) {   // E, F, G, H se crean al vuelo
            el = document.createElement('div');
            el.id = prefijo + l;
            el.className = 'prueba-opcion prueba-opcion-extra';
            el.addEventListener('click', () => {
                if (prefijo === 'pp-opcion-') seleccionarOpcionPP(l);
                else seleccionarOpcion(l);
            });
            contenedor.appendChild(el);
        }

        if (info.tipo === 'banco') {   // letra en negrilla + la palabra del banco
            el.innerHTML = '';

            const spanLetra = document.createElement('span');
            spanLetra.className = 'prueba-opcion-letra';
            spanLetra.textContent = l + '.';

            const cuerpo = document.createElement('div');
            cuerpo.className = 'prueba-opcion-texto';
            cuerpo.innerHTML = renderRico(info.banco[i]);

            el.appendChild(spanLetra);
            el.appendChild(cuerpo);
        }
    });

    ['A', 'B', 'C', 'D'].forEach(l => {
        document.getElementById(prefijo + l).classList.toggle('oculto', !letras.includes(l));
    });

    marcarSeleccion(prefijo, elegida);
}

// Las originales solo marcaban A-D: ahora sirven también para E-H
window.seleccionarOpcion = function (letra) {
    opcionSeleccionada = letra;
    const pregunta = preguntasMateriaActual[indicePreguntaActual];
    if (pregunta) respuestasMap[pregunta.id] = letra;
    marcarSeleccion('prueba-opcion-', letra);
};

window.seleccionarOpcionPP = function (letra) {
    const pregunta = ppPreguntas[ppIndice];
    if (!pregunta) return;
    ppRespuestas[pregunta.id] = letra;
    marcarSeleccion('pp-opcion-', letra);
};

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
// 3) EXPULSIÓN AL PERDER EL FOCO
//
//   - Computador: inmediata, como siempre.
//   - Celular / tableta: TOLERANCIA de 4 segundos. Las notificaciones,
//     llamadas o un roce del selector de apps no anulan el examen si el
//     estudiante vuelve a tiempo; la salida queda registrada como
//     "salida breve" en la tabla incidentes_examen.
// =====================================================================

// ¿Es un celular o una tableta táctil?
const ES_MOVIL =
    window.matchMedia('(pointer: coarse)').matches ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPad con "sitio de escritorio"

// Cuánto puede estar fuera de la app un estudiante en celular antes de anular el examen
const TOLERANCIA_MOVIL_MS = 4000;

let ocultoDesde = 0;
let temporizadorOculto = null;

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
    if (!ModoExamen.activo) return; // ya se expulsó (evita disparar dos veces)

    const tipo = ModoExamen.tipo;
    const referencia = ModoExamen.referencia;

    clearTimeout(temporizadorOculto);
    ocultoDesde = 0;

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

document.addEventListener('visibilitychange', () => {
    if (!ModoExamen.activo) return;

    // Computador: estricto, como antes
    if (!ES_MOVIL) {
        if (document.hidden) expulsarDelExamen('cambiaste de pestaña o minimizaste el navegador');
        return;
    }

    // Celular: se da un margen de tolerancia
    if (document.hidden) {
        ocultoDesde = Date.now();
        clearTimeout(temporizadorOculto);
        temporizadorOculto = setTimeout(
            () => expulsarDelExamen('saliste de la aplicación del examen'),
            TOLERANCIA_MOVIL_MS
        );
        return;
    }

    // Volvió a la pantalla del examen
    clearTimeout(temporizadorOculto);
    if (!ocultoDesde) return;

    const fuera = Date.now() - ocultoDesde;
    ocultoDesde = 0;

    if (fuera > TOLERANCIA_MOVIL_MS) {
        expulsarDelExamen('saliste de la aplicación del examen');
    } else {
        registrarIncidenteExamen(
            ModoExamen.tipo, ModoExamen.referencia,
            'salida breve (' + Math.max(1, Math.round(fuera / 1000)) + ' s)'
        );
        activarEscudo('Volviste al examen. No salgas de esta pantalla.');
    }
});

// Solo en computador: perder el foco de la ventana anula el examen al instante
if (!ES_MOVIL) {
    window.addEventListener('blur', () => expulsarDelExamen('la ventana del examen perdió el foco'));
    window.addEventListener('pagehide', () => expulsarDelExamen('saliste de la página del examen'));

    // Respaldo: algunos navegadores no disparan "blur" en todos los casos
    setInterval(() => {
        if (ModoExamen.activo && !document.hasFocus()) {
            expulsarDelExamen('la ventana del examen perdió el foco');
        }
    }, 400);
}

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