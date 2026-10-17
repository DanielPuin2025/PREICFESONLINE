// ===================================================
// ESTADO GLOBAL
// ===================================================
let rolActual = '';
let usuarioActual = {}; // { nombre, correo, grado, materia } del usuario logueado

// Estado del formulario y de las respuestas de Ayudas y PQRS
let enviandoPQRS = false;
let enviandoRespuestaPQRS = false;
let pqrsAdminLista = [];

// Pruebas de profesores que el estudiante ocultó con el botón "Actualizar"
let pruebasCerradasOcultas = new Set();

// ===================================================
// UTILIDADES GENERALES
// ===================================================

// Muestra / oculta una pantalla por su id (no falla si el elemento ya no existe en el HTML)
function ocultarPantalla(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('oculto');
}

function mostrarPantalla(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('oculto');
}

// Escapa texto que viene de usuarios antes de insertarlo con innerHTML
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

// Convierte una hora "HH:MM" (24 horas) en texto de 12 horas.
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

// Convierte segundos en un texto legible.
//   formatearDuracion(45)   -> "45 s"
//   formatearDuracion(750)  -> "12 min 30 s"
//   formatearDuracion(3725) -> "1 h 2 min"
// Devuelve '' si no hay dato (resultados antiguos guardados sin tiempo).
function formatearDuracion(segundos) {
    if (segundos === null || segundos === undefined || segundos === '') return '';
    const s = Number(segundos);
    if (isNaN(s) || s < 0) return '';
    if (s < 60) return s + ' s';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h > 0) return h + ' h ' + m + ' min';
    return m + ' min' + (r ? ' ' + r + ' s' : '');
}

