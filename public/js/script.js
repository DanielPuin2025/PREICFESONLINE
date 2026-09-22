// ===================================================
// ESTADO GLOBAL
// ===================================================
let rolActual = '';
let usuarioActual = {}; // { nombre, correo, grado, materia } del usuario logueado

// ===================================================
// UTILIDADES GENERALES
// ===================================================

// Escapa texto que viene de usuarios (por ejemplo, lo que escriben los
// profesores o el administrador) antes de insertarlo con innerHTML, para que
// no se interprete como HTML.
function escaparHtml(texto) {
    return String(texto === null || texto === undefined ? '' : texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Devuelve la fecha y la hora ya formateadas (es-CO) a partir de un ISO.
function formatearFechaHora(iso) {
    const fecha = new Date(iso);
    if (isNaN(fecha.getTime())) return '';
    const fechaTexto = fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
    const horaTexto = fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    return fechaTexto + ' · ' + horaTexto;
}

// Devuelve solo la fecha formateada (es-CO) a partir de un texto "AAAA-MM-DD".
function formatearSoloFecha(ymd) {
    if (!ymd) return '';
    const [a, m, d] = String(ymd).split('-').map(Number);
    const fecha = new Date(a, m - 1, d);
    if (isNaN(fecha.getTime())) return '';
    return fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ✏️ NUEVO: convierte una hora "HH:MM" (24 horas) en texto de 12 horas.
//   formatearHora("08:00") -> "8:00 a. m."   |   formatearHora("14:30") -> "2:30 p. m."
function formatearHora(hhmm) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
    if (!m) return '';
    let h = parseInt(m[1], 10);
    const sufijo = h >= 12 ? 'p. m.' : 'a. m.';
    h = h % 12;
    if (h === 0) h = 12;
    return h + ':' + m[2] + ' ' + sufijo;
}

// Fecha de hoy como "AAAA-MM-DD" (hora local del navegador)
function hoyLocal() {
    const d = new Date();
    const dos = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

// ✏️ NUEVO: hora actual como "HH:MM" (hora local del navegador)
function horaActualLocal() {
    const d = new Date();
    const dos = n => String(n).padStart(2, '0');
    return `${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

// ✏️ NUEVO: fecha y hora actuales como "AAAA-MM-DD HH:MM" (igual que el servidor)
function ahoraLocal() {
    return hoyLocal() + ' ' + horaActualLocal();
}

// Muestra el grado de un estudiante tal como se registró: "9-A" se deja igual
// y un grado antiguo guardado solo como número ("9") se muestra como "9°".
function formatearGrado(grado) {
    if (!grado) return '—';
    const texto = String(grado).trim();
    return /^\d+$/.test(texto) ? texto + '°' : texto;
}

// Textos de los grados de una prueba de profesor. Cada elemento es un grado
// completo ("9") o un curso ("9-A").
//   textoGrados(["9"])               -> "9°"
//   textoGrados(["9-A", "9-B"])      -> "9-A y 9-B"
//   textoGrados(["9", "10-A", "11"]) -> "9°, 10-A y 11°"
//   palabraGrado(["9"]) -> "grado"   |   palabraGrado(["9-A", "9-B"]) -> "grados"
function textoGrados(lista) {
    const partes = (lista || []).map(g => (/^\d+$/.test(String(g)) ? g + '°' : g));
    if (partes.length <= 1) return partes.join('');
    return partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1];
}

function palabraGrado(lista) {
    return (lista || []).length === 1 ? 'grado' : 'grados';
}

// Color de cada materia. Cada valor es una clase "tema-..." de estilos.css
// que define las variables de color (--tema-fondo, --tema-badge, etc.).
// Sirve tanto para las materias de los profesores como para las 5 materias
// de los niveles B, A y S (que administra el administrador).
const temaPorMateria = {
    // Materias de los profesores
    'Matemáticas': 'tema-matematicas',                        // rojo
    'Física': 'tema-fisica',                                  // turquesa
    'Química': 'tema-quimica',                                // azul
    'Inglés': 'tema-ingles',                                  // azul verdoso
    'Lectura Crítica/Español': 'tema-lectura',                // amarillo
    'Filosofía': 'tema-filosofia',                            // índigo
    'Ciencias Económicas y Políticas/Sociales': 'tema-ciudadanas', // naranja
    'Ciencias Naturales': 'tema-naturales',                   // verde
    'Estadísticas': 'tema-estadisticas',                      // gris
    'Educación Artística': 'tema-artistica',                  // rosa
    'Educación Física': 'tema-deportiva',                     // rojo/salmón
    'Emprendimiento': 'tema-emprendimiento',                  // naranja fuerte
    'Ética': 'tema-etica',                                    // azul acero
    'Religión': 'tema-religion',                              // dorado
    'Informática': 'tema-informatica',                        // verde azulado
    // Nombre antiguo (pruebas guardadas antes de separar Ética y Religión)
    'Ética y Religión': 'tema-etica',
    // Materias de los niveles B / A / S
    'Lectura Crítica': 'tema-lectura',                        // amarillo
    'C. Ciudadanas': 'tema-ciudadanas',                       // naranja
    'C. Naturales': 'tema-naturales'                         // verde

};

function claseTemaMateria(materia) {
    return temaPorMateria[materia] || 'tema-profesor';
}

// Materias que puede elegir un profesor al crear una prueba. Esta lista
// alimenta la lista desplegable "Selecciona tu materia" de "Crear prueba".
// (El servidor tiene la misma lista para validar.)
const materiasProfesor = [
    'Ciencias Económicas y Políticas/Sociales',
    'Ciencias Naturales',          // ← AÑADIDO
    'Educación Artística',
    'Educación Física',
    'Emprendimiento',
    'Estadísticas',
    'Ética',
    'Filosofía',
    'Física',
    'Informática',
    'Inglés',
    'Lectura Crítica/Español',
    'Matemáticas',
    'Química',
    'Religión'
];

// Devuelve las <option> de todas las materias de profesor
function opcionesMateriasHtml() {
    return materiasProfesor
        .map(m => `<option value="${escaparHtml(m)}">${escaparHtml(m)}</option>`)
        .join('');
}

// Nombre completo de cada nivel de los estudiantes
const NOMBRE_NIVEL = { B: 'Básico', A: 'Alto', S: 'Superior' };

// Materias que realmente aparecen en cada sesión de los niveles (las 5
// materias en total: Lectura Crítica solo en la Sesión 1 e Inglés solo en la
// Sesión 2). El servidor valida con la misma regla.
const MATERIAS_ADMIN_POR_SESION = {
    1: ['Lectura Crítica', 'Matemáticas', 'C. Ciudadanas', 'C. Naturales'],
    2: ['Matemáticas', 'C. Ciudadanas', 'C. Naturales', 'Inglés']
};

// ===================================================
// SPLASH SCREEN (4 SEGUNDOS)
// ===================================================
setTimeout(() => {
    const splash = document.getElementById('splash');
    if (splash) {
        splash.style.opacity = '0';
        setTimeout(() => {
            splash.style.display = 'none';
            const pRoles = document.getElementById('pantalla-roles');
            if (pRoles) pRoles.classList.remove('oculto');
        }, 500);
    }
}, 4000);

// ===================================================
// NAVEGACIÓN ENTRE PANTALLAS
// ===================================================
function mostrarFormulario(rol) {
    rolActual = rol;
    limpiarFormularioCompleto();

    document.getElementById('pantalla-roles').classList.add('oculto');
    document.getElementById('pantalla-registro').classList.remove('oculto');

    const campoExtra = document.getElementById('campo-extra');
    campoExtra.classList.remove('oculto');
    if (rol === 'estudiante') {
        document.getElementById('titulo-registro').innerText = 'Registro de Estudiantes';
        campoExtra.innerHTML = `
            <select id="reg-extra" required>
                <option value="" disabled selected>Selecciona tu grado</option>
                <option value="9-A">9-A</option>
                <option value="9-B">9-B</option>
                <option value="9-C">9-C</option>
                <option value="10-A">10-A</option>
                <option value="10-B">10-B</option>
                <option value="10-C">10-C</option>
                <option value="11-A">11-A</option>
                <option value="11-B">11-B</option>
                <option value="11-C">11-C</option>
            </select>
            <input type="text" id="reg-codigo" placeholder="Código único" maxlength="100" autocomplete="off" required>`;
    } else if (rol === 'profesor') {
        document.getElementById('titulo-registro').innerText = 'Registro de Profesor/a';
        campoExtra.innerHTML = `
            <input type="text" id="reg-codigo" placeholder="Código único" maxlength="100" autocomplete="off" required>`;
    } else {
        // Admin: nombre, correo, contraseña y código único
        document.getElementById('titulo-registro').innerText = 'Registro de Admin';
        campoExtra.innerHTML = `
            <input type="text" id="reg-codigo" placeholder="Código único" maxlength="100" autocomplete="off" required>`;
    }
}

function irALogin() {
    limpiarFormularioCompleto();
    const titulosLogin = { estudiante: 'Login Estudiantes', profesor: 'Login Profesor/a', admin: 'Login Admin' };
    document.getElementById('titulo-login').innerText = titulosLogin[rolActual] || 'Iniciar Sesión';
    document.getElementById('pantalla-registro').classList.add('oculto');
    document.getElementById('pantalla-login').classList.remove('oculto');
}

function irARegistro() {
    limpiarFormularioCompleto();
    document.getElementById('pantalla-login').classList.add('oculto');
    document.getElementById('pantalla-registro').classList.remove('oculto');
    mostrarFormulario(rolActual);
}

function volverARoles() {
    limpiarFormularioCompleto();
    document.getElementById('pantalla-registro').classList.add('oculto');
    document.getElementById('pantalla-login').classList.add('oculto');
    document.getElementById('pantalla-roles').classList.remove('oculto');
}

// Muestra la pantalla principal (sidebar + contenido) después de un login exitoso
function mostrarNiveles(usuario) {
    // ✏️ NUEVO: empieza siempre desde cero (niveles, sin candados ni progreso
    // del usuario anterior). Las sesiones se sincronizan al entrar a un nivel.
    reiniciarVistasEstudiante();

    document.getElementById('pantalla-login').classList.add('oculto');
    document.getElementById('pantalla-registro').classList.add('oculto');
    document.getElementById('pantalla-roles').classList.add('oculto');
    document.getElementById('pantalla-app').classList.remove('oculto');

    usuarioActual = usuario || {};

    if (usuario && usuario.nombre) {
        document.getElementById('app-usuario-nombre').innerText = usuario.nombre;
    }

    // Los textos del menú lateral cambian según el rol
    aplicarMenuPorRol();

    // El bloqueo de niveles por grado y su sincronización solo aplican a
    // estudiantes; profesores y administradores no tienen "grado" ni niveles.
    if (rolActual === 'estudiante' && usuario && usuario.grado) {
        aplicarNivelesPorGrado(usuario.grado);
        sincronizarDesbloqueosPorAprobacion();
    }

    // Profesores y administradores usan el formulario de "Crear prueba"
    // (cada uno con sus propios campos)
    if (rolActual === 'profesor' || rolActual === 'admin') {
        configurarFormularioPorRol();
    }

    mostrarSeccion('pruebas');
}

// Ajusta el menú lateral según el perfil logueado:
//  - Estudiante: Pruebas / Puntaje actual / Historial de puntajes / Ranking /
//                Pruebas de profesores
//  - Profesor:   Crear prueba / Pruebas creadas / Resultados de las pruebas /
//                Pruebas almacenadas
//  - Admin:      Crear prueba / Pruebas creadas (preguntas de los niveles B, A y S) /
//                Base de datos registros (tablas de estudiantes y profesores)
function aplicarMenuPorRol() {
    const navPruebas = document.getElementById('nav-pruebas');
    const navPuntaje = document.getElementById('nav-puntaje');
    const navPuntajes = document.getElementById('nav-puntajes');
    const navRanking = document.getElementById('nav-ranking');
    const navPruebasProf = document.getElementById('nav-pruebas-prof');
    const navRegistros = document.getElementById('nav-registros');
    const navAlmacenadas = document.getElementById('nav-almacenadas');

    // Se muestran todos y luego se ocultan los que no corresponden al perfil
    [navPuntaje, navPuntajes, navRanking, navPruebasProf, navRegistros, navAlmacenadas]
        .forEach(n => n.classList.remove('oculto'));

    if (rolActual === 'admin') {
        navPruebas.innerText = '📝 Crear prueba';
        navPuntaje.innerText = '📊 Pruebas creadas';
        navRegistros.innerText = '🗄️ Base de datos registros';
        [navPuntajes, navRanking, navPruebasProf, navAlmacenadas].forEach(n => n.classList.add('oculto'));
    } else if (rolActual === 'profesor') {
        navPruebas.innerText = '📝 Crear prueba';
        navPuntaje.innerText = '📊 Pruebas creadas';
        navPuntajes.innerText = '📦 Resultados de las pruebas';
        [navRanking, navPruebasProf, navRegistros].forEach(n => n.classList.add('oculto'));
        // navAlmacenadas queda visible: solo lo ve el profesor
    } else {
        navPruebas.innerText = '📝 Pruebas';
        navPuntaje.innerText = '📊 Puntaje actual';
        navPuntajes.innerText = '📦 Historial de puntajes';
        [navRegistros, navAlmacenadas].forEach(n => n.classList.add('oculto'));
    }
}

// Extrae el número de grado desde un texto como "11-02" -> 11
function extraerGrado(gradoTexto) {
    if (!gradoTexto) return null;
    const match = gradoTexto.match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
}

// Bloquea/desbloquea los niveles B, A, S según el grado del estudiante
function aplicarNivelesPorGrado(gradoTexto) {
    const grado = extraerGrado(gradoTexto);

    const nivelB = document.getElementById('nivel-B');
    const nivelA = document.getElementById('nivel-A');
    const nivelS = document.getElementById('nivel-S');
    const msgB = document.getElementById('msg-B');
    const msgA = document.getElementById('msg-A');

    [nivelB, nivelA, nivelS].forEach(n => n.classList.remove('bloqueado'));
    msgB.innerText = '';
    msgA.innerText = '';

    if (grado === 9) {
        nivelA.classList.add('bloqueado');
        nivelS.classList.add('bloqueado');
    } else if (grado === 10) {
        msgB.innerText = 'Recomendado para practicar';
        nivelS.classList.add('bloqueado');
    } else if (grado === 11) {
        msgB.innerText = 'Recomendado para practicar';
        msgA.innerText = 'Recomendado para practicar';
    }
}

// Cambia entre las secciones del menú lateral (Pruebas, Puntaje, Puntajes,
// Ranking, Pruebas de profesores, Pruebas almacenadas, Base de datos registros)
function mostrarSeccion(nombre) {
    document.querySelectorAll('.seccion-app').forEach(sec => sec.classList.add('oculto'));
    document.getElementById('seccion-' + nombre).classList.remove('oculto');

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('activo', item.dataset.seccion === nombre);
    });

    // Al salir de "Base de datos registros" se descartan las contraseñas
    // que estaban cargadas en memoria.
    if (nombre !== 'registros') {
        registrosFilasActuales = [];
        registrosTipoActual = null;
    }

    if (nombre === 'pruebas') {
        mostrarVistaPruebasSegunRol();
    }

    if (nombre === 'puntaje') {
        const cardEstudiante = document.getElementById('puntaje-actual-contenido');
        const cardCreadas = document.getElementById('pruebas-creadas-contenido');
        if (rolActual === 'profesor' || rolActual === 'admin') {
            cardEstudiante.classList.add('oculto');
            cardCreadas.classList.remove('oculto');
            if (rolActual === 'admin') {
                cargarGruposAdmin();
            } else {
                cargarPruebasCreadas();
            }
        } else {
            cardCreadas.classList.add('oculto');
            cardEstudiante.classList.remove('oculto');
            cargarPuntajeActual();
        }
    }

    if (nombre === 'puntajes') {
        const cardEstudiante = document.getElementById('historial-puntajes-contenido');
        const cardProfesor = document.getElementById('resultados-generales-contenido');
        if (rolActual === 'profesor') {
            cardEstudiante.classList.add('oculto');
            cardProfesor.classList.remove('oculto');
            cargarResultadosProfesor();
        } else {
            cardProfesor.classList.add('oculto');
            cardEstudiante.classList.remove('oculto');
            cargarHistorialPuntajes();
        }
    }

    // ✏️ NUEVO: "Pruebas almacenadas" (solo profesores)
    if (nombre === 'almacenadas') {
        cargarPruebasAlmacenadas();
    }

    if (nombre === 'ranking') {
        cargarRanking();
    }

    if (nombre === 'pruebas-profesores') {
        cargarPruebasProfesores();
    }

    if (nombre === 'registros') {
        mostrarMenuRegistros();
    }
}

// Dentro de la sección "Pruebas": los estudiantes ven los niveles B/A/S
// (o la sesión/prueba en curso); los profesores y administradores ven
// directamente el formulario de "Crear prueba".
function mostrarVistaPruebasSegunRol() {
    const vistaNiveles = document.getElementById('vista-niveles');
    const vistaSesiones = document.getElementById('vista-sesiones');
    const vistaPrueba = document.getElementById('vista-prueba');
    const vistaCrear = document.getElementById('vista-crear-prueba');

    if (rolActual === 'profesor' || rolActual === 'admin') {
        vistaNiveles.classList.add('oculto');
        vistaSesiones.classList.add('oculto');
        vistaPrueba.classList.add('oculto');
        vistaCrear.classList.remove('oculto');
    } else {
        vistaCrear.classList.add('oculto');
        // Solo se fuerza la vista de niveles si el estudiante no está a
        // mitad de una sesión o de una prueba en curso.
        if (vistaSesiones.classList.contains('oculto') && vistaPrueba.classList.contains('oculto')) {
            vistaNiveles.classList.remove('oculto');
        }
    }
}

// ===================================================
// 📝 CREAR PRUEBA (profesores y administradores)
//
//  - PROFESOR: materia (lista desplegable) + título + varias preguntas.
//    La prueba queda "sin subir" hasta que el profesor la sube desde
//    "Pruebas creadas".
//  - ADMINISTRADOR: nivel (B, A, S) + sesión (1, 2) + materia + varias
//    preguntas. Son las preguntas que ven los estudiantes dentro de cada
//    nivel. En cada pregunta el administrador puede definir la respuesta
//    correcta de dos maneras:
//        · "letra": escribe las 4 opciones y elige la letra correcta en una
//                   lista desplegable.
//        · "aleatoria": escribe el TEXTO de la respuesta correcta y 3
//                   opciones incorrectas; el servidor mezcla las 4 y sortea
//                   en qué letra queda la correcta.
// ===================================================

// Prepara el formulario al iniciar sesión un profesor o un administrador:
// muestra los campos de su rol, ajusta cuáles son obligatorios (los campos
// ocultos no pueden ser "required" o el navegador bloquea el envío) y deja
// listo el primer bloque de pregunta.
function configurarFormularioPorRol() {
    const esAdmin = rolActual === 'admin';

    document.getElementById('cp-campos-profesor').classList.toggle('oculto', esAdmin);
    document.getElementById('cp-campos-admin').classList.toggle('oculto', !esAdmin);

    // Obligatorios solo los campos del rol que está usando el formulario
    document.getElementById('cp-materia').required = !esAdmin;
    document.getElementById('cp-titulo').required = !esAdmin;
    ['cp-nivel', 'cp-sesion', 'cp-materia-nivel'].forEach(id => {
        document.getElementById(id).required = esAdmin;
    });

    if (esAdmin) {
        actualizarMateriasAdmin();
    } else {
        document.getElementById('cp-materia').innerHTML =
            '<option value="" disabled selected>Selecciona tu materia</option>' + opcionesMateriasHtml();
    }

    document.getElementById('cp-pill-titulo').innerText = 'CREAR PRUEBA';

    const contenedor = document.getElementById('cp-preguntas');
    if (contenedor && contenedor.children.length === 0) {
        agregarBloquePregunta(false);
    }
}

// Administrador: llena la lista de materias según la sesión elegida
// (Sesión 1: Lectura Crítica, Matemáticas, C. Ciudadanas, C. Naturales;
//  Sesión 2: Matemáticas, C. Ciudadanas, C. Naturales, Inglés).
// Conserva la materia ya elegida si también existe en la nueva sesión.
function actualizarMateriasAdmin() {
    const selectMateria = document.getElementById('cp-materia-nivel');
    if (!selectMateria) return;

    const sesion = document.getElementById('cp-sesion').value;
    const lista = MATERIAS_ADMIN_POR_SESION[sesion] || [];
    const previa = selectMateria.value;

    if (lista.length === 0) {
        selectMateria.innerHTML = '<option value="" disabled selected>Selecciona primero la sesión</option>';
        return;
    }

    selectMateria.innerHTML =
        '<option value="" disabled>Materia</option>' +
        lista.map(m => `<option value="${escaparHtml(m)}">${escaparHtml(m)}</option>`).join('');
    selectMateria.value = lista.includes(previa) ? previa : '';
}

// Añade un bloque de pregunta nuevo (clonado de la plantilla del HTML)
function agregarBloquePregunta(hacerScroll = true) {
    const plantilla = document.getElementById('tpl-pregunta-cp');
    const contenedor = document.getElementById('cp-preguntas');
    if (!plantilla || !contenedor) return;

    contenedor.appendChild(plantilla.content.cloneNode(true));
    const bloque = contenedor.lastElementChild;

    // El selector "cómo se define la respuesta correcta" es solo del administrador
    const selector = bloque.querySelector('.cp-modo-selector');
    if (selector) selector.classList.toggle('oculto', rolActual !== 'admin');

    renumerarBloquesPregunta();

    if (hacerScroll && bloque) {
        bloque.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// Quita el bloque de pregunta al que pertenece el botón "✕ Quitar".
// La prueba siempre debe conservar al menos una pregunta.
function quitarBloquePregunta(elemento) {
    const contenedor = document.getElementById('cp-preguntas');
    const bloque = elemento.closest('.cp-bloque-pregunta');
    if (!contenedor || !bloque) return;

    if (contenedor.children.length <= 1) {
        mostrarAviso('La prueba necesita al menos una pregunta.');
        return;
    }

    bloque.remove();
    renumerarBloquesPregunta();
}

// Vuelve a numerar los bloques ("Pregunta 1", "Pregunta 2", ...)
function renumerarBloquesPregunta() {
    document.querySelectorAll('#cp-preguntas .cp-bloque-pregunta').forEach((bloque, i) => {
        bloque.querySelector('.cp-bloque-numero').innerText = 'Pregunta ' + (i + 1);
    });
}

// Administrador: cambia entre "elegir la letra correcta en una lista" y
// "escribir el texto de la respuesta correcta (letra aleatoria)".
function cambiarModoRespuesta(select) {
    const bloque = select.closest('.cp-bloque-pregunta');
    if (!bloque) return;

    const aleatoria = select.value === 'aleatoria';
    bloque.querySelector('.cp-modo-letra').classList.toggle('oculto', aleatoria);
    bloque.querySelector('.cp-modo-aleatoria').classList.toggle('oculto', !aleatoria);

    // Solo los campos visibles pueden ser obligatorios
    bloque.querySelectorAll('.cp-modo-letra input, .cp-modo-letra select').forEach(campo => {
        campo.required = !aleatoria;
    });
    bloque.querySelectorAll('.cp-modo-aleatoria input').forEach(campo => {
        campo.required = aleatoria;
    });
}

// ===================================================
// 🖼️ IMAGEN DE LA PREGUNTA (Crear prueba)
//     El cuadro "+" abre un modal que pide la imagen: se puede pegar
//     (Ctrl + V), arrastrar o elegir desde los archivos. La imagen se
//     reduce en el navegador (máx. 1400 px, JPEG) y se guarda en el
//     propio bloque de la pregunta (bloque._imagen). El servidor la
//     guarda en disco cuando se pulsa "Guardar prueba".
// ===================================================
let bloqueImagenObjetivo = null; // bloque de pregunta que está esperando la imagen

function abrirModalImagen(elemento) {
    bloqueImagenObjetivo = elemento.closest('.cp-bloque-pregunta');
    document.getElementById('modal-imagen-error').innerText = '';
    document.getElementById('modal-imagen').classList.remove('oculto');
    document.getElementById('modal-imagen-zona').focus();
}

function cerrarModalImagen() {
    document.getElementById('modal-imagen').classList.add('oculto');
    document.getElementById('modal-imagen-zona').classList.remove('arrastrando');
    bloqueImagenObjetivo = null;
}

function elegirArchivoImagen() {
    document.getElementById('modal-imagen-archivo').click();
}

function mostrarErrorImagen(mensaje) {
    document.getElementById('modal-imagen-error').innerText = mensaje;
}

// Valida la imagen, la reduce y la asigna al bloque de pregunta
async function procesarImagen(archivo) {
    if (!bloqueImagenObjetivo) return;

    if (!archivo || !archivo.type.startsWith('image/')) {
        mostrarErrorImagen('El archivo debe ser una imagen (PNG, JPG, WEBP o GIF).');
        return;
    }
    if (archivo.size > 15 * 1024 * 1024) {
        mostrarErrorImagen('La imagen es demasiado grande (máximo 15 MB).');
        return;
    }

    try {
        const dataUrl = await reducirImagen(archivo);
        asignarImagenABloque(bloqueImagenObjetivo, dataUrl);
        cerrarModalImagen();
    } catch (err) {
        console.error('⚠️ No se pudo leer la imagen:', err);
        mostrarErrorImagen('No se pudo leer la imagen. Prueba con otra.');
    }
}

// Reduce la imagen a un máximo de 1400 px por lado y la convierte a JPEG
function reducirImagen(archivo, maxLado = 1400) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(archivo);
        const img = new Image();

        img.onload = () => {
            const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
            const ancho = Math.round(img.width * escala);
            const alto = Math.round(img.height * escala);

            const canvas = document.createElement('canvas');
            canvas.width = ancho;
            canvas.height = alto;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff'; // fondo blanco para imágenes con transparencia
            ctx.fillRect(0, 0, ancho, alto);
            ctx.drawImage(img, 0, 0, ancho, alto);

            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.88));
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Imagen inválida'));
        };
        img.src = url;
    });
}

// Muestra la vista previa dentro del bloque y guarda la imagen en él
// (puede ser una imagen nueva en data URL o la ruta de una que ya existía)
function asignarImagenABloque(bloque, dataUrl) {
    if (!bloque) return;
    bloque._imagen = dataUrl;
    bloque.querySelector('.cp-imagen-vista').src = dataUrl;
    bloque.querySelector('.cp-imagen-agregar').classList.add('oculto');
    bloque.querySelector('.cp-imagen-preview').classList.remove('oculto');
}

// "✕ Quitar imagen": vuelve a mostrar el cuadro "+"
function quitarImagenBloque(elemento) {
    const bloque = elemento.closest('.cp-bloque-pregunta');
    if (!bloque) return;
    bloque._imagen = null;
    bloque.querySelector('.cp-imagen-vista').src = '';
    bloque.querySelector('.cp-imagen-preview').classList.add('oculto');
    bloque.querySelector('.cp-imagen-agregar').classList.remove('oculto');
}

// Eventos del modal: elegir archivo, arrastrar, pegar (Ctrl + V) y Escape
(function iniciarModalImagen() {
    const zona = document.getElementById('modal-imagen-zona');
    const inputArchivo = document.getElementById('modal-imagen-archivo');
    if (!zona || !inputArchivo) return;

    inputArchivo.addEventListener('change', () => {
        const archivo = inputArchivo.files[0];
        inputArchivo.value = ''; // permite volver a elegir el mismo archivo
        if (archivo) procesarImagen(archivo);
    });

    zona.addEventListener('dragover', e => {
        e.preventDefault();
        zona.classList.add('arrastrando');
    });
    zona.addEventListener('dragleave', () => zona.classList.remove('arrastrando'));
    zona.addEventListener('drop', e => {
        e.preventDefault();
        zona.classList.remove('arrastrando');
        const archivo = e.dataTransfer.files[0];
        if (archivo) procesarImagen(archivo);
    });

    // Pegar desde el portapapeles (solo mientras el modal está abierto)
    document.addEventListener('paste', e => {
        const modal = document.getElementById('modal-imagen');
        if (!modal || modal.classList.contains('oculto')) return;

        const items = e.clipboardData ? Array.from(e.clipboardData.items) : [];
        const itemImagen = items.find(i => i.kind === 'file' && i.type.startsWith('image/'));

        e.preventDefault();
        if (itemImagen) {
            procesarImagen(itemImagen.getAsFile());
        } else {
            mostrarErrorImagen('No hay ninguna imagen copiada. Copia una imagen e inténtalo de nuevo.');
        }
    });

    document.addEventListener('keydown', e => {
        const modal = document.getElementById('modal-imagen');
        if (e.key === 'Escape' && modal && !modal.classList.contains('oculto')) {
            cerrarModalImagen();
        }
    });
})();

let enviandoPrueba = false;  // evita guardar la prueba dos veces si se pulsa dos veces
let pruebaEditandoId = null; // profesor: id de la prueba que se está editando (null = creando una nueva)
let grupoEditando = null;    // admin: { nivel, sesion, materia } del grupo que se está editando (null = creando)

// ¿Se está editando algo (una prueba de profesor o un grupo de preguntas de nivel)?
function estaEditando() {
    return pruebaEditandoId !== null || grupoEditando !== null;
}

// Deja el formulario en modo "Crear prueba": título de la pantalla, texto del
// botón de guardar y sin el botón "Cancelar edición".
function restaurarModoCrear() {
    pruebaEditandoId = null;
    grupoEditando = null;

    const pill = document.getElementById('cp-pill-titulo');
    if (pill) pill.innerText = 'CREAR PRUEBA';

    const boton = document.querySelector('#form-crear-pregunta button[type="submit"]');
    if (boton) boton.innerText = 'Guardar prueba';

    const cancelar = document.getElementById('cp-btn-cancelar-edicion');
    if (cancelar) cancelar.classList.add('oculto');
}

// Vacía el formulario y deja un solo bloque de pregunta en blanco
function reiniciarFormularioCrearPrueba() {
    document.getElementById('form-crear-pregunta').reset();
    document.getElementById('cp-preguntas').innerHTML = '';
    if (rolActual === 'admin') actualizarMateriasAdmin();
    agregarBloquePregunta(false);
}

// Lee todos los bloques de pregunta del formulario y arma la lista que se
// envía al servidor. El administrador también manda el modo de la respuesta
// correcta ('letra' o 'aleatoria').
function leerPreguntasDelFormulario() {
    const esAdmin = rolActual === 'admin';
    const bloques = document.querySelectorAll('#cp-preguntas .cp-bloque-pregunta');

    return Array.from(bloques).map(b => {
        const base = {
            id: b._preguntaId || null, // solo las preguntas que ya existían (al editar)
            enunciado: b.querySelector('.cp-enunciado').value.trim(),
            imagen: b._imagen || null  // imagen nueva (data URL), imagen que ya tenía (ruta) o null
        };

        const modo = esAdmin ? b.querySelector('.cp-modo-respuesta').value : 'letra';

        if (modo === 'aleatoria') {
            return {
                ...base,
                modo: 'aleatoria',
                texto_correcta: b.querySelector('.cp-texto-correcta').value.trim(),
                incorrectas: [
                    b.querySelector('.cp-incorrecta-1').value.trim(),
                    b.querySelector('.cp-incorrecta-2').value.trim(),
                    b.querySelector('.cp-incorrecta-3').value.trim()
                ]
            };
        }

        return {
            ...base,
            modo: 'letra',
            opcion_a: b.querySelector('.cp-opcion-a').value.trim(),
            opcion_b: b.querySelector('.cp-opcion-b').value.trim(),
            opcion_c: b.querySelector('.cp-opcion-c').value.trim(),
            opcion_d: b.querySelector('.cp-opcion-d').value.trim(),
            respuesta_correcta: b.querySelector('.cp-correcta').value
        };
    });
}

// Envía el formulario al servidor:
//  - Profesor: crea o edita una prueba (materia + título + preguntas).
//  - Admin:    añade preguntas a un nivel + sesión + materia, o guarda los
//              cambios de un grupo de preguntas que se está editando.
async function enviarPrueba(e) {
    e.preventDefault();
    if (enviandoPrueba) return;

    const esAdmin = rolActual === 'admin';

    const bloques = document.querySelectorAll('#cp-preguntas .cp-bloque-pregunta');
    if (bloques.length === 0) {
        mostrarAviso('Añade al menos una pregunta.');
        return;
    }

    const preguntas = leerPreguntasDelFormulario();

    let url;
    let metodo;
    let datos;

    if (esAdmin) {
        const nivel = document.getElementById('cp-nivel').value;
        const sesion = document.getElementById('cp-sesion').value;
        const materia = document.getElementById('cp-materia-nivel').value;

        if (!nivel || !sesion || !materia) {
            mostrarAviso('Selecciona el nivel, la sesión y la materia.');
            return;
        }

        datos = { correo: usuarioActual.correo, nivel, sesion: Number(sesion), materia, preguntas };
        url = '/api/admin/grupo';
        metodo = 'POST';

        if (grupoEditando) {
            datos.original = grupoEditando;
            metodo = 'PUT';
        }
    } else {
        const materia = document.getElementById('cp-materia').value;
        if (!materia) {
            mostrarAviso('Selecciona la materia de la prueba.');
            return;
        }

        datos = {
            correo: usuarioActual.correo,
            materia,
            titulo: document.getElementById('cp-titulo').value,
            preguntas
        };

        if (pruebaEditandoId !== null) {
            url = `/api/pruebas-profesor/${pruebaEditandoId}`;
            metodo = 'PUT';
        } else {
            url = '/api/pruebas-profesor';
            metodo = 'POST';
        }
    }

    const editando = estaEditando();

    enviandoPrueba = true;
    const boton = document.querySelector('#form-crear-pregunta button[type="submit"]');
    if (boton) { boton.disabled = true; boton.innerText = 'Guardando...'; }

    try {
        const respuesta = await fetch(url, {
            method: metodo,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datos)
        });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            reiniciarFormularioCrearPrueba();

            if (editando) {
                restaurarModoCrear();
                mostrarSeccion('puntaje'); // vuelve a "Pruebas creadas" (se recarga sola)
                mostrarAviso('✅ ¡Cambios guardados con éxito!');
            } else if (esAdmin) {
                mostrarAviso('🎉 ¡Preguntas guardadas con éxito!\n\nLos estudiantes ya las verán en su nivel y sesión. Puedes modificarlas o eliminarlas en "Pruebas creadas".');
            } else {
                mostrarAviso('🎉 ¡Prueba guardada con éxito!\n\nVe a "Pruebas creadas" y pulsa "Subir prueba" para que los estudiantes puedan presentarla.');
            }
        } else {
            mostrarAviso('⚠️ Error al guardar:\n' + resultado.error);
        }
    } catch (err) {
        console.error('⚠️ Error al guardar la prueba:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    } finally {
        enviandoPrueba = false;
        if (boton) {
            boton.disabled = false;
            boton.innerText = estaEditando() ? 'Guardar cambios' : 'Guardar prueba';
        }
    }
}

// Llena el formulario con las preguntas que ya existían (para editarlas).
// Las preguntas ya guardadas siempre se cargan en modo "letra": muestran sus
// 4 opciones y la letra correcta actual.
function llenarBloquesDesdePreguntas(preguntas) {
    const contenedor = document.getElementById('cp-preguntas');
    contenedor.innerHTML = '';

    preguntas.forEach(q => {
        agregarBloquePregunta(false);
        const bloque = contenedor.lastElementChild;

        bloque._preguntaId = q.id; // así el servidor sabe cuál pregunta se está actualizando
        bloque.querySelector('.cp-enunciado').value = q.enunciado;
        bloque.querySelector('.cp-opcion-a').value = q.opcion_a;
        bloque.querySelector('.cp-opcion-b').value = q.opcion_b;
        bloque.querySelector('.cp-opcion-c').value = q.opcion_c;
        bloque.querySelector('.cp-opcion-d').value = q.opcion_d;
        bloque.querySelector('.cp-correcta').value = q.respuesta_correcta;
        if (q.imagen) asignarImagenABloque(bloque, q.imagen);
    });

    if (preguntas.length === 0) agregarBloquePregunta(false);
}

// Deja el formulario en modo edición: título, botón de guardar y botón de cancelar
function activarModoEdicionVisual() {
    document.getElementById('cp-pill-titulo').innerText = 'EDITAR PRUEBA';

    const boton = document.querySelector('#form-crear-pregunta button[type="submit"]');
    if (boton) boton.innerText = 'Guardar cambios';
    document.getElementById('cp-btn-cancelar-edicion').classList.remove('oculto');

    const panel = document.querySelector('.app-main');
    if (panel) panel.scrollTop = 0;
}

// ===================================================
// ✏️ EDITAR PRUEBA (solo profesores): el botón "Editar" de "Pruebas creadas"
//     abre el mismo formulario de "Crear prueba", ya lleno con la materia,
//     el título y las preguntas de esa prueba (con sus imágenes y su
//     respuesta correcta). Al guardar se actualiza la prueba. Si algún
//     estudiante ya la presentó NO se puede editar (sus resultados dejarían
//     de tener sentido); en ese caso hay que crear una prueba nueva.
// ===================================================
const MENSAJE_PRUEBA_PRESENTADA = 'Esta prueba ya fue presentada por estudiantes, por eso ya no se puede editar.\n\nSi necesitas cambiarla, crea una prueba nueva.';

async function clickEditarPrueba(idPrueba) {
    const prueba = pruebasCreadas.find(p => p.id === idPrueba);
    if (!prueba) return;

    if (prueba.num_presentaciones > 0) {
        mostrarAviso(MENSAJE_PRUEBA_PRESENTADA);
        return;
    }

    try {
        const url = `/api/pruebas-profesor/${idPrueba}/editar?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();

        if (!respuesta.ok) {
            mostrarAviso('⚠️ ' + (datos.error || 'No se pudo abrir la prueba para editarla.'));
            cargarPruebasCreadas();
            return;
        }

        abrirEdicionPrueba(datos);
    } catch (err) {
        console.error('⚠️ Error al abrir la prueba para editarla:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    }
}

// Lleva al formulario de "Crear prueba" y lo llena con los datos de la prueba
function abrirEdicionPrueba(datos) {
    restaurarModoCrear();
    pruebaEditandoId = datos.prueba.id;

    mostrarSeccion('pruebas');

    document.getElementById('cp-materia').value = datos.prueba.materia;
    document.getElementById('cp-titulo').value = datos.prueba.titulo;
    llenarBloquesDesdePreguntas(datos.preguntas);

    activarModoEdicionVisual();
}

// Pide confirmación antes de salir de la edición, ya que se perderían los cambios
function cancelarEdicionPrueba() {
    mostrarModalConfirmacion(
        '¿Cancelar la edición? Se perderán los cambios que no hayas guardado.',
        () => {
            reiniciarFormularioCrearPrueba();
            restaurarModoCrear();
            mostrarSeccion('puntaje');
        },
        'Sí, cancelar',
        'Seguir editando'
    );
}

// ===================================================
// 🛡️ PRUEBAS CREADAS (solo administradores): lista las preguntas de los
//     niveles B, A y S agrupadas por nivel, sesión y materia. Cada grupo
//     tiene su botón "Editar" (abre el formulario de "Crear prueba" con
//     esas preguntas) y su botón "Eliminar". Arriba a la derecha está el
//     botón "Promedio" (mínimo de respuestas correctas para pasar de nivel).
// ===================================================
let gruposAdmin = []; // última lista cargada (para los botones Editar / Eliminar)

function textoCantidadPreguntas(n) {
    return n === 1 ? '1 pregunta' : `${n} preguntas`;
}

async function cargarGruposAdmin() {
    const contenedor = document.getElementById('pruebas-creadas-contenido');
    if (!contenedor) return;

    if (!usuarioActual || !usuarioActual.correo) {
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Inicia sesión para ver las preguntas.</p></div>';
        return;
    }

    contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Cargando...</p></div>';

    try {
        const url = `/api/admin/grupos?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();

        if (!respuesta.ok) {
            gruposAdmin = [];
            contenedor.innerHTML = `<div class="historial-vacio"><p class="texto-proximamente">${escaparHtml(datos.error || 'No se pudo cargar.')}</p></div>`;
            return;
        }

        gruposAdmin = datos.grupos || [];

        if (gruposAdmin.length === 0) {
            contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Aún no hay preguntas en los niveles. Créalas en "Crear prueba".</p></div>';
            return;
        }

        // Una fila por grupo, con un título cada vez que cambia el nivel
        let nivelAnterior = null;
        const filasHtml = gruposAdmin.map((g, i) => {
            let titulo = '';
            if (g.nivel !== nivelAnterior) {
                nivelAnterior = g.nivel;
                titulo = `<p class="admin-nivel-titulo">Nivel ${escaparHtml(g.nivel)} · ${escaparHtml(NOMBRE_NIVEL[g.nivel] || '')}</p>`;
            }

            return titulo + `
                <div class="pregunta-creada-fila ${claseTemaMateria(g.materia)}">
                    <div class="pregunta-creada-encabezado">
                        <div class="pregunta-creada-pills">
                            <span class="historial-nivel-pill">Sesión ${g.sesion}</span>
                            <span class="historial-nivel-pill pill-materia">${escaparHtml(g.materia)}</span>
                        </div>
                        <span class="historial-porcentaje">${textoCantidadPreguntas(g.num_preguntas)}</span>
                    </div>
                    <div class="pregunta-creada-pie">
                        <div class="pregunta-creada-acciones">
                            <button type="button" class="btn-editar-prueba" onclick="clickEditarGrupo(${i})">Editar</button>
                            <button type="button" class="btn-eliminar-grupo" onclick="clickEliminarGrupo(${i})">Eliminar</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const totalPreguntas = gruposAdmin.reduce((acc, g) => acc + g.num_preguntas, 0);
        const etiqueta = `${gruposAdmin.length === 1 ? '1 grupo' : gruposAdmin.length + ' grupos'} · ${textoCantidadPreguntas(totalPreguntas)}`;

        // ✏️ NUEVO: arriba a la derecha, el botón "Promedio"
        contenedor.innerHTML = `
            <div class="admin-cabecera">
                <p class="historial-etiqueta">${etiqueta}</p>
                <button type="button" class="btn-promedio" onclick="abrirModalPromedio()">Promedio</button>
            </div>
            <div class="historial-lista">${filasHtml}</div>
        `;
    } catch (err) {
        console.error('⚠️ No se pudieron cargar las preguntas de los niveles:', err);
        gruposAdmin = [];
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">No se pudo cargar. Intenta de nuevo.</p></div>';
    }
}

// Botón "Editar" de un grupo: trae sus preguntas y abre el formulario
async function clickEditarGrupo(indice) {
    const grupo = gruposAdmin[indice];
    if (!grupo) return;

    try {
        const url = `/api/admin/grupo?correo=${encodeURIComponent(usuarioActual.correo)}` +
            `&nivel=${encodeURIComponent(grupo.nivel)}&sesion=${encodeURIComponent(grupo.sesion)}` +
            `&materia=${encodeURIComponent(grupo.materia)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();

        if (!respuesta.ok) {
            mostrarAviso('⚠️ ' + (datos.error || 'No se pudieron abrir las preguntas.'));
            cargarGruposAdmin();
            return;
        }

        abrirEdicionGrupo(datos);
    } catch (err) {
        console.error('⚠️ Error al abrir las preguntas para editarlas:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    }
}

// Lleva al formulario de "Crear prueba" y lo llena con las preguntas del grupo
function abrirEdicionGrupo(datos) {
    restaurarModoCrear();
    grupoEditando = { nivel: datos.nivel, sesion: Number(datos.sesion), materia: datos.materia };

    mostrarSeccion('pruebas');

    document.getElementById('cp-nivel').value = datos.nivel;
    document.getElementById('cp-sesion').value = String(datos.sesion);
    actualizarMateriasAdmin();
    document.getElementById('cp-materia-nivel').value = datos.materia;

    llenarBloquesDesdePreguntas(datos.preguntas);
    activarModoEdicionVisual();
}

// Botón "Eliminar" de un grupo: pide confirmación y borra todas sus preguntas
function clickEliminarGrupo(indice) {
    const grupo = gruposAdmin[indice];
    if (!grupo) return;

    const mensaje = '¿Seguro que quieres eliminar las ' + grupo.num_preguntas + ' preguntas de Nivel ' + grupo.nivel +
        ' · Sesión ' + grupo.sesion + ' · ' + grupo.materia + '?' +
        '\n\nLos resultados que los estudiantes ya obtuvieron se conservarán.\n\nEsta acción no se puede deshacer.';

    mostrarModalConfirmacion(mensaje, () => eliminarGrupo(grupo), 'Eliminar', 'Cancelar');
}

async function eliminarGrupo(grupo) {
    try {
        const url = `/api/admin/grupo?correo=${encodeURIComponent(usuarioActual.correo)}` +
            `&nivel=${encodeURIComponent(grupo.nivel)}&sesion=${encodeURIComponent(grupo.sesion)}` +
            `&materia=${encodeURIComponent(grupo.materia)}`;
        const respuesta = await fetch(url, { method: 'DELETE' });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            mostrarAviso('🗑️ Las preguntas fueron eliminadas.');
        } else {
            mostrarAviso('⚠️ No se pudieron eliminar las preguntas:\n' + (resultado.error || 'Error desconocido.'));
        }
        cargarGruposAdmin();
    } catch (err) {
        console.error('⚠️ Error al eliminar las preguntas:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    }
}

// ===================================================
// 🎯 PROMEDIO (solo administradores) — ✏️ NUEVO
//     El botón "Promedio" abre una ventana donde el administrador fija,
//     para cada paso (B → A y A → S), cuántas respuestas correctas debe
//     tener el estudiante SUMANDO la Sesión 1 y la Sesión 2 para pasar al
//     siguiente nivel. El máximo de cada campo es la cantidad total de
//     preguntas que hay en ese nivel (las dos sesiones). Si el
//     administrador nunca lo configuró, el servidor usa el 60%.
// ===================================================
let enviandoPromedio = false;

async function abrirModalPromedio() {
    if (rolActual !== 'admin' || !usuarioActual || !usuarioActual.correo) return;

    const lista = document.getElementById('promedio-lista');
    const error = document.getElementById('modal-promedio-error');
    const boton = document.getElementById('modal-promedio-boton');

    error.innerText = '';
    boton.disabled = true;
    lista.innerHTML = '<p class="dropdown-cargando">Cargando...</p>';
    document.getElementById('modal-promedio').classList.remove('oculto');

    try {
        const url = `/api/admin/promedio?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();

        if (!respuesta.ok) {
            lista.innerHTML = '';
            error.innerText = datos.error || 'No se pudo cargar el promedio.';
            return;
        }

        const niveles = datos.niveles || [];
        lista.innerHTML = niveles.map(n => {
            const total = Number(n.total_preguntas);
            const sinPreguntas = total === 0;
            const configurado = n.minimo_correctas !== null && n.minimo_correctas !== undefined;
            const valor = configurado ? n.minimo_correctas : n.por_defecto;

            const notaHtml = sinPreguntas
                ? 'Este nivel aún no tiene preguntas.'
                : (configurado
                    ? 'Mínimo actual para pasar de nivel.'
                    : `Sin configurar: se usa el 60% (${n.por_defecto} correctas).`);

            return `
                <div class="promedio-fila">
                    <div class="promedio-info">
                        <span class="promedio-nivel">Nivel ${escaparHtml(n.nivel)} → Nivel ${escaparHtml(n.siguiente)}</span>
                        <span class="promedio-total">${textoCantidadPreguntas(total)} entre las dos sesiones</span>
                        <span class="promedio-nota">${escaparHtml(notaHtml)}</span>
                    </div>
                    <div class="promedio-campo">
                        <input type="number" class="promedio-input" data-nivel="${escaparHtml(n.nivel)}"
                               data-total="${total}" min="1" max="${total}" step="1"
                               value="${sinPreguntas ? '' : valor}" ${sinPreguntas ? 'disabled' : ''}
                               aria-label="Respuestas correctas para pasar del Nivel ${escaparHtml(n.nivel)} al Nivel ${escaparHtml(n.siguiente)}">
                        <span class="promedio-de">de ${total}</span>
                    </div>
                </div>
            `;
        }).join('');

        // Si ningún nivel tiene preguntas no hay nada que guardar
        boton.disabled = !niveles.some(n => Number(n.total_preguntas) > 0);
    } catch (err) {
        console.error('⚠️ No se pudo cargar el promedio:', err);
        lista.innerHTML = '';
        error.innerText = 'No se pudo conectar con el servidor.';
    }
}

function cerrarModalPromedio() {
    document.getElementById('modal-promedio').classList.add('oculto');
}

async function guardarPromedio() {
    if (enviandoPromedio) return;

    const error = document.getElementById('modal-promedio-error');
    const boton = document.getElementById('modal-promedio-boton');
    const inputs = Array.from(document.querySelectorAll('#promedio-lista .promedio-input:not(:disabled)'));

    if (inputs.length === 0) {
        error.innerText = 'No hay niveles con preguntas para configurar.';
        return;
    }

    const minimos = {};
    for (const input of inputs) {
        const nivel = input.dataset.nivel;
        const total = Number(input.dataset.total);
        const texto = input.value.trim();
        const valor = Number(texto);

        if (texto === '' || !Number.isInteger(valor) || valor < 1 || valor > total) {
            error.innerText = 'En el Nivel ' + nivel + ' escribe un número entero entre 1 y ' + total + '.';
            input.focus();
            return;
        }
        minimos[nivel] = valor;
    }

    error.innerText = '';
    enviandoPromedio = true;
    boton.disabled = true;

    try {
        const respuesta = await fetch('/api/admin/promedio', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo: usuarioActual.correo, minimos })
        });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            cerrarModalPromedio();
            mostrarAviso('🎯 ¡Promedio guardado con éxito!\n\nLos estudiantes necesitarán ese mínimo de respuestas correctas (sumando las dos sesiones) para pasar de nivel.');
        } else {
            error.innerText = resultado.error || 'No se pudo guardar el promedio.';
        }
    } catch (err) {
        console.error('⚠️ Error al guardar el promedio:', err);
        error.innerText = 'No se pudo conectar con el servidor.';
    } finally {
        enviandoPromedio = false;
        boton.disabled = false;
    }
}

