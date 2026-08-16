// ===================================================
// ESTADO GLOBAL
// ===================================================
let rolActual = '';

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
    if (rol === 'estudiante') {
        document.getElementById('titulo-registro').innerText = 'Registro de Estudiantes';
        campoExtra.innerHTML = '<input type="text" id="reg-extra" placeholder="Grado (Ej: 11-02)" required>';
    } else {
        document.getElementById('titulo-registro').innerText = 'Registro de Profesor/a Admin';
        campoExtra.innerHTML = '<input type="text" id="reg-extra" placeholder="Materia asignada" required>';
    }
}

function irALogin() {
    limpiarFormularioCompleto();
    document.getElementById('titulo-login').innerText = rolActual === 'estudiante' ? 'Login Estudiantes' : 'Login Profesor/a Admin';
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
    document.getElementById('pantalla-login').classList.add('oculto');
    document.getElementById('pantalla-registro').classList.add('oculto');
    document.getElementById('pantalla-roles').classList.add('oculto');
    document.getElementById('pantalla-app').classList.remove('oculto');

    if (usuario && usuario.nombre) {
        document.getElementById('app-usuario-nombre').innerText = usuario.nombre;
    }

    if (usuario && usuario.grado) {
        aplicarNivelesPorGrado(usuario.grado);
    }

    mostrarSeccion('pruebas');
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

// Cambia entre las secciones del menú lateral (Pruebas, Puntaje, Puntajes, Ranking)
function mostrarSeccion(nombre) {
    document.querySelectorAll('.seccion-app').forEach(sec => sec.classList.add('oculto'));
    document.getElementById('seccion-' + nombre).classList.remove('oculto');

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('activo', item.dataset.seccion === nombre);
    });
}