// Fecha de hoy como "AAAA-MM-DD" (hora local del navegador)
function hoyLocal() {
    const d = new Date();
    const dos = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

// Hora actual como "HH:MM" (hora local del navegador)
function horaActualLocal() {
    const d = new Date();
    const dos = n => String(n).padStart(2, '0');
    return `${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

// Fecha y hora actuales como "AAAA-MM-DD HH:MM" (igual que el servidor)
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

// "JOSÉ ANDRÉS CUERVO DE LA ROSA" -> "José Andrés Cuervo de la Rosa"
function formatearNombre(texto) {
    const particulas = ['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e'];
    return String(texto === null || texto === undefined ? '' : texto)
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('es')
        .split(' ')
        .map((palabra, i) => (i > 0 && particulas.includes(palabra))
            ? palabra
            : palabra.replace(/(^|[-'])(\p{L})/gu, (m, sep, letra) => sep + letra.toLocaleUpperCase('es')))
        .join(' ');
}

// Textos de los grados de una prueba de profesor. Cada elemento es un grado
// completo ("9") o un curso ("9-A").
function textoGrados(lista) {
    const partes = (lista || []).map(g => (/^\d+$/.test(String(g)) ? g + '°' : g));
    if (partes.length <= 1) return partes.join('');
    return partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1];
}

function palabraGrado(lista) {
    return (lista || []).length === 1 ? 'grado' : 'grados';
}

// Color de cada materia. Cada valor es una clase "tema-..." de estilos.css
const temaPorMateria = {
    'Matemáticas': 'tema-matematicas',
    'Física': 'tema-fisica',
    'Química': 'tema-quimica',
    'Inglés': 'tema-ingles',
    'Lectura Crítica/Español': 'tema-lectura',
    'Filosofía': 'tema-filosofia',
    'Ciencias Económicas y Políticas/Sociales': 'tema-ciudadanas',
    'Ciencias Naturales': 'tema-naturales',
    'Estadísticas': 'tema-estadisticas',
    'Educación Artística': 'tema-artistica',
    'Educación Física': 'tema-deportiva',
    'Emprendimiento': 'tema-emprendimiento',
    'Ética': 'tema-etica',
    'Religión': 'tema-religion',
    'Informática': 'tema-informatica',
    'Ética y Religión': 'tema-etica',
    'Lectura Crítica': 'tema-lectura',
    'C. Ciudadanas': 'tema-ciudadanas',
    'C. Naturales': 'tema-naturales'
};

function claseTemaMateria(materia) {
    return temaPorMateria[materia] || 'tema-profesor';
}

// Materias que puede elegir un profesor al crear una prueba.
const materiasProfesor = [
    'Ciencias Económicas y Políticas/Sociales',
    'Ciencias Naturales',
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

function opcionesMateriasHtml() {
    return materiasProfesor
        .map(m => `<option value="${escaparHtml(m)}">${escaparHtml(m)}</option>`)
        .join('');
}

const NOMBRE_NIVEL = { B: 'Básico', A: 'Alto', S: 'Superior' };

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
//
//  - Estudiantes y profesores: ingresan solo con su código único.
//  - Administrador: YA NO SE REGISTRA desde la app. Va directo al login y
//    entra con correo + contraseña + código único.
// ===================================================

// Deja lista la pantalla de login del administrador:
//  - añade el campo "Código único" (con ojito) si el HTML todavía no lo trae,
//  - cambia "Volver al Registro" por "Volver" (regresa a la selección de perfil).
function prepararLoginAdmin() {
    const form = document.getElementById('form-login');
    if (!form) return;

    if (!document.getElementById('log-codigo')) {
        const bloque = document.createElement('div');
        bloque.className = 'campo-password';
        bloque.innerHTML = `
            <input type="password" id="log-codigo" placeholder="Código único" maxlength="100" autocomplete="off" required>
            <span class="btn-ojo" onclick="alternarPassword('log-codigo', this)">👁️</span>`;

        const botonIngresar = form.querySelector('.btn-enviar');
        if (botonIngresar) form.insertBefore(bloque, botonIngresar);
        else form.appendChild(bloque);
    }

    const botonVolver = form.querySelector('.btn-volver');
    if (botonVolver) {
        botonVolver.innerText = 'Volver';
        botonVolver.setAttribute('onclick', 'volverARoles()');
    }
}

function mostrarFormulario(rol) {
    rolActual = rol;
    limpiarFormularioCompleto();

    ocultarPantalla('pantalla-roles');
    ocultarPantalla('pantalla-registro');

    if (rol === 'estudiante' || rol === 'profesor') {
        ocultarPantalla('pantalla-login');
        document.getElementById('titulo-ingreso-codigo').innerText =
            rol === 'estudiante' ? 'Ingreso de Estudiantes' : 'Ingreso de Profesor/a';
        mostrarPantalla('pantalla-ingreso-codigo');
        document.getElementById('ing-codigo').focus();
        return;
    }

    // Administrador: directo al login (correo + contraseña + código único)
    ocultarPantalla('pantalla-ingreso-codigo');
    prepararLoginAdmin();
    document.getElementById('titulo-login').innerText = 'Ingreso de Admin';
    mostrarPantalla('pantalla-login');
    document.getElementById('log-correo').focus();
}

function volverARoles() {
    limpiarFormularioCompleto();
    ocultarPantalla('pantalla-ingreso-codigo');
    ocultarPantalla('pantalla-registro');
    ocultarPantalla('pantalla-login');
    mostrarPantalla('pantalla-roles');
}

function mostrarNiveles(usuario) {
    // Se oculta el fondo flotante de las materias al entrar a la app
    const fondoFlotante = document.getElementById('fondo-flotante');
    if (fondoFlotante) fondoFlotante.classList.add('oculto');

    reiniciarVistasEstudiante();

    ocultarPantalla('pantalla-ingreso-codigo');
    ocultarPantalla('pantalla-login');
    ocultarPantalla('pantalla-registro');
    ocultarPantalla('pantalla-roles');
    mostrarPantalla('pantalla-app');

    usuarioActual = usuario || {};

    if (usuario && usuario.nombre) {
        document.getElementById('app-usuario-nombre').innerText = usuario.nombre;
    }

    aplicarMenuPorRol();

    if (rolActual === 'estudiante' && usuario && usuario.grado) {
        aplicarNivelesPorGrado(usuario.grado);
        sincronizarDesbloqueosPorAprobacion();
    }

    if (rolActual === 'profesor' || rolActual === 'admin') {
        configurarFormularioPorRol();
    }

    mostrarSeccion('pruebas');
}

function aplicarMenuPorRol() {
    const navPruebas = document.getElementById('nav-pruebas');
    const navPuntaje = document.getElementById('nav-puntaje');
    const navPuntajes = document.getElementById('nav-puntajes');
    const navRanking = document.getElementById('nav-ranking');
    const navPruebasProf = document.getElementById('nav-pruebas-prof');
    const navRegistros = document.getElementById('nav-registros');
    const navAlmacenadas = document.getElementById('nav-almacenadas');
    // Botón de "Ayudas y PQRS" / "Gestión de PQRS"
    const navPqrs = document.getElementById('nav-pqrs');

    [navPuntaje, navPuntajes, navRanking, navPruebasProf, navRegistros, navAlmacenadas]
        .forEach(n => n.classList.remove('oculto'));

    if (rolActual === 'admin') {
        navPruebas.innerText = ' Crear prueba';
        navPuntaje.innerText = ' Pruebas creadas';
        navRegistros.innerText = ' Base de datos registros';
        if (navPqrs) navPqrs.innerText = ' Gestión de PQRS';
        [navPuntajes, navRanking, navPruebasProf, navAlmacenadas].forEach(n => n.classList.add('oculto'));
    } else if (rolActual === 'profesor') {
        navPruebas.innerText = ' Crear prueba';
        navPuntaje.innerText = ' Pruebas creadas';
        navPuntajes.innerText = ' Resultados de las pruebas';
        if (navPqrs) navPqrs.innerText = ' Ayudas y PQRS';
        [navRanking, navPruebasProf, navRegistros].forEach(n => n.classList.add('oculto'));
    } else {
        navPruebas.innerText = ' Pruebas';
        navPuntajes.innerText = ' Historial de puntajes';
        if (navPqrs) navPqrs.innerText = ' Ayudas y PQRS';
        [navPuntaje, navRegistros, navAlmacenadas].forEach(n => n.classList.add('oculto'));
    }
}

function extraerGrado(gradoTexto) {
    if (!gradoTexto) return null;
    const match = gradoTexto.match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
}

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

function mostrarSeccion(nombre) {
    document.querySelectorAll('.seccion-app').forEach(sec => sec.classList.add('oculto'));
    document.getElementById('seccion-' + nombre).classList.remove('oculto');

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('activo', item.dataset.seccion === nombre);
    });

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
                cargarGruposAdmin(true);   // conserva nivel/prueba (p. ej. al volver de editar)
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

    // Sección "Ayudas y PQRS" (estudiante/profesor) o "Gestión de PQRS" (admin)
    if (nombre === 'pqrs') {
        const vistaUsuario = document.getElementById('pqrs-vista-usuario');
        const vistaAdmin = document.getElementById('pqrs-vista-admin');
        if (rolActual === 'admin') {
            if (vistaUsuario) vistaUsuario.classList.add('oculto');
            if (vistaAdmin) vistaAdmin.classList.remove('oculto');
            cargarPQRSAdmin();
        } else {
            if (vistaAdmin) vistaAdmin.classList.add('oculto');
            if (vistaUsuario) vistaUsuario.classList.remove('oculto');
            cargarMisPQRS();
        }
    }
}

function mostrarVistaPruebasSegunRol() {
    const vistaNiveles = document.getElementById('vista-niveles');
    const vistaPruebasNivel = document.getElementById('vista-pruebas-nivel');
    const vistaSesiones = document.getElementById('vista-sesiones');
    const vistaPrueba = document.getElementById('vista-prueba');
    const vistaCrear = document.getElementById('vista-crear-prueba');

    if (rolActual === 'profesor' || rolActual === 'admin') {
        vistaNiveles.classList.add('oculto');
        if (vistaPruebasNivel) vistaPruebasNivel.classList.add('oculto');
        vistaSesiones.classList.add('oculto');
        vistaPrueba.classList.add('oculto');
        vistaCrear.classList.remove('oculto');
    } else {
        vistaCrear.classList.add('oculto');
        const pruebasNivelOculta = !vistaPruebasNivel || vistaPruebasNivel.classList.contains('oculto');
        if (vistaSesiones.classList.contains('oculto') && vistaPrueba.classList.contains('oculto') && pruebasNivelOculta) {
            vistaNiveles.classList.remove('oculto');
        }
    }
}

// ===================================================
// 📝 CREAR PRUEBA (profesores y administradores)
// ===================================================
function configurarFormularioPorRol() {
    const esAdmin = rolActual === 'admin';

    document.getElementById('cp-campos-profesor').classList.toggle('oculto', esAdmin);
    document.getElementById('cp-campos-admin').classList.toggle('oculto', !esAdmin);

    document.getElementById('cp-materia').required = !esAdmin;
    document.getElementById('cp-titulo').required = !esAdmin;
    ['cp-nivel', 'cp-prueba', 'cp-sesion', 'cp-materia-nivel'].forEach(id => {
        const campo = document.getElementById(id);
        if (campo) campo.required = esAdmin;
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

function agregarBloquePregunta(hacerScroll = true) {
    const plantilla = document.getElementById('tpl-pregunta-cp');
    const contenedor = document.getElementById('cp-preguntas');
    if (!plantilla || !contenedor) return;

    contenedor.appendChild(plantilla.content.cloneNode(true));
    const bloque = contenedor.lastElementChild;

    const selector = bloque.querySelector('.cp-modo-selector');
    if (selector) selector.classList.toggle('oculto', rolActual !== 'admin');

    renumerarBloquesPregunta();

    if (hacerScroll && bloque) {
        bloque.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

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

function renumerarBloquesPregunta() {
    document.querySelectorAll('#cp-preguntas .cp-bloque-pregunta').forEach((bloque, i) => {
        bloque.querySelector('.cp-bloque-numero').innerText = 'Pregunta ' + (i + 1);
    });
}

function cambiarModoRespuesta(select) {
    const bloque = select.closest('.cp-bloque-pregunta');
    if (!bloque) return;

    const aleatoria = select.value === 'aleatoria';
    bloque.querySelector('.cp-modo-letra').classList.toggle('oculto', aleatoria);
    bloque.querySelector('.cp-modo-aleatoria').classList.toggle('oculto', !aleatoria);

    bloque.querySelectorAll('.cp-modo-letra input, .cp-modo-letra select').forEach(campo => {
        campo.required = !aleatoria;
    });
    bloque.querySelectorAll('.cp-modo-aleatoria input').forEach(campo => {
        campo.required = aleatoria;
    });
}

// ===================================================
// 🖼️ IMAGEN DE LA PREGUNTA (Crear prueba)
// ===================================================
let bloqueImagenObjetivo = null;

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
            ctx.fillStyle = '#ffffff';
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

function asignarImagenABloque(bloque, dataUrl) {
    if (!bloque) return;
    bloque._imagen = dataUrl;
    bloque.querySelector('.cp-imagen-vista').src = dataUrl;
    bloque.querySelector('.cp-imagen-agregar').classList.add('oculto');
    bloque.querySelector('.cp-imagen-preview').classList.remove('oculto');
}

function quitarImagenBloque(elemento) {
    const bloque = elemento.closest('.cp-bloque-pregunta');
    if (!bloque) return;
    bloque._imagen = null;
    bloque.querySelector('.cp-imagen-vista').src = '';
    bloque.querySelector('.cp-imagen-preview').classList.add('oculto');
    bloque.querySelector('.cp-imagen-agregar').classList.remove('oculto');
}

(function iniciarModalImagen() {
    const zona = document.getElementById('modal-imagen-zona');
    const inputArchivo = document.getElementById('modal-imagen-archivo');
    if (!zona || !inputArchivo) return;

    inputArchivo.addEventListener('change', () => {
        const archivo = inputArchivo.files[0];
        inputArchivo.value = '';
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

let enviandoPrueba = false;
let pruebaEditandoId = null;
let grupoEditando = null;
// id de la prueba ALMACENADA que se está editando (distinto de pruebaEditandoId,
// que es para las pruebas de "Pruebas creadas"). Solo se usa con rol profesor.
let almacenadaEditando = null;

function estaEditando() {
    return pruebaEditandoId !== null || grupoEditando !== null || almacenadaEditando !== null;
}

function restaurarModoCrear() {
    pruebaEditandoId = null;
    grupoEditando = null;
    almacenadaEditando = null;

    const pill = document.getElementById('cp-pill-titulo');
    if (pill) pill.innerText = 'CREAR PRUEBA';

    const boton = document.querySelector('#form-crear-pregunta button[type="submit"]');
    if (boton) boton.innerText = 'Guardar prueba';

    const cancelar = document.getElementById('cp-btn-cancelar-edicion');
    if (cancelar) cancelar.classList.add('oculto');
}

function reiniciarFormularioCrearPrueba() {
    document.getElementById('form-crear-pregunta').reset();
    document.getElementById('cp-preguntas').innerHTML = '';
    if (rolActual === 'admin') actualizarMateriasAdmin();
    agregarBloquePregunta(false);
}

function leerPreguntasDelFormulario() {
    const esAdmin = rolActual === 'admin';
    const bloques = document.querySelectorAll('#cp-preguntas .cp-bloque-pregunta');

    return Array.from(bloques).map(b => {
        const base = {
            id: b._preguntaId || null,
            enunciado: b.querySelector('.cp-enunciado').value.trim(),
            imagen: b._imagen || null
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
        const prueba = document.getElementById('cp-prueba').value;
        const sesion = document.getElementById('cp-sesion').value;
        const materia = document.getElementById('cp-materia-nivel').value;

        if (!nivel || !prueba || !sesion || !materia) {
            mostrarAviso('Selecciona el nivel, la prueba, la sesión y la materia.');
            return;
        }

        datos = { correo: usuarioActual.correo, nivel, prueba: Number(prueba), sesion: Number(sesion), materia, preguntas };
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

        // Si se está editando una prueba ALMACENADA, se guarda con
        // PUT /api/pruebas-almacenadas/:id en lugar de /api/pruebas-profesor/:id.
        if (almacenadaEditando !== null) {
            url = `/api/pruebas-almacenadas/${almacenadaEditando}`;
            metodo = 'PUT';
        } else if (pruebaEditandoId !== null) {
            url = `/api/pruebas-profesor/${pruebaEditandoId}`;
            metodo = 'PUT';
        } else {
            url = '/api/pruebas-profesor';
            metodo = 'POST';
        }
    }

    const editando = estaEditando();
    // Se guarda antes de restaurarModoCrear() (que la pone en null) para
    // saber, después de guardar, a qué sección volver.
    const eraAlmacenada = almacenadaEditando !== null;

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
                // Si se editó una prueba almacenada, vuelve a "Pruebas almacenadas"
                // en lugar de "Pruebas creadas".
                mostrarSeccion(eraAlmacenada ? 'almacenadas' : 'puntaje');
                mostrarAviso('✅ ¡Cambios guardados con éxito!');
            } else if (esAdmin) {
                mostrarAviso('🎉 ¡Preguntas guardadas con éxito!\n\nLos estudiantes ya las verán en su nivel, prueba y sesión. Puedes modificarlas o eliminarlas en "Pruebas creadas".');
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

function llenarBloquesDesdePreguntas(preguntas) {
    const contenedor = document.getElementById('cp-preguntas');
    contenedor.innerHTML = '';

    preguntas.forEach(q => {
        agregarBloquePregunta(false);
        const bloque = contenedor.lastElementChild;

        bloque._preguntaId = q.id;
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

function activarModoEdicionVisual() {
    document.getElementById('cp-pill-titulo').innerText = 'EDITAR PRUEBA';

    const boton = document.querySelector('#form-crear-pregunta button[type="submit"]');
    if (boton) boton.innerText = 'Guardar cambios';
    document.getElementById('cp-btn-cancelar-edicion').classList.remove('oculto');

    const panel = document.querySelector('.app-main');
    if (panel) panel.scrollTop = 0;
}

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

function abrirEdicionPrueba(datos) {
    restaurarModoCrear();
    pruebaEditandoId = datos.prueba.id;

    mostrarSeccion('pruebas');

    document.getElementById('cp-materia').value = datos.prueba.materia;
    document.getElementById('cp-titulo').value = datos.prueba.titulo;
    llenarBloquesDesdePreguntas(datos.preguntas);

    activarModoEdicionVisual();
}

// Abre el mismo formulario de "Crear prueba" para editar una prueba
// ALMACENADA (a diferencia de clickEditarPrueba, esta no se bloquea por
// presentaciones porque las pruebas almacenadas nunca se presentan).
async function clickEditarAlmacenada(id) {
    try {
        const url = `/api/pruebas-almacenadas/${id}/editar?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();

        if (!respuesta.ok) {
            mostrarAviso('⚠️ ' + (datos.error || 'No se pudo abrir la prueba almacenada para editarla.'));
            cargarPruebasAlmacenadas();
            return;
        }

        abrirEdicionAlmacenada(datos);
    } catch (err) {
        console.error('⚠️ Error al abrir la prueba almacenada para editarla:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    }
}

function abrirEdicionAlmacenada(datos) {
    restaurarModoCrear();
    almacenadaEditando = datos.almacenada.id;

    mostrarSeccion('pruebas');

    document.getElementById('cp-materia').value = datos.almacenada.materia;
    document.getElementById('cp-titulo').value = datos.almacenada.titulo;
    llenarBloquesDesdePreguntas(datos.preguntas);

    activarModoEdicionVisual();
}

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
// 🛡️ PRUEBAS CREADAS (solo administradores)
// ===================================================
let gruposAdmin = [];

function textoCantidadPreguntas(n) {
    return n === 1 ? '1 pregunta' : `${n} preguntas`;
}

// Parte común de la URL de un grupo (nivel + prueba + sesión + materia)
function parametrosGrupo(grupo) {
    return `&nivel=${encodeURIComponent(grupo.nivel)}&prueba=${encodeURIComponent(grupo.prueba || 1)}` +
        `&sesion=${encodeURIComponent(grupo.sesion)}&materia=${encodeURIComponent(grupo.materia)}`;
}
// Vista actual de "Pruebas creadas" del administrador
let adminNivelSel = null;   // 'B' | 'A' | 'S' | null
let adminPruebaSel = null;  // 1 | 2 | 3 | null

async function cargarGruposAdmin(mantenerVista = false) {
    const contenedor = document.getElementById('pruebas-creadas-contenido');
    if (!contenedor) return;

    if (!mantenerVista) {
        adminNivelSel = null;
        adminPruebaSel = null;
    }

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
        dibujarPruebasCreadasAdmin();
    } catch (err) {
        console.error('⚠️ No se pudieron cargar las preguntas de los niveles:', err);
        gruposAdmin = [];
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">No se pudo cargar. Intenta de nuevo.</p></div>';
    }
}

function selectorNivelAdminHtml() {
    const opciones = ['B', 'A', 'S'].map(n =>
        `<option value="${n}" ${adminNivelSel === n ? 'selected' : ''}>Nivel ${n} · ${NOMBRE_NIVEL[n]}</option>`
    ).join('');

    return `
        <select class="admin-select-nivel" onchange="elegirNivelAdmin(this.value)" aria-label="Elegir nivel">
            <option value="" disabled ${adminNivelSel ? '' : 'selected'}>Selecciona un nivel</option>
            ${opciones}
        </select>`;
}

function elegirNivelAdmin(nivel) {
    adminNivelSel = nivel;
    adminPruebaSel = null;
    dibujarPruebasCreadasAdmin();
}

function elegirPruebaAdmin(prueba) {
    adminPruebaSel = prueba;
    dibujarPruebasCreadasAdmin();
}

function volverAPruebasAdmin() {
    adminPruebaSel = null;
    dibujarPruebasCreadasAdmin();
}

function dibujarPruebasCreadasAdmin() {
    const contenedor = document.getElementById('pruebas-creadas-contenido');
    if (!contenedor) return;

    const selector = selectorNivelAdminHtml();

    // 1) Todavía no eligió nivel
    if (!adminNivelSel) {
        contenedor.innerHTML = `
            <div class="admin-barra-nivel">
                <span></span>
                ${selector}
            </div>
            <div class="historial-vacio"><p class="texto-proximamente">Selecciona un nivel para ver sus pruebas.</p></div>
        `;
        return;
    }

    const delNivel = gruposAdmin.filter(g => g.nivel === adminNivelSel);

    // 2) Nivel elegido: Prueba 1, 2 y 3
    if (!adminPruebaSel) {
        const botones = [1, 2, 3].map(p => {
            const total = delNivel
                .filter(g => (g.prueba || 1) === p)
                .reduce((acc, g) => acc + g.num_preguntas, 0);
            return `
                <button type="button" class="btn-prueba-nivel" onclick="elegirPruebaAdmin(${p})">
                    <span class="prueba-nivel-titulo">PRUEBA ${p}</span>
                    <span class="prueba-nivel-meta">${total === 0 ? 'Vacía' : textoCantidadPreguntas(total)}</span>
                </button>`;
        }).join('');

        contenedor.innerHTML = `
            <div class="admin-barra-nivel">
                <button type="button" class="btn-promedio" onclick="abrirModalPromedio()">Promedio</button>
                ${selector}
            </div>
            <div class="pill-niveles">PRUEBAS DE NIVEL ${adminNivelSel}</div>
            <div class="lista-pruebas">${botones}</div>
        `;
        return;
    }

    // 3) Prueba elegida: sus grupos (sesión + materia) o vacío
    const delaPrueba = delNivel
        .filter(g => (g.prueba || 1) === adminPruebaSel)
        .sort((a, b) => a.sesion - b.sesion);

    const filasHtml = delaPrueba.map(g => {
        const i = gruposAdmin.indexOf(g);   // clickEditarGrupo / clickEliminarGrupo usan este índice
        return `
            <div class="pregunta-creada-fila ${claseTemaMateria(g.materia)}">
                <div class="pregunta-creada-encabezado">
                    <div class="pregunta-creada-pills">
                        <span class="historial-nivel-pill">Prueba ${g.prueba || 1}</span>
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
            </div>`;
    }).join('');

    const totalPreguntas = delaPrueba.reduce((acc, g) => acc + g.num_preguntas, 0);
    const cuerpo = delaPrueba.length === 0
        ? '<div class="historial-vacio"><p class="texto-proximamente">Esta prueba aún no tiene preguntas. Créalas en "Crear prueba".</p></div>'
        : `<p class="historial-etiqueta">${delaPrueba.length === 1 ? '1 grupo' : delaPrueba.length + ' grupos'} · ${textoCantidadPreguntas(totalPreguntas)}</p>
           <div class="historial-lista">${filasHtml}</div>`;

    contenedor.innerHTML = `
        <div class="admin-barra-nivel">
            <button type="button" class="btn-volver-niveles" onclick="volverAPruebasAdmin()">← Volver</button>
            ${selector}
        </div>
        <div class="pill-niveles">NIVEL ${adminNivelSel} · PRUEBA ${adminPruebaSel}</div>
        ${cuerpo}
    `;
}
async function clickEditarGrupo(indice) {
    const grupo = gruposAdmin[indice];
    if (!grupo) return;

    try {
        const url = `/api/admin/grupo?correo=${encodeURIComponent(usuarioActual.correo)}` + parametrosGrupo(grupo);
        const respuesta = await fetch(url);
        const datos = await respuesta.json();

        if (!respuesta.ok) {
            mostrarAviso('⚠️ ' + (datos.error || 'No se pudieron abrir las preguntas.'));
            cargarGruposAdmin(true);
            return;
        }

        abrirEdicionGrupo(datos);
    } catch (err) {
        console.error('⚠️ Error al abrir las preguntas para editarlas:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    }
}
function abrirEdicionGrupo(datos) {
    restaurarModoCrear();
    grupoEditando = {
        nivel: datos.nivel,
        prueba: Number(datos.prueba || 1),
        sesion: Number(datos.sesion),
        materia: datos.materia
    };

    mostrarSeccion('pruebas');

    document.getElementById('cp-nivel').value = datos.nivel;
    document.getElementById('cp-prueba').value = String(datos.prueba || 1);
    document.getElementById('cp-sesion').value = String(datos.sesion);
    actualizarMateriasAdmin();
    document.getElementById('cp-materia-nivel').value = datos.materia;

    llenarBloquesDesdePreguntas(datos.preguntas);
    activarModoEdicionVisual();
}

function clickEliminarGrupo(indice) {
    const grupo = gruposAdmin[indice];
    if (!grupo) return;

    const mensaje = '¿Seguro que quieres eliminar las ' + grupo.num_preguntas + ' preguntas de Nivel ' + grupo.nivel +
        ' · Prueba ' + (grupo.prueba || 1) + ' · Sesión ' + grupo.sesion + ' · ' + grupo.materia + '?' +
        '\n\nLos resultados que los estudiantes ya obtuvieron se conservarán.\n\nEsta acción no se puede deshacer.';

    mostrarModalConfirmacion(mensaje, () => eliminarGrupo(grupo), 'Eliminar', 'Cancelar');
}

async function eliminarGrupo(grupo) {
    try {
        const url = `/api/admin/grupo?correo=${encodeURIComponent(usuarioActual.correo)}` + parametrosGrupo(grupo);
        const respuesta = await fetch(url, { method: 'DELETE' });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            mostrarAviso('🗑️ Las preguntas fueron eliminadas.');
        } else {
            mostrarAviso('⚠️ No se pudieron eliminar las preguntas:\n' + (resultado.error || 'Error desconocido.'));
        }
        cargarGruposAdmin(true);
    } catch (err) {
        console.error('⚠️ Error al eliminar las preguntas:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    }
}

// ===================================================
// 🎯 PROMEDIO (solo administradores)
//
// Un solo mínimo por nivel (B → A, A → S). El "de N" es la suma de las
// preguntas de TODAS las pruebas del nivel, así que cambia solo si se
// añaden o se quitan preguntas.
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
                        <span class="promedio-total">${textoCantidadPreguntas(total)} sumando todas las pruebas</span>
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
            mostrarAviso('🎯 ¡Promedio guardado con éxito!\n\nLos estudiantes necesitarán ese mínimo de respuestas correctas, sumando todas las pruebas del nivel, para pasar al siguiente.');
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
// ===================================================
let registrosTipoActual = null;
let registrosFilasActuales = [];

const CONTRASENA_OCULTA = '••••••••';

// "codigo_unico" y "contrasena" llevan tipo: 'contrasena': se muestran ocultos en la
// tabla, con un botón de ojo. El nombre se muestra con formato "José Andrés Cuervo".
const COLUMNAS_REGISTROS = {
    estudiantes: [
        { titulo: 'Nombre completo', campo: 'nombre', formato: formatearNombre },
        { titulo: 'Grado', campo: 'grado', formato: v => (v ? formatearGrado(v) : '') },
        { titulo: 'Código único', campo: 'codigo_unico', tipo: 'contrasena' }
    ],
    profesores: [
        { titulo: 'Nombre completo', campo: 'nombre', formato: formatearNombre },
        { titulo: 'Código único', campo: 'codigo_unico', tipo: 'contrasena' }
    ],
    administradores: [
        { titulo: 'Nombre completo', campo: 'nombre', formato: formatearNombre },
        { titulo: 'Correo', campo: 'correo' },
        { titulo: 'Contraseña', campo: 'contrasena', tipo: 'contrasena' },
        { titulo: 'Código único', campo: 'codigo_unico', tipo: 'contrasena' }
    ]
};

function mostrarMenuRegistros() {
    registrosTipoActual = null;
    registrosFilasActuales = [];
    document.getElementById('registros-vista').classList.add('oculto');
    document.getElementById('registros-menu').classList.remove('oculto');
}

// ===================================================================
// ☑️ ELIMINACIÓN MÚLTIPLE en "Base de datos registros" (administrador)
// ===================================================================
let registrosModoMultiple = false;
let registrosSeleccionados = new Set();   // correos marcados
let eliminandoVarios = false;

const SINGULAR_REGISTRO = { estudiantes: 'estudiante', profesores: 'profesor', administradores: 'administrador' };
const PLURAL_REGISTRO = { estudiantes: 'estudiantes', profesores: 'profesores', administradores: 'administradores' };

// Un administrador no puede eliminar su propia cuenta (el servidor tampoco lo permite)
function esCuentaPropiaRegistro(fila) {
    return registrosTipoActual === 'administradores' && fila.correo === usuarioActual.correo;
}

async function cargarRegistros(tipo) {
    if (rolActual !== 'admin' || !COLUMNAS_REGISTROS[tipo]) return;
    if (!usuarioActual || !usuarioActual.correo) return;

    registrosTipoActual = tipo;
    registrosFilasActuales = [];
    // Al entrar o recargar una tabla siempre se sale del modo selección
    registrosModoMultiple = false;
    registrosSeleccionados = new Set();

    document.getElementById('registros-menu').classList.add('oculto');
    document.getElementById('registros-vista').classList.remove('oculto');
    const titulosRegistros = { estudiantes: 'Estudiantes', profesores: 'Profesores', administradores: 'Administradores' };
    document.getElementById('registros-titulo').innerText = titulosRegistros[tipo] || tipo;

    const btnAgregar = document.getElementById('btn-agregar-registro');
    btnAgregar.classList.remove('oculto');
    btnAgregar.innerText = tipo === 'estudiantes'
        ? '＋ Agregar estudiante'
        : tipo === 'profesores'
            ? '＋ Agregar profesor'
            : '＋ Agregar administrador';

    const contenedor = document.getElementById('registros-contenido');
    contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Cargando...</p></div>';

    try {
        const url = `/api/admin/${tipo}?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();

        if (registrosTipoActual !== tipo) return;

        if (!respuesta.ok) {
            contenedor.innerHTML = `<div class="historial-vacio"><p class="texto-proximamente">${escaparHtml(datos.error || 'No se pudo cargar.')}</p></div>`;
            return;
        }

        registrosFilasActuales = datos[tipo] || [];
        dibujarRegistros();
    } catch (err) {
        console.error('⚠️ No se pudo cargar la tabla de registros:', err);
        if (registrosTipoActual === tipo) {
            contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">No se pudo cargar. Intenta de nuevo.</p></div>';
        }
    }
}

// Dibuja la barra (botón "Eliminación múltiple" + cantidad) y la tabla.
// Se llama al cargar y al entrar o salir del modo selección.
function dibujarRegistros() {
    const tipo = registrosTipoActual;
    const contenedor = document.getElementById('registros-contenido');
    if (!tipo || !contenedor) return;

    const filas = registrosFilasActuales;
    const columnas = COLUMNAS_REGISTROS[tipo];

    if (filas.length === 0) {
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Aún no hay registros en esta tabla.</p></div>';
        return;
    }

    const modo = registrosModoMultiple;

    const encabezadoHtml = (modo ? '<th class="col-check"></th>' : '') +
        '<th class="col-num">N.º</th>' +
        columnas.map(c => `<th>${escaparHtml(c.titulo)}</th>`).join('') +
        '<th class="col-accion">Eliminar</th>';

    const cuerpoHtml = filas.map((f, i) => {
        const celdasHtml = columnas.map(c => {
            if (c.tipo === 'contrasena') {
                const botonEditar = c.campo === 'codigo_unico'
                    ? `<button type="button" class="btn-ojo-tabla" title="Cambiar código único" aria-label="Cambiar código único" onclick="abrirModalEditarCodigo(${i})" ${modo ? 'disabled' : ''}>✏️</button>`
                    : '';
                return `
                    <td>
                        <div class="pass-celda">
                            <span class="pass-texto" id="registro-pass-${i}-${c.campo}" data-visible="0">${CONTRASENA_OCULTA}</span>
                            <button type="button" class="btn-ojo-tabla" title="Mostrar contraseña" aria-label="Mostrar contraseña" onclick="alternarPasswordRegistro(${i}, this, '${c.campo}')">👁️</button>
                            ${botonEditar}
                        </div>
                    </td>`;
            }
            const valor = c.formato ? c.formato(f[c.campo]) : f[c.campo];
            return `<td>${escaparHtml(valor)}</td>`;
        }).join('');

        const propio = esCuentaPropiaRegistro(f);
        const marcado = registrosSeleccionados.has(f.correo);
        const clasesFila = modo
            ? 'modo-seleccion' + (marcado ? ' seleccionada' : '') + (propio ? ' no-seleccionable' : '')
            : '';
        const clickFila = modo && !propio ? ` onclick="clickFilaRegistro(event, ${i})"` : '';

        const celdaCheck = !modo ? '' : (propio
            ? '<td class="col-check"><span class="registros-check registros-check-off" title="No puedes eliminar tu propia cuenta"></span></td>'
            : `<td class="col-check"><span class="registros-check" role="checkbox" aria-checked="${marcado}"></span></td>`);

        return `
            <tr data-i="${i}" class="${clasesFila}"${clickFila}>
                ${celdaCheck}
                <td class="col-num">${i + 1}</td>
                ${celdasHtml}
                <td class="col-accion">
                    <button type="button" class="btn-borrar-registro" title="Eliminar usuario" aria-label="Eliminar a ${escaparHtml(f.nombre)}" onclick="clickEliminarRegistro(${i})" ${modo ? 'disabled' : ''}>🗑️ Eliminar</button>
                </td>
            </tr>
        `;
    }).join('');

    contenedor.innerHTML = `
        <div class="registros-barra">
            <div id="registros-acciones" class="resultados-acciones"></div>
            <p class="historial-etiqueta">${textoCantidadRegistros(tipo, filas.length)}</p>
            <span></span>
        </div>
        <div class="registros-tabla-wrap">
            <table class="registros-tabla">
                <thead><tr>${encabezadoHtml}</tr></thead>
                <tbody>${cuerpoHtml}</tbody>
            </table>
        </div>
    `;

    renderizarBarraRegistros();
}

// Botón "Eliminación múltiple" o, en modo selección: "Seleccionar todos" + "Eliminar (n)" + "Cancelar"
function renderizarBarraRegistros() {
    const cont = document.getElementById('registros-acciones');
    if (!cont) return;

    if (!registrosModoMultiple) {
        cont.innerHTML = '<button type="button" class="btn-eliminacion-multiple" onclick="activarEliminacionMultipleRegistros()">☑️ Eliminación múltiple</button>';
        return;
    }

    const n = registrosSeleccionados.size;
    cont.innerHTML = `
        <button type="button" class="btn-seleccionar-todos" onclick="seleccionarTodosRegistros()">Seleccionar todos</button>
        <button type="button" class="btn-eliminar-seleccion" onclick="confirmarEliminarSeleccionRegistros()" ${n === 0 ? 'disabled' : ''}>🗑️ Eliminar (${n})</button>
        <button type="button" class="btn-cancelar-seleccion" onclick="cancelarEliminacionMultipleRegistros()">Cancelar</button>
    `;
}

function activarEliminacionMultipleRegistros() {
    registrosModoMultiple = true;
    registrosSeleccionados = new Set();
    dibujarRegistros();
}

function cancelarEliminacionMultipleRegistros() {
    registrosModoMultiple = false;
    registrosSeleccionados = new Set();
    dibujarRegistros();
}

// Actualiza las casillas y el contador sin volver a dibujar toda la tabla
function pintarSeleccionRegistros() {
    document.querySelectorAll('#registros-contenido tbody tr[data-i]').forEach(tr => {
        const fila = registrosFilasActuales[Number(tr.dataset.i)];
        if (!fila) return;
        const marcado = registrosSeleccionados.has(fila.correo);
        tr.classList.toggle('seleccionada', marcado);
        const casilla = tr.querySelector('.registros-check');
        if (casilla) casilla.setAttribute('aria-checked', String(marcado));
    });
    renderizarBarraRegistros();
}

function clickFilaRegistro(evento, indice) {
    // Los botones de la fila (ojito, etc.) no marcan ni desmarcan la casilla
    if (evento && evento.target && evento.target.closest('button')) return;
    alternarSeleccionRegistro(indice);
}

function alternarSeleccionRegistro(indice) {
    if (!registrosModoMultiple) return;
    const fila = registrosFilasActuales[indice];
    if (!fila || esCuentaPropiaRegistro(fila)) return;

    if (registrosSeleccionados.has(fila.correo)) registrosSeleccionados.delete(fila.correo);
    else registrosSeleccionados.add(fila.correo);

    pintarSeleccionRegistros();
}

// Marca todos; si ya estaban todos marcados, los desmarca
function seleccionarTodosRegistros() {
    const correos = registrosFilasActuales.filter(f => !esCuentaPropiaRegistro(f)).map(f => f.correo);
    const todosMarcados = correos.length > 0 && correos.every(c => registrosSeleccionados.has(c));

    correos.forEach(c => {
        if (todosMarcados) registrosSeleccionados.delete(c);
        else registrosSeleccionados.add(c);
    });

    pintarSeleccionRegistros();
}

function confirmarEliminarSeleccionRegistros() {
    const n = registrosSeleccionados.size;
    if (n === 0 || !registrosTipoActual) return;

    const tipo = registrosTipoActual;
    let mensaje = n === 1
        ? '¿Seguro que quieres eliminar al ' + SINGULAR_REGISTRO[tipo] + ' seleccionado?'
        : '¿Seguro que quieres eliminar a los ' + n + ' ' + PLURAL_REGISTRO[tipo] + ' seleccionados?';
    mensaje += '\n\nEsta acción no se puede deshacer.';

    mostrarModalConfirmacion(mensaje, eliminarRegistrosSeleccionados, 'Eliminar', 'Cancelar');
}

async function eliminarRegistrosSeleccionados() {
    if (eliminandoVarios || registrosSeleccionados.size === 0 || !registrosTipoActual) return;
    eliminandoVarios = true;
    const tipo = registrosTipoActual;

    try {
        const respuesta = await fetch('/api/admin/eliminar-usuarios', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                correo: usuarioActual.correo,
                tipo,
                correos: Array.from(registrosSeleccionados)
            })
        });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            const n = resultado.eliminados;
            mostrarAviso('🗑️ ' + (n === 1 ? 'Se eliminó 1 usuario.' : 'Se eliminaron ' + n + ' usuarios.'));
        } else {
            mostrarAviso('⚠️ ' + (resultado.error || 'No se pudieron eliminar los usuarios.'));
        }

        if (registrosTipoActual === tipo) cargarRegistros(tipo);   // recarga y sale del modo selección
    } catch (err) {
        console.error('⚠️ Error al eliminar los usuarios:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    } finally {
        eliminandoVarios = false;
    }
}

function textoCantidadRegistros(tipo, n) {
    if (tipo === 'estudiantes') {
        return n === 1 ? '1 estudiante registrado' : `${n} estudiantes registrados`;
    }
    if (tipo === 'administradores') {
        return n === 1 ? '1 administrador registrado' : `${n} administradores registrados`;
    }
    return n === 1 ? '1 profesor registrado' : `${n} profesores registrados`;
}

// Recibe "campo" (por ejemplo 'contrasena' o 'codigo_unico') para saber qué valor
// de la fila mostrar. El id del span incluye el campo porque la tabla de
// Administradores tiene dos columnas ocultas (contraseña y código único) en la misma fila.
function alternarPasswordRegistro(indice, boton, campo) {
    const nombreCampo = campo || 'contrasena';
    const span = document.getElementById('registro-pass-' + indice + '-' + nombreCampo);
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
        span.textContent = fila[nombreCampo];
        span.dataset.visible = '1';
        boton.innerText = '🔒';
        boton.title = 'Ocultar contraseña';
        boton.setAttribute('aria-label', 'Ocultar contraseña');
    }
}

function clickEliminarRegistro(indice) {
    const fila = registrosFilasActuales[indice];
    if (!fila || !registrosTipoActual) return;

    const tipo = registrosTipoActual;
    const mensaje = '¿Estás seguro de borrar a este usuario?\n\n' +
        formatearNombre(fila.nombre) + '\n' + (fila.correo || '') +
        '\n\nEsta acción no se puede deshacer.';

    mostrarModalConfirmacion(
        mensaje,
        () => eliminarRegistro(tipo, fila.correo, formatearNombre(fila.nombre)),
        'Sí',
        'Cancelar'
    );
}

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

        if (registrosTipoActual === tipo) cargarRegistros(tipo);
    } catch (err) {
        console.error('⚠️ Error al eliminar el usuario:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    }
}

// ===================================================
// ➕ AGREGAR ESTUDIANTE / PROFESOR / ADMINISTRADOR (solo administradores)
// ===================================================
let enviandoNuevoUsuario = false;

function abrirModalAgregarUsuario() {
    if (rolActual !== 'admin' || !registrosTipoActual) return;

    const tipo = registrosTipoActual;
    const esEstudiante = tipo === 'estudiantes';
    const esAdministrador = tipo === 'administradores';

    const TITULOS = {
        estudiantes: 'Agregar estudiante',
        profesores: 'Agregar profesor/a',
        administradores: 'Agregar administrador'
    };
    document.getElementById('agregar-usuario-titulo').innerText = TITULOS[tipo] || 'Agregar usuario';

    document.getElementById('agregar-nombre').value = '';
    document.getElementById('agregar-codigo').value = '';
    document.getElementById('agregar-correo').value = '';
    document.getElementById('agregar-contrasena').value = '';

    const selectGrado = document.getElementById('agregar-grado');
    selectGrado.value = '';
    selectGrado.classList.toggle('oculto', !esEstudiante);

    // Estudiantes/Profesores usan código único; Administradores usan correo + contraseña (y también código)
    document.getElementById('agregar-codigo-wrap').classList.remove('oculto');
    document.getElementById('agregar-correo').classList.toggle('oculto', !esAdministrador);
    document.getElementById('agregar-contrasena-wrap').classList.toggle('oculto', !esAdministrador);

    // Los campos ocultos con ojito vuelven a quedar ocultos al abrir el modal
    document.getElementById('agregar-codigo').type = 'password';
    document.getElementById('agregar-contrasena').type = 'password';
    document.querySelectorAll('#modal-agregar-usuario .btn-ojo').forEach(ojo => ojo.innerText = '👁️');

    document.getElementById('agregar-usuario-error').innerText = '';
    document.getElementById('modal-agregar-usuario').classList.remove('oculto');
    document.getElementById('agregar-nombre').focus();
}

function cerrarModalAgregarUsuario() {
    document.getElementById('modal-agregar-usuario').classList.add('oculto');
}

async function guardarNuevoUsuario() {
    if (enviandoNuevoUsuario || !registrosTipoActual) return;

    const tipo = registrosTipoActual;
    // El nombre se guarda con formato "Nombre Apellido"
    const nombre = formatearNombre(document.getElementById('agregar-nombre').value);
    const error = document.getElementById('agregar-usuario-error');

    if (!nombre) { error.innerText = 'Escribe el nombre completo.'; return; }

    let datos;

    if (tipo === 'administradores') {
        const codigo = document.getElementById('agregar-codigo').value.trim();
        const correoNuevo = document.getElementById('agregar-correo').value.trim();
        const contrasenaNueva = document.getElementById('agregar-contrasena').value;

        if (!codigo) { error.innerText = 'Escribe el código único.'; return; }
        if (!correoNuevo) { error.innerText = 'Escribe el correo.'; return; }
        if (!contrasenaNueva) { error.innerText = 'Escribe la contraseña.'; return; }

        datos = { correo: usuarioActual.correo, tipo, nombre, correo_nuevo: correoNuevo, contrasena: contrasenaNueva, codigo_unico: codigo };
    } else {
        const grado = document.getElementById('agregar-grado').value;
        const codigo = document.getElementById('agregar-codigo').value.trim();

        if (tipo === 'estudiantes' && !grado) { error.innerText = 'Selecciona el grado.'; return; }
        if (!codigo) { error.innerText = 'Escribe el código único.'; return; }

        datos = { correo: usuarioActual.correo, tipo, nombre, grado, codigo_unico: codigo };
    }

    error.innerText = '';
    enviandoNuevoUsuario = true;
    const boton = document.getElementById('agregar-usuario-boton');
    boton.disabled = true;

    try {
        const respuesta = await fetch('/api/admin/registrar-usuario', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datos)
        });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            cerrarModalAgregarUsuario();
            const mensaje = tipo === 'administradores'
                ? '🎉 ¡' + nombre + ' fue registrado con éxito!\n\nYa puede iniciar sesión con su correo, contraseña y código único.'
                : '🎉 ¡' + nombre + ' fue registrado con éxito!\n\nYa puede entrar con su código único.';
            mostrarAviso(mensaje);
            if (registrosTipoActual === tipo) cargarRegistros(tipo);
        } else {
            error.innerText = resultado.error || 'No se pudo registrar.';
        }
    } catch (err) {
        console.error('⚠️ Error al registrar el usuario:', err);
        error.innerText = 'No se pudo conectar con el servidor.';
    } finally {
        enviandoNuevoUsuario = false;
        boton.disabled = false;
    }
}
// ===================================================
// ✏️ CAMBIAR CÓDIGO ÚNICO (solo administradores)
// ===================================================
let usuarioEditandoCodigo = null;
let guardandoCodigo = false;

function abrirModalEditarCodigo(indice) {
    const fila = registrosFilasActuales[indice];
    if (rolActual !== 'admin' || !fila || !registrosTipoActual) return;

    usuarioEditandoCodigo = { tipo: registrosTipoActual, correo: fila.correo };
    document.getElementById('editar-codigo-usuario').innerText = formatearNombre(fila.nombre);
    document.getElementById('editar-codigo-nuevo').value = '';
    document.getElementById('editar-codigo-error').innerText = '';
    document.getElementById('modal-editar-codigo').classList.remove('oculto');
    document.getElementById('editar-codigo-nuevo').focus();
}

function cerrarModalEditarCodigo() {
    document.getElementById('modal-editar-codigo').classList.add('oculto');
    usuarioEditandoCodigo = null;
}

async function guardarCodigoEditado() {
    if (guardandoCodigo || !usuarioEditandoCodigo) return;

    const error = document.getElementById('editar-codigo-error');
    const nuevo = document.getElementById('editar-codigo-nuevo').value.trim();
    if (!nuevo) { error.innerText = 'Escribe el nuevo código único.'; return; }

    error.innerText = '';
    guardandoCodigo = true;
    const boton = document.getElementById('editar-codigo-boton');
    boton.disabled = true;
    const { tipo, correo } = usuarioEditandoCodigo;

    try {
        const respuesta = await fetch('/api/admin/cambiar-codigo', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                correo: usuarioActual.correo,
                tipo,
                correo_usuario: correo,
                nuevo_codigo: nuevo
            })
        });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            cerrarModalEditarCodigo();
            mostrarAviso('✅ Código actualizado.\n\nEl código anterior ya no funciona.');
            if (registrosTipoActual === tipo) cargarRegistros(tipo);
        } else {
            error.innerText = resultado.error || 'No se pudo cambiar el código.';
        }
    } catch (err) {
        console.error('⚠️ Error al cambiar el código:', err);
        error.innerText = 'No se pudo conectar con el servidor.';
    } finally {
        guardandoCodigo = false;
        boton.disabled = false;
    }
}
// ===================================================
// 📊 PRUEBAS CREADAS (solo profesores)
// ===================================================
let pruebasCreadas = [];
let pruebaPorSubir = null;
let enviandoSubida = false;

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

function clickSubirPrueba() {
    if (pruebasCreadas.length === 0) {
        mostrarAviso('Por favor cree una prueba primero.');
        return;
    }

    const sinSubir = pruebasCreadas.filter(p => p.estado === 'sin_subir');
    if (sinSubir.length === 0) {
        mostrarAviso('Todas tus pruebas ya fueron subidas. Crea una prueba nueva para poder subirla.');
        return;
    }

    mostrarSeleccionPrueba('Seleccione la prueba que desea subir', sinSubir, abrirModalFechas);
}

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

document.querySelectorAll('.grado-desplegable').forEach(d => {
    d.addEventListener('toggle', () => {
        if (!d.open) return;
        document.querySelectorAll('.grado-desplegable').forEach(otra => {
            if (otra !== d) otra.open = false;
        });
    });
});

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

    document.getElementById('hora-inicio').value = horaActualLocal();
    document.getElementById('hora-fin').value = '';

    document.querySelectorAll('input[name="grado-prueba"]').forEach(c => { c.checked = false; });
    document.querySelectorAll('.grado-desplegable').forEach(d => {
        d.open = false;
        actualizarResumenGrado(d);
    });

    document.getElementById('modal-fechas-error').innerText = '';
    document.getElementById('modal-fechas').classList.remove('oculto');
}

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
    const horaInicio = document.getElementById('hora-inicio').value;
    const horaFin = document.getElementById('hora-fin').value;
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
// 🗂️ PRUEBAS ALMACENADAS (solo profesores)
// ===================================================
let pruebasAlmacenadas = [];
let almacenando = false;

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
        cargarPruebasCreadas();
    } catch (err) {
        console.error('⚠️ Error al almacenar la prueba:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    } finally {
        almacenando = false;
    }
}

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
                        <button type="button" class="btn-editar-prueba" onclick="clickEditarAlmacenada(${p.id})">Editar</button>
                        <button type="button" class="btn-resubir-almacenada" onclick="clickResubirAlmacenada(${p.id})">Resubir</button>
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

// "Resubir" una prueba almacenada. Crea en el servidor una copia como
// prueba nueva (sin fechas todavía) y abre de una vez el modal de "Grado, fechas
// y horas" para completarla y volver a subirla a los estudiantes.
let resubiendo = false;

async function clickResubirAlmacenada(id) {
    if (resubiendo) return;
    resubiendo = true;

    try {
        const respuesta = await fetch(`/api/pruebas-almacenadas/${id}/resubir`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo: usuarioActual.correo })
        });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            // La añadimos de una vez a "pruebasCreadas" para que abrirModalFechas() la encuentre
            pruebasCreadas.unshift({
                id: resultado.id,
                titulo: resultado.titulo,
                materia: resultado.materia,
                num_preguntas: resultado.num_preguntas,
                num_presentaciones: 0,
                almacenada: true,
                estado: 'sin_subir'
            });
            abrirModalFechas(resultado.id);
        } else {
            mostrarAviso('⚠️ ' + (resultado.error || 'No se pudo preparar la prueba para resubir.'));
        }
    } catch (err) {
        console.error('⚠️ Error al resubir la prueba almacenada:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    } finally {
        resubiendo = false;
    }
}

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
// 📦 RESULTADOS DE LAS PRUEBAS (solo profesores)
// ===================================================
let resultadosProfesorActuales = [];
// Estado de la "Eliminación múltiple"
let modoEliminacionMultiple = false;
let resultadosSeleccionados = new Set();
let eliminandoResultados = false;

// Ordena grados tipo "9", "9-A", "10-B", "11" numérica y alfabéticamente
function ordenarGrados(lista) {
    return lista.slice().sort((a, b) => {
        const ma = /^(\d+)(?:-([A-Za-z]))?/.exec(String(a));
        const mb = /^(\d+)(?:-([A-Za-z]))?/.exec(String(b));
        const na = ma ? parseInt(ma[1], 10) : 0;
        const nb = mb ? parseInt(mb[1], 10) : 0;
        if (na !== nb) return na - nb;
        const la = ma && ma[2] ? ma[2] : '';
        const lb = mb && mb[2] ? mb[2] : '';
        return la.localeCompare(lb);
    });
}

function filaResultadoHtml(r) {
    const porcentaje = r.total > 0 ? Math.round((r.correctas / r.total) * 100) : 0;
    const gradoTexto = r.grado ? ` · Grado ${escaparHtml(formatearGrado(r.grado))}` : '';

    // Casilla de selección (solo en modo "Eliminación múltiple")
    const marcado = resultadosSeleccionados.has(r.id);
    const casilla = modoEliminacionMultiple
        ? `<span class="resultado-check" role="checkbox" aria-checked="${marcado}"></span>`
        : '';
    const clasesItem = 'resultado-item' +
        (modoEliminacionMultiple ? ' modo-seleccion' : '') +
        (marcado ? ' seleccionado' : '');
    const clickItem = modoEliminacionMultiple ? ` onclick="alternarSeleccionResultado(${r.id})"` : '';

    return `
        <div class="${clasesItem}" data-id="${r.id}"${clickItem}>
            ${casilla}
            <div class="resultado-fila ${claseTemaMateria(r.materia)}">
                <div class="resultado-fila-info">
                    <div class="resultado-fila-encabezado">
                        <span class="historial-nivel-pill pill-materia">${escaparHtml(r.materia)}</span>
                        ${r.prueba_eliminada ? '<span class="estado-pill estado-finalizada">Prueba eliminada</span>' : ''}
                    </div>
                    <p class="resultado-fila-titulo">${escaparHtml(r.titulo)}</p>
                    <p class="resultado-fila-estudiante"><span class="resultado-general-nombre">${escaparHtml(formatearNombre(r.nombre))}</span>${gradoTexto}</p>
                    <p class="resultado-fila-fecha">${escaparHtml(formatearFechaHora(r.fecha))}</p>
                </div>
                <div class="resultado-fila-puntaje">
                    <span class="resultado-fila-numero">${r.correctas}/${r.total}</span>
                    <span class="resultado-fila-detalle">correctas · ${porcentaje}%</span>
                </div>
            </div>
        </div>
    `;
}

// Resultados que se ven ahora mismo (según el filtro de grado), ordenados por nombre
function resultadosFiltrados() {
    const filtro = document.getElementById('resultados-filtro-grado');
    const gradoElegido = filtro ? filtro.value : '';

    return (gradoElegido
        ? resultadosProfesorActuales.filter(r => String(r.grado || '') === gradoElegido)
        : resultadosProfesorActuales
    ).slice().sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
}

// Vuelve a dibujar la lista aplicando el filtro de grado, sin pedir datos al servidor.
function renderizarResultadosProfesor() {
    const lista = document.getElementById('resultados-lista-contenido');
    if (!lista) return;

    const filtrados = resultadosFiltrados();

    if (filtrados.length === 0) {
        lista.innerHTML = '<p class="texto-proximamente">No hay resultados para ese grado.</p>';
        return;
    }

    const etiquetaCantidad = filtrados.length === 1 ? '1 prueba presentada' : `${filtrados.length} pruebas presentadas`;
    lista.innerHTML = `
        <p class="historial-etiqueta">${etiquetaCantidad}</p>
        <div class="historial-lista">${filtrados.map(filaResultadoHtml).join('')}</div>
    `;
}

// Barra de la izquierda: botón "Eliminación múltiple" o, en modo selección,
// "Seleccionar todos" + "Eliminar (n)" + "Cancelar".
function renderizarBarraResultados() {
    const cont = document.getElementById('resultados-acciones');
    if (!cont) return;

    if (!modoEliminacionMultiple) {
        cont.innerHTML = '<button type="button" class="btn-eliminacion-multiple" onclick="activarEliminacionMultiple()">☑️ Eliminación múltiple</button>';
        return;
    }

    const n = resultadosSeleccionados.size;
    cont.innerHTML = `
        <button type="button" class="btn-seleccionar-todos" onclick="seleccionarTodosResultados()">Seleccionar todos</button>
        <button type="button" class="btn-eliminar-seleccion" onclick="confirmarEliminarSeleccion()" ${n === 0 ? 'disabled' : ''}>🗑️ Eliminar (${n})</button>
        <button type="button" class="btn-cancelar-seleccion" onclick="cancelarEliminacionMultiple()">Cancelar</button>
    `;
}

function activarEliminacionMultiple() {
    modoEliminacionMultiple = true;
    resultadosSeleccionados = new Set();
    renderizarBarraResultados();
    renderizarResultadosProfesor();
}

function cancelarEliminacionMultiple() {
    modoEliminacionMultiple = false;
    resultadosSeleccionados = new Set();
    renderizarBarraResultados();
    renderizarResultadosProfesor();
}

function alternarSeleccionResultado(id) {
    if (!modoEliminacionMultiple) return;

    if (resultadosSeleccionados.has(id)) resultadosSeleccionados.delete(id);
    else resultadosSeleccionados.add(id);

    // Se actualiza solo esa tarjeta (así la lista no salta de posición)
    const item = document.querySelector('.resultado-item[data-id="' + id + '"]');
    if (item) {
        const marcado = resultadosSeleccionados.has(id);
        item.classList.toggle('seleccionado', marcado);
        const casilla = item.querySelector('.resultado-check');
        if (casilla) casilla.setAttribute('aria-checked', String(marcado));
    }
    renderizarBarraResultados();
}

// Marca todos los resultados que se ven; si ya estaban todos marcados, los desmarca
function seleccionarTodosResultados() {
    const visibles = resultadosFiltrados().map(r => r.id);
    const todosMarcados = visibles.length > 0 && visibles.every(id => resultadosSeleccionados.has(id));

    visibles.forEach(id => {
        if (todosMarcados) resultadosSeleccionados.delete(id);
        else resultadosSeleccionados.add(id);
    });

    renderizarBarraResultados();
    renderizarResultadosProfesor();
}

function confirmarEliminarSeleccion() {
    const n = resultadosSeleccionados.size;
    if (n === 0) return;

    let mensaje = n === 1
        ? '¿Seguro que quieres eliminar este resultado?'
        : '¿Seguro que quieres eliminar los ' + n + ' resultados seleccionados?';

    // Si la prueba todavía existe, al borrar el resultado el estudiante podrá presentarla otra vez
    const conPruebaVigente = resultadosProfesorActuales.some(r => resultadosSeleccionados.has(r.id) && !r.prueba_eliminada);
    if (conPruebaVigente) {
        mensaje += '\n\nOjo: si la prueba todavía existe y sigue abierta, el estudiante podrá presentarla de nuevo.';
    }
    mensaje += '\n\nEsta acción no se puede deshacer.';

    mostrarModalConfirmacion(mensaje, eliminarResultadosSeleccionados, 'Eliminar', 'Cancelar');
}

async function eliminarResultadosSeleccionados() {
    if (eliminandoResultados || resultadosSeleccionados.size === 0) return;
    eliminandoResultados = true;

    try {
        const respuesta = await fetch('/api/pruebas-profesor/resultados/eliminar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                correo: usuarioActual.correo,
                ids: Array.from(resultadosSeleccionados)
            })
        });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            const n = resultado.eliminados;
            mostrarAviso('🗑️ ' + (n === 1 ? 'Se eliminó 1 resultado.' : 'Se eliminaron ' + n + ' resultados.'));
        } else {
            mostrarAviso('⚠️ ' + (resultado.error || 'No se pudieron eliminar los resultados.'));
        }
        cargarResultadosProfesor();   // vuelve a cargar y sale del modo selección
    } catch (err) {
        console.error('⚠️ Error al eliminar los resultados:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    } finally {
        eliminandoResultados = false;
    }
}

// Se llama desde el onchange de la lista desplegable de grados
function filtrarResultadosPorGrado() {
    // Si cambia el filtro, se descartan las marcas de los resultados que ya no se ven
    // (así nunca se borra algo que el profesor no tiene a la vista).
    const visibles = new Set(resultadosFiltrados().map(r => r.id));
    resultadosSeleccionados = new Set([...resultadosSeleccionados].filter(id => visibles.has(id)));
    renderizarBarraResultados();
    renderizarResultadosProfesor();
}

async function cargarResultadosProfesor() {
    const contenedor = document.getElementById('resultados-generales-contenido');
    if (!contenedor) return;

    // Al entrar o recargar siempre se sale del modo selección
    modoEliminacionMultiple = false;
    resultadosSeleccionados = new Set();

    if (!usuarioActual || !usuarioActual.correo) {
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Inicia sesión para ver los resultados.</p></div>';
        return;
    }

    contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Cargando...</p></div>';

    try {
        const url = `/api/pruebas-profesor/resultados?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();
        resultadosProfesorActuales = datos.resultados || [];

        if (resultadosProfesorActuales.length === 0) {
            contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Aún no hay estudiantes que hayan presentado tus pruebas.</p></div>';
            return;
        }

        const gradosDisponibles = ordenarGrados([...new Set(resultadosProfesorActuales.map(r => r.grado).filter(Boolean))]);
        const opcionesHtml = gradosDisponibles.map(g =>
            `<option value="${escaparHtml(g)}">Grado ${escaparHtml(formatearGrado(g))}</option>`
        ).join('');

        contenedor.innerHTML = `
            <div class="resultados-filtro-grado-wrap">
                <div id="resultados-acciones" class="resultados-acciones"></div>
                <select id="resultados-filtro-grado" class="resultados-filtro-grado" onchange="filtrarResultadosPorGrado()">
                    <option value="">Todos los grados</option>
                    ${opcionesHtml}
                </select>
            </div>
            <div id="resultados-lista-contenido"></div>
        `;

        renderizarBarraResultados();
        renderizarResultadosProfesor();
    } catch (err) {
        console.error('⚠️ No se pudieron cargar los resultados:', err);
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">No se pudo cargar. Intenta de nuevo.</p></div>';
    }
}

// ===================================================
// 📩 AYUDAS Y PQRS
// - Estudiante / Profesor: escriben un mensaje (tipo + texto) y ven su propio
//   historial con la respuesta del administrador cuando exista.
// - Administrador: ve todos los mensajes ("Gestión de PQRS") y responde cada
//   uno con una caja de texto igual a la del estudiante/profesor.
// ===================================================
const ETIQUETA_ROL_PQRS = { estudiante: 'Estudiante', profesor: 'Profesor/a' };

// --- Estudiante / Profesor: enviar y ver sus propios mensajes ---
async function enviarPQRS(e) {
    e.preventDefault();
    if (enviandoPQRS) return;

    const selectTipo = document.getElementById('pqrs-tipo');
    const textareaMensaje = document.getElementById('pqrs-mensaje');
    const tipo = selectTipo.value;
    const mensaje = textareaMensaje.value.trim();

    if (!tipo) {
        mostrarAviso('Selecciona el tipo de mensaje (Ayuda, Petición, Queja, Reclamo o Sugerencia).');
        return;
    }
    if (!mensaje) {
        mostrarAviso('Escribe tu mensaje antes de enviarlo.');
        return;
    }

    enviandoPQRS = true;
    const boton = document.getElementById('pqrs-btn-enviar');
    if (boton) boton.disabled = true;

    try {
        const respuesta = await fetch('/api/pqrs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                correo: usuarioActual.correo,
                nombre: usuarioActual.nombre,
                rol: rolActual,
                tipo,
                mensaje
            })
        });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            document.getElementById('form-pqrs').reset();
            mostrarAviso('📩 ' + resultado.mensaje);
            cargarMisPQRS();
        } else {
            mostrarAviso('⚠️ ' + (resultado.error || 'No se pudo enviar el mensaje.'));
        }
    } catch (err) {
        console.error('⚠️ Error al enviar la PQRS:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    } finally {
        enviandoPQRS = false;
        if (boton) boton.disabled = false;
    }
}

function filaPQRSHtml(m, { mostrarRemitente = false } = {}) {
    const remitenteHtml = mostrarRemitente
        ? `<p class="pqrs-remitente">${escaparHtml(formatearNombre(m.nombre))} · ${escaparHtml(ETIQUETA_ROL_PQRS[m.rol] || m.rol)}</p>`
        : '';

    const cuerpoRespuesta = m.respuesta
        ? `
            <div class="pqrs-respuesta">
                <p class="pqrs-respuesta-etiqueta">${mostrarRemitente ? 'Tu respuesta' : 'Respuesta del administrador'}</p>
                <p class="pqrs-respuesta-texto">${escaparHtml(m.respuesta)}</p>
            </div>
        `
        : (mostrarRemitente
            ? `
                <form class="pqrs-form" onsubmit="enviarRespuestaPQRS(event, ${m.id})">
                    <div class="pqrs-caja-mensaje">
                        <textarea id="pqrs-respuesta-${m.id}" placeholder="Escribe tu respuesta..." maxlength="3000" required></textarea>
                        <button type="submit" class="pqrs-btn-enviar" title="Responder" aria-label="Responder">➤</button>
                    </div>
                </form>
            `
            : '<p class="pqrs-pendiente">⏳ Pendiente de respuesta</p>');

    return `
        <div class="pqrs-fila">
            <div class="pqrs-fila-encabezado">
                <span class="pqrs-tipo-pill">${escaparHtml(m.tipo)}</span>
                <button type="button" class="btn-eliminar-pqrs" onclick="confirmarEliminarPQRS(${m.id})">🗑️ Eliminar</button>
                <span class="pqrs-fecha">${escaparHtml(formatearFechaHora(m.fecha))}</span>
            </div>
            ${remitenteHtml}
            <p class="pqrs-mensaje-texto">${escaparHtml(m.mensaje)}</p>
            ${cuerpoRespuesta}
        </div>
    `;
}

// Eliminar un mensaje de PQRS.
// - El propio autor (estudiante/profesor) puede eliminar su mensaje desde "Mis mensajes".
// - Cualquier administrador puede eliminar cualquier mensaje desde "Gestión de PQRS".
// El servidor (DELETE /api/pqrs/:id) valida en ambos casos que la solicitud sea legítima.
function confirmarEliminarPQRS(id) {
    mostrarModalConfirmacion(
        '¿Seguro que quieres eliminar este mensaje?\n\nEsta acción no se puede deshacer.',
        () => eliminarPQRS(id),
        'Eliminar',
        'Cancelar'
    );
}

async function eliminarPQRS(id) {
    try {
        const url = `/api/pqrs/${id}?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url, { method: 'DELETE' });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            mostrarAviso('🗑️ Mensaje eliminado.');
        } else {
            mostrarAviso('⚠️ ' + (resultado.error || 'No se pudo eliminar el mensaje.'));
        }

        // Refresca la lista correcta según quién esté viendo la pantalla
        if (rolActual === 'admin') {
            cargarPQRSAdmin();
        } else {
            cargarMisPQRS();
        }
    } catch (err) {
        console.error('⚠️ Error al eliminar la PQRS:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    }
}

async function cargarMisPQRS() {
    const contenedor = document.getElementById('pqrs-mis-mensajes');
    if (!contenedor) return;

    if (!usuarioActual || !usuarioActual.correo) {
        contenedor.innerHTML = '<p class="texto-proximamente">Inicia sesión para ver tus mensajes.</p>';
        return;
    }

    contenedor.innerHTML = '<p class="texto-proximamente">Cargando...</p>';

    try {
        const url = `/api/pqrs/mis?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();
        const lista = datos.pqrs || [];

        if (lista.length === 0) {
            contenedor.innerHTML = '<p class="texto-proximamente">Aún no has enviado ningún mensaje.</p>';
            return;
        }

        contenedor.innerHTML = lista.map(m => filaPQRSHtml(m, { mostrarRemitente: false })).join('');
    } catch (err) {
        console.error('⚠️ No se pudieron cargar tus mensajes:', err);
        contenedor.innerHTML = '<p class="texto-proximamente">No se pudo cargar. Intenta de nuevo.</p>';
    }
}

// --- Administrador: ver todos los mensajes y responder ---
async function cargarPQRSAdmin() {
    const contenedor = document.getElementById('pqrs-admin-contenido');
    if (!contenedor) return;

    if (!usuarioActual || !usuarioActual.correo) {
        contenedor.innerHTML = '<p class="texto-proximamente">Inicia sesión para ver los mensajes.</p>';
        return;
    }

    contenedor.innerHTML = '<p class="texto-proximamente">Cargando...</p>';

    try {
        const url = `/api/admin/pqrs?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();

        if (!respuesta.ok) {
            pqrsAdminLista = [];
            contenedor.innerHTML = `<p class="texto-proximamente">${escaparHtml(datos.error || 'No se pudo cargar.')}</p>`;
            return;
        }

        pqrsAdminLista = datos.pqrs || [];

        if (pqrsAdminLista.length === 0) {
            contenedor.innerHTML = '<p class="texto-proximamente">Aún no hay mensajes.</p>';
            return;
        }

        const etiquetaCantidad = pqrsAdminLista.length === 1 ? '1 mensaje' : `${pqrsAdminLista.length} mensajes`;
        const pendientes = pqrsAdminLista.filter(m => !m.respuesta).length;
        const etiquetaPendientes = pendientes > 0
            ? ` · ${pendientes === 1 ? '1 pendiente' : pendientes + ' pendientes'}`
            : '';

        contenedor.innerHTML = `
            <p class="historial-etiqueta">${etiquetaCantidad}${etiquetaPendientes}</p>
            <div class="pqrs-lista">
                ${pqrsAdminLista.map(m => filaPQRSHtml(m, { mostrarRemitente: true })).join('')}
            </div>
        `;
    } catch (err) {
        console.error('⚠️ No se pudieron cargar las PQRS:', err);
        contenedor.innerHTML = '<p class="texto-proximamente">No se pudo cargar. Intenta de nuevo.</p>';
    }
}

async function enviarRespuestaPQRS(e, id) {
    e.preventDefault();
    if (enviandoRespuestaPQRS) return;

    const textarea = document.getElementById('pqrs-respuesta-' + id);
    const respuestaTexto = textarea ? textarea.value.trim() : '';
    if (!respuestaTexto) {
        mostrarAviso('Escribe una respuesta antes de enviarla.');
        return;
    }

    enviandoRespuestaPQRS = true;
    const boton = e.target.querySelector('.pqrs-btn-enviar');
    if (boton) boton.disabled = true;

    try {
        const respuesta = await fetch(`/api/admin/pqrs/${id}/responder`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo: usuarioActual.correo, respuesta: respuestaTexto })
        });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            mostrarAviso('📩 Respuesta enviada.');
            cargarPQRSAdmin();
        } else {
            mostrarAviso('⚠️ ' + (resultado.error || 'No se pudo enviar la respuesta.'));
        }
    } catch (err) {
        console.error('⚠️ Error al responder la PQRS:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    } finally {
        enviandoRespuestaPQRS = false;
        if (boton) boton.disabled = false;
    }
}

// ===================================================
// 👩‍🏫 PRUEBAS DE PROFESORES (solo estudiantes)
// ===================================================
// Tiene el botón "Actualizar". Con ocultarCerradas = true
// (lo que pasa al pulsar el botón) las pruebas finalizadas dejan de mostrarse.
// Las pruebas eliminadas por el profesor desaparecen solas porque ya no existen en la base de datos.
async function cargarPruebasProfesores(silencioso = false, ocultarCerradas = false) {
    const contenedor = document.getElementById('lista-pp-contenido');
    if (!contenedor) return;

    if (!usuarioActual || !usuarioActual.correo) {
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Inicia sesión para ver las pruebas.</p></div>';
        return;
    }

    if (!silencioso) {
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Cargando...</p></div>';
    }

    const botonActualizarHtml =
        '<button type="button" class="btn-actualizar-pp" onclick="actualizarPruebasProfesores()">🔄 Actualizar</button>';

    try {
        const url = `/api/pruebas-profesor/disponibles?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();
        let pruebas = datos.pruebas || [];

        // Al pulsar "Actualizar": se recuerdan las pruebas cerradas para no volver a mostrarlas
        if (ocultarCerradas) {
            pruebas.forEach(p => {
                if (p.estado === 'finalizada') pruebasCerradasOcultas.add(p.id);
            });
        }
        pruebas = pruebas.filter(p => !pruebasCerradasOcultas.has(p.id));

        if (pruebas.length === 0) {
            contenedor.innerHTML = `
                <div class="pp-cabecera">${botonActualizarHtml}<p class="historial-etiqueta">0 pruebas</p></div>
                <div class="historial-vacio"><p class="texto-proximamente">Aún no hay pruebas disponibles.</p></div>`;
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
                claseExtra = ' pp-bloqueada';
                accionHtml = `<span class="estado-pill estado-programada">🔒 Solo para ${palabraGrado(p.grados)} ${textoGrados(p.grados)}</span>`;
            } else if (p.estado === 'programada') {
                claseExtra = ' pp-bloqueada';
                accionHtml = `<span class="estado-pill estado-programada">🔒 Se desbloquea el ${escaparHtml(inicio)} a las ${escaparHtml(horaInicio)}</span>`;
            } else if (p.estado === 'finalizada') {
                claseExtra = ' pp-bloqueada';
                accionHtml = '<span class="estado-pill estado-finalizada">⏹ Cerrada</span>';
            } else {
                accionHtml = `<button class="btn-presentar-pp" onclick="confirmarPresentarPP(${p.id})">Presentar</button>`;
            }

            return `
                <div class="pp-fila ${claseTemaMateria(p.materia)}${claseExtra}">
                    <div class="pp-info">
                        <p class="pp-titulo">${escaparHtml(p.titulo)}</p>
                        <p class="pp-meta">
                            <span class="historial-nivel-pill pill-materia">${escaparHtml(p.materia)}</span>
                            Prof. ${escaparHtml(formatearNombre(p.nombre_profesor))} · ${textoPreguntas}
                        </p>
                        <p class="pp-meta">${p.grados && p.grados.length ? 'Para ' + palabraGrado(p.grados) + ' ' + textoGrados(p.grados) + ' · ' : ''}Disponible del ${escaparHtml(inicio)} (${escaparHtml(horaInicio)}) al ${escaparHtml(fin)} (${escaparHtml(horaFin)})</p>
                    </div>
                    <div class="pp-accion">${accionHtml}</div>
                </div>
            `;
        }).join('');

        const etiquetaCantidad = pruebas.length === 1 ? '1 prueba' : `${pruebas.length} pruebas`;

        contenedor.innerHTML = `
            <div class="pp-cabecera">
                ${botonActualizarHtml}
                <p class="historial-etiqueta">${etiquetaCantidad}</p>
            </div>
            <div class="historial-lista">${filasHtml}</div>
        `;
    } catch (err) {
        console.error('⚠️ No se pudieron cargar las pruebas de profesores:', err);
        contenedor.innerHTML = `
            <div class="pp-cabecera">${botonActualizarHtml}</div>
            <div class="historial-vacio"><p class="texto-proximamente">No se pudo cargar. Intenta de nuevo.</p></div>`;
    }
}