// ===================================================
// 🗄️ BASE DE DATOS REGISTROS (solo administradores)
//     Dos botones (Estudiantes / Profesores). Al pulsar uno se muestra
//     la tabla de usuarios registrados, con:
//       · Contraseña oculta (••••••••) y un ojito 👁️ para verla u ocultarla,
//         por si alguien no la recuerda.
//       · Un botón "Eliminar" en cada fila. Al pulsarlo aparece una ventana
//         que pregunta "¿Estás seguro de borrar a este usuario?" con los
//         botones "Sí" y "Cancelar". Si se elige "Sí", el usuario se borra
//         de la base de datos.
//     El código único se ve vacío si la persona no tiene uno guardado.
// ===================================================
let registrosTipoActual = null;   // 'estudiantes' | 'profesores' | null (menú)
let registrosFilasActuales = [];  // filas de la tabla mostrada (para ver contraseñas y eliminar)

const CONTRASENA_OCULTA = '••••••••';
//ACTUALIZADO EL 20 DE SEPT
const COLUMNAS_REGISTROS = {
    estudiantes: [
        { titulo: 'Nombre completo', campo: 'nombre' },
        { titulo: 'Correo', campo: 'correo' },
        { titulo: 'Contraseña', campo: 'contrasena', tipo: 'contrasena' },
        { titulo: 'Grado', campo: 'grado', formato: v => (v ? formatearGrado(v) : '') },
        { titulo: 'Código único', campo: 'codigo_unico' }
    ],
    profesores: [
        { titulo: 'Nombre completo', campo: 'nombre' },
        { titulo: 'Correo', campo: 'correo' },
        { titulo: 'Contraseña', campo: 'contrasena', tipo: 'contrasena' },
        { titulo: 'Código único', campo: 'codigo_unico' }
    ],
    administradores: [
        { titulo: 'Nombre completo', campo: 'nombre' },
        { titulo: 'Correo', campo: 'correo' },
        { titulo: 'Contraseña', campo: 'contrasena', tipo: 'contrasena' }
    ]
};
// Vuelve a los dos botones "Estudiantes" / "Profesores"
function mostrarMenuRegistros() {
    registrosTipoActual = null;
    registrosFilasActuales = []; // no se dejan contraseñas en memoria fuera de la tabla
    document.getElementById('registros-vista').classList.add('oculto');
    document.getElementById('registros-menu').classList.remove('oculto');
}