// Cierra sesión y regresa a la pantalla de registro
function cerrarSesion() {
    document.getElementById('pantalla-app').classList.add('oculto');
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
    const extra = document.getElementById('reg-extra').value;

    const datos = { nombre, correo, contrasena };
    if (rolActual === 'estudiante') datos.grado = extra;
    else datos.materia = extra;

    const respuesta = await fetch(`/api/registro/${rolActual}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos)
    });

    const resultado = await respuesta.json();
    if (respuesta.ok) {
        alert('🎉 ¡Registrado con éxito en la base de datos SQLite!');
        irALogin();
    } else {
        alert('⚠️ Error del sistema:\n' + resultado.error);
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
        alert('⚠️ Error al ingresar:\n' + resultado.error);
    }
}

// ===================================================
// PANTALLA DE NIVELES / PRUEBAS / SESIONES
// ===================================================
function entrarPrueba(nivel) {
    const circulo = document.getElementById('nivel-' + nivel);
    if (circulo.classList.contains('bloqueado')) {
        alert('🔒 Este nivel está bloqueado. Debes aprobar el nivel anterior para desbloquearlo.');
        return;
    }
    nivelActual = nivel;
    mostrarSesiones(nivel);
}

// Muestra las ventanas de Sesión 1 y Sesión 2 para el nivel elegido
function mostrarSesiones(nivel) {
    document.getElementById('vista-niveles').classList.add('oculto');
    document.getElementById('vista-sesiones').classList.remove('oculto');
    document.getElementById('titulo-nivel-sesiones').innerText = 'Nivel ' + nivel;
}

// Regresa de las sesiones a la selección de niveles
function volverANiveles() {
    document.getElementById('vista-sesiones').classList.add('oculto');
    document.getElementById('vista-niveles').classList.remove('oculto');
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
let respuestasSesion = [];

// Inicia el entorno visual de la prueba con la primera materia de la sesión
function iniciarSesion(numero) {
    sesionActual = numero;
    indiceMateriaActual = 0;
    respuestasSesion = [];

    document.getElementById('vista-sesiones').classList.add('oculto');
    document.getElementById('vista-prueba').classList.remove('oculto');

    cargarMateriaActual();
}

// Pide al servidor las preguntas de la materia actual y muestra la primera
async function cargarMateriaActual() {
    const materias = materiasPorSesion[sesionActual];
    const materia = materias[indiceMateriaActual];

    const vistaPrueba = document.getElementById('vista-prueba');
    vistaPrueba.className = 'vista-prueba ' + materia.tema;
    document.getElementById('prueba-materia-nombre').innerText = materia.nombre;

    const url = `/api/preguntas?nivel=${nivelActual}&sesion=${sesionActual}&materia=${encodeURIComponent(materia.nombre)}`;
    const respuesta = await fetch(url);
    const datos = await respuesta.json();

    preguntasMateriaActual = datos.preguntas || [];
    indicePreguntaActual = 0;

    if (preguntasMateriaActual.length === 0) {
        document.getElementById('prueba-enunciado').innerText = 'Aún no hay preguntas cargadas para esta materia.';
        document.getElementById('prueba-progreso').innerText = '';
        ['A', 'B', 'C', 'D'].forEach(letra => {
            document.getElementById('prueba-opcion-' + letra).innerText = '';
        });
        return;
    }

    renderizarPregunta();
}

// Pinta en pantalla la pregunta actual con sus 4 opciones
function renderizarPregunta() {
    const pregunta = preguntasMateriaActual[indicePreguntaActual];
    opcionSeleccionada = null;

    document.getElementById('prueba-progreso').innerText =
        'Pregunta ' + (indicePreguntaActual + 1) + ' de ' + preguntasMateriaActual.length;

    document.getElementById('prueba-enunciado').innerText = pregunta.enunciado;

    document.getElementById('prueba-opcion-A').innerText = 'A. ' + pregunta.opcion_a;
    document.getElementById('prueba-opcion-B').innerText = 'B. ' + pregunta.opcion_b;
    document.getElementById('prueba-opcion-C').innerText = 'C. ' + pregunta.opcion_c;
    document.getElementById('prueba-opcion-D').innerText = 'D. ' + pregunta.opcion_d;

    ['A', 'B', 'C', 'D'].forEach(letra => {
        document.getElementById('prueba-opcion-' + letra).classList.remove('seleccionada');
    });

    actualizarTextoBoton();
}

// Marca visualmente la opción elegida por el estudiante
function seleccionarOpcion(letra) {
    opcionSeleccionada = letra;
    ['A', 'B', 'C', 'D'].forEach(l => {
        document.getElementById('prueba-opcion-' + l).classList.toggle('seleccionada', l === letra);
    });
}

// Cambia el texto del botón según si falta pregunta, materia, o es el final
function actualizarTextoBoton() {
    const materias = materiasPorSesion[sesionActual];
    const esUltimaPregunta = indicePreguntaActual === preguntasMateriaActual.length - 1;
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

// Avanza: siguiente pregunta, siguiente materia, o finaliza y califica la sesión
async function continuarPrueba() {
    if (preguntasMateriaActual.length === 0) {
        avanzar();
        return;
    }

    if (!opcionSeleccionada) {
        alert('Selecciona una respuesta antes de continuar.');
        return;
    }

    respuestasSesion.push({
        pregunta_id: preguntasMateriaActual[indicePreguntaActual].id,
        opcion_elegida: opcionSeleccionada
    });

    avanzar();
}

async function avanzar() {
    const materias = materiasPorSesion[sesionActual];
    const esUltimaPregunta = indicePreguntaActual === preguntasMateriaActual.length - 1;
    const esUltimaMateria = indiceMateriaActual === materias.length - 1;

    if (!esUltimaPregunta) {
        indicePreguntaActual++;
        renderizarPregunta();
    } else if (!esUltimaMateria) {
        indiceMateriaActual++;
        await cargarMateriaActual();
    } else {
        await finalizarSesion();
    }
}

// Envía todas las respuestas de la sesión al servidor para calificarlas
async function finalizarSesion() {
    const respuesta = await fetch('/api/calificar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ respuestas: respuestasSesion })
    });

    const resultado = await respuesta.json();

    if (respuesta.ok) {
        alert('🎉 Terminaste la Sesión ' + sesionActual + '.\n\nResultado: ' + resultado.correctas + ' de ' + resultado.total + ' correctas.');
    } else {
        alert('⚠️ Error al calificar:\n' + resultado.error);
    }

    salirDePrueba();
}

// Sale del entorno de la prueba y regresa a las sesiones
function salirDePrueba() {
    document.getElementById('vista-prueba').classList.add('oculto');
    document.getElementById('vista-sesiones').classList.remove('oculto');
}