// Se llama al pulsar el botón "Actualizar"
function actualizarPruebasProfesores() {
    cargarPruebasProfesores(false, true);
}

// Muestra la advertencia de fraude antes de presentar una prueba de profesor.
// Solo al pulsar "Continuar" se abre realmente la prueba (iniciarPruebaPP).
function confirmarPresentarPP(idPrueba) {
    mostrarModalConfirmacion(
        '⚠️ Cualquier intento de fraude anulará la prueba.',
        () => iniciarPruebaPP(idPrueba),
        'Continuar',
        'Cancelar'
    );
}

// --- Entorno para presentar una prueba de profesor ---
let ppPrueba = null;
let ppPreguntas = [];
let ppIndice = 0;
let ppRespuestas = {};
let ppEnviando = false;

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
// 📊 PUNTAJE ACTUAL (solo estudiantes)
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

        const nivelReciente = puntajes[0].nivel;
        const pruebaReciente = puntajes[0].prueba || 1;

        const urlNivel = `/api/nivel-aprobado?correo=${encodeURIComponent(usuarioActual.correo)}&nivel=${encodeURIComponent(nivelReciente)}&prueba=${pruebaReciente}`;
        const respuestaNivel = await fetch(urlNivel);
        const datosNivel = await respuestaNivel.json();

        const sesiones = datosNivel.sesiones || [];
        const totalCorrectas = datosNivel.totalCorrectas || 0;
        const totalPreguntas = datosNivel.totalPreguntas || 0;
        const porcentaje = totalPreguntas > 0 ? Math.round((totalCorrectas / totalPreguntas) * 100) : 0;

        const ultimaDeEseNivel = puntajes.find(p => p.nivel === nivelReciente && (p.prueba || 1) === pruebaReciente);
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

        // Mínimo para pasar de nivel: se cuentan las respuestas correctas de todas
        // las pruebas del nivel (el servidor ya hace la suma).
        let minimoHtml = '';
        const siguienteNivel = obtenerSiguienteNivel(nivelReciente);
        if (siguienteNivel && datosNivel.minimoCorrectas) {
            minimoHtml = `<p class="puntaje-minimo">Para pasar al nivel ${siguienteNivel} se necesitan ${datosNivel.minimoCorrectas} de ${datosNivel.totalNivel} respuestas correctas sumando todas las pruebas del nivel ${nivelReciente}. Llevas ${datosNivel.correctasNivel}.</p>`;
        }

        contenedor.innerHTML = `
            <p class="puntaje-etiqueta">Puntaje actual</p>
            <div class="puntaje-nivel-pill">Nivel ${nivelReciente} · Prueba ${pruebaReciente}</div>
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
// 📦 HISTORIAL DE PUNTAJES (solo estudiantes)
// ===================================================
let historialPuntajesActuales = [];
let historialModoMultiple = false;
let historialSeleccionados = new Set();
let eliminandoHistorial = false;

async function cargarHistorialPuntajes() {
    const contenedor = document.getElementById('historial-puntajes-contenido');
    if (!contenedor) return;

    // Al entrar o recargar siempre se sale del modo selección
    historialModoMultiple = false;
    historialSeleccionados = new Set();

    if (!usuarioActual || !usuarioActual.correo) {
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Inicia sesión para ver tu historial.</p></div>';
        return;
    }

    contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Cargando...</p></div>';

    try {
        const url = `/api/mis-puntajes?correo=${encodeURIComponent(usuarioActual.correo)}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();
        historialPuntajesActuales = datos.puntajes || [];

        if (historialPuntajesActuales.length === 0) {
            contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">Aún no has presentado ninguna prueba.</p></div>';
            return;
        }

        dibujarHistorialPuntajes();
    } catch (err) {
        console.error('⚠️ No se pudo cargar el historial de puntajes:', err);
        contenedor.innerHTML = '<div class="historial-vacio"><p class="texto-proximamente">No se pudo cargar tu historial. Intenta de nuevo.</p></div>';
    }
}