// Trae del servidor la tabla elegida y la dibuja
async function cargarRegistros(tipo) {
    if (rolActual !== 'admin' || !COLUMNAS_REGISTROS[tipo]) return;
    if (!usuarioActual || !usuarioActual.correo) return;

    registrosTipoActual = tipo;
    registrosFilasActuales = [];

    document.getElementById('registros-menu').classList.add('oculto');
    document.getElementById('registros-vista').classList.remove('oculto');
    const titulosRegistros = { estudiantes: 'Estudiantes', profesores: 'Profesores', administradores: 'Administradores' };
    document.getElementById('registros-titulo').innerText = titulosRegistros[tipo] || tipo;

    const contenedor = document.getElementById('registros-contenido');
    contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Cargando...</p></div>';

    try {
        const url = `/api/admin/${tipo}?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();

        // Si el admin ya volvió al menú o cambió de tabla mientras cargaba, se ignora
        if (registrosTipoActual !== tipo) return;

        if (!respuesta.ok) {
            contenedor.innerHTML = `<div class="historial-vacio"><p class="texto-proximamente">${escaparHtml(datos.error || 'No se pudo cargar.')}</p></div>`;
            return;
        }

        const filas = datos[tipo] || [];
        registrosFilasActuales = filas;
        const columnas = COLUMNAS_REGISTROS[tipo];

        if (filas.length === 0) {
            contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Aún no hay registros en esta tabla.</p></div>';
            return;
        }

        const encabezadoHtml = columnas.map(c => `<th>${escaparHtml(c.titulo)}</th>`).join('') +
            '<th class="col-accion">Eliminar</th>';

        const cuerpoHtml = filas.map((f, i) => {
            const celdasHtml = columnas.map(c => {
                // Contraseña: oculta por defecto, con un ojito para verla
                if (c.tipo === 'contrasena') {
                    return `
                        <td>
                            <div class="pass-celda">
                                <span class="pass-texto" id="registro-pass-${i}" data-visible="0">${CONTRASENA_OCULTA}</span>
                                <button type="button" class="btn-ojo-tabla" title="Mostrar contraseña" aria-label="Mostrar contraseña" onclick="alternarPasswordRegistro(${i}, this)">👁️</button>
                            </div>
                        </td>`;
                }
                const valor = c.formato ? c.formato(f[c.campo]) : f[c.campo];
                return `<td>${escaparHtml(valor)}</td>`;
            }).join('');

            return `
                <tr>
                    ${celdasHtml}
                    <td class="col-accion">
                        <button type="button" class="btn-borrar-registro" title="Eliminar usuario" aria-label="Eliminar a ${escaparHtml(f.nombre)}" onclick="clickEliminarRegistro(${i})">🗑️ Eliminar</button>
                    </td>
                </tr>
            `;
        }).join('');

        contenedor.innerHTML = `
            <p class="historial-etiqueta">${textoCantidadRegistros(tipo, filas.length)}</p>
            <div class="registros-tabla-wrap">
                <table class="registros-tabla">
                    <thead><tr>${encabezadoHtml}</tr></thead>
                    <tbody>${cuerpoHtml}</tbody>
                </table>
            </div>
        `;
    } catch (err) {
        console.error('⚠️ No se pudo cargar la tabla de registros:', err);
        if (registrosTipoActual === tipo) {
            contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">No se pudo cargar. Intenta de nuevo.</p></div>';
        }
    }
}
//ACTUALIZADO EL 20 DE SEPT
// "12 estudiantes registrados" / "1 profesor registrado" / "1 administrador registrado"
function textoCantidadRegistros(tipo, n) {
    if (tipo === 'estudiantes') {
        return n === 1 ? '1 estudiante registrado' : `${n} estudiantes registrados`;
    }
    if (tipo === 'administradores') {
        return n === 1 ? '1 administrador registrado' : `${n} administradores registrados`;
    }
    return n === 1 ? '1 profesor registrado' : `${n} profesores registrados`;
}

// 👁️ Muestra u oculta la contraseña de una fila (igual que en el login: 👁️ oculta, 🔒 visible)
function alternarPasswordRegistro(indice, boton) {
    const span = document.getElementById('registro-pass-' + indice);
    const fila = registrosFilasActuales[indice];
    if (!span || !fila) return;

    const estabaVisible = span.dataset.visible === '1';

    if (estabaVisible) {
        span.textContent = CONTRASENA_OCULTA;
        span.dataset.visible = '0';
        boton.innerText = '👁️';
        boton.title = 'Mostrar contraseña';
        boton.setAttribute('aria-label', 'Mostrar contraseña');
    } else {
        span.textContent = fila.contrasena; // textContent: se muestra tal cual, sin interpretar HTML
        span.dataset.visible = '1';
        boton.innerText = '🔒';
        boton.title = 'Ocultar contraseña';
        boton.setAttribute('aria-label', 'Ocultar contraseña');
    }
}

// Botón "Eliminar" de una fila: pide confirmación antes de borrar al usuario
function clickEliminarRegistro(indice) {
    const fila = registrosFilasActuales[indice];
    if (!fila || !registrosTipoActual) return;

    const tipo = registrosTipoActual;
    const mensaje = '¿Estás seguro de borrar a este usuario?\n\n' +
        fila.nombre + '\n' + fila.correo +
        '\n\nEsta acción no se puede deshacer.';

    mostrarModalConfirmacion(
        mensaje,
        () => eliminarRegistro(tipo, fila.correo, fila.nombre),
        'Sí',
        'Cancelar'
    );
}

// Borra al usuario de la base de datos y recarga la tabla
async function eliminarRegistro(tipo, correoUsuario, nombreUsuario) {
    try {
        const url = `/api/admin/${tipo}/${encodeURIComponent(correoUsuario)}?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url, { method: 'DELETE' });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            mostrarAviso('🗑️ El usuario "' + nombreUsuario + '" fue eliminado de la base de datos.');
        } else {
            mostrarAviso('⚠️ No se pudo eliminar al usuario:\n' + (resultado.error || 'Error desconocido.'));
        }

        // Se recarga la tabla (si el admin sigue viéndola) para que la fila desaparezca
        if (registrosTipoActual === tipo) cargarRegistros(tipo);
    } catch (err) {
        console.error('⚠️ Error al eliminar el usuario:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    }
}

// ===================================================
// 📊 PRUEBAS CREADAS (solo profesores): lista las pruebas que el
//     profesor logueado ha creado hasta el momento, con su estado
//     (sin subir / programada / activa / finalizada). Arriba a la derecha
//     tiene dos botones: "Subir prueba" (azul) y "Eliminar prueba" (rojo).
//     ✏️ Cada prueba tiene además el botón "Almacenar" (junto a "Editar").
// ===================================================
let pruebasCreadas = [];        // última lista cargada (para los botones de subir/eliminar)
let pruebaPorSubir = null;      // prueba elegida que se está programando
let enviandoSubida = false;     // evita subir la misma prueba dos veces seguidas

// Texto de la etiqueta de estado que se muestra en cada prueba creada.
// ✏️ Ahora incluye la hora de inicio y la de finalización.
function etiquetaEstadoPrueba(p) {
    const inicio = formatearSoloFecha(p.fecha_inicio) + ' ' + formatearHora(p.hora_inicio);
    const fin = formatearSoloFecha(p.fecha_fin) + ' ' + formatearHora(p.hora_fin);

    if (p.estado === 'programada') {
        return `<span class="estado-pill estado-programada">🔒 Programada · del ${escaparHtml(inicio)} al ${escaparHtml(fin)}</span>`;
    }
    if (p.estado === 'activa') {
        return `<span class="estado-pill estado-activa">✅ Activa · del ${escaparHtml(inicio)} al ${escaparHtml(fin)}</span>`;
    }
    if (p.estado === 'finalizada') {
        return `<span class="estado-pill estado-finalizada">⏹ Finalizada · cerró el ${escaparHtml(fin)}</span>`;
    }
    return '<span class="estado-pill estado-sin-subir">Sin subir</span>';
}

async function cargarPruebasCreadas() {
    const contenedor = document.getElementById('pruebas-creadas-contenido');
    if (!contenedor) return;

    if (!usuarioActual || !usuarioActual.correo) {
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Inicia sesión para ver tus pruebas.</p></div>';
        return;
    }

    contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Cargando...</p></div>';

    try {
        const url = `/api/pruebas-profesor/creadas?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();
        const pruebas = datos.pruebas || [];
        pruebasCreadas = pruebas;

        // Botones de arriba a la derecha (azul: subir, rojo: eliminar).
        // Siempre se muestran, haya pruebas o no.
        const botonesHtml = `
            <div class="pc-acciones">
                <button type="button" class="btn-pc btn-pc-subir" onclick="clickSubirPrueba()">Subir prueba</button>
                <button type="button" class="btn-pc btn-pc-eliminar" onclick="clickEliminarPrueba()">Eliminar prueba</button>
            </div>
        `;

        if (pruebas.length === 0) {
            contenedor.innerHTML = botonesHtml +
                '<div class="historial-vacio"><p class="texto-proximamente">Aún no has creado ninguna prueba.</p></div>';
            return;
        }

        const filasHtml = pruebas.map(p => {
            const textoPreguntas = p.num_preguntas === 1 ? '1 pregunta' : `${p.num_preguntas} preguntas`;
            const textoPresentaciones = p.num_presentaciones === 1 ? '1 presentación' : `${p.num_presentaciones} presentaciones`;

            // ✏️ NUEVO: botón "Almacenar" (queda deshabilitado si la prueba ya está almacenada)
            const botonAlmacenar = p.almacenada
                ? '<button type="button" class="btn-almacenar-prueba" disabled>✔ Almacenada</button>'
                : `<button type="button" class="btn-almacenar-prueba" onclick="clickAlmacenarPrueba(${p.id})">Almacenar</button>`;

            return `
                <div class="pregunta-creada-fila ${claseTemaMateria(p.materia)}">
                    <div class="pregunta-creada-encabezado">
                        <div class="historial-nivel-pill pill-materia">${escaparHtml(p.materia)}</div>
                        <span class="historial-porcentaje">${textoPreguntas} · ${textoPresentaciones}</span>
                    </div>
                    <p class="pregunta-creada-enunciado">${escaparHtml(p.titulo)}</p>
                    <div class="pregunta-creada-pie">
                        <div class="pregunta-creada-info">
                            <p class="pregunta-creada-fecha">Creada: ${escaparHtml(formatearFechaHora(p.fecha))}${p.grados && p.grados.length ? ' · Para ' + palabraGrado(p.grados) + ' ' + textoGrados(p.grados) : ''}</p>
                            ${etiquetaEstadoPrueba(p)}
                        </div>
                        <div class="pregunta-creada-acciones">
                            ${botonAlmacenar}
                            <button type="button" class="btn-editar-prueba" onclick="clickEditarPrueba(${p.id})">Editar</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const etiquetaCantidad = pruebas.length === 1 ? '1 prueba creada' : `${pruebas.length} pruebas creadas`;

        contenedor.innerHTML = botonesHtml + `
            <p class="historial-etiqueta">${etiquetaCantidad}</p>
            <div class="historial-lista">${filasHtml}</div>
        `;
    } catch (err) {
        console.error('⚠️ No se pudieron cargar las pruebas creadas:', err);
        pruebasCreadas = [];
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">No se pudo cargar. Intenta de nuevo.</p></div>';
    }
}

// --- Modal para elegir una prueba de la lista (subir o borrar) ---
let callbackSeleccion = null;

function mostrarSeleccionPrueba(titulo, pruebas, callback) {
    document.getElementById('modal-seleccion-titulo').innerText = titulo;

    document.getElementById('modal-seleccion-lista').innerHTML = pruebas.map(p => {
        const textoPreguntas = p.num_preguntas === 1 ? '1 pregunta' : `${p.num_preguntas} preguntas`;
        return `
            <button type="button" class="seleccion-item ${claseTemaMateria(p.materia)}" onclick="elegirPruebaSeleccion(${p.id})">
                <span class="seleccion-item-pill">${escaparHtml(p.materia)}</span>
                <span class="seleccion-item-texto">
                    <span class="seleccion-item-titulo">${escaparHtml(p.titulo)}</span>
                    <span class="seleccion-item-meta">${textoPreguntas}</span>
                </span>
            </button>
        `;
    }).join('');

    callbackSeleccion = callback;
    document.getElementById('modal-seleccion').classList.remove('oculto');
}

function elegirPruebaSeleccion(id) {
    const callback = callbackSeleccion;
    cerrarModalSeleccion();
    if (callback) callback(id);
}

function cerrarModalSeleccion() {
    document.getElementById('modal-seleccion').classList.add('oculto');
    callbackSeleccion = null;
}

// --- Botón azul "Subir prueba" ---
function clickSubirPrueba() {
    if (pruebasCreadas.length === 0) {
        mostrarAviso('Por favor cree una prueba primero.');
        return;
    }

    // Solo se pueden subir las pruebas que aún no se han subido
    const sinSubir = pruebasCreadas.filter(p => p.estado === 'sin_subir');
    if (sinSubir.length === 0) {
        mostrarAviso('Todas tus pruebas ya fueron subidas. Crea una prueba nueva para poder subirla.');
        return;
    }

    mostrarSeleccionPrueba('Seleccione la prueba que desea subir', sinSubir, abrirModalFechas);
}

// --- Listas desplegables de grados (9°, 10° y 11°) de la ventana "Subir prueba" ---
// Cada grado tiene su propia lista con "Todos" (todo el grado) y sus cursos
// (A, B y C). Marcar "Todos" marca los tres cursos; si se marcan los tres
// cursos a mano, "Todos" se marca solo.

// Escribe en la cabecera de la lista lo que hay marcado ("Ninguno", "Todos" o "9-A, 9-B")
function actualizarResumenGrado(details) {
    const todos = details.querySelector('input[data-todos]');
    const cursos = Array.from(details.querySelectorAll('input:not([data-todos])'));
    const marcados = cursos.filter(c => c.checked);

    let texto = 'Ninguno';
    if (todos.checked) texto = 'Todos';
    else if (marcados.length > 0) texto = marcados.map(c => c.value).join(', ');

    details.querySelector('.grado-desplegable-resumen').innerText = texto;
    details.classList.toggle('con-seleccion', todos.checked || marcados.length > 0);
}

// Se ejecuta al marcar o desmarcar cualquier casilla de las listas
function alCambiarGrado(input) {
    const details = input.closest('.grado-desplegable');
    const todos = details.querySelector('input[data-todos]');
    const cursos = Array.from(details.querySelectorAll('input:not([data-todos])'));

    if (input === todos) {
        cursos.forEach(c => { c.checked = todos.checked; });
    } else {
        todos.checked = cursos.every(c => c.checked);
    }
    actualizarResumenGrado(details);
}

// Solo una lista abierta a la vez, para que la ventana no se haga muy larga
document.querySelectorAll('.grado-desplegable').forEach(d => {
    d.addEventListener('toggle', () => {
        if (!d.open) return;
        document.querySelectorAll('.grado-desplegable').forEach(otra => {
            if (otra !== d) otra.open = false;
        });
    });
});

// Segundo paso de "Subir prueba": pide los grados, la fecha y hora de inicio
// (desbloqueo) y la fecha y hora de finalización (cierre).
function abrirModalFechas(idPrueba) {
    const prueba = pruebasCreadas.find(p => p.id === idPrueba);
    if (!prueba) return;

    pruebaPorSubir = prueba;
    const hoy = hoyLocal();

    document.getElementById('modal-fechas-prueba').innerText = prueba.titulo;

    const inputInicio = document.getElementById('fecha-inicio');
    const inputFin = document.getElementById('fecha-fin');
    inputInicio.min = hoy;
    inputInicio.value = hoy;
    inputFin.min = hoy;
    inputFin.value = '';

    // ✏️ NUEVO: horas. Por defecto la prueba se desbloquea "ahora" y la hora de cierre
    // queda vacía para que el profesor la elija.
    document.getElementById('hora-inicio').value = horaActualLocal();
    document.getElementById('hora-fin').value = '';

    // Los grados siempre empiezan sin marcar: el profesor debe elegir a cuál(es) va dirigida
    document.querySelectorAll('input[name="grado-prueba"]').forEach(c => { c.checked = false; });
    document.querySelectorAll('.grado-desplegable').forEach(d => {
        d.open = false;
        actualizarResumenGrado(d);
    });

    document.getElementById('modal-fechas-error').innerText = '';
    document.getElementById('modal-fechas').classList.remove('oculto');
}

// Al cambiar la fecha de inicio, la de fin no puede ser anterior a ella
function alCambiarFechaInicio() {
    const inicio = document.getElementById('fecha-inicio').value;
    const inputFin = document.getElementById('fecha-fin');
    inputFin.min = inicio || hoyLocal();
    if (inputFin.value && inicio && inputFin.value < inicio) inputFin.value = inicio;
}

function cerrarModalFechas() {
    document.getElementById('modal-fechas').classList.add('oculto');
    pruebaPorSubir = null;
}

async function confirmarSubirPrueba() {
    if (!pruebaPorSubir || enviandoSubida) return;

    const inicio = document.getElementById('fecha-inicio').value;
    const fin = document.getElementById('fecha-fin').value;
    const horaInicio = document.getElementById('hora-inicio').value; // "HH:MM"
    const horaFin = document.getElementById('hora-fin').value;       // "HH:MM"
    const error = document.getElementById('modal-fechas-error');
    const hoy = hoyLocal();

    if (!inicio || !fin) {
        error.innerText = 'Elige la fecha de inicio y la fecha de finalización.';
        return;
    }
    if (!horaInicio || !horaFin) {
        error.innerText = 'Elige la hora de inicio y la hora de finalización.';
        return;
    }
    if (inicio < hoy) {
        error.innerText = 'La fecha de inicio no puede ser anterior a hoy.';
        return;
    }
    if (fin < inicio) {
        error.innerText = 'La fecha de finalización no puede ser anterior a la de inicio.';
        return;
    }

    // Comparación de fecha + hora (como texto "AAAA-MM-DD HH:MM")
    const inicioCompleto = inicio + ' ' + horaInicio;
    const finCompleto = fin + ' ' + horaFin;
    if (finCompleto <= inicioCompleto) {
        error.innerText = 'La hora de finalización debe ser posterior a la hora de inicio.';
        return;
    }
    if (finCompleto < ahoraLocal()) {
        error.innerText = 'La fecha y hora de finalización ya pasaron.';
        return;
    }

    // Grados marcados (9, 10 y/u 11): la prueba solo estará disponible para ellos
    const grados = Array.from(document.querySelectorAll('input[name="grado-prueba"]:checked'))
        .map(c => c.value);
    if (grados.length === 0) {
        error.innerText = 'Elige al menos un grado para esta prueba.';
        return;
    }

    error.innerText = '';
    enviandoSubida = true;
    const boton = document.getElementById('modal-fechas-boton');
    boton.disabled = true;

    try {
        const respuesta = await fetch(`/api/pruebas-profesor/${pruebaPorSubir.id}/subir`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                correo: usuarioActual.correo,
                fecha_inicio: inicio,
                fecha_fin: fin,
                hora_inicio: horaInicio,
                hora_fin: horaFin,
                grados
            })
        });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            const titulo = pruebaPorSubir.titulo;
            cerrarModalFechas();

            // El servidor devuelve los grados ya ordenados (y con el grado completo si se marcaron sus tres cursos)
            const gradosFinales = resultado.grados || grados;
            const paraQuien = palabraGrado(gradosFinales) + ' ' + textoGrados(gradosFinales);
            const textoInicio = formatearSoloFecha(inicio) + ' a las ' + formatearHora(horaInicio);
            const textoFin = formatearSoloFecha(fin) + ' a las ' + formatearHora(horaFin);

            if (resultado.estado === 'programada') {
                mostrarAviso('🔒 La prueba "' + titulo + '" quedó programada para ' + paraQuien + '.\n\nEstará bloqueada y se desbloqueará el ' +
                    textoInicio + ' (se cierra el ' + textoFin + '). Los estudiantes de otros grados la verán bloqueada.');
            } else {
                mostrarAviso('🚀 ¡Prueba "' + titulo + '" subida!\n\nLos estudiantes de ' + paraQuien + ' ya pueden presentarla hasta el ' +
                    textoFin + '. Los estudiantes de otros grados la verán bloqueada.');
            }
            cargarPruebasCreadas();
        } else {
            error.innerText = resultado.error || 'No se pudo subir la prueba.';
        }
    } catch (err) {
        console.error('⚠️ Error al subir la prueba:', err);
        error.innerText = 'No se pudo conectar con el servidor.';
    } finally {
        enviandoSubida = false;
        boton.disabled = false;
    }
}