function filaHistorialHtml(p) {
    const porcentaje = p.total > 0 ? Math.round((p.correctas / p.total) * 100) : 0;
    const fecha = new Date(p.fecha);
    const fechaValida = !isNaN(fecha.getTime());
    const fechaTexto = fechaValida
        ? fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
        : '';
    const horaTexto = fechaValida
        ? fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
        : '';

    // Tiempo que tardó el estudiante en presentar la sesión
    const duracionTexto = formatearDuracion(p.duracion_segundos);
    const duracionHtml = duracionTexto
        ? `<span class="historial-duracion">⏱️ ${escaparHtml(duracionTexto)}</span>`
        : '';

    const marcado = historialSeleccionados.has(p.id);
    const casilla = historialModoMultiple
        ? `<span class="historial-check" role="checkbox" aria-checked="${marcado}"></span>`
        : '';
    const clases = 'historial-fila' +
        (historialModoMultiple ? ' modo-seleccion' : '') +
        (marcado ? ' seleccionada' : '');
    const clickFila = historialModoMultiple ? ` onclick="alternarSeleccionHistorial(${p.id})"` : '';

    // En modo selección se oculta el menú ⋮
    const menuMaterias = historialModoMultiple ? '' : `
        <div class="historial-detalle-wrap">
            <button class="btn-detalle-historial" title="Ver materias" onclick="toggleMenuMaterias(event, ${p.id})">⋮</button>
            <div class="dropdown-materias oculto" id="dropdown-materias-${p.id}"></div>
        </div>`;

    return `
        <div class="${clases}" data-id="${p.id}"${clickFila}>
            ${casilla}
            <div class="historial-nivel-pill">Nivel ${p.nivel} · Prueba ${p.prueba || 1} · Sesión ${p.sesion}</div>
            <div class="historial-resultado-col">
                <div class="historial-resultado">
                    <span class="historial-numero">${p.correctas}/${p.total}</span>
                    <span class="historial-porcentaje">${porcentaje}%</span>
                </div>
                ${duracionHtml}
            </div>
            <div class="historial-fecha">${fechaValida ? (fechaTexto + ' · ' + horaTexto) : ''}</div>
            ${menuMaterias}
        </div>
    `;
}