// --- Botón rojo "Eliminar prueba" ---
function clickEliminarPrueba() {
    if (pruebasCreadas.length === 0) {
        mostrarAviso('Por favor cree una prueba primero.');
        return;
    }

    mostrarSeleccionPrueba('Seleccione la prueba que desea borrar', pruebasCreadas, pedirConfirmacionEliminar);
}

function pedirConfirmacionEliminar(idPrueba) {
    const prueba = pruebasCreadas.find(p => p.id === idPrueba);
    if (!prueba) return;

    let mensaje = '¿Seguro que quieres eliminar la prueba "' + prueba.titulo + '"?';
    if (prueba.num_presentaciones > 0) {
        mensaje += '\n\nLos resultados de los estudiantes que ya la presentaron se conservarán en "Resultados de las pruebas".';
    }
    // ✏️ NUEVO: avisa si la prueba no está almacenada (se perdería por completo)
    if (prueba.almacenada) {
        mensaje += '\n\nLa prueba seguirá disponible en "Pruebas almacenadas".';
    } else {
        mensaje += '\n\nOjo: esta prueba NO está almacenada, se perderá por completo.';
    }
    mensaje += '\n\nEsta acción no se puede deshacer.';

    mostrarModalConfirmacion(mensaje, () => eliminarPrueba(idPrueba), 'Eliminar', 'Cancelar');
}

async function eliminarPrueba(idPrueba) {
    try {
        const url = `/api/pruebas-profesor/${idPrueba}?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url, { method: 'DELETE' });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            mostrarAviso('🗑️ La prueba fue eliminada.');
            cargarPruebasCreadas();
        } else {
            mostrarAviso('⚠️ No se pudo eliminar la prueba:\n' + (resultado.error || 'Error desconocido.'));
        }
    } catch (err) {
        console.error('⚠️ Error al eliminar la prueba:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    }
}

// ===================================================
// 🗂️ PRUEBAS ALMACENADAS (solo profesores) — ✏️ NUEVO
//     - El botón "Almacenar" de "Pruebas creadas" guarda una copia
//       independiente de la prueba (preguntas + imágenes) en el servidor.
//     - "Pruebas almacenadas" (menú lateral) lista esas copias. Siguen ahí
//       aunque la prueba original se elimine de "Pruebas creadas".
//     - Desde aquí el profesor puede eliminar una prueba almacenada.
// ===================================================
let pruebasAlmacenadas = [];  // última lista cargada (para el botón Eliminar)
let almacenando = false;      // evita almacenar dos veces seguidas con un doble clic

// Botón "Almacenar" de una prueba en "Pruebas creadas"
async function clickAlmacenarPrueba(idPrueba) {
    if (almacenando) return;
    almacenando = true;

    try {
        const respuesta = await fetch(`/api/pruebas-profesor/${idPrueba}/almacenar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo: usuarioActual.correo })
        });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            mostrarAviso('🗂️ ' + resultado.mensaje);
        } else {
            mostrarAviso('⚠️ ' + (resultado.error || 'No se pudo almacenar la prueba.'));
        }
        cargarPruebasCreadas(); // así el botón cambia a "✔ Almacenada"
    } catch (err) {
        console.error('⚠️ Error al almacenar la prueba:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    } finally {
        almacenando = false;
    }
}

// Lista de "Pruebas almacenadas" del profesor
async function cargarPruebasAlmacenadas() {
    const contenedor = document.getElementById('almacenadas-contenido');
    if (!contenedor) return;

    if (!usuarioActual || !usuarioActual.correo) {
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Inicia sesión para ver tus pruebas.</p></div>';
        return;
    }

    contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Cargando...</p></div>';

    try {
        const url = `/api/pruebas-almacenadas?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();

        if (!respuesta.ok) {
            pruebasAlmacenadas = [];
            contenedor.innerHTML = `<div class="historial-vacio"><p class="texto-proximamente">${escaparHtml(datos.error || 'No se pudo cargar.')}</p></div>`;
            return;
        }

        pruebasAlmacenadas = datos.pruebas || [];

        if (pruebasAlmacenadas.length === 0) {
            contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Aún no has almacenado ninguna prueba. Puedes hacerlo con el botón "Almacenar" en "Pruebas creadas".</p></div>';
            return;
        }

        const filasHtml = pruebasAlmacenadas.map(p => `
            <div class="pregunta-creada-fila ${claseTemaMateria(p.materia)}">
                <div class="pregunta-creada-encabezado">
                    <div class="historial-nivel-pill pill-materia">${escaparHtml(p.materia)}</div>
                    <span class="historial-porcentaje">${textoCantidadPreguntas(Number(p.num_preguntas))}</span>
                </div>
                <p class="pregunta-creada-enunciado">${escaparHtml(p.titulo)}</p>
                <div class="pregunta-creada-pie">
                    <p class="pregunta-creada-fecha">Almacenada: ${escaparHtml(formatearFechaHora(p.fecha_almacenada))}</p>
                    <div class="pregunta-creada-acciones">
                        <button type="button" class="btn-eliminar-grupo" onclick="clickEliminarAlmacenada(${p.id})">Eliminar</button>
                    </div>
                </div>
            </div>
        `).join('');

        const etiqueta = pruebasAlmacenadas.length === 1 ? '1 prueba almacenada' : `${pruebasAlmacenadas.length} pruebas almacenadas`;

        contenedor.innerHTML = `
            <p class="historial-etiqueta">${etiqueta}</p>
            <div class="historial-lista">${filasHtml}</div>
        `;
    } catch (err) {
        console.error('⚠️ No se pudieron cargar las pruebas almacenadas:', err);
        pruebasAlmacenadas = [];
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">No se pudo cargar. Intenta de nuevo.</p></div>';
    }
}

// Botón "Eliminar" de una prueba almacenada: pide confirmación
function clickEliminarAlmacenada(id) {
    const prueba = pruebasAlmacenadas.find(p => p.id === id);
    if (!prueba) return;

    mostrarModalConfirmacion(
        '¿Seguro que quieres eliminar la prueba almacenada "' + prueba.titulo + '"?\n\nEsta acción no se puede deshacer.',
        () => eliminarAlmacenada(id),
        'Eliminar',
        'Cancelar'
    );
}

async function eliminarAlmacenada(id) {
    try {
        const url = `/api/pruebas-almacenadas/${id}?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url, { method: 'DELETE' });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            mostrarAviso('🗑️ La prueba almacenada fue eliminada.');
        } else {
            mostrarAviso('⚠️ No se pudo eliminar:\n' + (resultado.error || 'Error desconocido.'));
        }
        cargarPruebasAlmacenadas();
    } catch (err) {
        console.error('⚠️ Error al eliminar la prueba almacenada:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    }
}

// ===================================================
// 📦 RESULTADOS DE LAS PRUEBAS (solo profesores): muestra quién ha
//     presentado las pruebas de ESTE profesor y cómo le fue, de la más
//     reciente a la más antigua.
// ===================================================
async function cargarResultadosProfesor() {
    const contenedor = document.getElementById('resultados-generales-contenido');
    if (!contenedor) return;

    if (!usuarioActual || !usuarioActual.correo) {
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Inicia sesión para ver los resultados.</p></div>';
        return;
    }

    contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Cargando...</p></div>';

    try {
        const url = `/api/pruebas-profesor/resultados?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();
        const resultados = datos.resultados || [];

        if (resultados.length === 0) {
            contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Aún no hay estudiantes que hayan presentado tus pruebas.</p></div>';
            return;
        }

        const filasHtml = resultados.map(r => {
            const porcentaje = r.total > 0 ? Math.round((r.correctas / r.total) * 100) : 0;
            const gradoTexto = r.grado ? ` · Grado ${escaparHtml(formatearGrado(r.grado))}` : '';

            return `
                <div class="resultado-fila ${claseTemaMateria(r.materia)}">
                    <div class="resultado-fila-info">
                        <div class="resultado-fila-encabezado">
                            <span class="historial-nivel-pill pill-materia">${escaparHtml(r.materia)}</span>
                            ${r.prueba_eliminada ? '<span class="estado-pill estado-finalizada">Prueba eliminada</span>' : ''}
                        </div>
                        <p class="resultado-fila-titulo">${escaparHtml(r.titulo)}</p>
                        <p class="resultado-fila-estudiante"><span class="resultado-general-nombre">${escaparHtml(r.nombre)}</span>${gradoTexto}</p>
                        <p class="resultado-fila-fecha">${escaparHtml(formatearFechaHora(r.fecha))}</p>
                    </div>
                    <div class="resultado-fila-puntaje">
                        <span class="resultado-fila-numero">${r.correctas}/${r.total}</span>
                        <span class="resultado-fila-detalle">correctas · ${porcentaje}%</span>
                    </div>
                </div>
            `;
        }).join('');

        const etiquetaCantidad = resultados.length === 1 ? '1 prueba presentada' : `${resultados.length} pruebas presentadas`;

        contenedor.innerHTML = `
            <p class="historial-etiqueta">${etiquetaCantidad}</p>
            <div class="historial-lista">${filasHtml}</div>
        `;
    } catch (err) {
        console.error('⚠️ No se pudieron cargar los resultados:', err);
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">No se pudo cargar. Intenta de nuevo.</p></div>';
    }
}

// ===================================================
// 👩‍🏫 PRUEBAS DE PROFESORES (solo estudiantes): lista de pruebas que los
//     profesores ya SUBIERON. Cada prueba lleva el color de su materia
//     (por ejemplo, Matemáticas en rojo). Si la fecha y hora de inicio aún
//     no han llegado, la prueba aparece bloqueada; si ya pasó la fecha y
//     hora de fin, aparece cerrada. Cada prueba se puede presentar UNA sola
//     vez; después se muestra el resultado en lugar del botón "Presentar".
// ===================================================
async function cargarPruebasProfesores(silencioso = false) {
    //AGREGADO 20 DE SEPT anyns
    const contenedor = document.getElementById('lista-pp-contenido');
    if (!contenedor) return;

    if (!usuarioActual || !usuarioActual.correo) {
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Inicia sesión para ver las pruebas.</p></div>';
        return;
    }

    //AGREGADO 20 SEPT if silencioso
    if (!silencioso) {
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Cargando...</p></div>';
    }
    try {
        const url = `/api/pruebas-profesor/disponibles?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();
        const pruebas = datos.pruebas || [];

        if (pruebas.length === 0) {
            contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Aún no hay pruebas disponibles.</p></div>';
            return;
        }

        const filasHtml = pruebas.map(p => {
            const yaPresentada = p.correctas !== null && p.correctas !== undefined;
            const textoPreguntas = p.num_preguntas === 1 ? '1 pregunta' : `${p.num_preguntas} preguntas`;
            const inicio = formatearSoloFecha(p.fecha_inicio);
            const fin = formatearSoloFecha(p.fecha_fin);
            const horaInicio = formatearHora(p.hora_inicio);
            const horaFin = formatearHora(p.hora_fin);

            let accionHtml;
            let claseExtra = '';
            if (yaPresentada) {
                const porcentaje = p.total > 0 ? Math.round((p.correctas / p.total) * 100) : 0;
                accionHtml = `
                    <div class="historial-resultado">
                        <span class="historial-numero">${p.correctas}/${p.total}</span>
                        <span class="historial-porcentaje">${porcentaje}%</span>
                    </div>`;
            } else if (p.grado_permitido === false) {
                // La prueba va dirigida a otro grado: bloqueada para este estudiante
                claseExtra = ' pp-bloqueada';
                accionHtml = `<span class="estado-pill estado-programada">🔒 Solo para ${palabraGrado(p.grados)} ${textoGrados(p.grados)}</span>`;
            } else if (p.estado === 'programada') {
                // Aún no llega la fecha y hora de inicio: prueba bloqueada
                claseExtra = ' pp-bloqueada';
                accionHtml = `<span class="estado-pill estado-programada">🔒 Se desbloquea el ${escaparHtml(inicio)} a las ${escaparHtml(horaInicio)}</span>`;
            } else if (p.estado === 'finalizada') {
                claseExtra = ' pp-bloqueada';
                accionHtml = '<span class="estado-pill estado-finalizada">⏹ Cerrada</span>';
            } else {
                accionHtml = `<button class="btn-presentar-pp" onclick="iniciarPruebaPP(${p.id})">Presentar</button>`;
            }

            return `
                <div class="pp-fila ${claseTemaMateria(p.materia)}${claseExtra}">
                    <div class="pp-info">
                        <p class="pp-titulo">${escaparHtml(p.titulo)}</p>
                        <p class="pp-meta">
                            <span class="historial-nivel-pill pill-materia">${escaparHtml(p.materia)}</span>
                            Prof. ${escaparHtml(p.nombre_profesor)} · ${textoPreguntas}
                        </p>
                        <p class="pp-meta">${p.grados && p.grados.length ? 'Para ' + palabraGrado(p.grados) + ' ' + textoGrados(p.grados) + ' · ' : ''}Disponible del ${escaparHtml(inicio)} (${escaparHtml(horaInicio)}) al ${escaparHtml(fin)} (${escaparHtml(horaFin)})</p>
                    </div>
                    <div class="pp-accion">${accionHtml}</div>
                </div>
            `;
        }).join('');

        const etiquetaCantidad = pruebas.length === 1 ? '1 prueba' : `${pruebas.length} pruebas`;

        contenedor.innerHTML = `
            <p class="historial-etiqueta">${etiquetaCantidad}</p>
            <div class="historial-lista">${filasHtml}</div>
        `;
    } catch (err) {
        console.error('⚠️ No se pudieron cargar las pruebas de profesores:', err);
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">No se pudo cargar. Intenta de nuevo.</p></div>';
    }
}

// --- Entorno para presentar una prueba de profesor ---
let ppPrueba = null;           // { id, titulo, materia }
let ppPreguntas = [];          // preguntas de la prueba (sin respuesta correcta)
let ppIndice = 0;              // pregunta que se está viendo
let ppRespuestas = {};         // { idPregunta: 'A' | 'B' | 'C' | 'D' }
let ppEnviando = false;        // evita enviar la prueba dos veces seguidas

async function iniciarPruebaPP(idPrueba) {
    try {
        const url = `/api/pruebas-profesor/${idPrueba}/preguntas?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();

        if (!respuesta.ok) {
            mostrarAviso('⚠️ ' + (datos.error || 'No se pudo abrir la prueba.'));
            cargarPruebasProfesores();
            return;
        }

        if (!datos.preguntas || datos.preguntas.length === 0) {
            mostrarAviso('Esta prueba todavía no tiene preguntas.');
            return;
        }

        ppPrueba = datos.prueba;
        ppPreguntas = datos.preguntas;
        ppIndice = 0;
        ppRespuestas = {};
        ppEnviando = false;

        document.getElementById('pp-titulo').innerText = ppPrueba.titulo;

        // La prueba se ve con el color de su materia (Matemáticas en rojo, etc.).
        // Al reemplazar el className también se quita 'oculto', así que se muestra.
        document.getElementById('vista-prueba-pp').className = 'vista-prueba ' + claseTemaMateria(ppPrueba.materia);

        renderizarPreguntaPP();
    } catch (err) {
        console.error('⚠️ Error al abrir la prueba:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    }
}

function renderizarPreguntaPP() {
    const pregunta = ppPreguntas[ppIndice];
    const elegida = ppRespuestas[pregunta.id] || null;

    document.getElementById('pp-progreso').innerText =
        'Pregunta ' + (ppIndice + 1) + ' de ' + ppPreguntas.length;

    actualizarImagenEn('pp-imagen-wrap', 'pp-imagen', pregunta.imagen || null);

    document.getElementById('pp-enunciado').innerText = pregunta.enunciado;

    escribirOpcionEn('pp-opcion-', 'A', pregunta.opcion_a);
    escribirOpcionEn('pp-opcion-', 'B', pregunta.opcion_b);
    escribirOpcionEn('pp-opcion-', 'C', pregunta.opcion_c);
    escribirOpcionEn('pp-opcion-', 'D', pregunta.opcion_d);

    ['A', 'B', 'C', 'D'].forEach(letra => {
        document.getElementById('pp-opcion-' + letra).classList.toggle('seleccionada', letra === elegida);
    });

    const esUltima = ppIndice === ppPreguntas.length - 1;
    document.getElementById('pp-btn-siguiente').innerText = esUltima ? 'Finalizar prueba' : 'Siguiente pregunta →';
    document.getElementById('pp-btn-anterior').classList.toggle('oculto', ppIndice === 0);
}

// Marca la opción elegida y la guarda de una vez
function seleccionarOpcionPP(letra) {
    const pregunta = ppPreguntas[ppIndice];
    if (!pregunta) return;

    ppRespuestas[pregunta.id] = letra;
    ['A', 'B', 'C', 'D'].forEach(l => {
        document.getElementById('pp-opcion-' + l).classList.toggle('seleccionada', l === letra);
    });
}

async function continuarPruebaPP() {
    const pregunta = ppPreguntas[ppIndice];
    if (!pregunta) return;

    if (!ppRespuestas[pregunta.id]) {
        mostrarAviso('Selecciona una respuesta antes de continuar.');
        return;
    }

    if (ppIndice < ppPreguntas.length - 1) {
        ppIndice++;
        renderizarPreguntaPP();
    } else {
        await finalizarPruebaPP();
    }
}

function preguntaAnteriorPP() {
    if (ppIndice > 0) {
        ppIndice--;
        renderizarPreguntaPP();
    }
}

// Envía las respuestas al servidor y muestra el resultado
async function finalizarPruebaPP() {
    if (ppEnviando) return;
    ppEnviando = true;

    const respuestas = Object.keys(ppRespuestas).map(id => ({
        pregunta_id: parseInt(id, 10),
        opcion_elegida: ppRespuestas[id]
    }));

    try {
        const respuesta = await fetch(`/api/pruebas-profesor/${ppPrueba.id}/calificar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                correo: usuarioActual.correo,
                nombre: usuarioActual.nombre,
                respuestas
            })
        });
        const resultado = await respuesta.json();

        const titulo = ppPrueba.titulo;
        salirDePruebaPP();
        cargarPruebasProfesores();

        if (respuesta.ok) {
            mostrarAviso('🎉 Terminaste la prueba "' + titulo + '".\n\nResultado: ' +
                resultado.correctas + ' de ' + resultado.total + ' correctas.');
        } else {
            mostrarAviso('⚠️ ' + (resultado.error || 'Error al calificar la prueba.'));
        }
    } catch (err) {
        console.error('⚠️ Error al enviar la prueba:', err);
        ppEnviando = false;
        mostrarAviso('⚠️ No se pudo conectar con el servidor. Intenta de nuevo.');
    }
}