function dibujarHistorialPuntajes() {
    const contenedor = document.getElementById('historial-puntajes-contenido');
    if (!contenedor) return;

    const total = historialPuntajesActuales.length;
    const etiquetaCantidad = total === 1 ? '1 prueba presentada' : `${total} pruebas presentadas`;

    contenedor.innerHTML = `
        <div class="registros-barra">
            <div id="historial-acciones" class="resultados-acciones"></div>
            <p class="historial-etiqueta">${etiquetaCantidad}</p>
            <span></span>
        </div>
        <div class="historial-lista">${historialPuntajesActuales.map(filaHistorialHtml).join('')}</div>
    `;

    renderizarBarraHistorial();
}

function renderizarBarraHistorial() {
    const cont = document.getElementById('historial-acciones');
    if (!cont) return;

    if (!historialModoMultiple) {
        cont.innerHTML = '<button type="button" class="btn-eliminacion-multiple" onclick="activarEliminacionMultipleHistorial()">☑️ Eliminación múltiple</button>';
        return;
    }

    const n = historialSeleccionados.size;
    cont.innerHTML = `
        <button type="button" class="btn-seleccionar-todos" onclick="seleccionarTodosHistorial()">Seleccionar todos</button>
        <button type="button" class="btn-eliminar-seleccion" onclick="confirmarEliminarSeleccionHistorial()" ${n === 0 ? 'disabled' : ''}>🗑️ Eliminar (${n})</button>
        <button type="button" class="btn-cancelar-seleccion" onclick="cancelarEliminacionMultipleHistorial()">Cancelar</button>
    `;
}

function activarEliminacionMultipleHistorial() {
    historialModoMultiple = true;
    historialSeleccionados = new Set();
    dibujarHistorialPuntajes();
}

function cancelarEliminacionMultipleHistorial() {
    historialModoMultiple = false;
    historialSeleccionados = new Set();
    dibujarHistorialPuntajes();
}

// Actualiza casillas y contador sin volver a dibujar toda la lista
function pintarSeleccionHistorial() {
    document.querySelectorAll('#historial-puntajes-contenido .historial-fila[data-id]').forEach(fila => {
        const marcado = historialSeleccionados.has(Number(fila.dataset.id));
        fila.classList.toggle('seleccionada', marcado);
        const casilla = fila.querySelector('.historial-check');
        if (casilla) casilla.setAttribute('aria-checked', String(marcado));
    });
    renderizarBarraHistorial();
}

function alternarSeleccionHistorial(id) {
    if (!historialModoMultiple) return;

    if (historialSeleccionados.has(id)) historialSeleccionados.delete(id);
    else historialSeleccionados.add(id);

    pintarSeleccionHistorial();
}

// Marca todos; si ya estaban todos marcados, los desmarca
function seleccionarTodosHistorial() {
    const ids = historialPuntajesActuales.map(p => p.id);
    const todosMarcados = ids.length > 0 && ids.every(id => historialSeleccionados.has(id));

    ids.forEach(id => {
        if (todosMarcados) historialSeleccionados.delete(id);
        else historialSeleccionados.add(id);
    });

    pintarSeleccionHistorial();
}

function confirmarEliminarSeleccionHistorial() {
    const n = historialSeleccionados.size;
    if (n === 0) return;

    let mensaje = n === 1
        ? '¿Seguro que quieres eliminar este resultado?'
        : '¿Seguro que quieres eliminar los ' + n + ' resultados seleccionados?';
    mensaje += '\n\nOjo: si borras una sesión de tu intento actual, podrás presentarla de nuevo y tu puntaje, tu avance de nivel y el ranking se recalcularán.';
    mensaje += '\n\nEsta acción no se puede deshacer.';

    mostrarModalConfirmacion(mensaje, eliminarHistorialSeleccionado, 'Eliminar', 'Cancelar');
}

async function eliminarHistorialSeleccionado() {
    if (eliminandoHistorial || historialSeleccionados.size === 0) return;
    eliminandoHistorial = true;

    try {
        const respuesta = await fetch('/api/mis-puntajes/eliminar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                correo: usuarioActual.correo,
                ids: Array.from(historialSeleccionados)
            })
        });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            const n = resultado.eliminados;
            mostrarAviso('🗑️ ' + (n === 1 ? 'Se eliminó 1 resultado.' : 'Se eliminaron ' + n + ' resultados.'));
        } else {
            mostrarAviso('⚠️ ' + (resultado.error || 'No se pudieron eliminar los resultados.'));
        }
        cargarHistorialPuntajes();   // vuelve a cargar y sale del modo selección
    } catch (err) {
        console.error('⚠️ Error al eliminar el historial:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    } finally {
        eliminandoHistorial = false;
    }
}