// Pide confirmación antes de salir, ya que se perdería el progreso
function confirmarSalirPruebaPP() {
    mostrarModalConfirmacion(
        'Si sales de la prueba perderás el progreso.',
        () => salirDePruebaPP(),
        'Salir',
        'Cancelar'
    );
}

function salirDePruebaPP() {
    document.getElementById('vista-prueba-pp').classList.add('oculto');
    ppPrueba = null;
    ppPreguntas = [];
    ppIndice = 0;
    ppRespuestas = {};
    ppEnviando = false;
}

// ===================================================
// 📊 PUNTAJE ACTUAL (solo estudiantes): combina TODAS las sesiones ya
//     presentadas del intento activo del nivel más reciente (no solo la
//     última sesión aislada), para que el porcentaje mostrado coincida
//     con el que usa el servidor para decidir si el nivel quedó aprobado.
//     ✏️ Cuando ya presentó las dos sesiones, también se muestra el
//     mínimo de respuestas correctas que fijó el administrador ("Promedio").
// ===================================================
async function cargarPuntajeActual() {
    const contenedor = document.getElementById('puntaje-actual-contenido');
    if (!contenedor) return;

    if (!usuarioActual || !usuarioActual.correo) {
        contenedor.innerHTML = '<p class="texto-proximamente">Inicia sesión para ver tu puntaje.</p>';
        return;
    }

    contenedor.innerHTML = '<p class="texto-proximamente">Cargando...</p>';

    try {
        const url = `/api/mis-puntajes?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();
        const puntajes = datos.puntajes || [];

        if (puntajes.length === 0) {
            contenedor.innerHTML = '<p class="texto-proximamente">Aún no has presentado ninguna prueba.</p>';
            return;
        }

        // El nivel de la prueba más reciente (el servidor ya ordena por
        // fecha descendente, así que el primero es siempre el más nuevo).
        const nivelReciente = puntajes[0].nivel;

        // Trae TODAS las sesiones del intento actualmente activo de ese
        // nivel (no solo la última), para sumar correctamente el puntaje.
        const urlNivel = `/api/nivel-aprobado?correo=${encodeURIComponent(usuarioActual.correo)}&nivel=${encodeURIComponent(nivelReciente)}`;
        const respuestaNivel = await fetch(urlNivel);
        const datosNivel = await respuestaNivel.json();

        const sesiones = datosNivel.sesiones || [];
        const totalCorrectas = datosNivel.totalCorrectas || 0;
        const totalPreguntas = datosNivel.totalPreguntas || 0;
        const porcentaje = totalPreguntas > 0 ? Math.round((totalCorrectas / totalPreguntas) * 100) : 0;

        // Fecha de la prueba más reciente que pertenece a ese mismo nivel
        // (para mostrar "última actividad").
        const ultimaDeEseNivel = puntajes.find(p => p.nivel === nivelReciente);
        const fecha = ultimaDeEseNivel ? new Date(ultimaDeEseNivel.fecha) : null;
        const fechaValida = fecha && !isNaN(fecha.getTime());
        const fechaTexto = fechaValida
            ? fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })
            : '';
        const horaTexto = fechaValida
            ? fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
            : '';

        const sesionesHtml = sesiones.map(s => {
            const pct = s.total > 0 ? Math.round((s.correctas / s.total) * 100) : 0;
            return `
                <div class="puntaje-sesion-fila">
                    <span>Sesión ${s.sesion}</span>
                    <span>${s.correctas}/${s.total} · ${pct}%</span>
                </div>
            `;
        }).join('');

        // ✏️ NUEVO: mínimo para pasar de nivel (solo si ya presentó las dos sesiones y no es el nivel S)
        let minimoHtml = '';
        const siguienteNivel = obtenerSiguienteNivel(nivelReciente);
        if (siguienteNivel && sesiones.length >= 2 && datosNivel.minimoCorrectas) {
            minimoHtml = `<p class="puntaje-minimo">Para pasar al nivel ${siguienteNivel} se necesitan ${datosNivel.minimoCorrectas} de ${totalPreguntas} respuestas correctas entre las dos sesiones.</p>`;
        }

        contenedor.innerHTML = `
            <p class="puntaje-etiqueta">Puntaje actual</p>
            <div class="puntaje-nivel-pill">Nivel ${nivelReciente}</div>
            <div class="puntaje-numero">${totalCorrectas}<span class="puntaje-numero-total">/${totalPreguntas}</span></div>
            <p class="puntaje-porcentaje">${porcentaje}% de respuestas correctas (todas las sesiones presentadas)</p>
            ${sesionesHtml ? `<div class="puntaje-sesiones-detalle">${sesionesHtml}</div>` : ''}
            ${minimoHtml}
            ${fechaValida ? `<p class="puntaje-fecha">Última actividad: ${fechaTexto} a las ${horaTexto}</p>` : ''}
        `;
    } catch (err) {
        console.error('⚠️ No se pudo cargar el puntaje actual:', err);
        contenedor.innerHTML = '<p class="texto-proximamente">No se pudo cargar tu puntaje. Intenta de nuevo.</p>';
    }
}

// ===================================================
// 📦 HISTORIAL DE PUNTAJES (solo estudiantes): muestra TODAS las pruebas
//     presentadas por el estudiante (una fila por cada nivel/sesión ya
//     calificada), ordenadas de la más reciente a la más antigua. Cada
//     fila tiene un botón de tres puntos (⋮) que despliega las materias de
//     esa prueba y, al tocarlas, el detalle pregunta por pregunta.
// ===================================================
async function cargarHistorialPuntajes() {
    const contenedor = document.getElementById('historial-puntajes-contenido');
    if (!contenedor) return;

    if (!usuarioActual || !usuarioActual.correo) {
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Inicia sesión para ver tu historial.</p></div>';
        return;
    }

    contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Cargando...</p></div>';

    try {
        const url = `/api/mis-puntajes?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();
        const puntajes = datos.puntajes || [];

        if (puntajes.length === 0) {
            contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Aún no has presentado ninguna prueba.</p></div>';
            return;
        }

        const filasHtml = puntajes.map(p => {
            const porcentaje = p.total > 0 ? Math.round((p.correctas / p.total) * 100) : 0;
            const fecha = new Date(p.fecha);
            const fechaValida = !isNaN(fecha.getTime());
            const fechaTexto = fechaValida
                ? fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
                : '';
            const horaTexto = fechaValida
                ? fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
                : '';

            return `
                <div class="historial-fila">
                    <div class="historial-nivel-pill">Nivel ${p.nivel} · Sesión ${p.sesion}</div>
                    <div class="historial-resultado">
                        <span class="historial-numero">${p.correctas}/${p.total}</span>
                        <span class="historial-porcentaje">${porcentaje}%</span>
                    </div>
                    <div class="historial-fecha">${fechaValida ? (fechaTexto + ' · ' + horaTexto) : ''}</div>
                    <div class="historial-detalle-wrap">
                        <button class="btn-detalle-historial" title="Ver materias" onclick="toggleMenuMaterias(event, ${p.id})">⋮</button>
                        <div class="dropdown-materias oculto" id="dropdown-materias-${p.id}"></div>
                    </div>
                </div>
            `;
        }).join('');

        const totalPruebas = puntajes.length;
        const etiquetaCantidad = totalPruebas === 1 ? '1 prueba presentada' : `${totalPruebas} pruebas presentadas`;

        contenedor.innerHTML = `
            <p class="historial-etiqueta">${etiquetaCantidad}</p>
            <div class="historial-lista">${filasHtml}</div>
        `;
    } catch (err) {
        console.error('⚠️ No se pudo cargar el historial de puntajes:', err);
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">No se pudo cargar tu historial. Intenta de nuevo.</p></div>';
    }
}