// ===================================================
// ⋮ MENÚ DE MATERIAS
// ===================================================
async function toggleMenuMaterias(event, resultadoId) {
    event.stopPropagation();
    const dropdown = document.getElementById('dropdown-materias-' + resultadoId);
    if (!dropdown) return;

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

document.addEventListener('click', () => {
    document.querySelectorAll('.dropdown-materias').forEach(d => d.classList.add('oculto'));
});

// ===================================================
// 📖 DETALLE DE PREGUNTAS POR MATERIA
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
// 🚀 RANKING (solo estudiantes)
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
                cont.innerHTML = '<p class="texto-proximamente">Aún no hay estudiantes que hayan presentado las 3 pruebas de este nivel.</p>';
                return;
            }

            cont.innerHTML = lista.map((e, i) => {
                const pos = i + 1;
                const etiquetaPos = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : pos + '.';

                const pruebasHtml = (e.pruebas || []).map(p =>
                    `<span class="ranking-chip">P${p.prueba} ${p.correctas}/${p.total}</span>`
                ).join('');

                return `
                    <div class="ranking-fila ${pos <= 3 ? 'ranking-podio' : ''}">
                        <div class="ranking-linea-1">
                            <span class="ranking-posicion">${etiquetaPos}</span>
                            <span class="ranking-chip ranking-chip-nombre">${escaparHtml(formatearNombre(e.nombre))}</span>
                            <span class="ranking-chip">${escaparHtml(formatearGrado(e.grado))}</span>
                            <span class="ranking-chip">Puntaje global ${e.puntaje}/500</span>
                        </div>
                        <div class="ranking-linea-2">${pruebasHtml}</div>
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

function confirmarCerrarSesion() {
    mostrarModalConfirmacion('¿Estás seguro de que quieres cerrar sesión?', () => {
        cerrarSesion();
    });
}

function reiniciarVistasEstudiante() {
    document.getElementById('vista-prueba').classList.add('oculto');
    document.getElementById('vista-sesiones').classList.add('oculto');
    const vistaPruebasNivel = document.getElementById('vista-pruebas-nivel');
    if (vistaPruebasNivel) vistaPruebasNivel.classList.add('oculto');
    document.getElementById('vista-niveles').classList.remove('oculto');

    const btnRepetir = document.getElementById('btn-repetir-nivel');
    if (btnRepetir) btnRepetir.classList.add('oculto');

    desbloquearVentanaSesion(0, 1);
    bloquearVentanaSesion(1);

    nivelActual = 'B';
    pruebaActual = 1;
    sesionActual = 1;
    indiceMateriaActual = 0;
    indicePreguntaActual = 0;
    opcionSeleccionada = null;
    respuestasMap = {};
    cacheMaterias = {};
}

function cerrarSesion() {
    document.getElementById('pantalla-app').classList.add('oculto');
    usuarioActual = {};
    reiniciarVistasEstudiante();
    pruebasCreadas = [];
    pruebasAlmacenadas = [];
    gruposAdmin = [];
    adminNivelSel = null;
    adminPruebaSel = null;
    pruebaPorSubir = null;
    registrosTipoActual = null;
    registrosFilasActuales = [];
    pqrsAdminLista = [];
    pruebasCerradasOcultas = new Set();

    salirDePruebaPP();
    cerrarModalSeleccion();
    cerrarModalFechas();
    cerrarModalPromedio();
    cerrarModalAgregarUsuario();
    const cpPreguntas = document.getElementById('cp-preguntas');
    if (cpPreguntas) cpPreguntas.innerHTML = '';
    const cpForm = document.getElementById('form-crear-pregunta');
    if (cpForm) cpForm.reset();
    restaurarModoCrear();

    const registrosContenido = document.getElementById('registros-contenido');
    if (registrosContenido) registrosContenido.innerHTML = '';

    const almacenadasContenido = document.getElementById('almacenadas-contenido');
    if (almacenadasContenido) almacenadasContenido.innerHTML = '';

    const pqrsMisMensajes = document.getElementById('pqrs-mis-mensajes');
    if (pqrsMisMensajes) pqrsMisMensajes.innerHTML = '';
    const pqrsAdminContenido = document.getElementById('pqrs-admin-contenido');
    if (pqrsAdminContenido) pqrsAdminContenido.innerHTML = '';
    const formPqrs = document.getElementById('form-pqrs');
    if (formPqrs) formPqrs.reset();

    // Se vuelve a mostrar el fondo flotante de las materias
    const fondoFlotante = document.getElementById('fondo-flotante');
    if (fondoFlotante) fondoFlotante.classList.remove('oculto');

    mostrarFormulario(rolActual);
}

// ===================================================
// UTILIDADES DE FORMULARIO
// ===================================================
function limpiarFormularioCompleto() {
    // Los formularios que ya no existan en el HTML (p. ej. el registro de admin) se ignoran
    ['form-registro', 'form-login', 'form-ingreso-codigo'].forEach(id => {
        const form = document.getElementById(id);
        if (form) form.reset();
    });

    // Todos los campos ocultos (contraseña / código único) vuelven a ocultarse
    ['reg-pass', 'log-pass', 'log-codigo', 'ing-codigo'].forEach(id => {
        const campo = document.getElementById(id);
        if (campo) campo.type = 'password';
    });

    document.querySelectorAll('.btn-ojo').forEach(ojo => ojo.innerText = '👁️');

    const campoExtra = document.getElementById('campo-extra');
    if (campoExtra) campoExtra.innerHTML = '';
}

function alternarPassword(inputId, elementoOjo) {
    const passInput = document.getElementById(inputId);
    if (!passInput) return;
    if (passInput.type === 'password') {
        passInput.type = 'text';
        elementoOjo.innerText = '🔒';
    } else {
        passInput.type = 'password';
        elementoOjo.innerText = '👁️';
    }
}

// ===================================================
// PETICIONES AL SERVIDOR (INGRESO)
// El registro de administradores se eliminó de la app: los nuevos admin los
// agrega otro administrador desde "Base de datos registros".
// ===================================================
async function enviarIngresoCodigo(e) {
    e.preventDefault();
    const codigo = document.getElementById('ing-codigo').value.trim();

    if (!codigo) {
        mostrarAviso('Escribe tu código único.');
        return;
    }

    try {
        const respuesta = await fetch('/api/ingreso-codigo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codigo_unico: codigo, rol: rolActual })
        });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            mostrarNiveles(resultado.usuario);
        } else {
            mostrarAviso('⚠️ Error al ingresar:\n' + resultado.error);
        }
    } catch (err) {
        console.error('⚠️ Error al ingresar con código:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    }
}

// Login del administrador: correo + contraseña + código único
async function enviarDatosLogin(e) {
    e.preventDefault();
    const correo = document.getElementById('log-correo').value.trim();
    const contrasena = document.getElementById('log-pass').value;
    const campoCodigo = document.getElementById('log-codigo');
    const codigo_unico = campoCodigo ? campoCodigo.value.trim() : '';

    if (!codigo_unico) {
        mostrarAviso('Escribe tu código único.');
        return;
    }

    try {
        const respuesta = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo, contrasena, codigo_unico, rol: rolActual })
        });

        const resultado = await respuesta.json();
        if (respuesta.ok) {
            mostrarNiveles(resultado.usuario);
        } else {
            mostrarAviso('⚠️ Error al ingresar:\n' + resultado.error);
        }
    } catch (err) {
        console.error('⚠️ Error al iniciar sesión:', err);
        mostrarAviso('⚠️ No se pudo conectar con el servidor.');
    }
}

// ===================================================
// PANTALLA DE NIVELES / PRUEBAS / SESIONES (solo estudiantes)
//
// Flujo: NIVEL (B/A/S) -> lista de PRUEBAS del nivel (Prueba 1, 2, 3...)
//        -> SESIONES 1 y 2 de esa prueba -> preguntas.
// ===================================================
let pruebaActual = 1;

function entrarPrueba(nivel) {
    const circulo = document.getElementById('nivel-' + nivel);
    if (circulo.classList.contains('bloqueado')) {
        mostrarAviso('🔒 Este nivel está bloqueado. Debes aprobar el nivel anterior para desbloquearlo.');
        return;
    }
    nivelActual = nivel;
    mostrarPruebasDeNivel(nivel);
}

// Lista de pruebas del nivel elegido ("PRUEBAS DE NIVEL B": Prueba 1, Prueba 2, Prueba 3...)
async function mostrarPruebasDeNivel(nivel) {
    document.getElementById('vista-niveles').classList.add('oculto');
    document.getElementById('vista-sesiones').classList.add('oculto');
    document.getElementById('vista-pruebas-nivel').classList.remove('oculto');
    document.getElementById('titulo-pruebas-nivel').innerText = 'PRUEBAS DE NIVEL ' + nivel;

    const lista = document.getElementById('lista-pruebas-nivel');
    lista.innerHTML = '<p class="texto-proximamente">Cargando...</p>';

    try {
        const respuesta = await fetch('/api/pruebas-nivel?nivel=' + encodeURIComponent(nivel));
        const datos = await respuesta.json();

        lista.innerHTML = (datos.pruebas || []).map(p => {
            const vacia = p.total === 0;
            return `
                <button type="button" class="btn-prueba-nivel" ${vacia ? 'disabled' : ''} onclick="abrirPruebaNivel(${p.prueba})">
                    <span class="prueba-nivel-titulo">PRUEBA ${p.prueba}</span>
                    <span class="prueba-nivel-meta">${vacia ? 'Próximamente' : textoCantidadPreguntas(p.total)}</span>
                </button>
            `;
        }).join('');
    } catch (err) {
        console.error('⚠️ No se pudieron cargar las pruebas del nivel:', err);
        lista.innerHTML = '<p class="texto-proximamente">No se pudo cargar. Intenta de nuevo.</p>';
    }
}

function abrirPruebaNivel(numero) {
    pruebaActual = numero;
    mostrarSesiones(nivelActual);
}

function volverAPruebasNivel() {
    mostrarPruebasDeNivel(nivelActual);
}

function mostrarSesiones(nivel) {
    document.getElementById('vista-niveles').classList.add('oculto');
    document.getElementById('vista-pruebas-nivel').classList.add('oculto');
    document.getElementById('vista-sesiones').classList.remove('oculto');
    document.getElementById('titulo-nivel-sesiones').innerText = 'Nivel ' + nivel + ' · Prueba ' + pruebaActual;

    actualizarConteosPreguntas(nivel);
    sincronizarEstadoSesiones(nivel);
}

async function actualizarConteosPreguntas(nivel) {
    const ventanas = document.querySelectorAll('.ventana-sesion');

    try {
        await Promise.all([1, 2].map(async (sesion, i) => {
            const ventana = ventanas[i];
            if (!ventana) return;

            const url = `/api/conteo-preguntas?nivel=${encodeURIComponent(nivel)}&prueba=${pruebaActual}&sesion=${sesion}`;
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

// Vuelve a la pantalla de los tres niveles (B, A, S)
function volverANiveles() {
    document.getElementById('vista-sesiones').classList.add('oculto');
    const vistaPruebasNivel = document.getElementById('vista-pruebas-nivel');
    if (vistaPruebasNivel) vistaPruebasNivel.classList.add('oculto');
    document.getElementById('vista-niveles').classList.remove('oculto');
}

// ===================================================
// BLOQUEO / DESBLOQUEO DE LAS VENTANAS DE SESIÓN
// ===================================================
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

// El botón "Iniciar Sesión X" no llama a iniciarSesion() directamente;
// primero pasa por confirmarIniciarSesion(), que muestra el aviso de fraude,
// y solo si el estudiante pulsa "Continuar" se inicia la sesión.
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
        boton.onclick = () => confirmarIniciarSesion(numeroSesion);
    }
}

// Muestra la advertencia de fraude antes de iniciar una sesión de
// nivel (B/A/S). Solo al pulsar "Continuar" se abre realmente la sesión.
function confirmarIniciarSesion(numero) {
    mostrarModalConfirmacion(
        '⚠️ Cualquier intento de fraude anulará la prueba.',
        () => iniciarSesion(numero),
        'Continuar',
        'Cancelar'
    );
}

async function sesionCompletada(nivel, sesion) {
    const url = `/api/sesion-completada?correo=${encodeURIComponent(usuarioActual.correo)}&nivel=${encodeURIComponent(nivel)}&prueba=${pruebaActual}&sesion=${sesion}`;
    const datos = await (await fetch(url)).json();
    return !!datos.completada;
}

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
// 🔄 REPETIR PRUEBA
// ===================================================
function confirmarRepetirNivel() {
    mostrarModalConfirmacion(
        '¿Deseas repetir esta prueba? Se bloqueará la Sesión 2 y podrás presentar la Sesión 1 nuevamente.\nTu historial y tu puntaje actual no se perderán.',
        () => repetirNivel()
    );
}

async function repetirNivel() {
    try {
        const respuesta = await fetch('/api/repetir-nivel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo: usuarioActual.correo, nivel: nivelActual, prueba: pruebaActual })
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
function obtenerSiguienteNivel(nivel) {
    if (nivel === 'B') return 'A';
    if (nivel === 'A') return 'S';
    return null;
}

// Sin indicar la prueba, el servidor suma las respuestas correctas de todas las
// pruebas del nivel y las compara con el mínimo que fijó el administrador.
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

function desbloquearNivel(nivel) {
    const circulo = document.getElementById('nivel-' + nivel);
    if (circulo) circulo.classList.remove('bloqueado');
    const msg = document.getElementById('msg-' + nivel);
    if (msg) msg.innerText = '';
}

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

function mostrarModalDesbloqueoNivel(nivel) {
    const mensaje = '🎉 ¡Felicidades, lo has conseguido!\nEl nivel ' + nivel +
        ' se ha desbloqueado con éxito.';

    mostrarAvisoSinBotones(mensaje);
}

// ===================================================
// ENTORNO DE LA PRUEBA (una materia a la vez, preguntas reales)
// ===================================================
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
let respuestasMap = {};
let cacheMaterias = {};

// Momento (en milisegundos) en que el estudiante empezó la sesión.
// Con esto se calcula cuánto tardó y se envía al servidor al calificar.
let inicioSesionMs = 0;

// ===================================================
// ⏱️ TEMPORIZADOR DE LA PRUEBA
// Tiempo total = (preguntas de la sesión × 2 min) + 5 min extra.
// Al llegar a 00:00 la sesión se envía sola con lo que se alcanzó a responder.
// ===================================================
const SEGUNDOS_POR_PREGUNTA = 2 * 60;   // 2 minutos por pregunta
const SEGUNDOS_EXTRA = 5 * 60;          // 5 minutos adicionales

let intervaloTemporizador = null;
let finTemporizador = 0;                // momento (ms) en que se acaba el tiempo
let tokenTemporizador = 0;              // evita que una respuesta tardía arranque un reloj viejo
let tiempoAgotado = false;

function textoTemporizador(segundos) {
    const m = Math.floor(segundos / 60);
    const s = segundos % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function detenerTemporizador() {
    clearInterval(intervaloTemporizador);
    intervaloTemporizador = null;
    tokenTemporizador++;
    const el = document.getElementById('prueba-temporizador');
    if (el) {
        el.classList.remove('poco-tiempo');
        el.textContent = '--:--';
    }
}

function pintarTemporizador() {
    const el = document.getElementById('prueba-temporizador');
    if (!el) return;

    const restante = Math.max(0, Math.ceil((finTemporizador - Date.now()) / 1000));
    el.textContent = textoTemporizador(restante);
    el.classList.toggle('poco-tiempo', restante <= 60);

    if (restante <= 0) {
        clearInterval(intervaloTemporizador);
        intervaloTemporizador = null;
        finalizarPorTiempo();
    }
}

// Calcula el tiempo según las preguntas de la sesión y arranca el reloj
async function arrancarTemporizadorSesion() {
    detenerTemporizador();
    const token = tokenTemporizador;
    tiempoAgotado = false;

    const btnSiguiente = document.getElementById('btn-siguiente-materia');
    if (btnSiguiente) btnSiguiente.disabled = false;

    try {
        const url = `/api/conteo-preguntas?nivel=${encodeURIComponent(nivelActual)}&prueba=${pruebaActual}&sesion=${sesionActual}`;
        const datos = await (await fetch(url)).json();
        const totalPreguntas = Object.values(datos.conteo || {}).reduce((a, n) => a + Number(n), 0);

        // Si el estudiante salió mientras cargaba, no se arranca nada
        if (token !== tokenTemporizador || totalPreguntas === 0) return;

        const segundos = totalPreguntas * SEGUNDOS_POR_PREGUNTA + SEGUNDOS_EXTRA;
        finTemporizador = Date.now() + segundos * 1000;
        pintarTemporizador();
        intervaloTemporizador = setInterval(pintarTemporizador, 250);
    } catch (err) {
        console.error('⚠️ No se pudo iniciar el temporizador:', err);
    }
}

// Se acabó el tiempo: las preguntas sin responder cuentan como incorrectas
async function finalizarPorTiempo() {
    if (tiempoAgotado) return;
    tiempoAgotado = true;

    const btnSiguiente = document.getElementById('btn-siguiente-materia');
    if (btnSiguiente) btnSiguiente.disabled = true;

    // Se cargan las materias que el estudiante todavía no había abierto
    // para que sus preguntas se registren como sin responder
    const materias = materiasPorSesion[sesionActual];
    for (let i = 0; i < materias.length; i++) {
        try {
            if (!cacheMaterias[i]) {
                const url = `/api/preguntas?nivel=${nivelActual}&prueba=${pruebaActual}&sesion=${sesionActual}` +
                    `&materia=${encodeURIComponent(materias[i].nombre)}` +
                    `&correo=${encodeURIComponent(usuarioActual.correo)}`;
                const datos = await (await fetch(url)).json();
                cacheMaterias[i] = datos.preguntas || [];
            }
            cacheMaterias[i].forEach(p => {
                if (!respuestasMap[p.id]) respuestasMap[p.id] = '';
            });
        } catch (err) {
            console.error('⚠️ No se pudieron cargar las preguntas pendientes:', err);
        }
    }

    if (Object.keys(respuestasMap).length === 0) {
        salirDePrueba();
        mostrarAviso('⏰ Se acabó el tiempo.');
        return;
    }

    await finalizarSesion();
}

function iniciarSesion(numero) {
    sesionActual = numero;
    indiceMateriaActual = 0;
    indicePreguntaActual = 0;
    opcionSeleccionada = null;
    respuestasMap = {};
    cacheMaterias = {};

    // Se anota el momento exacto en que empieza la sesión
    inicioSesionMs = Date.now();

    document.getElementById('vista-sesiones').classList.add('oculto');
    document.getElementById('vista-prueba').classList.remove('oculto');

    cargarMateriaActual();
    arrancarTemporizadorSesion();   // arranca el reloj de la sesión
}

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

function actualizarImagenPregunta(rutaImagen) {
    actualizarImagenEn('prueba-imagen-wrap', 'prueba-imagen', rutaImagen);
}

async function cargarMateriaActual(indicePreguntaInicial = 0) {
    const materias = materiasPorSesion[sesionActual];
    const materia = materias[indiceMateriaActual];

    const vistaPrueba = document.getElementById('vista-prueba');
    vistaPrueba.className = 'vista-prueba ' + materia.tema;
    document.getElementById('prueba-materia-nombre').innerText = materia.nombre;

    if (cacheMaterias[indiceMateriaActual]) {
        preguntasMateriaActual = cacheMaterias[indiceMateriaActual];
    } else {
        const url = `/api/preguntas?nivel=${nivelActual}&prueba=${pruebaActual}&sesion=${sesionActual}` +
            `&materia=${encodeURIComponent(materia.nombre)}` +
            `&correo=${encodeURIComponent(usuarioActual.correo)}`;
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

function actualizarBotonAnterior() {
    const btnAnterior = document.getElementById('btn-anterior-pregunta');
    if (!btnAnterior) return;
    const esPrimeraPregunta = indiceMateriaActual === 0 && indicePreguntaActual === 0;
    btnAnterior.classList.toggle('oculto', esPrimeraPregunta);
}

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

async function preguntaAnterior() {
    if (indicePreguntaActual > 0) {
        indicePreguntaActual--;
        renderizarPregunta();
    } else if (indiceMateriaActual > 0) {
        indiceMateriaActual--;
        await cargarMateriaActual('ultima');
    }
}

async function finalizarSesion() {
    const respuestasSesion = Object.keys(respuestasMap).map(id => ({
        pregunta_id: parseInt(id, 10),
        opcion_elegida: respuestasMap[id]
    }));

    // Tiempo que tardó el estudiante en presentar la sesión (en segundos)
    const duracionSegundos = inicioSesionMs > 0
        ? Math.max(0, Math.round((Date.now() - inicioSesionMs) / 1000))
        : null;

    let respuesta;
    let resultado;
    try {
        respuesta = await fetch('/api/calificar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                respuestas: respuestasSesion,
                correo: usuarioActual.correo,
                nombre: usuarioActual.nombre,
                nivel: nivelActual,
                prueba: pruebaActual,
                sesion: sesionActual,
                duracion_segundos: duracionSegundos
            })
        });
        resultado = await respuesta.json();
    } catch (err) {
        console.error('⚠️ Error al enviar la sesión:', err);
        // El estudiante se queda en la prueba con sus respuestas y puede volver a pulsar "Finalizar"
        const btnSiguiente = document.getElementById('btn-siguiente-materia');
        if (btnSiguiente) btnSiguiente.disabled = false;
        mostrarAviso('⚠️ No se pudo conectar con el servidor.\n\nRevisa tu internet y pulsa "Finalizar sesión" de nuevo. Tus respuestas siguen guardadas en esta pantalla.');
        return;
    }

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

        // Si terminó por tiempo, el mensaje lo indica
        const mensajeResultado = (tiempoAgotado ? '⏰ Se acabó el tiempo.\n\n' : '') +
            '🎉 Terminaste la Sesión ' + sesionActual + '.\n\nResultado: ' +
            resultado.correctas + ' de ' + resultado.total + ' correctas.';

        if (nivelDesbloqueado) {
            mostrarAviso(mensajeResultado, () => {
                mostrarModalDesbloqueoNivel(nivelDesbloqueado);
            });
        } else {
            mostrarAviso(mensajeResultado);
        }
    } else {
        const btnSiguiente = document.getElementById('btn-siguiente-materia');
        if (btnSiguiente) btnSiguiente.disabled = false;
        mostrarAviso('⚠️ Error al calificar:\n' + (resultado.error || 'Error desconocido.') +
            '\n\nTus respuestas siguen en pantalla. Corrige el problema e inténtalo de nuevo.');
    }
}

function confirmarSalirPrueba() {
    mostrarModalConfirmacion(
        'Si sales de la prueba perderás el progreso.',
        () => salirDePrueba(),
        'Salir',
        'Cancelar'
    );
}

function salirDePrueba() {
    detenerTemporizador();   // detiene el reloj al salir o terminar
    document.getElementById('vista-prueba').classList.add('oculto');
    document.getElementById('vista-sesiones').classList.remove('oculto');

    indiceMateriaActual = 0;
    indicePreguntaActual = 0;
    opcionSeleccionada = null;
    respuestasMap = {};
    cacheMaterias = {};
}

// ===================================================
// 📥 SUBIR ARCHIVO EXCEL (Base de datos registros - admin)
//
//  1) Lee TODAS las hojas del libro.
//  2) Busca la fila de encabezados en las primeras 15 filas (los archivos
//     traen títulos como "GRADO: 9-A" arriba).
//  3) Si la celda de Grado está vacía, usa el nombre de la hoja ("10-A").
//  4) Ignora filas vacías y la columna de numeración (N°).
// ===================================================
function elegirArchivoRegistros() {
    const input = document.getElementById('registros-archivo');
    if (input) input.click();
}

// Quita tildes, mayúsculas y símbolos: "Código Único " -> "codigo unico"
function limpiarClaveExcel(k) {
    return String(k === null || k === undefined ? '' : k).trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ').trim();
}

// Lee un libro de Excel y devuelve { filas, encabezadosVistos }.
function leerFilasDelLibro(libro, tipo) {
    const filas = [];
    const encabezadosVistos = [];

    // Palabras que debe tener la fila de encabezados para reconocerla
    const palabrasClave = tipo === 'administradores' ? ['correo'] : ['codigo'];

    libro.SheetNames.forEach(nombreHoja => {
        const hoja = libro.Sheets[nombreHoja];
        const matriz = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', blankrows: true });
        // La hoja puede empezar en una fila distinta de la 1: se ajusta el número real de fila
        const desfase = hoja['!ref'] ? XLSX.utils.decode_range(hoja['!ref']).s.r : 0;

        // 1) Buscar la fila de encabezados (la primera que tenga "nombre" y "codigo"/"correo")
        let filaEnc = -1;
        for (let i = 0; i < Math.min(matriz.length, 15); i++) {
            const claves = matriz[i].map(limpiarClaveExcel);
            const tieneNombre = claves.some(c => c.includes('nombre') || c.includes('apellido'));
            const tieneClave = claves.some(c => palabrasClave.some(p => c.includes(p)));
            if (tieneNombre && tieneClave) { filaEnc = i; break; }
        }
        if (filaEnc === -1) {
            if (matriz.length > 0) encabezadosVistos.push(nombreHoja + ': ' + matriz[0].map(limpiarClaveExcel).filter(Boolean).join(', '));
            return; // esta hoja no tiene la estructura esperada
        }

        const enc = matriz[filaEnc].map(limpiarClaveExcel);
        const col = palabras => enc.findIndex(c => c && palabras.some(p => c.includes(p)));
        const cNombre = col(['nombre']);
        const cApellido = col(['apellido']);
        const cCodigo = col(['codigo']);
        const cGrado = col(['grado', 'curso']);
        const cCorreo = col(['correo']);
        const cClave = col(['contrasena', 'clave']);

        // Grado de respaldo: nombre de la hoja ("10-A") o celda "GRADO: 10-A" de arriba
        let gradoHoja = '';
        const comoGrado = t => /^\d{1,2}\s*-?\s*[a-c]$/i.test(String(t).trim()) ? String(t).trim() : '';
        gradoHoja = comoGrado(nombreHoja);
        if (!gradoHoja) {
            for (let i = 0; i < filaEnc && !gradoHoja; i++) {
                matriz[i].forEach(celda => { if (!gradoHoja) gradoHoja = comoGrado(celda); });
            }
        }

        const texto = (fila, c) => (c >= 0 && fila[c] !== undefined && fila[c] !== null) ? String(fila[c]).trim() : '';

        // 2) Leer las filas de datos
        for (let i = filaEnc + 1; i < matriz.length; i++) {
            const fila = matriz[i];
            const nombreCompleto = (texto(fila, cNombre) + ' ' + texto(fila, cApellido)).trim();
            if (!nombreCompleto && !texto(fila, cCodigo)) continue; // fila vacía

            const base = {
                fila: libro.SheetNames.length > 1
                    ? nombreHoja + ', fila ' + (i + 1 + desfase)
                    : String(i + 1 + desfase),
                nombre: formatearNombre(nombreCompleto)
            };

            if (tipo === 'estudiantes') {
                base.grado = texto(fila, cGrado) || gradoHoja;
                base.codigo_unico = texto(fila, cCodigo);
            } else if (tipo === 'profesores') {
                base.codigo_unico = texto(fila, cCodigo);
            } else { // administradores
                base.correo_nuevo = texto(fila, cCorreo);
                base.contrasena = texto(fila, cClave);
                base.codigo_unico = texto(fila, cCodigo);
            }
            filas.push(base);
        }
    });

    return { filas, encabezadosVistos };
}

async function alElegirArchivoRegistros(input) {
    const archivo = input.files[0];
    input.value = ''; // permite volver a elegir el mismo archivo después
    if (!archivo || !registrosTipoActual) return;

    const ayuda = document.getElementById('registros-ayuda-archivo');
    if (ayuda) ayuda.innerText = 'Leyendo archivo...';

    try {
        const datosArchivo = await archivo.arrayBuffer();
        const libro = XLSX.read(datosArchivo, { type: 'array' });
        const { filas, encabezadosVistos } = leerFilasDelLibro(libro, registrosTipoActual);

        if (filas.length === 0) {
            const pedido = registrosTipoActual === 'estudiantes' ? 'Nombre, Grado, Código único'
                : registrosTipoActual === 'profesores' ? 'Nombre, Código único'
                : 'Nombre, Correo, Contraseña, Código único';
            mostrarAviso('⚠️ No encontré la fila de encabezados ni datos en el archivo.\n\nBusco una fila con: ' + pedido +
                (encabezadosVistos.length ? '\n\nLo que leí:\n' + encabezadosVistos.join('\n') : ''));
            if (ayuda) ayuda.innerText = '';
            return;
        }

        if (ayuda) ayuda.innerText = 'Subiendo ' + filas.length + ' registros...';

        const respuesta = await fetch('/api/admin/importar-usuarios', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo: usuarioActual.correo, tipo: registrosTipoActual, filas })
        });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            let msg = '🎉 Se registraron ' + resultado.registrados + ' usuario(s) con éxito.';
            if (resultado.omitidos > 0) {
                msg += '\n\n⚠️ ' + resultado.omitidos + ' fila(s) se omitieron:\n' +
                    resultado.errores.map(e => '• ' + (/^\d+$/.test(String(e.fila)) ? 'Fila ' : '') + e.fila + ': ' + e.motivo).join('\n');
            }
            mostrarAviso(msg);
            cargarRegistros(registrosTipoActual);
        } else {
            mostrarAviso('⚠️ ' + (resultado.error || 'No se pudo importar el archivo.'));
        }
    } catch (err) {
        console.error('⚠️ Error al leer/subir el archivo:', err);
        mostrarAviso('⚠️ No se pudo leer el archivo. Verifica que sea un Excel válido (.xlsx o .xls).');
    } finally {
        if (ayuda) ayuda.innerText = '';
    }
}
// ===================================================
// 👥 EQUIPO DE DESARROLLO (datos fijos, no editables desde la app)
// Pegar AL FINAL de script.js
// Las fotos van en la carpeta "equipo/" junto a index.html.
// foto: null deja el círculo vacío.
// ===================================================
const EQUIPO_DESARROLLO = Object.freeze([
     Object.freeze({ nombre: 'MIRIAN EDITH ALVAREZ JAQUE',        rol: 'Desarrolladora', foto: 'equipo/mirian-alvarez.jpeg' }),
    Object.freeze({ nombre: 'AMY VALENTINA CARVAJAL',            rol: 'Desarrolladora', foto: 'equipo/amy-carvajal.jpeg' }),
    Object.freeze({ nombre: 'SHARIT DALIANA GUTIERREZ SANDOBAL', rol: 'Desarrolladora', foto: 'equipo/sharit-gutierrez.jpeg' })
]);

function abrirModalEquipo() {
    document.getElementById('modal-equipo-lista').innerHTML = EQUIPO_DESARROLLO.map(p => {
        const fotoHtml = p.foto
            ? `<img class="equipo-foto" src="${escaparHtml(p.foto)}" alt="" draggable="false">`
            : '<div class="equipo-foto equipo-foto-vacia"></div>';

        return `
            <div class="equipo-fila">
                ${fotoHtml}
                <div class="equipo-datos">
                    <p class="equipo-nombre">${escaparHtml(p.nombre)}</p>
                    <p class="equipo-rol">${escaparHtml(p.rol)}</p>
                </div>
            </div>
        `;
    }).join('');

    document.getElementById('modal-equipo').classList.remove('oculto');
}

function cerrarModalEquipo() {
    document.getElementById('modal-equipo').classList.add('oculto');
}

// Refresca cada 30 segundos la lista de pruebas de profesores mientras el
// estudiante la está viendo, para que las pruebas se bloqueen o se abran a su hora.
setInterval(() => {
    const seccion = document.getElementById('seccion-pruebas-profesores');
    if (rolActual === 'estudiante' && seccion && !seccion.classList.contains('oculto') && ppPrueba === null) {
        cargarPruebasProfesores(true);
    }
}, 30000);