// ===================================================
// ⋮ MENÚ DE MATERIAS: al tocar los tres puntos de una fila del historial,
//     se consulta al servidor el desglose por materia de ESE resultado
//     concreto y se muestra en un desplegable.
// ===================================================
async function toggleMenuMaterias(event, resultadoId) {
    event.stopPropagation();
    const dropdown = document.getElementById('dropdown-materias-' + resultadoId);
    if (!dropdown) return;

    // Cierra cualquier otro menú de materias que estuviera abierto
    document.querySelectorAll('.dropdown-materias').forEach(d => {
        if (d !== dropdown) d.classList.add('oculto');
    });

    const estabaOculto = dropdown.classList.contains('oculto');
    if (!estabaOculto) {
        dropdown.classList.add('oculto');
        return;
    }

    dropdown.classList.remove('oculto');
    dropdown.innerHTML = '<p class="dropdown-cargando">Cargando...</p>';

    try {
        const url = `/api/resultado-materias?resultado_id=${resultadoId}&correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();
        const materias = datos.materias || [];

        if (materias.length === 0) {
            dropdown.innerHTML = '<p class="dropdown-cargando">Sin detalle disponible para esta prueba.</p>';
            return;
        }

        dropdown.innerHTML = materias.map(m => `
            <div class="materia-dropdown-item" onclick="verPreguntasMateria(${resultadoId}, '${m.materia.replace(/'/g, "\\'")}')">
                <span>${escaparHtml(m.materia)}</span>
                <span class="materia-dropdown-puntaje">${m.correctas}/${m.total}</span>
            </div>
        `).join('');
    } catch (err) {
        console.error('⚠️ No se pudieron cargar las materias:', err);
        dropdown.innerHTML = '<p class="dropdown-cargando">Error al cargar.</p>';
    }
}

// Cierra cualquier menú de materias abierto al hacer clic fuera de él
document.addEventListener('click', () => {
    document.querySelectorAll('.dropdown-materias').forEach(d => d.classList.add('oculto'));
});

// ===================================================
// 📖 DETALLE DE PREGUNTAS POR MATERIA: muestra en un modal cada pregunta
//     de la materia elegida, marcando la opción correcta (verde) y, si el
//     estudiante falló, también su opción elegida (roja). Si la pregunta
//     tenía una imagen asociada, se muestra encima del enunciado.
// ===================================================
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
                return `<div class="${clase}">${letra}. ${escaparHtml(texto)}</div>`;
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
                    <p class="detalle-pregunta-enunciado">${escaparHtml(p.enunciado)}</p>
                    <div class="detalle-opciones">${opcionesHtml}</div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('⚠️ No se pudieron cargar las preguntas de la materia:', err);
        cuerpo.innerHTML = '<p class="dropdown-cargando">Error al cargar las preguntas.</p>';
    }
}

function cerrarModalDetalle() {
    document.getElementById('modal-detalle').classList.add('oculto');
}

// ===================================================
// 🚀 RANKING (solo estudiantes): carga el top de cada nivel (B, A, S) y lo
//     pinta con formato de medallas para el top 3 y lista numerada para el
//     resto. Solo aparecen estudiantes que ya presentaron ambas sesiones
//     del nivel (esto lo garantiza el servidor).
// ===================================================
async function cargarRanking() {
    const niveles = ['B', 'A', 'S'];

    niveles.forEach(n => {
        const cont = document.getElementById('ranking-lista-' + n);
        if (cont) cont.innerHTML = '<p class="texto-proximamente">Cargando...</p>';
    });

    try {
        const respuesta = await fetch('/api/ranking');
        const datos = await respuesta.json();
        const ranking = datos.ranking || {};

        niveles.forEach(nivel => {
            const cont = document.getElementById('ranking-lista-' + nivel);
            if (!cont) return;

            const lista = ranking[nivel] || [];

            if (lista.length === 0) {
                cont.innerHTML = '<p class="texto-proximamente">Aún no hay estudiantes en el ranking de este nivel.</p>';
                return;
            }

            cont.innerHTML = lista.map((e, i) => {
                const pos = i + 1;
                const gradoTexto = formatearGrado(e.grado);
                const puntajeTexto = `${e.correctas}/${e.total} · Grado ${gradoTexto}`;

                let etiquetaPos;
                if (pos === 1) etiquetaPos = '🥇 1.º LUGAR:';
                else if (pos === 2) etiquetaPos = '🥈 2.º LUGAR:';
                else if (pos === 3) etiquetaPos = '🥉 3.º LUGAR:';
                else etiquetaPos = pos + '.';

                return `
                    <div class="ranking-fila ${pos <= 3 ? 'ranking-podio' : ''}">
                        <span class="ranking-posicion">${etiquetaPos}</span>
                        <span class="ranking-nombre">${escaparHtml(e.nombre)} – ${escaparHtml(puntajeTexto)}</span>
                    </div>
                `;
            }).join('');
        });
    } catch (err) {
        console.error('⚠️ No se pudo cargar el ranking:', err);
        niveles.forEach(n => {
            const cont = document.getElementById('ranking-lista-' + n);
            if (cont) cont.innerHTML = '<p class="texto-proximamente">No se pudo cargar el ranking.</p>';
        });
    }
}

// ===================================================
// MODAL PERSONALIZADO (reutilizable)
// Reemplaza TODOS los alert()/confirm() nativos del navegador
// (esos recuadros negros feos) por el modal morado propio de la app.
//
//  - mostrarModalConfirmacion(mensaje, callback, textoSi, textoNo)
//        -> Pregunta con botones configurables (por defecto "SÍ" / "NO").
//           El callback solo se ejecuta si el usuario elige el botón
//           afirmativo. textoSi/textoNo permiten reutilizar el mismo
//           modal para casos como "Salir" / "Cancelar".
//  - mostrarAviso(mensaje, callback)
//        -> Solo informa, con un único botón "Aceptar". El callback
//           (opcional) se ejecuta al cerrar el aviso; úsalo cuando
//           algo debe pasar DESPUÉS de que el usuario lo cierre.
//  - mostrarAvisoSinBotones(mensaje, milisegundos)
//        -> Solo muestra el mensaje, sin ningún botón, y se cierra
//           solo después del tiempo indicado (3 segundos por defecto).
// ===================================================
let callbackConfirmacion = null;
let temporizadorAviso = null;

function mostrarModalConfirmacion(mensaje, callback, textoSi = 'SÍ', textoNo = 'NO') {
    clearTimeout(temporizadorAviso);
    document.getElementById('modal-pregunta').innerText = mensaje;
    document.getElementById('modal-boton-si').innerText = textoSi;
    document.getElementById('modal-boton-si').classList.remove('oculto');
    document.getElementById('modal-boton-no').innerText = textoNo;
    document.getElementById('modal-boton-no').classList.remove('oculto');
    callbackConfirmacion = callback;
    document.getElementById('modal-confirmacion').classList.remove('oculto');
}

function mostrarAviso(mensaje, callback) {
    clearTimeout(temporizadorAviso);
    document.getElementById('modal-pregunta').innerText = mensaje;
    document.getElementById('modal-boton-si').innerText = 'Aceptar';
    document.getElementById('modal-boton-si').classList.remove('oculto');
    document.getElementById('modal-boton-no').classList.add('oculto');
    callbackConfirmacion = callback || null;
    document.getElementById('modal-confirmacion').classList.remove('oculto');
}

// Aviso informativo sin ningún botón: aparece y se cierra solo
function mostrarAvisoSinBotones(mensaje, milisegundos = 3000) {
    clearTimeout(temporizadorAviso);
    document.getElementById('modal-pregunta').innerText = mensaje;
    document.getElementById('modal-boton-si').classList.add('oculto');
    document.getElementById('modal-boton-no').classList.add('oculto');
    callbackConfirmacion = null;
    document.getElementById('modal-confirmacion').classList.remove('oculto');

    temporizadorAviso = setTimeout(() => {
        document.getElementById('modal-confirmacion').classList.add('oculto');
    }, milisegundos);
}

function confirmarSi() {
    document.getElementById('modal-confirmacion').classList.add('oculto');
    if (callbackConfirmacion) callbackConfirmacion();
    callbackConfirmacion = null;
}

function confirmarNo() {
    document.getElementById('modal-confirmacion').classList.add('oculto');
    callbackConfirmacion = null;
}

// Pide confirmación antes de cerrar sesión
function confirmarCerrarSesion() {
    mostrarModalConfirmacion('¿Estás seguro de que quieres cerrar sesión?', () => {
        cerrarSesion();
    });
}

// ✏️ NUEVO: deja la zona de pruebas del estudiante como recién abierta, para
// que no se arrastre nada (vista, candados, nivel, progreso) del usuario anterior.
// Se llama al cerrar sesión y al iniciar sesión (mostrarNiveles).
function reiniciarVistasEstudiante() {
    document.getElementById('vista-prueba').classList.add('oculto');
    document.getElementById('vista-sesiones').classList.add('oculto');
    document.getElementById('vista-niveles').classList.remove('oculto');

    const btnRepetir = document.getElementById('btn-repetir-nivel');
    if (btnRepetir) btnRepetir.classList.add('oculto');

    // Estado por defecto: Sesión 1 abierta, Sesión 2 bloqueada.
    // (Al entrar a un nivel, sincronizarEstadoSesiones() lo ajusta con los datos reales.)
    desbloquearVentanaSesion(0, 1);
    bloquearVentanaSesion(1);

    nivelActual = 'B';
    sesionActual = 1;
    indiceMateriaActual = 0;
    indicePreguntaActual = 0;
    opcionSeleccionada = null;
    respuestasMap = {};
    cacheMaterias = {};
}

// Cierra sesión y regresa a la pantalla de registro
function cerrarSesion() {
    document.getElementById('pantalla-app').classList.add('oculto');
    usuarioActual = {};
    reiniciarVistasEstudiante(); // ✏️ NUEVO: nada del usuario anterior queda en pantalla
    pruebasCreadas = [];
    pruebasAlmacenadas = []; // ✏️ NUEVO
    gruposAdmin = [];
    pruebaPorSubir = null;
    registrosTipoActual = null;
    registrosFilasActuales = []; // no se deja ninguna contraseña en memoria

    // Limpia lo que haya quedado a medias del usuario anterior
    salirDePruebaPP();
    cerrarModalSeleccion();
    cerrarModalFechas();
    cerrarModalPromedio();
    const cpPreguntas = document.getElementById('cp-preguntas');
    if (cpPreguntas) cpPreguntas.innerHTML = '';
    const cpForm = document.getElementById('form-crear-pregunta');
    if (cpForm) cpForm.reset();
    restaurarModoCrear();

    // Vacía la tabla de registros del administrador
    const registrosContenido = document.getElementById('registros-contenido');
    if (registrosContenido) registrosContenido.innerHTML = '';

    // ✏️ NUEVO: vacía la lista de pruebas almacenadas del profesor anterior
    const almacenadasContenido = document.getElementById('almacenadas-contenido');
    if (almacenadasContenido) almacenadasContenido.innerHTML = '';

    mostrarFormulario(rolActual);
}

// ===================================================
// UTILIDADES DE FORMULARIO
// ===================================================
function limpiarFormularioCompleto() {
    const formReg = document.getElementById('form-registro');
    const formLog = document.getElementById('form-login');
    if (formReg) formReg.reset();
    if (formLog) formLog.reset();

    document.getElementById('reg-pass').type = 'password';
    document.getElementById('log-pass').type = 'password';

    const ojos = document.querySelectorAll('.btn-ojo');
    ojos.forEach(ojo => ojo.innerText = '👁️');

    const campoExtra = document.getElementById('campo-extra');
    if (campoExtra) campoExtra.innerHTML = '';
}

function alternarPassword(inputId, elementoOjo) {
    const passInput = document.getElementById(inputId);
    if (passInput.type === 'password') {
        passInput.type = 'text';
        elementoOjo.innerText = '🔒';
    } else {
        passInput.type = 'password';
        elementoOjo.innerText = '👁️';
    }
}

// ===================================================
// PETICIONES AL SERVIDOR (REGISTRO / LOGIN)
// ===================================================
async function enviarDatos(e) {
    e.preventDefault();
    const nombre = document.getElementById('reg-nombre').value;
    const correo = document.getElementById('reg-correo').value;
    const contrasena = document.getElementById('reg-pass').value;
    // Los tres perfiles (estudiante, profesor y admin) mandan su código único
    const datos = {
        nombre,
        correo,
        contrasena,
        codigo_unico: document.getElementById('reg-codigo').value.trim()
    };
    // El estudiante, además, manda el grado que eligió en la lista desplegable
    if (rolActual === 'estudiante') datos.grado = document.getElementById('reg-extra').value;

    const respuesta = await fetch(`/api/registro/${rolActual}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos)
    });

    const resultado = await respuesta.json();
    if (respuesta.ok) {
        mostrarAviso('🎉 ¡Registrado con éxito en la base de datos!', () => {
            irALogin();
        });
    } else {
        mostrarAviso('⚠️ Error del sistema:\n' + resultado.error);
    }
}

async function enviarDatosLogin(e) {
    e.preventDefault();
    const correo = document.getElementById('log-correo').value;
    const contrasena = document.getElementById('log-pass').value;

    const respuesta = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo, contrasena, rol: rolActual })
    });

    const resultado = await respuesta.json();
    if (respuesta.ok) {
        mostrarNiveles(resultado.usuario);
    } else {
        mostrarAviso('⚠️ Error al ingresar:\n' + resultado.error);
    }
}

// ===================================================
// PANTALLA DE NIVELES / PRUEBAS / SESIONES (solo estudiantes)
// ===================================================
function entrarPrueba(nivel) {
    const circulo = document.getElementById('nivel-' + nivel);
    if (circulo.classList.contains('bloqueado')) {
        mostrarAviso('🔒 Este nivel está bloqueado. Debes aprobar el nivel anterior para desbloquearlo.');
        return;
    }
    nivelActual = nivel;
    mostrarSesiones(nivel);
}

// Muestra las ventanas de Sesión 1 y Sesión 2 para el nivel elegido y
// sincroniza cuál de las dos está disponible según lo ya presentado.
function mostrarSesiones(nivel) {
    document.getElementById('vista-niveles').classList.add('oculto');
    document.getElementById('vista-sesiones').classList.remove('oculto');
    document.getElementById('titulo-nivel-sesiones').innerText = 'Nivel ' + nivel;

    actualizarConteosPreguntas(nivel);
    sincronizarEstadoSesiones(nivel);
}

// Escribe en cada materia de las dos ventanas de sesión la cantidad REAL de
// preguntas que hay en ese nivel (el administrador puede añadir o quitar
// preguntas, así que el número cambia).
async function actualizarConteosPreguntas(nivel) {
    const ventanas = document.querySelectorAll('.ventana-sesion');

    try {
        await Promise.all([1, 2].map(async (sesion, i) => {
            const ventana = ventanas[i];
            if (!ventana) return;

            const url = `/api/conteo-preguntas?nivel=${encodeURIComponent(nivel)}&sesion=${sesion}`;
            const datos = await (await fetch(url)).json();
            const conteo = datos.conteo || {};

            ventana.querySelectorAll('.materia[data-materia]').forEach(elemento => {
                const n = conteo[elemento.dataset.materia] || 0;
                const etiqueta = elemento.querySelector('.materia-cantidad');
                if (etiqueta) {
                    etiqueta.innerText = n === 0 ? 'Sin preguntas' : textoCantidadPreguntas(n);
                }
            });
        }));
    } catch (err) {
        console.error('⚠️ No se pudo actualizar la cantidad de preguntas:', err);
    }
}

// Regresa de las sesiones a la selección de niveles
function volverANiveles() {
    document.getElementById('vista-sesiones').classList.add('oculto');
    document.getElementById('vista-niveles').classList.remove('oculto');
}

// ===================================================
// BLOQUEO / DESBLOQUEO DE LAS VENTANAS DE SESIÓN
//
// Modelo: cada sesión, apenas se presenta, se bloquea (no se puede volver
// a enviar). Al completar la Sesión 1 se desbloquea la Sesión 2. Al
// completar también la Sesión 2, las DOS quedan bloqueadas y aparece el
// botón "Repetir prueba". Presionarlo desbloquea de nuevo la Sesión 1
// (y vuelve a bloquear la Sesión 2), permitiendo repetir el nivel completo.
// ===================================================

// Bloquea la ventana de sesión en la posición indicada (0 = Sesión 1, 1 = Sesión 2)
function bloquearVentanaSesion(indice) {
    const ventanas = document.querySelectorAll('.ventana-sesion');
    const ventana = ventanas[indice];
    if (!ventana) return;

    ventana.classList.add('bloqueada');

    if (!ventana.querySelector('.candado-overlay')) {
        const candado = document.createElement('span');
        candado.className = 'candado-overlay';
        candado.innerText = '🔒';
        ventana.prepend(candado);
    }

    const boton = ventana.querySelector('.btn-iniciar-sesion');
    if (boton) {
        boton.disabled = true;
        boton.onclick = null;
    }
}

// Desbloquea la ventana de sesión en la posición indicada, dejándola lista
// para iniciar el número de sesión indicado (1 o 2)
function desbloquearVentanaSesion(indice, numeroSesion) {
    const ventanas = document.querySelectorAll('.ventana-sesion');
    const ventana = ventanas[indice];
    if (!ventana) return;

    ventana.classList.remove('bloqueada');

    const candado = ventana.querySelector('.candado-overlay');
    if (candado) candado.remove();

    const boton = ventana.querySelector('.btn-iniciar-sesion');
    if (boton) {
        boton.disabled = false;
        boton.onclick = () => iniciarSesion(numeroSesion);
    }
}

// Le pregunta al servidor si el estudiante ya presentó cierta sesión
// dentro del intento actualmente activo de ese nivel.
async function sesionCompletada(nivel, sesion) {
    const url = `/api/sesion-completada?correo=${encodeURIComponent(usuarioActual.correo)}&nivel=${encodeURIComponent(nivel)}&sesion=${sesion}`;
    const datos = await (await fetch(url)).json();
    return !!datos.completada;
}

// Sincroniza el estado visual de las dos ventanas de sesión según lo que
// el estudiante ya presentó en el intento actual de este nivel:
//  - Ninguna sesión presentada    -> Sesión 1 abierta, Sesión 2 bloqueada
//  - Solo Sesión 1 presentada     -> Sesión 1 bloqueada, Sesión 2 abierta
//  - Las dos sesiones presentadas -> ambas bloqueadas + botón "Repetir prueba"
// También sirve para refrescar el estado tras usar "Repetir prueba" o
// justo después de calificar una sesión.
async function sincronizarEstadoSesiones(nivel) {
    if (!usuarioActual || !usuarioActual.correo) return;

    const btnRepetir = document.getElementById('btn-repetir-nivel');

    try {
        const [s1, s2] = await Promise.all([
            sesionCompletada(nivel, 1),
            sesionCompletada(nivel, 2)
        ]);

        if (!s1) {
            desbloquearVentanaSesion(0, 1);
            bloquearVentanaSesion(1);
            if (btnRepetir) btnRepetir.classList.add('oculto');
        } else if (!s2) {
            bloquearVentanaSesion(0);
            desbloquearVentanaSesion(1, 2);
            if (btnRepetir) btnRepetir.classList.add('oculto');
        } else {
            bloquearVentanaSesion(0);
            bloquearVentanaSesion(1);
            if (btnRepetir) btnRepetir.classList.remove('oculto');
        }
    } catch (err) {
        console.error('⚠️ No se pudo sincronizar el estado de las sesiones:', err);
    }
}

// ===================================================
// 🔄 REPETIR PRUEBA (nivel ya presentado por completo)
// ===================================================

// Pide confirmación antes de repetir el nivel completo
function confirmarRepetirNivel() {
    mostrarModalConfirmacion(
        '¿Deseas repetir este nivel? Se bloqueará la Sesión 2 y podrás presentar la Sesión 1 nuevamente.\nTu historial y tu puntaje actual no se perderán.',
        () => repetirNivel()
    );
}

// Avanza el "intento" activo en el servidor y refresca visualmente las
// ventanas de sesión: Sesión 1 vuelve a estar disponible y Sesión 2
// vuelve a quedar bloqueada. Los resultados anteriores no se borran.
async function repetirNivel() {
    try {
        const respuesta = await fetch('/api/repetir-nivel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo: usuarioActual.correo, nivel: nivelActual })
        });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            await sincronizarEstadoSesiones(nivelActual);
            mostrarAviso('🔄 ' + resultado.mensaje);
        } else {
            mostrarAviso('⚠️ Error al repetir el nivel:\n' + resultado.error);
        }
    } catch (err) {
        console.error('⚠️ Error al repetir el nivel:', err);
    }
}

// ===================================================
// 🚀 DESBLOQUEO DE NIVELES (B -> A -> S)
// ===================================================

// Devuelve cuál es el siguiente nivel en la progresión B -> A -> S,
// o null si "nivel" ya es el último (S) o no es válido.
function obtenerSiguienteNivel(nivel) {
    if (nivel === 'B') return 'A';
    if (nivel === 'A') return 'S';
    return null;
}

// Consulta al servidor si el estudiante tiene aprobado el nivel indicado
// (las dos sesiones presentadas y el mínimo de correctas alcanzado).
async function estaNivelAprobado(nivel) {
    if (!usuarioActual || !usuarioActual.correo) return false;
    try {
        const url = `/api/nivel-aprobado?correo=${encodeURIComponent(usuarioActual.correo)}&nivel=${encodeURIComponent(nivel)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();
        return !!datos.aprobado;
    } catch (err) {
        console.error('⚠️ No se pudo verificar la aprobación del nivel', nivel, err);
        return false;
    }
}

// Quita el candado visual (bloqueado) de un círculo de nivel y limpia su mensaje
function desbloquearNivel(nivel) {
    const circulo = document.getElementById('nivel-' + nivel);
    if (circulo) circulo.classList.remove('bloqueado');
    const msg = document.getElementById('msg-' + nivel);
    if (msg) msg.innerText = '';
}

// Al entrar a la app, revisa si el estudiante ya se ganó (por aprobación,
// no solo por grado) el desbloqueo de A o S, por si vuelve a iniciar sesión
// más tarde. No muestra ninguna ventana emergente, solo sincroniza el candado.
async function sincronizarDesbloqueosPorAprobacion() {
    if (!usuarioActual || !usuarioActual.correo) return;

    const nivelA = document.getElementById('nivel-A');
    if (nivelA && nivelA.classList.contains('bloqueado')) {
        if (await estaNivelAprobado('B')) desbloquearNivel('A');
    }

    const nivelS = document.getElementById('nivel-S');
    if (nivelS && nivelS.classList.contains('bloqueado')) {
        if (await estaNivelAprobado('A')) desbloquearNivel('S');
    }
}

// Ventana de felicitación cuando se desbloquea un nivel nuevo en caliente
// (justo después de terminar una sesión). Solo informa: no hace ninguna
// pregunta ni muestra botones, y se cierra sola a los pocos segundos.
function mostrarModalDesbloqueoNivel(nivel) {
    const mensaje = '🎉 ¡Felicidades, lo has conseguido!\nEl nivel ' + nivel +
        ' se ha desbloqueado con éxito.';

    mostrarAvisoSinBotones(mensaje);
}

// ===================================================
// ENTORNO DE LA PRUEBA (una materia a la vez, preguntas reales)
// ===================================================

// Materias de cada sesión, en orden, con su clase de tema visual
const materiasPorSesion = {
    1: [
        { nombre: 'Lectura Crítica', tema: 'tema-lectura' },
        { nombre: 'Matemáticas', tema: 'tema-matematicas' },
        { nombre: 'C. Ciudadanas', tema: 'tema-ciudadanas' },
        { nombre: 'C. Naturales', tema: 'tema-naturales' }
    ],
    2: [
        { nombre: 'Matemáticas', tema: 'tema-matematicas' },
        { nombre: 'C. Ciudadanas', tema: 'tema-ciudadanas' },
        { nombre: 'C. Naturales', tema: 'tema-naturales' },
        { nombre: 'Inglés', tema: 'tema-ingles' }
    ]
};

let nivelActual = 'B';
let sesionActual = 1;
let indiceMateriaActual = 0;
let preguntasMateriaActual = [];
let indicePreguntaActual = 0;
let opcionSeleccionada = null;

// Respuestas ya elegidas por el estudiante en la sesión actual, indexadas
// por el id de la pregunta. Se usa (en vez de una simple lista) para poder
// restaurar la opción marcada cuando el estudiante usa "← Anterior" y
// vuelve a una pregunta que ya había respondido.
let respuestasMap = {};

// Guarda las preguntas ya obtenidas del servidor para cada materia de la
// sesión actual (indexadas por el número de materia), así "← Anterior"
// puede regresar a una materia anterior sin volver a pedirla al servidor.
let cacheMaterias = {};

// Inicia el entorno visual de la prueba con la primera materia de la sesión
function iniciarSesion(numero) {
    sesionActual = numero;
    indiceMateriaActual = 0;
    indicePreguntaActual = 0;
    opcionSeleccionada = null;
    respuestasMap = {};
    cacheMaterias = {};

    document.getElementById('vista-sesiones').classList.add('oculto');
    document.getElementById('vista-prueba').classList.remove('oculto');

    cargarMateriaActual();
}

// Muestra u oculta un contenedor de imagen (y le pone la ruta), según si la
// pregunta trae o no una imagen asociada. Sirve tanto para las pruebas de
// nivel como para las pruebas de profesores.
function actualizarImagenEn(idWrap, idImagen, rutaImagen) {
    const imagenWrap = document.getElementById(idWrap);
    const imagenEl = document.getElementById(idImagen);
    if (!imagenWrap || !imagenEl) return;

    if (rutaImagen) {
        imagenEl.src = rutaImagen;
        imagenWrap.classList.remove('oculto');
    } else {
        imagenEl.src = '';
        imagenWrap.classList.add('oculto');
    }
}

// Imagen de la pregunta actual dentro del entorno de prueba de nivel
function actualizarImagenPregunta(rutaImagen) {
    actualizarImagenEn('prueba-imagen-wrap', 'prueba-imagen', rutaImagen);
}

// Pide al servidor las preguntas de la materia actual (o las toma del caché
// si ya se habían cargado antes) y muestra la pregunta indicada.
// indicePreguntaInicial puede ser un número (normalmente 0, al entrar por
// primera vez a la materia) o el texto 'ultima', usado por "← Anterior"
// para aterrizar en la última pregunta de la materia anterior.
async function cargarMateriaActual(indicePreguntaInicial = 0) {
    const materias = materiasPorSesion[sesionActual];
    const materia = materias[indiceMateriaActual];

    const vistaPrueba = document.getElementById('vista-prueba');
    vistaPrueba.className = 'vista-prueba ' + materia.tema;
    document.getElementById('prueba-materia-nombre').innerText = materia.nombre;

    if (cacheMaterias[indiceMateriaActual]) {
        preguntasMateriaActual = cacheMaterias[indiceMateriaActual];
    } else {
        const url = `/api/preguntas?nivel=${nivelActual}&sesion=${sesionActual}&materia=${encodeURIComponent(materia.nombre)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();
        preguntasMateriaActual = datos.preguntas || [];
        cacheMaterias[indiceMateriaActual] = preguntasMateriaActual;
    }

    if (preguntasMateriaActual.length === 0) {
        indicePreguntaActual = 0;
        document.getElementById('prueba-enunciado').innerText = 'Aún no hay preguntas cargadas para esta materia.';
        document.getElementById('prueba-progreso').innerText = '';
        actualizarImagenPregunta(null);
        ['A', 'B', 'C', 'D'].forEach(letra => {
            document.getElementById('prueba-opcion-' + letra).innerText = '';
        });
        actualizarTextoBoton();
        actualizarBotonAnterior();
        return;
    }

    indicePreguntaActual = indicePreguntaInicial === 'ultima'
        ? preguntasMateriaActual.length - 1
        : indicePreguntaInicial;

    renderizarPregunta();
}

// Escribe una opción de respuesta separando la letra (en negrilla) del
// texto (en peso normal). Usa textContent, así el texto se muestra tal cual.
// "prefijoId" es el comienzo del id del elemento (por ejemplo
// 'prueba-opcion-' o 'pp-opcion-').
function escribirOpcionEn(prefijoId, letra, texto) {
    const el = document.getElementById(prefijoId + letra);
    el.innerHTML = '';

    const spanLetra = document.createElement('span');
    spanLetra.className = 'prueba-opcion-letra';
    spanLetra.textContent = letra + '.';

    const spanTexto = document.createElement('span');
    spanTexto.className = 'prueba-opcion-texto';
    spanTexto.textContent = texto;

    el.appendChild(spanLetra);
    el.appendChild(spanTexto);
}

function escribirOpcion(letra, texto) {
    escribirOpcionEn('prueba-opcion-', letra, texto);
}

// Pinta en pantalla la pregunta actual con sus 4 opciones. Si la pregunta
// trae una imagen asociada (por ejemplo, una tira cómica o un gráfico), se
// muestra encima del enunciado. Si el estudiante ya había elegido una
// respuesta para esta pregunta (por ejemplo, volvió con "← Anterior"), la
// deja marcada.
function renderizarPregunta() {
    const pregunta = preguntasMateriaActual[indicePreguntaActual];
    opcionSeleccionada = respuestasMap[pregunta.id] || null;

    document.getElementById('prueba-progreso').innerText =
        'Pregunta ' + (indicePreguntaActual + 1) + ' de ' + preguntasMateriaActual.length;

    actualizarImagenPregunta(pregunta.imagen || null);

    document.getElementById('prueba-enunciado').innerText = pregunta.enunciado;

    escribirOpcion('A', pregunta.opcion_a);
    escribirOpcion('B', pregunta.opcion_b);
    escribirOpcion('C', pregunta.opcion_c);
    escribirOpcion('D', pregunta.opcion_d);

    ['A', 'B', 'C', 'D'].forEach(letra => {
        document.getElementById('prueba-opcion-' + letra).classList.toggle('seleccionada', letra === opcionSeleccionada);
    });

    actualizarTextoBoton();
    actualizarBotonAnterior();
}

// Marca visualmente la opción elegida por el estudiante y la guarda de una
// vez en respuestasMap (así queda registrada aunque el estudiante navegue
// con "← Anterior" sin llegar a presionar "Siguiente").
function seleccionarOpcion(letra) {
    opcionSeleccionada = letra;
    const pregunta = preguntasMateriaActual[indicePreguntaActual];
    if (pregunta) {
        respuestasMap[pregunta.id] = letra;
    }
    ['A', 'B', 'C', 'D'].forEach(l => {
        document.getElementById('prueba-opcion-' + l).classList.toggle('seleccionada', l === letra);
    });
}

// Cambia el texto del botón según si falta pregunta, materia, o es el final
function actualizarTextoBoton() {
    const materias = materiasPorSesion[sesionActual];
    const esUltimaPregunta = indicePreguntaActual >= preguntasMateriaActual.length - 1;
    const esUltimaMateria = indiceMateriaActual === materias.length - 1;
    const btn = document.getElementById('btn-siguiente-materia');

    if (!esUltimaPregunta) {
        btn.innerText = 'Siguiente pregunta →';
    } else if (!esUltimaMateria) {
        btn.innerText = 'Siguiente materia →';
    } else {
        btn.innerText = 'Finalizar sesión';
    }
}

// Muestra u oculta el botón "← Anterior": no tiene sentido en la primera
// pregunta de la primera materia de la sesión (no hay a dónde volver).
function actualizarBotonAnterior() {
    const btnAnterior = document.getElementById('btn-anterior-pregunta');
    if (!btnAnterior) return;
    const esPrimeraPregunta = indiceMateriaActual === 0 && indicePreguntaActual === 0;
    btnAnterior.classList.toggle('oculto', esPrimeraPregunta);
}

// Avanza: siguiente pregunta, siguiente materia, o finaliza y califica la sesión
async function continuarPrueba() {
    if (preguntasMateriaActual.length === 0) {
        avanzar();
        return;
    }

    if (!opcionSeleccionada) {
        mostrarAviso('Selecciona una respuesta antes de continuar.');
        return;
    }

    avanzar();
}

async function avanzar() {
    const materias = materiasPorSesion[sesionActual];
    const esUltimaPregunta = indicePreguntaActual >= preguntasMateriaActual.length - 1;
    const esUltimaMateria = indiceMateriaActual === materias.length - 1;

    if (!esUltimaPregunta) {
        indicePreguntaActual++;
        renderizarPregunta();
    } else if (!esUltimaMateria) {
        indiceMateriaActual++;
        await cargarMateriaActual(0);
    } else {
        await finalizarSesion();
    }
}

// Retrocede: pregunta anterior dentro de la materia, o última pregunta de
// la materia anterior si ya estaba en la primera pregunta de la materia
// actual. No hace nada si ya está en la primera pregunta de toda la sesión.
async function preguntaAnterior() {
    if (indicePreguntaActual > 0) {
        indicePreguntaActual--;
        renderizarPregunta();
    } else if (indiceMateriaActual > 0) {
        indiceMateriaActual--;
        await cargarMateriaActual('ultima');
    }
}

// Envía todas las respuestas de la sesión al servidor para calificarlas.
// Luego sincroniza el estado de las dos ventanas de sesión (bloquea la
// que se acaba de presentar y, si corresponde, desbloquea la siguiente
// o muestra "Repetir prueba" si ya se presentaron las dos).
//
// Además, si con este resultado el nivel actual queda aprobado y eso
// desbloquea el siguiente nivel (A o S) que hasta ahora estaba bloqueado
// en pantalla, se quita el candado al instante y, justo después de que el
// estudiante cierre el aviso normal de resultado, se muestra el mensaje de
// felicitación (solo informativo, sin botones).
async function finalizarSesion() {
    const respuestasSesion = Object.keys(respuestasMap).map(id => ({
        pregunta_id: parseInt(id, 10),
        opcion_elegida: respuestasMap[id]
    }));

    const respuesta = await fetch('/api/calificar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            respuestas: respuestasSesion,
            correo: usuarioActual.correo,
            nombre: usuarioActual.nombre,
            nivel: nivelActual,
            sesion: sesionActual
        })
    });

    const resultado = await respuesta.json();

    if (respuesta.ok) {
        const siguienteNivel = obtenerSiguienteNivel(nivelActual);
        let nivelDesbloqueado = null;

        if (siguienteNivel) {
            const circuloSiguiente = document.getElementById('nivel-' + siguienteNivel);
            if (circuloSiguiente && circuloSiguiente.classList.contains('bloqueado')) {
                if (await estaNivelAprobado(nivelActual)) {
                    desbloquearNivel(siguienteNivel);
                    nivelDesbloqueado = siguienteNivel;
                }
            }
        }

        await sincronizarEstadoSesiones(nivelActual);
        salirDePrueba();

        const mensajeResultado = '🎉 Terminaste la Sesión ' + sesionActual + '.\n\nResultado: ' +
            resultado.correctas + ' de ' + resultado.total + ' correctas.';

        if (nivelDesbloqueado) {
            mostrarAviso(mensajeResultado, () => {
                mostrarModalDesbloqueoNivel(nivelDesbloqueado);
            });
        } else {
            mostrarAviso(mensajeResultado);
        }
    } else {
        salirDePrueba();
        mostrarAviso('⚠️ Error al calificar:\n' + (resultado.error || 'Error desconocido.'));
    }
}

// Pide confirmación antes de salir de la prueba, ya que el estudiante
// perdería el progreso que lleva en la sesión actual (no se guarda nada
// hasta que se presiona "Finalizar sesión").
function confirmarSalirPrueba() {
    mostrarModalConfirmacion(
        'Si sales de la prueba perderás el progreso.',
        () => salirDePrueba(),
        'Salir',
        'Cancelar'
    );
}

// Sale del entorno de la prueba, regresa a las sesiones y limpia el
// progreso de la sesión que se estaba presentando.
function salirDePrueba() {
    document.getElementById('vista-prueba').classList.add('oculto');
    document.getElementById('vista-sesiones').classList.remove('oculto');

    indiceMateriaActual = 0;
    indicePreguntaActual = 0;
    opcionSeleccionada = null;
    respuestasMap = {};
    cacheMaterias = {};
}
// Refresca cada 30 segundos la lista de pruebas de profesores mientras el
// estudiante la está viendo, para que las pruebas se bloqueen o se abran a su hora.
setInterval(() => {
    const seccion = document.getElementById('seccion-pruebas-profesores');
    if (rolActual === 'estudiante' && seccion && !seccion.classList.contains('oculto') && ppPrueba === null) {
        cargarPruebasProfesores(true);
    }
}, 30000);