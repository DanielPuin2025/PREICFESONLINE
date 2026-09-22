const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// ✏️ NUEVO: limpia el HTML que llega del editor de texto enriquecido (Quill)
// para que nadie pueda guardar <script>, onerror=..., etc.
// Instalar una sola vez con:  npm install sanitize-html
const sanitizeHtml = require('sanitize-html');

const app = express();
// Límite alto porque las imágenes de las pruebas viajan en base64
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

let db; // pool de conexiones a MySQL, se asigna en iniciarBaseDeDatos()

// Porcentaje mínimo de respuestas correctas (sumando las sesiones ya presentadas
// de un nivel) para considerar que el estudiante APROBÓ ese nivel.
// Solo se usa si el administrador NO ha configurado el botón "Promedio".
const UMBRAL_APROBACION = 0.6; // 60%

function esCorreoValido(correo) {
    if (!correo) return false;
    return correo.endsWith('.com') || correo.endsWith('.edu.co');
}

function esContrasenaSegura(pass) {
    if (!pass) return false;
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.])[A-Za-z\d@$!%*?&.]{8,}$/;
    return regex.test(pass);
}

// Devuelve el número de "intento" actualmente activo para un estudiante en un
// nivel dado. Si nunca ha repetido ese nivel se asume el intento 1.
async function obtenerIntentoActual(correo, nivel) {
    const [filas] = await db.query(
        'SELECT intento_actual FROM intentos_nivel WHERE correo = ? AND nivel = ?',
        [correo, nivel]
    );
    return filas.length > 0 ? filas[0].intento_actual : 1;
}

// ===================================================
// ✏️ TEXTO ENRIQUECIDO (HTML del editor Quill)
// Profesores y administradores escriben enunciados y opciones con formato
// (negritas, superíndices x², listas...). Se guardan como HTML en columnas
// TEXT de MySQL, pero SIEMPRE pasan antes por esta limpieza: solo se
// conservan las etiquetas de formato permitidas y se descartan atributos,
// scripts, eventos, enlaces, etc.
// ===================================================
const CONFIG_HTML_RICO = {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'ul', 'ol', 'li', 'blockquote'],
    allowedAttributes: {}
};
const CONFIG_SOLO_TEXTO = { allowedTags: [], allowedAttributes: {} };

// Devuelve el HTML ya limpio ('' si no llegó texto)
function limpiarHtmlRico(html) {
    if (typeof html !== 'string') return '';
    return sanitizeHtml(html, CONFIG_HTML_RICO).trim();
}

// Texto visible sin etiquetas (sirve para saber si el campo está realmente vacío,
// porque un editor vacío de Quill devuelve "<p><br></p>")
function textoPlano(html) {
    return sanitizeHtml(String(html || ''), CONFIG_SOLO_TEXTO).replace(/&nbsp;|\u00a0/g, ' ').trim();
}

// ===================================================
// 📅 FECHAS Y HORAS DE LAS PRUEBAS DE PROFESORES
// Las fechas de inicio y fin se guardan como texto "AAAA-MM-DD" y las horas
// como "HH:MM" (24 horas), así se pueden comparar directamente como texto.
// ===================================================

// Devuelve la fecha de hoy como "AAAA-MM-DD" (hora local)
function hoyLocal() {
    const d = new Date();
    const dos = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

// ✏️ NUEVO: fecha y hora actuales como "AAAA-MM-DD HH:MM" (hora local)
function ahoraLocal() {
    const d = new Date();
    const dos = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

// Comprueba que el texto sea una fecha real con formato "AAAA-MM-DD"
function esFechaValida(texto) {
    if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
    const [a, m, d] = texto.split('-').map(Number);
    const f = new Date(a, m - 1, d);
    return f.getFullYear() === a && f.getMonth() === m - 1 && f.getDate() === d;
}

// ✏️ NUEVO: comprueba que el texto sea una hora válida "HH:MM" (24 horas)
function esHoraValida(texto) {
    return typeof texto === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(texto);
}

// "2026-09-25" -> "25/09/2026" (para los mensajes de error)
function fechaParaMensaje(texto) {
    return texto ? texto.split('-').reverse().join('/') : '';
}

// ✏️ Estado de una prueba de profesor según sus fechas Y horas:
//  'sin_subir' | 'programada' | 'activa' | 'finalizada'
// "ahora" es "AAAA-MM-DD HH:MM" (usa ahoraLocal()).
// La prueba se desbloquea en fechaInicio + horaInicio y se cierra en fechaFin + horaFin.
function calcularEstadoPrueba(fechaInicio, fechaFin, horaInicio, horaFin, ahora) {
    if (!fechaInicio || !fechaFin) return 'sin_subir';
    const inicio = fechaInicio + ' ' + (horaInicio || '00:00');
    const fin = fechaFin + ' ' + (horaFin || '23:59');
    if (ahora < inicio) return 'programada';
    if (ahora > fin) return 'finalizada';
    return 'activa';
}

// ===================================================
// 🎓 GRADOS DE LAS PRUEBAS DE PROFESORES
//    "9"   -> TODO el grado 9° (cursos 9-A, 9-B y 9-C; también estudiantes antiguos guardados como "9")
//    "9-A" -> solo el curso 9-A
// Se guardan separados por comas en la columna 'grados' (ej. "9,10-A,10-B").
// ===================================================
const GRADOS_VALIDOS = [9, 10, 11];

// Grados con curso que puede elegir un estudiante al registrarse
const GRADOS_REGISTRO = ['9-A', '9-B', '9-C', '10-A', '10-B', '10-C', '11-A', '11-B', '11-C'];

// Materias que puede elegir un profesor al crear una prueba
const MATERIAS_PROFESOR = [
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

// ===================================================
// 🛡️ BANCO DE PREGUNTAS DE LOS NIVELES (B, A, S) — administrador
// ===================================================
const NIVELES_VALIDOS = ['B', 'A', 'S'];

// Las 5 materias de los niveles, en el orden en que se muestran
const MATERIAS_NIVEL = ['Lectura Crítica', 'Matemáticas', 'C. Ciudadanas', 'C. Naturales', 'Inglés'];

// Materias que realmente aparecen en cada sesión
const MATERIAS_POR_SESION = {
    1: ['Lectura Crítica', 'Matemáticas', 'C. Ciudadanas', 'C. Naturales'],
    2: ['Matemáticas', 'C. Ciudadanas', 'C. Naturales', 'Inglés']
};

// Largo máximo (en caracteres de HTML) de cada opción. Las columnas ahora son TEXT
// (antes VARCHAR(500)) porque el formato HTML ocupa más espacio que el texto solo.
const MAX_LARGO_OPCION = 5000;

const LETRAS_CURSO = ['A', 'B', 'C'];

// Convierte lo que llega del navegador (una lista) en una lista limpia:
// solo grados/cursos válidos, sin repetidos y ordenados. Si están marcados
// los tres cursos de un grado (A, B y C), se guarda como el grado completo.
function normalizarGrados(lista) {
    if (!Array.isArray(lista)) return [];
    const elegidos = new Set(lista.map(g => String(g).trim().toUpperCase()));
    const resultado = [];

    for (const grado of GRADOS_VALIDOS) {
        if (elegidos.has(String(grado))) {
            resultado.push(String(grado));
            continue;
        }
        const cursos = LETRAS_CURSO.filter(letra => elegidos.has(`${grado}-${letra}`));
        if (cursos.length === LETRAS_CURSO.length) {
            resultado.push(String(grado));
        } else {
            cursos.forEach(letra => resultado.push(`${grado}-${letra}`));
        }
    }
    return resultado;
}

// Convierte el texto guardado en la base de datos ("9,10-A") en lista ["9", "10-A"]
function parsearGrados(texto) {
    if (!texto) return [];
    return normalizarGrados(String(texto).split(','));
}

// ["9"] -> "9°"   |   ["9-A", "9-B"] -> "9-A y 9-B"   |   ["9", "10-A", "11"] -> "9°, 10-A y 11°"
function textoGrados(lista) {
    const partes = lista.map(g => (/^\d+$/.test(g) ? g + '°' : g));
    if (partes.length <= 1) return partes.join('');
    return partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1];
}

// "grado" o "grados" según cuántos haya en la lista
function palabraGrado(lista) {
    return lista.length === 1 ? 'grado' : 'grados';
}

// Grado con el que se registró un estudiante (por ejemplo "9-A"), o null si no se encuentra.
async function obtenerGradoEstudiante(correo) {
    const [filas] = await db.query('SELECT grado FROM estudiantes WHERE correo = ?', [correo]);
    if (filas.length === 0) return null;
    return String(filas[0].grado).trim().toUpperCase();
}

// ¿El estudiante está entre los grados/cursos a los que va dirigida la prueba?
function estudianteEnGrados(gradoEstudiante, gradosPrueba) {
    if (!gradoEstudiante) return false;
    const m = /^(\d+)(?:-([A-Z]))?/.exec(gradoEstudiante);
    if (!m) return false;

    const numero = m[1];
    if (gradosPrueba.includes(numero)) return true;
    return m[2] ? gradosPrueba.includes(`${numero}-${m[2]}`) : false;
}

// ===================================================
// 🖼️ IMÁGENES DE LAS PREGUNTAS
//   - "imagenes-profesores": pruebas de profesores
//   - "imagenes-preguntas" : preguntas de los niveles (administrador)
// ===================================================
const CARPETA_IMAGENES = path.join(__dirname, 'imagenes-profesores');
const CARPETA_IMAGENES_NIVELES = path.join(__dirname, 'imagenes-preguntas');
const CARPETA_IMAGENES_ALMACENADAS = path.join(__dirname, 'imagenes-almacenadas');

// Copia la imagen de una pregunta a la carpeta de almacenadas (así no se pierde si se borra la prueba original)
async function copiarImagenAlmacenada(ruta) {
    if (!ruta) return null;
    const origen = path.join(CARPETA_IMAGENES, path.basename(ruta));
    const extension = path.extname(origen) || '.jpg';
    const nombre = `al-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`;
    try {
        await fs.promises.copyFile(origen, path.join(CARPETA_IMAGENES_ALMACENADAS, nombre));
    } catch (e) {
        return null; // si el archivo original ya no existe, se almacena sin imagen
    }
    return '/imagenes-almacenadas/' + nombre;
}

async function borrarImagenAlmacenada(ruta) {
    if (!ruta) return;
    try {
        await fs.promises.unlink(path.join(CARPETA_IMAGENES_ALMACENADAS, path.basename(ruta)));
    } catch (e) { /* si ya no existe, no pasa nada */ }
}
const MAX_BYTES_IMAGEN = 8 * 1024 * 1024; // 8 MB por imagen (ya reducida en el navegador)

const DESTINOS_IMAGEN = {
    profesores: { carpeta: CARPETA_IMAGENES, urlBase: '/imagenes-profesores/', prefijo: 'pp' },
    niveles: { carpeta: CARPETA_IMAGENES_NIVELES, urlBase: '/imagenes-preguntas/', prefijo: 'nv' }
};

function errorImagen(mensaje) {
    const e = new Error(mensaje);
    e.codigoHttp = 400;
    return e;
}

// Comprueba los primeros bytes del archivo para confirmar que de verdad es una imagen
function extensionPorFirma(b) {
    if (b.length < 12) return null;
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
    if (b.toString('ascii', 0, 4) === 'GIF8') return 'gif';
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    return null;
}

async function guardarImagenDataUrl(dataUrl, destino = 'profesores') {
    const config = DESTINOS_IMAGEN[destino] || DESTINOS_IMAGEN.profesores;

    const cabecera = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/.exec(dataUrl);
    if (!cabecera) throw errorImagen('Una de las imágenes no tiene un formato válido.');

    const buffer = Buffer.from(dataUrl.slice(cabecera[0].length), 'base64');
    if (buffer.length === 0) throw errorImagen('Una de las imágenes está vacía.');
    if (buffer.length > MAX_BYTES_IMAGEN) throw errorImagen('Una de las imágenes es demasiado grande (máximo 8 MB).');

    const extension = extensionPorFirma(buffer);
    if (!extension) throw errorImagen('Una de las imágenes no es un archivo de imagen válido.');

    const nombre = `${config.prefijo}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extension}`;
    const archivo = path.join(config.carpeta, nombre);
    await fs.promises.writeFile(archivo, buffer);

    return { ruta: config.urlBase + nombre, archivo };
}

// Borra del disco la imagen de una pregunta de profesor. Solo toca archivos
// dentro de "imagenes-profesores". (Las imágenes de los niveles NO se borran
// nunca: el historial de los estudiantes guarda una copia de la ruta.)
async function borrarImagenDeRuta(ruta) {
    if (!ruta) return;
    try {
        await fs.promises.unlink(path.join(CARPETA_IMAGENES, path.basename(ruta)));
    } catch (e) { /* si ya no existe, no pasa nada */ }
}

// ===================================================
// CONEXIÓN E INICIALIZACIÓN DE LA BASE DE DATOS
// ===================================================

// ✏️ NUEVO: en instalaciones anteriores las opciones eran VARCHAR(500). Con el
// editor enriquecido guardan HTML, así que se convierten a TEXT (una sola vez:
// solo se modifican las columnas que todavía sean VARCHAR).
async function ampliarColumnasATexto() {
    const opciones = ['opcion_a', 'opcion_b', 'opcion_c', 'opcion_d'];
    const objetivos = {
        banco_preguntas: opciones,
        preguntas_profesor: opciones,
        respuestas_detalle: opciones
    };

    for (const [tabla, columnas] of Object.entries(objetivos)) {
        try {
            const [filas] = await db.query(
                `SELECT COLUMN_NAME AS nombre FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND DATA_TYPE = 'varchar' AND COLUMN_NAME IN (?)`,
                [tabla, columnas]
            );
            for (const f of filas) {
                await db.query('ALTER TABLE `' + tabla + '` MODIFY `' + f.nombre + '` TEXT NOT NULL');
                console.log('🔧 Columna "' + f.nombre + '" de ' + tabla + ' convertida a TEXT (soporta HTML del editor).');
            }
        } catch (err) {
            console.error('❌ Error al convertir a TEXT las columnas de ' + tabla + ':', err.message);
        }
    }
}

async function iniciarBaseDeDatos() {
    // 0) Carpetas donde se guardan las imágenes de las preguntas
    await fs.promises.mkdir(CARPETA_IMAGENES, { recursive: true });
    await fs.promises.mkdir(CARPETA_IMAGENES_NIVELES, { recursive: true });
    await fs.promises.mkdir(CARPETA_IMAGENES_ALMACENADAS, { recursive: true });
    // 1) Conexión inicial SIN elegir base de datos, solo para crearla si no existe
    const conexionInicial = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '' // XAMPP viene sin contraseña por defecto
    });
    await conexionInicial.query('CREATE DATABASE IF NOT EXISTS preicfes');
    await conexionInicial.end();

    // 2) Pool de conexiones ya apuntando a la base de datos 'preicfes'
    db = await mysql.createPool({
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'preicfes',
        waitForConnections: true,
        connectionLimit: 10
    });

    console.log('✅ Conectado a MySQL, base de datos: preicfes');

    // 3) Crear tablas si no existen
    await db.query(`CREATE TABLE IF NOT EXISTS estudiantes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        contrasena VARCHAR(255) NOT NULL,
        grado VARCHAR(50) NOT NULL,
        codigo_unico VARCHAR(100) DEFAULT NULL,
        correo VARCHAR(255) UNIQUE NOT NULL
    )`);

    try {
        await db.query('ALTER TABLE estudiantes ADD COLUMN codigo_unico VARCHAR(100) DEFAULT NULL');
        console.log('🔧 Columna "codigo_unico" añadida a la tabla estudiantes (actualización desde una versión anterior).');
    } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('❌ Error al verificar/añadir la columna codigo_unico en estudiantes:', err.message);
        }
    }

    await db.query(`CREATE TABLE IF NOT EXISTS profesores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        contrasena VARCHAR(255) NOT NULL,
        materia VARCHAR(255) NOT NULL,
        codigo_unico VARCHAR(100) DEFAULT NULL,
        correo VARCHAR(255) UNIQUE NOT NULL
    )`);

    try {
        await db.query('ALTER TABLE profesores ADD COLUMN codigo_unico VARCHAR(100) DEFAULT NULL');
        console.log('🔧 Columna "codigo_unico" añadida a la tabla profesores (actualización desde una versión anterior).');
    } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('❌ Error al verificar/añadir la columna codigo_unico en profesores:', err.message);
        }
    }

    // Administradores: solo necesitan nombre, correo y contraseña.
    await db.query(`CREATE TABLE IF NOT EXISTS administradores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        contrasena VARCHAR(255) NOT NULL,
        correo VARCHAR(255) UNIQUE NOT NULL
    )`);

    // ✏️ enunciado y opciones son TEXT: guardan HTML del editor enriquecido.
    // 'imagen' guarda la ruta de una imagen opcional; 'creado_por' el correo de quien creó la pregunta.
    await db.query(`CREATE TABLE IF NOT EXISTS banco_preguntas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nivel VARCHAR(5) NOT NULL,
        sesion INT NOT NULL,
        materia VARCHAR(100) NOT NULL,
        enunciado TEXT NOT NULL,
        opcion_a TEXT NOT NULL,
        opcion_b TEXT NOT NULL,
        opcion_c TEXT NOT NULL,
        opcion_d TEXT NOT NULL,
        respuesta_correcta VARCHAR(1) NOT NULL,
        imagen VARCHAR(500) DEFAULT NULL,
        creado_por VARCHAR(255) DEFAULT NULL
    )`);

    try {
        await db.query('ALTER TABLE banco_preguntas ADD COLUMN imagen VARCHAR(500) DEFAULT NULL');
        console.log('🔧 Columna "imagen" añadida a la tabla banco_preguntas (actualización desde una versión anterior).');
    } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('❌ Error al verificar/añadir la columna imagen en banco_preguntas:', err.message);
        }
    }

    try {
        await db.query('ALTER TABLE banco_preguntas ADD COLUMN creado_por VARCHAR(255) DEFAULT NULL');
        console.log('🔧 Columna "creado_por" añadida a la tabla banco_preguntas (actualización desde una versión anterior).');
    } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('❌ Error al verificar/añadir la columna creado_por en banco_preguntas:', err.message);
        }
    }

    // 'intento' identifica a qué "vuelta" del nivel pertenece cada resultado.
    // Nunca se borran filas de esta tabla.
    await db.query(`CREATE TABLE IF NOT EXISTS resultados (
        id INT AUTO_INCREMENT PRIMARY KEY,
        correo VARCHAR(255) NOT NULL,
        nombre VARCHAR(255) NOT NULL,
        nivel VARCHAR(5) NOT NULL,
        sesion INT NOT NULL,
        intento INT NOT NULL DEFAULT 1,
        correctas INT NOT NULL,
        total INT NOT NULL,
        fecha VARCHAR(50) NOT NULL
    )`);

    try {
        await db.query('ALTER TABLE resultados ADD COLUMN intento INT NOT NULL DEFAULT 1');
        console.log('🔧 Columna "intento" añadida a la tabla resultados (actualización desde una versión anterior).');
    } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('❌ Error al verificar/añadir la columna intento:', err.message);
        }
    }

    // Para cada (estudiante, nivel), cuál es el número de intento actualmente "en curso".
    await db.query(`CREATE TABLE IF NOT EXISTS intentos_nivel (
        correo VARCHAR(255) NOT NULL,
        nivel VARCHAR(5) NOT NULL,
        intento_actual INT NOT NULL DEFAULT 1,
        PRIMARY KEY (correo, nivel)
    )`);

    // Detalle de CADA pregunta respondida dentro de un resultado (copia de la pregunta,
    // incluida su imagen) para mostrar el historial pregunta por pregunta.
    await db.query(`CREATE TABLE IF NOT EXISTS respuestas_detalle (
        id INT AUTO_INCREMENT PRIMARY KEY,
        resultado_id INT NOT NULL,
        pregunta_id INT NOT NULL,
        materia VARCHAR(100) NOT NULL,
        enunciado TEXT NOT NULL,
        opcion_a TEXT NOT NULL,
        opcion_b TEXT NOT NULL,
        opcion_c TEXT NOT NULL,
        opcion_d TEXT NOT NULL,
        opcion_elegida VARCHAR(1) NOT NULL,
        respuesta_correcta VARCHAR(1) NOT NULL,
        es_correcta TINYINT(1) NOT NULL,
        imagen VARCHAR(500) DEFAULT NULL,
        FOREIGN KEY (resultado_id) REFERENCES resultados(id) ON DELETE CASCADE
    )`);

    try {
        await db.query('ALTER TABLE respuestas_detalle ADD COLUMN imagen VARCHAR(500) DEFAULT NULL');
        console.log('🔧 Columna "imagen" añadida a la tabla respuestas_detalle (actualización desde una versión anterior).');
    } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('❌ Error al verificar/añadir la columna imagen en respuestas_detalle:', err.message);
        }
    }

    // ===================================================
    // PRUEBAS DE PROFESORES (independientes de los niveles B/A/S)
    // ===================================================
    await db.query(`CREATE TABLE IF NOT EXISTS pruebas_profesor (
        id INT AUTO_INCREMENT PRIMARY KEY,
        titulo VARCHAR(255) NOT NULL,
        materia VARCHAR(255) NOT NULL,
        creado_por VARCHAR(255) NOT NULL,
        nombre_profesor VARCHAR(255) NOT NULL,
        fecha VARCHAR(50) NOT NULL,
        fecha_inicio VARCHAR(10) DEFAULT NULL,
        fecha_fin VARCHAR(10) DEFAULT NULL,
        fecha_subida VARCHAR(50) DEFAULT NULL,
        grados VARCHAR(100) DEFAULT NULL
    )`);

    // ✏️ Se añaden también hora_inicio y hora_fin (formato "HH:MM")
    for (const columna of [
        'fecha_inicio VARCHAR(10) DEFAULT NULL',
        'fecha_fin VARCHAR(10) DEFAULT NULL',
        'fecha_subida VARCHAR(50) DEFAULT NULL',
        'grados VARCHAR(100) DEFAULT NULL',
        'hora_inicio VARCHAR(5) DEFAULT NULL',
        'hora_fin VARCHAR(5) DEFAULT NULL'
    ]) {
        try {
            await db.query('ALTER TABLE pruebas_profesor ADD COLUMN ' + columna);
            console.log('🔧 Columna "' + columna.split(' ')[0] + '" añadida a la tabla pruebas_profesor (actualización desde una versión anterior).');
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') {
                console.error('❌ Error al verificar/añadir la columna ' + columna.split(' ')[0] + ':', err.message);
            }
        }
    }

    try {
        await db.query('ALTER TABLE pruebas_profesor MODIFY grados VARCHAR(100) DEFAULT NULL');
    } catch (err) {
        console.error('❌ Error al ampliar la columna grados:', err.message);
    }

    // Pruebas ya subidas ANTES de existir la opción de grados: quedan abiertas para los tres grados.
    try {
        await db.query(`UPDATE pruebas_profesor SET grados = '9,10,11' WHERE fecha_inicio IS NOT NULL AND grados IS NULL`);
    } catch (err) {
        console.error('❌ Error al asignar grados a las pruebas ya subidas:', err.message);
    }

    // Compatibilidad: "Ciencias Económicas y Políticas" -> "Ciencias Económicas y Políticas/Sociales"
    try {
        const [resultadoRenombre] = await db.query(
            `UPDATE pruebas_profesor SET materia = 'Ciencias Económicas y Políticas/Sociales' WHERE materia = 'Ciencias Económicas y Políticas'`
        );
        if (resultadoRenombre.affectedRows > 0) {
            console.log('🔧 ' + resultadoRenombre.affectedRows + ' prueba(s) actualizada(s): "Ciencias Económicas y Políticas" -> "Ciencias Económicas y Políticas/Sociales".');
        }
    } catch (err) {
        console.error('❌ Error al renombrar la materia de Ciencias Económicas:', err.message);
    }

    // ✏️ enunciado y opciones son TEXT (HTML del editor). 'imagen' guarda la ruta de la imagen opcional.
    await db.query(`CREATE TABLE IF NOT EXISTS preguntas_profesor (
        id INT AUTO_INCREMENT PRIMARY KEY,
        prueba_id INT NOT NULL,
        enunciado TEXT NOT NULL,
        opcion_a TEXT NOT NULL,
        opcion_b TEXT NOT NULL,
        opcion_c TEXT NOT NULL,
        opcion_d TEXT NOT NULL,
        respuesta_correcta VARCHAR(1) NOT NULL,
        imagen VARCHAR(500) DEFAULT NULL,
        FOREIGN KEY (prueba_id) REFERENCES pruebas_profesor(id) ON DELETE CASCADE
    )`);

    // UNIQUE (prueba_id, correo): un estudiante solo puede presentar cada prueba de profesor una vez.
    // Los resultados NO se borran al eliminar la prueba (ON DELETE SET NULL + copia del título/materia/profesor).
    await db.query(`CREATE TABLE IF NOT EXISTS resultados_profesor (
        id INT AUTO_INCREMENT PRIMARY KEY,
        prueba_id INT NULL,
        correo VARCHAR(255) NOT NULL,
        nombre VARCHAR(255) NOT NULL,
        correctas INT NOT NULL,
        total INT NOT NULL,
        fecha VARCHAR(50) NOT NULL,
        titulo_prueba VARCHAR(255) DEFAULT NULL,
        materia_prueba VARCHAR(255) DEFAULT NULL,
        profesor_correo VARCHAR(255) DEFAULT NULL,
        UNIQUE KEY unico_estudiante_prueba (prueba_id, correo),
        FOREIGN KEY (prueba_id) REFERENCES pruebas_profesor(id) ON DELETE SET NULL
    )`);

    for (const columna of [
        'titulo_prueba VARCHAR(255) DEFAULT NULL',
        'materia_prueba VARCHAR(255) DEFAULT NULL',
        'profesor_correo VARCHAR(255) DEFAULT NULL'
    ]) {
        try {
            await db.query('ALTER TABLE resultados_profesor ADD COLUMN ' + columna);
            console.log('🔧 Columna "' + columna.split(' ')[0] + '" añadida a la tabla resultados_profesor (actualización desde una versión anterior).');
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') {
                console.error('❌ Error al verificar/añadir la columna ' + columna.split(' ')[0] + ' en resultados_profesor:', err.message);
            }
        }
    }

    try {
        await db.query(
            `UPDATE resultados_profesor SET materia_prueba = 'Ciencias Económicas y Políticas/Sociales' WHERE materia_prueba = 'Ciencias Económicas y Políticas'`
        );
    } catch (err) {
        console.error('❌ Error al renombrar la materia en resultados_profesor:', err.message);
    }

    // Instalaciones antiguas: la relación era ON DELETE CASCADE; se cambia a SET NULL.
    try {
        const [relaciones] = await db.query(
            `SELECT CONSTRAINT_NAME AS nombre, DELETE_RULE AS regla
             FROM information_schema.REFERENTIAL_CONSTRAINTS
             WHERE CONSTRAINT_SCHEMA = DATABASE()
               AND TABLE_NAME = 'resultados_profesor'
               AND REFERENCED_TABLE_NAME = 'pruebas_profesor'`
        );
        const yaConserva = relaciones.length > 0 && relaciones.every(r => r.regla === 'SET NULL');

        if (!yaConserva) {
            for (const r of relaciones) {
                await db.query('ALTER TABLE resultados_profesor DROP FOREIGN KEY `' + r.nombre + '`');
            }
            await db.query('ALTER TABLE resultados_profesor MODIFY prueba_id INT NULL');
            await db.query(
                `ALTER TABLE resultados_profesor
                 ADD CONSTRAINT fk_resultados_profesor_prueba
                 FOREIGN KEY (prueba_id) REFERENCES pruebas_profesor(id) ON DELETE SET NULL`
            );
            console.log('🔧 Los resultados de las pruebas de profesores ahora se conservan aunque la prueba se elimine.');
        }
    } catch (err) {
        console.error('❌ Error al actualizar la relación de resultados_profesor:', err.message);
    }

    try {
        await db.query(
            `UPDATE resultados_profesor r
             JOIN pruebas_profesor p ON p.id = r.prueba_id
             SET r.titulo_prueba = p.titulo, r.materia_prueba = p.materia, r.profesor_correo = p.creado_por
             WHERE r.titulo_prueba IS NULL`
        );
    } catch (err) {
        console.error('❌ Error al copiar los datos de las pruebas en los resultados:', err.message);
    }

    // ✏️ NUEVO: registro de las veces que un estudiante fue expulsado de un examen
    // (perdió el foco de la ventana). Se puede consultar desde phpMyAdmin.
    await db.query(`CREATE TABLE IF NOT EXISTS incidentes_examen (
        id INT AUTO_INCREMENT PRIMARY KEY,
        correo VARCHAR(255) NOT NULL,
        nombre VARCHAR(255) NOT NULL,
        tipo_examen VARCHAR(20) NOT NULL,
        referencia VARCHAR(255) DEFAULT NULL,
        motivo VARCHAR(100) NOT NULL,
        fecha VARCHAR(50) NOT NULL
    )`);

    // ✏️ NUEVO: mínimo de respuestas correctas (sumando las 2 sesiones) que el
    // administrador exige para pasar de un nivel al siguiente (botón "Promedio").
    await db.query(`CREATE TABLE IF NOT EXISTS config_niveles (
        nivel VARCHAR(5) NOT NULL PRIMARY KEY,
        minimo_correctas INT NOT NULL
    )`);

    // ✏️ CORREGIDO: estas dos tablas estaban antes SUELTAS fuera de cualquier
    // función (a nivel de módulo), lo que producía:
    //   "SyntaxError: await is only valid in async functions..."
    // Ahora quedan dentro de iniciarBaseDeDatos(), junto a las demás tablas.
    await db.query(`CREATE TABLE IF NOT EXISTS pruebas_almacenadas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        origen_id INT DEFAULT NULL,
        titulo VARCHAR(255) NOT NULL,
        materia VARCHAR(255) NOT NULL,
        creado_por VARCHAR(255) NOT NULL,
        fecha_almacenada VARCHAR(50) NOT NULL
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS preguntas_almacenadas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        almacenada_id INT NOT NULL,
        enunciado TEXT NOT NULL,
        opcion_a TEXT NOT NULL,
        opcion_b TEXT NOT NULL,
        opcion_c TEXT NOT NULL,
        opcion_d TEXT NOT NULL,
        respuesta_correcta VARCHAR(1) NOT NULL,
        imagen VARCHAR(500) DEFAULT NULL,
        FOREIGN KEY (almacenada_id) REFERENCES pruebas_almacenadas(id) ON DELETE CASCADE
    )`);

    // ✏️ NUEVO: pasa a TEXT las opciones que en instalaciones anteriores seguían siendo VARCHAR(500)
    await ampliarColumnasATexto();
    // 4) Sembrar el banco de preguntas solo si está vacío
    const [filasConteo] = await db.query('SELECT COUNT(*) AS total FROM banco_preguntas');
    if (filasConteo[0].total === 0) {
        const preguntas = [
            ['B', 1, 'Matemáticas',
                'En una papelería, un paquete de 500 hojas de papel cuesta $15.000. Si un estudiante necesita comprar solamente 100 hojas de papel para un trabajo escolar, ¿cuánto dinero debe pagar manteniendo la misma relación de precio?',
                '$5.000', '$3.000', '$1.500', '$4.000', 'B'],
            ['B', 1, 'Matemáticas',
                'El rector de un colegio revisa el número de estudiantes que ingresaron a la biblioteca durante una semana y encuentra los siguientes datos: Lunes (20), Martes (35), Miércoles (15), Jueves (40) y Viernes (30). ¿Cuál es el promedio (media) diario de estudiantes que visitaron la biblioteca esa semana?',
                '28 estudiantes', '35 estudiantes', '25 estudiantes', '30 estudiantes', 'A'],
            ['B', 1, 'Lectura Crítica',
                '"El agua es un recurso vital, pero el acceso a ella no es igual para todos. En algunas regiones del planeta, las personas deben caminar varias horas al día bajo el sol solo para conseguir un balde de agua limpia. Mientras tanto, en las grandes ciudades, es común ver cómo se desperdician litros de agua lavando aceras con mangueras o dejando grifos abiertos sin necesidad. La falta de conciencia y la distribución desigual son los verdaderos motores de la crisis hídrica global". Según el texto, la crisis mundial del agua se debe principalmente a:',
                'Las largas horas de caminata que realizan las personas en el campo.', 'El clima extremadamente caluroso de las regiones que no tienen ríos.', 'La falta de conciencia humana y la repartición inequitativa del recurso.', 'La construcción excesiva de aceras y carreteras en las grandes ciudades.', 'C'],
            ['B', 1, 'Lectura Crítica',
                'En la frase del texto: "La falta de conciencia y la distribución desigual son los verdaderos motores de la crisis hídrica global", la palabra motores se utiliza con el significado de:',
                'Máquinas que transforman la energía en movimiento para los autos.', 'Las consecuencias o resultados finales de una situación problemática.', 'Las causas originarias o motivos que impulsan un fenómeno.', 'Herramientas tecnológicas usadas para extraer agua subterránea.', 'C'],
            ['B', 1, 'C. Naturales',
                'En un bosque, las abejas van de flor en flor recolectando néctar para alimentarse y producir miel. Al hacer esto, transportan de manera accidental el polen pegado a sus cuerpos, lo que permite que las plantas se reproduzcan y den frutos. Esta relación biológica, donde ambas especies se benefician mutuamente, es un ejemplo de:',
                'Parasitismo', 'Mutualismo', 'Competencia', 'Depredación', 'B'],
            ['B', 1, 'C. Naturales',
                'Un estudiante tiene dos esferas del mismo tamaño: una está hecha de madera y la otra está hecha de hierro. Al colocarlas en una balanza, nota que la esfera de hierro es mucho más pesada que la de madera. A pesar de ocupar el mismo espacio (volumen), la diferencia de peso demuestra que la esfera de hierro posee una mayor:',
                'Temperatura', 'Solubilidad', 'Densidad', 'Elasticidad', 'C'],
            ['B', 1, 'C. Ciudadanas',
                'En un colegio de Colombia, los estudiantes de noveno grado proponen cambiar el uniforme deportivo por uno más cómodo. Para que esta propuesta sea escuchada y evaluada formalmente por las directivas de la institución, el representante estudiantil debe llevar la iniciativa ante el organismo donde participan docentes, padres y directivos. Este organismo se conoce como:',
                'Consejo Directivo', 'Comisión de Convivencia', 'Asociación de Exalumnos', 'Personería Estudiantil', 'A'],
            ['B', 1, 'C. Ciudadanas',
                'Un niño de 14 años es obligado por sus padres a dejar el colegio para trabajar jornadas de 10 horas diarias en un local comercial, argumentando que la familia necesita más ingresos económicos. En esta situación, se está vulnerando directamente la Constitución Política de Colombia porque:',
                'Los menores de edad solo pueden trabajar un máximo de 5 horas al día.', 'El trabajo comercial paga menos dinero que el trabajo en el campo.', 'Los derechos de los niños prevalecen sobre los demás y el Estado garantiza su educación.', 'Los padres de familia no tienen autoridad legal para decidir sobre sus hijos.', 'C'],
            ['S', 1, 'Matemáticas',
                'Una empresa de mensajería determina que el costo diario de operación C (en miles de pesos) para transportar x cantidad de paquetes está modelado por la función cuadrática C(x) = x² - 40x + 500. ¿Qué cantidad de paquetes x debe transportar la empresa para alcanzar su costo mínimo diario de operación?',
                '40 paquetes', '20 paquetes', '500 paquetes', '10 paquetes', 'B'],
            ['S', 1, 'Matemáticas',
                'En un colegio, el 60% de los estudiantes practica fútbol, el 30% practica baloncesto y el 10% practica ambos deportes. Si se elige un estudiante al azar y se descubre que practica fútbol, ¿cuál es la probabilidad de que también practique baloncesto?',
                '1/10', '1/3', '1/6', '1/2', 'C'],
            ['S', 1, 'Lectura Crítica',
                '"Nadie es justo por voluntad sino por la fuerza de la ley. Imaginemos que un hombre justo y uno injusto recibieran un anillo que los volviera invisibles. El injusto, claramente, robaría, violaría y asesinaría sin temor al castigo. Pero el hombre justo, al verse libre de la mirada social y de las sanciones legales, terminaría haciendo exactamente lo mismo. Esto demuestra que la justicia no es una virtud intrínseca del alma humana, sino un pacto de conveniencia basado en el miedo mutuo al castigo" (Adaptación de La República de Platón). De acuerdo con la estructura argumentativa del texto, el ejemplo del anillo de invisibilidad se utiliza principalmente para:',
                'Demostrar que los seres humanos son inherentemente buenos pero la sociedad los corrompe.', 'Sustentar la tesis de que la justicia se practica únicamente por temor a las consecuencias sociales y legales.', 'Proponer una solución fantástica para eliminar los delitos y la impunidad en las grandes ciudades.', 'Criticar a los gobiernos que no implementan leyes lo suficientemente severas contra los criminales.', 'B'],
            ['S', 1, 'Lectura Crítica',
                'Del texto anterior se puede inferir una concepción de la naturaleza humana que coincide con cuál de las siguientes afirmaciones:',
                'El ser humano es un ser racional capaz de actuar éticamente sin necesidad de supervisión externa.', 'Las leyes son un obstáculo artificial que impide el desarrollo de la verdadera bondad del individuo.', 'El comportamiento moral es una fachada impuesta; en libertad absoluta, el egoísmo prima sobre el bien común.', 'La justicia es un valor absoluto que se aprende a través de la educación formal y la filosofía.', 'C'],
            ['S', 1, 'C. Naturales',
                'Un bloque se desliza hacia abajo por una rampa inclinada. En un primer ensayo, la rampa está completamente libre de fricción y el bloque llega al suelo con una energía cinética final E1. En un segundo ensayo, utilizando el mismo bloque y la misma rampa, se añade una superficie rugosa que genera fricción, y el bloque llega al suelo con una energía cinética final E2. Al comparar los dos ensayos, se puede afirmar correctamente que:',
                'E1 = E2, porque la energía total del universo siempre se conserva de manera exacta.', 'E1 < E2, porque la fuerza de fricción acelera el cuerpo en la última parte del trayecto.', 'E1 > E2, porque una parte de la energía mecánica inicial se disipó en forma de calor debido al roce.', 'E1 = 0 y E2 > 0, porque la fricción es la única variable que permite acumular energía en movimiento.', 'C'],
            ['S', 1, 'C. Naturales',
                'El uso excesivo de fertilizantes nitrogenados en la agricultura arrastra grandes cantidades de nitratos hacia los ríos y lagos cercanos mediante el agua de lluvia. Este fenómeno altera el equilibrio del ecosistema acuático al provocar un crecimiento descontrolado de algas en la superficie, las cuales bloquean la luz solar y consumen todo el oxígeno disuelto al morir y descomponerse. Este proceso de degradación ambiental se conoce como:',
                'Fotosíntesis inversa', 'Eutrofización', 'Efecto invernadero local', 'Nitrificación atmosférica', 'B'],
            ['S', 1, 'C. Ciudadanas',
                'Un sector político propone reducir drásticamente los impuestos a las grandes empresas nacionales y extranjeras, argumentando que esto atraerá mayor inversión privada, generará nuevos puestos de trabajo y dinamizará la economía a largo plazo. Por el contrario, un sindicato de trabajadores se opone firmemente a la medida, señalando que la reducción de impuestos disminuirá los recursos del Estado para inversión social, ensanchando la brecha de desigualdad. En esta situación, el conflicto de intereses entre ambos sectores se origina principalmente en:',
                'Una diferencia ideológica sobre el rol que debe tener el Estado en la recaudación y redistribución de la riqueza.', 'El desconocimiento total por parte del sindicato sobre el funcionamiento de las leyes comerciales del país.', 'La intención oculta de las grandes empresas de quebrar el aparato público para no pagar salarios mínimos.', 'Un desacuerdo técnico sobre los meses exactos en que se debe aplicar el cobro de aranceles de aduana.', 'A'],
            ['S', 1, 'C. Ciudadanas',
                'Un ciudadano colombiano nota que la alcaldía de su municipio planea talar un bosque nativo protegido para construir un centro comercial privado, afectando el derecho colectivo a un ambiente sano de toda la comunidad local. ¿Cuál es el mecanismo constitucional idóneo que debe interponer este ciudadano para proteger este derecho colectivo de inmediato?',
                'Acción de Tutela', 'Derecho de Petición', 'Acción Popular', 'Habeas Corpus', 'C'],
            ['A', 1, 'Matemáticas',
                'Un servicio de taxi cobra una tarifa fija de $3.000 por abordar el vehículo y $1.200 por cada kilómetro recorrido. Si x representa los kilómetros recorridos, ¿cuál de las siguientes expresiones modela el costo total (C) del viaje?',
                'C = 3.000x + 1.200', 'C = 1.200x + 3.000', 'C = 4.200x', 'C = 3.000x / 1.200', 'B'],
            ['A', 1, 'Matemáticas',
                'Una caja de zapatos tiene forma de prisma rectangular con las siguientes dimensiones: 30 cm de largo, 20 cm de ancho y 10 cm de alto. ¿Cuál es el volumen total de la caja?',
                '600 cm³', '60 cm³', '6.000 cm³', '120 cm³', 'C'],
            ['A', 1, 'Lectura Crítica',
                'Observa la tira cómica de Gaturro y responde la pregunta. En ella, el profesor pregunta a varios alumnos si ciertas palabras ("examen", "escrúpulo", "alpiste", "calvicie") se acentúan, y en la última viñeta Gaturro, sentado en su pupitre, piensa "Con los años, sí...", representado con una serie de círculos que suben desde su cabeza hasta un globo con el texto. ¿Qué función cumplen los círculos que aparecen sobre la cabeza de Gaturro en el último recuadro?',
                'Representan globos inflables que flotan sobre el personaje.',
                'Indican que el personaje responde con una broma, no literalmente.',
                'Indican los pensamientos del personaje, no sus palabras en voz alta.',
                'Representan un signo de admiración por la sorpresa del personaje al ser interrogado.',
                'C'],
            ['A', 1, 'Lectura Crítica',
                '"La tecnología avanza a pasos agigantados, simplificando tareas que antes tomaban días. Sin embargo, este ritmo frenético ha creado una dependencia invisible: hoy nos cuesta recordar un número telefónico o guiarnos por las calles sin una pantalla encendida. No cabe duda de que ganamos eficiencia, pero es imperativo preguntarnos qué habilidades humanas estamos dejando morir en el camino." A partir del texto, se puede inferir que para el autor la tecnología es:',
                'Un peligro absoluto que debe ser eliminado de la vida cotidiana.', 'Una herramienta que solo trae beneficios de eficiencia a la humanidad.', 'Un avance positivo que, no obstante, conlleva un costo en capacidades humanas.', 'La única causa del deterioro de la memoria en los jóvenes actuales.', 'C'],
            ['A', 1, 'C. Naturales',
                'Un automóvil viaja por una carretera recta a una velocidad constante de 20 metros por segundo (m/s) durante un tiempo de 30 segundos. ¿Qué distancia total recorrió el automóvil en ese intervalo de tiempo?',
                '50 metros', '10 metros', '600 metros', '1.500 metros', 'C'],
            ['A', 1, 'C. Naturales',
                'Durante una práctica de laboratorio, se hace reaccionar gas hidrógeno (H2) con gas oxígeno (O2) para producir agua líquida (H2O), liberando una gran cantidad de calor al entorno. De acuerdo con este comportamiento térmico, esta reacción se clasifica como:',
                'Endotérmica', 'Exotérmica', 'De descomposición', 'Neutra', 'B'],
            ['A', 1, 'C. Ciudadanas',
                'Durante la primera mitad del siglo XX en Colombia, el proceso de industrialización y la búsqueda de mejores condiciones de vida provocaron un fenómeno social masivo conocido como el "éxodo rural". ¿Cuál fue la principal consecuencia demográfica de este fenómeno?',
                'El abandono total de las principales actividades económicas en las costas del país.', 'Un crecimiento acelerado y desordenado de la población en las zonas urbanas.', 'La reducción drástica de la población que habitaba en las capitales de los departamentos.', 'El fin definitivo de la producción agrícola y cafetera en el territorio nacional.', 'B'],
            ['A', 1, 'C. Ciudadanas',
                'En Colombia, cuando el Congreso de la República debate, modifica y aprueba las leyes que rigen a toda la nación, está ejerciendo las funciones propias de cuál rama del poder público:',
                'Rama Ejecutiva', 'Rama Judicial', 'Rama Legislativa', 'Órganos de Control', 'C']
        ];

        await db.query(
            `INSERT INTO banco_preguntas (nivel, sesion, materia, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta) VALUES ?`,
            [preguntas]
        );
        console.log('🌱 Banco de preguntas creado: 24 preguntas (niveles B, S y A, sesión 1).');
    }

    // Corrige la Pregunta 1 de Lectura Crítica (Nivel A, Sesión 1): tira cómica de Gaturro con su imagen.
    // Se ejecuta SIEMPRE al arrancar: una vez corregido el enunciado, el LIKE ya no encuentra la fila.
    try {
        const [resultadoGaturro] = await db.query(
            `UPDATE banco_preguntas
             SET enunciado = ?,
                 opcion_a = ?, opcion_b = ?, opcion_c = ?, opcion_d = ?,
                 respuesta_correcta = ?, imagen = ?
             WHERE nivel = 'A' AND sesion = 1 AND materia = 'Lectura Crítica'
               AND enunciado LIKE ?`,
            [
                'Observa la tira cómica de Gaturro y responde la pregunta. En ella, el profesor pregunta a varios alumnos si ciertas palabras ("examen", "escrúpulo", "alpiste", "calvicie") se acentúan, y en la última viñeta Gaturro, sentado en su pupitre, piensa "Con los años, sí...", representado con una serie de círculos que suben desde su cabeza hasta un globo con el texto. ¿Qué función cumplen los círculos que aparecen sobre la cabeza de Gaturro en el último recuadro?',
                'Representan globos inflables que flotan sobre el personaje.',
                'Indican que el personaje responde con una broma, no literalmente.',
                'Indican los pensamientos del personaje, no sus palabras en voz alta.',
                'Representan un signo de admiración por la sorpresa del personaje al ser interrogado.',
                'C',
                '/public/images/gaturro-acentuacion.jpg',
                '%tecnología avanza a pasos agigantados%'
            ]
        );
        if (resultadoGaturro.affectedRows > 0) {
            console.log('🔧 Pregunta de Gaturro (Nivel A, Sesión 1) actualizada con su imagen correspondiente.');
        }
    } catch (err) {
        console.error('❌ Error al actualizar la pregunta de Gaturro:', err.message);
    }

    // Garantiza que la imagen de Gaturro quede asignada aunque el enunciado ya estuviera corregido.
    try {
        await db.query(
            `UPDATE banco_preguntas SET imagen = ? WHERE nivel = 'A' AND sesion = 1 AND materia = 'Lectura Crítica' AND enunciado LIKE ? AND (imagen IS NULL OR imagen = '')`,
            ['/public/images/gaturro-acentuacion.jpg', '%círculos que aparecen sobre la cabeza%']
        );
    } catch (err) {
        console.error('❌ Error al asignar la imagen de la pregunta de Gaturro:', err.message);
    }

    // Corrige la Pregunta 2 de Lectura Crítica (Nivel A, Sesión 1): texto completo sobre tecnología.
    try {
        const [resultadoTecnologia] = await db.query(
            `UPDATE banco_preguntas
             SET enunciado = ?,
                 opcion_a = ?, opcion_b = ?, opcion_c = ?, opcion_d = ?,
                 respuesta_correcta = ?
             WHERE nivel = 'A' AND sesion = 1 AND materia = 'Lectura Crítica'
               AND enunciado LIKE ?`,
            [
                '"La tecnología avanza a pasos agigantados, simplificando tareas que antes tomaban días. Sin embargo, este ritmo frenético ha creado una dependencia invisible: hoy nos cuesta recordar un número telefónico o guiarnos por las calles sin una pantalla encendida. No cabe duda de que ganamos eficiencia, pero es imperativo preguntarnos qué habilidades humanas estamos dejando morir en el camino." A partir del texto, se puede inferir que para el autor la tecnología es:',
                'Un peligro absoluto que debe ser eliminado de la vida cotidiana.',
                'Una herramienta que solo trae beneficios de eficiencia a la humanidad.',
                'Un avance positivo que, no obstante, conlleva un costo en capacidades humanas.',
                'La única causa del deterioro de la memoria en los jóvenes actuales.',
                'C',
                '%fragmento anterior%dependencia invisible%'
            ]
        );
        if (resultadoTecnologia.affectedRows > 0) {
            console.log('🔧 Pregunta 2 de Lectura Crítica (Nivel A, Sesión 1) actualizada con el texto completo sobre tecnología.');
        }
    } catch (err) {
        console.error('❌ Error al actualizar la pregunta de tecnología:', err.message);
    }

    // 5) Sembrar el banco de preguntas de SESIÓN 2 solo si aún no existen
    const [filasConteoS2] = await db.query("SELECT COUNT(*) AS total FROM banco_preguntas WHERE sesion = 2");
    if (filasConteoS2[0].total === 0) {
        const preguntasSesion2 = [
            // ---------- NIVEL S (Grado 11) - Sesión 2 ----------
            ['S', 2, 'Matemáticas',
                'Un ingeniero necesita calcular la altura de una torre de telecomunicaciones. Para ello, se ubica a una distancia horizontal de 30 metros de la base de la torre y mide un ángulo de elevación de 45° hacia la parte más alta. ¿Cuál es la altura aproximada de la torre sin tener en cuenta la estatura del ingeniero?',
                '15 metros', '30 metros', '45 metros', '60 metros', 'B'],
            ['S', 2, 'Matemáticas',
                'En un estudio sobre el uso de transporte público, una alcaldía decide realizar una encuesta solo a las personas que salen de una estación de metro exclusiva de una zona residencial de altos ingresos entre las 7:00 a. m. y las 8:00 a. m. Con respecto a la validez de la muestra para inferir el comportamiento de toda la ciudad, se puede afirmar que:',
                'Es completamente válida porque a esa hora toda la población se moviliza a sus trabajos.', 'Es inválida porque sesga los resultados al ignorar los hábitos de otros sectores socioeconómicos y horarios.', 'Es válida debido a que las estaciones de metro reciben un flujo constante y homogéneo de ciudadanos.', 'Es inválida únicamente porque el tamaño de la muestra debería incluir al 100% de los usuarios del sistema.', 'B'],
            ['S', 2, 'C. Ciudadanas',
                'Durante un debate sobre la implementación de programas de educación bilingüe (español y lenguas indígenas) en comunidades nativas, un funcionario afirma: "La prioridad debe ser enseñar únicamente español, pues es el idioma que les permitirá integrarse plenamente a la economía de mercado y la modernidad del país". Esta postura prioriza un enfoque de:',
                'Asimilación cultural, subordinando la preservación de la identidad lingüística nativa al desarrollo económico individual.', 'Pluriculturalidad, buscando un equilibrio equitativo entre las tradiciones ancestrales y las demandas globales.', 'Autonomía territorial, permitiendo que las propias comunidades decidan sus métodos de aprendizaje formal.', 'Segregación social, aislando a las poblaciones vulnerables del resto del aparato productivo nacional.', 'A'],
            ['S', 2, 'C. Ciudadanas',
                'Ante el incremento de hurtos en un barrio, un grupo de vecinos decide organizarse en una "brigada de seguridad armada", deteniendo a sospechosos y aplicando castigos físicos públicos sin dar aviso a las autoridades. Esta acción comunitaria vulnera la Constitución Política de Colombia principalmente porque:',
                'Los ciudadanos comunes no tienen permitido hablar en nombre de toda la junta de acción comunal.', 'El monopolio legítimo de la fuerza y la administración de justicia corresponden exclusivamente al Estado.', 'Los castigos físicos solo pueden aplicarse si se cuenta con la aprobación escrita del alcalde local.', 'La seguridad ciudadana es una responsabilidad exclusiva de las empresas privadas de vigilancia.', 'B'],
            ['S', 2, 'C. Naturales',
                'Un gas ideal se encuentra encerrado en un recipiente hermético de volumen constante. Si la temperatura absoluta del gas se duplica mediante la adición de calor externo, ¿qué ocurrirá con la presión ejercida por las partículas del gas contra las paredes del recipiente?',
                'La presión se duplicará, de acuerdo con la ley de Gay-Lussac.', 'La presión disminuirá a la mitad, debido al aumento del espacio disponible.', 'La presión se mantendrá igual, ya que el volumen del recipiente no cambió.', 'La presión se cuadruplicará, porque las partículas pierden energía cinética.', 'A'],
            ['S', 2, 'C. Naturales',
                'En una especie de plantas, el alelo para las flores rojas (R) es completamente dominante sobre el alelo para las flores blancas (r). Si se cruzan dos plantas heterocigotas (Rr), ¿cuál es la probabilidad genotípica esperada para la descendencia en la primera generación filial (F1)?',
                '100% plantas heterocigotas (Rr).', '50% homocigotas dominantes (RR) y 50% homocigotas recesivas (rr).', '25% homocigotas dominantes (RR), 50% heterocigotas (Rr) y 25% homocigotas recesivas (rr).', '75% plantas con flores rojas y 25% plantas con flores blancas.', 'C'],
            ['S', 2, 'Inglés',
                'Read the text and choose the correct word for the blank space: "Climate change is one of the most critical challenges of our century. Scientists argue that human activities ________ responsible for the rapid increase in global temperatures over the last few decades."',
                'is', 'are', 'was', 'been', 'B'],
            ['S', 2, 'Inglés',
                'Choose the most appropriate response to complete the conversation: Speaker 1: "I\'m really nervous about the final physics exam tomorrow. I don\'t feel prepared enough." Speaker 2: "________________________"',
                'Don\'t worry, you have already studied a lot and you will do great.', 'Yes, physics is definitely my favorite subject at school.', 'I think the classroom is on the second floor next to the lab.', 'Yesterday I bought a new book about space exploration.', 'A'],

            // ---------- NIVEL A (Grado 10) - Sesión 2 ----------
            ['A', 2, 'Matemáticas',
                'Un topógrafo quiere medir el ancho de un río. Se ubica en una orilla directamente frente a un árbol situado en la orilla opuesta. Luego, camina 10 metros en línea recta a lo largo de su orilla y mide un ángulo de 60° entre su posición actual y el árbol. Si la tangente de 60° es aproximadamente 1.73, ¿cuál es el ancho aproximado del río?',
                '5.7 metros', '10.0 metros', '17.3 metros', '20.0 metros', 'C'],
            ['A', 2, 'Matemáticas',
                'Para ingresar a un parque de diversiones, la entrada de 2 adultos y 3 niños cuesta $35.000 en total. Al día siguiente, bajo las mismas tarifas, la entrada de 3 adultos y 1 niño cuesta $31.000. ¿Cuál es el precio individual de la entrada de un adulto?',
                '$10.000', '$8.000', '$5.000', '$9.000', 'D'],
            ['A', 2, 'C. Ciudadanas',
                'El alcalde de un municipio propone construir una autopista que pasará por encima de una zona residencial de bajos recursos, argumentando que la obra reducirá los tiempos de viaje de miles de trabajadores de la ciudad. Los residentes de la zona se oponen porque la construcción implicará la demolición de sus viviendas y la pérdida de sus redes comunitarias. En esta situación, los intereses en conflicto son:',
                'El desarrollo de la infraestructura urbana frente al derecho a la propiedad y la vivienda digna de una comunidad.', 'El enriquecimiento de las empresas privadas frente al presupuesto público asignado para las vías locales.', 'La recreación de los sectores de altos ingresos frente al cuidado ecológico de los bosques del municipio.', 'El libre comercio internacional frente a la protección de las fronteras terrestres del territorio nacional.', 'A'],
            ['A', 2, 'C. Ciudadanas',
                'Un grupo de ciudadanos colombianos considera que un artículo de la Constitución actual debe modificarse para endurecer las penas contra los delitos ambientales. Para lograr que la ciudadanía vote directamente en las urnas a favor o en contra de esta reforma constitucional específica, el mecanismo de participación idóneo que se debe convocar es:',
                'Un plebiscito', 'Una consulta popular', 'Un referendo constitucional', 'Un cabildo abierto', 'C'],
            ['A', 2, 'C. Naturales',
                'Un ciclista que se desplaza por una pista recta con una velocidad inicial de 4 m/s decide acelerar uniformemente a razón de 2 m/s² durante un tiempo de 5 segundos. ¿Cuál es la velocidad final alcanzada por el ciclista al terminar ese intervalo de tiempo?',
                '10 m/s', '14 m/s', '20 m/s', '6 m/s', 'B'],
            ['A', 2, 'C. Naturales',
                'De acuerdo con la ley de conservación de la masa, una ecuación química debe estar correctamente balanceada para reflejar que el número de átomos de cada elemento es igual en los reactivos y en los productos. Al revisar la siguiente reacción de combustión incompleta del metano: CH4 + X O2 → CO2 + 2H2O. ¿Cuál debe ser el valor del coeficiente X para que la ecuación cumpla con dicha ley?',
                '1', '3', '4', '2', 'D'],
            ['A', 2, 'Inglés',
                'Read the text and choose the correct option for the blank space: "Learning a second language is very beneficial for teenagers. Research shows that bilingual students ________ better cognitive flexibility and problem-solving skills compared to those who only speak one language."',
                'develops', 'develop', 'developing', 'developed', 'B'],
            ['A', 2, 'Inglés',
                'Choose the most appropriate response to complete the short conversation: Speaker 1: "Can you help me clean the laboratory before the chemistry teacher arrives?" Speaker 2: "________________________"',
                'Yes, I love reading history books on weekends.', 'Of course, let\'s start by organizing these test tubes.', 'No, the classroom is next to the principal\'s office.', 'I went to the cinema with my family last night.', 'B'],

            // ---------- NIVEL B (Grado 9) - Sesión 2 ----------
            ['B', 2, 'Matemáticas',
                'En una granja hay gallinas y conejos. Si en total se cuentan 20 cabezas y 50 patas, ¿cuál de los siguientes sistemas de ecuaciones lineales permite hallar correctamente la cantidad de gallinas (x) y conejos (y) que hay en la granja?',
                'x + y = 50; 2x + 4y = 20', 'x + y = 20; 4x + 2y = 50', 'x + y = 20; 2x + 4y = 50', 'x + y = 70; 2x + 2y = 50', 'C'],
            ['B', 2, 'Matemáticas',
                'Un estudiante quiere diseñar una cometa con forma de rombo. Sabe que la diagonal mayor mide 40 cm y la diagonal menor mide 20 cm. ¿Qué cantidad de papel en centímetros cuadrados necesita para cubrir la superficie de la cometa?',
                '800 cm²', '400 cm²', '200 cm²', '60 cm²', 'B'],
            ['B', 2, 'C. Ciudadanas',
                'Un grupo de ciudadanos pertenecientes a una comunidad afrodescendiente denuncia que una empresa minera comenzó a excavar cerca de sus tierras ancestrales sin haberles informado previamente ni consultado sobre el impacto ambiental. En Colombia, el mecanismo constitucional específico que protege a las minorías étnicas garantizando su participación antes de estos proyectos se denomina:',
                'Consulta previa', 'Derecho de petición', 'Acción de tutela', 'Plebiscito popular', 'A'],
            ['B', 2, 'C. Ciudadanas',
                'En varias regiones andinas de Colombia, la tala indiscriminada de bosques nativos en las partes altas de las montañas para ampliar la frontera agrícola ha generado graves consecuencias río abajo. ¿Cuál es el principal impacto ambiental y de riesgo que sufre la comunidad de las zonas bajas debido a esta deforestación?',
                'El aumento drástico de las nevadas durante el invierno.', 'La erosión del suelo y un mayor riesgo de deslizamientos e inundaciones en épocas de lluvia.', 'La desaparición inmediata de la producción industrial en las grandes ciudades de la costa.', 'El enfriamiento de la temperatura promedio del agua de los ríos locales.', 'B'],
            ['B', 2, 'C. Naturales',
                'Un libro se encuentra en reposo absoluto sobre una mesa horizontal. Al analizar las fuerzas que actúan sobre el libro, se puede afirmar correctamente que:',
                'No actúa ninguna fuerza sobre él, por eso no se mueve.', 'La fuerza de gravedad lo atrae hacia abajo y la mesa ejerce una fuerza normal de igual magnitud hacia arriba.', 'La fuerza normal de la mesa es mucho mayor que el peso del libro, lo que evita que se caiga.', 'Solo actúa la fuerza de fricción que lo empuja hacia los lados manteniéndolo estático.', 'B'],
            ['B', 2, 'C. Naturales',
                'En una cadena alimenticia de un jardín, los caracoles se alimentan de las hojas de las plantas, y los pájaros se comen a los caracoles. En este ecosistema, ¿qué nivel trófico ocupan los caracoles?',
                'Productores primarios', 'Consumidores primarios', 'Consumidores secundarios', 'Descomponedores', 'B'],
            ['B', 2, 'Inglés',
                'Read the sentence and choose the correct word to complete the blank space: "My brother is very athletic. He usually ________ basketball with his classmates after school on Fridays."',
                'play', 'plays', 'playing', 'played', 'B'],
            ['B', 2, 'Inglés',
                'Choose the most appropriate response to complete the short conversation: Speaker 1: "Excuse me, do you know where the school library is?" Speaker 2: "________________________"',
                'Yes, I am preparing for my English test.', 'It\'s on the second floor, right next to the laboratory.', 'I bought a very interesting storybook yesterday.', 'No, thank you, I don\'t want any food.', 'B']
        ];

        await db.query(
            `INSERT INTO banco_preguntas (nivel, sesion, materia, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta) VALUES ?`,
            [preguntasSesion2]
        );
        console.log('🌱 Banco de preguntas creado: 24 preguntas de SESIÓN 2 (niveles B, A y S).');
    }

    console.log('✅ Todas las tablas están listas.');
}
// ===================================================
// REGISTRO / LOGIN
// ===================================================
app.post('/api/registro/estudiante', async (req, res) => {
    console.log("\n📥 [Estudiante] Datos recibidos en el servidor:", { ...req.body, contrasena: '***' });
    const { nombre, contrasena, grado, codigo_unico, correo } = req.body;

    if (!esCorreoValido(correo)) {
        return res.status(400).json({ error: 'El correo debe terminar en .com o .edu.co' });
    }
    if (!esContrasenaSegura(contrasena)) {
        return res.status(400).json({ error: 'Contraseña débil. Requiere mínimo 8 caracteres, una mayúscula, una minúscula, un número y un símbolo.' });
    }

    const codigo = typeof codigo_unico === 'string' ? codigo_unico.trim() : '';
    if (!codigo) {
        return res.status(400).json({ error: 'Escribe tu código único.' });
    }
    if (codigo.length > 100) {
        return res.status(400).json({ error: 'El código único es demasiado largo (máximo 100 caracteres).' });
    }

    if (!GRADOS_REGISTRO.includes(grado)) {
        return res.status(400).json({ error: 'Selecciona tu grado.' });
    }

    try {
        await db.query(`INSERT INTO estudiantes (nombre, contrasena, grado, codigo_unico, correo) VALUES (?, ?, ?, ?, ?)`,
            [nombre, contrasena, grado, codigo, correo]);
        console.log("🎉 ¡Estudiante guardado con éxito en MySQL!");
        res.json({ mensaje: '¡Estudiante guardado con éxito!' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Este correo ya se encuentra registrado.' });
        }
        console.error("❌ Error al registrar estudiante:", err.message);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

app.post('/api/registro/profesor', async (req, res) => {
    console.log("\n📥 [Profesor] Datos recibidos en el servidor:", { ...req.body, contrasena: '***' });
    const { nombre, contrasena, codigo_unico, correo } = req.body;

    if (!esCorreoValido(correo)) {
        return res.status(400).json({ error: 'El correo debe terminar en .com o .edu.co' });
    }
    if (!esContrasenaSegura(contrasena)) {
        return res.status(400).json({ error: 'Contraseña débil. Requiere mínimo 8 caracteres, una mayúscula, una minúscula, un número y un símbolo.' });
    }

    const codigo = typeof codigo_unico === 'string' ? codigo_unico.trim() : '';
    if (!codigo) {
        return res.status(400).json({ error: 'Escribe tu código único.' });
    }
    if (codigo.length > 100) {
        return res.status(400).json({ error: 'El código único es demasiado largo (máximo 100 caracteres).' });
    }

    try {
        // La materia ya no se elige al registrarse (se elige en cada prueba), por eso se guarda vacía.
        await db.query(`INSERT INTO profesores (nombre, contrasena, materia, codigo_unico, correo) VALUES (?, ?, '', ?, ?)`,
            [nombre, contrasena, codigo, correo]);
        console.log("🎉 ¡Profesor/a guardado con éxito en MySQL!");
        res.json({ mensaje: '¡Profesor/a guardado con éxito!' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Este correo ya se encuentra registrado.' });
        }
        console.error("❌ Error al registrar profesor:", err.message);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// Registro de administrador: solo pide nombre, correo y contraseña.
app.post('/api/registro/admin', async (req, res) => {
    console.log("\n📥 [Admin] Registro recibido:", { nombre: req.body.nombre, correo: req.body.correo });
    const { nombre, contrasena, correo } = req.body;

    if (!nombre || !String(nombre).trim()) {
        return res.status(400).json({ error: 'Escribe tu nombre completo.' });
    }
    if (!esCorreoValido(correo)) {
        return res.status(400).json({ error: 'El correo debe terminar en .com o .edu.co' });
    }
    if (!esContrasenaSegura(contrasena)) {
        return res.status(400).json({ error: 'Contraseña débil. Requiere mínimo 8 caracteres, una mayúscula, una minúscula, un número y un símbolo.' });
    }

    try {
        await db.query(`INSERT INTO administradores (nombre, contrasena, correo) VALUES (?, ?, ?)`,
            [String(nombre).trim(), contrasena, correo]);
        console.log("🎉 ¡Admin guardado con éxito en MySQL!");
        res.json({ mensaje: '¡Admin guardado con éxito!' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Este correo ya se encuentra registrado.' });
        }
        console.error("❌ Error al registrar admin:", err.message);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

app.post('/api/login', async (req, res) => {
    const { correo, contrasena, rol } = req.body;
    console.log(`\n🔑 [Login] Intento de acceso para Rol: ${rol}, Correo: ${correo}`);

    // Cada perfil tiene su propia tabla
    const tablas = { estudiante: 'estudiantes', profesor: 'profesores', admin: 'administradores' };
    const tabla = tablas[rol];
    if (!tabla) {
        return res.status(400).json({ error: 'Perfil no válido.' });
    }

    try {
        const [filas] = await db.query(`SELECT * FROM ${tabla} WHERE correo = ? AND contrasena = ?`, [correo, contrasena]);
        const usuario = filas[0];

        if (!usuario) {
            return res.status(400).json({ error: 'Correo o contraseña incorrectos.' });
        }

        console.log(`🎉 ¡Ingreso exitoso! Validado correctamente: ${usuario.nombre}`);
        res.json({
            mensaje: '¡Inicio de sesión exitoso!',
            usuario: {
                nombre: usuario.nombre,
                correo: usuario.correo,
                grado: usuario.grado || null,
                materia: usuario.materia || null
            }
        });
    } catch (err) {
        console.error("❌ Error en login:", err.message);
        res.status(500).json({ error: 'Error interno del servidor en la base de datos.' });
    }
});

// ===================================================
// 📝 PREGUNTAS: obtener preguntas de una materia (SIN la respuesta correcta)
// ===================================================
app.get('/api/preguntas', async (req, res) => {
    const { nivel, sesion, materia } = req.query;
    console.log(`\n📝 [Preguntas] Solicitud -> nivel: ${nivel}, sesión: ${sesion}, materia: ${materia}`);

    if (!nivel || !sesion || !materia) {
        return res.status(400).json({ error: 'Faltan parámetros: nivel, sesion y materia son obligatorios.' });
    }

    try {
        const [filas] = await db.query(
            `SELECT id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, imagen FROM banco_preguntas WHERE nivel = ? AND sesion = ? AND materia = ? ORDER BY id`,
            [nivel, sesion, materia]
        );
        res.json({ preguntas: filas });
    } catch (err) {
        console.error("❌ Error al obtener preguntas:", err.message);
        res.status(500).json({ error: 'Error interno al obtener las preguntas.' });
    }
});

// Cantidad de preguntas de cada materia dentro de un nivel y sesión.
app.get('/api/conteo-preguntas', async (req, res) => {
    const { nivel, sesion } = req.query;
    if (!nivel || !sesion) {
        return res.status(400).json({ error: 'Faltan parámetros: nivel y sesion son obligatorios.' });
    }

    try {
        const [filas] = await db.query(
            `SELECT materia, COUNT(*) AS total FROM banco_preguntas WHERE nivel = ? AND sesion = ? GROUP BY materia`,
            [nivel, sesion]
        );
        const conteo = {};
        filas.forEach(f => { conteo[f.materia] = Number(f.total); });
        res.json({ conteo });
    } catch (err) {
        console.error("❌ Error al contar preguntas:", err.message);
        res.status(500).json({ error: 'Error interno al contar las preguntas.' });
    }
});

// ===================================================
// 👩‍🏫 CREAR PREGUNTA (versión anterior): ya no la usa ningún panel, se deja por
//     compatibilidad. ✏️ Ahora limpia el HTML igual que el resto de rutas.
// ===================================================
app.post('/api/crear-pregunta', async (req, res) => {
    const { correo, nivel, sesion, materia, respuesta_correcta, imagen } = req.body;
    console.log(`\n👩‍🏫 [Crear pregunta] ${correo} está creando una pregunta -> nivel: ${nivel}, sesión: ${sesion}, materia: ${materia}`);

    const enunciado = limpiarHtmlRico(req.body.enunciado);
    const opcion_a = limpiarHtmlRico(req.body.opcion_a);
    const opcion_b = limpiarHtmlRico(req.body.opcion_b);
    const opcion_c = limpiarHtmlRico(req.body.opcion_c);
    const opcion_d = limpiarHtmlRico(req.body.opcion_d);

    if (!correo || !nivel || !sesion || !materia || !textoPlano(enunciado) || !textoPlano(opcion_a) || !textoPlano(opcion_b) || !textoPlano(opcion_c) || !textoPlano(opcion_d) || !respuesta_correcta) {
        return res.status(400).json({ error: 'Faltan campos obligatorios para crear la pregunta.' });
    }

    if (!['A', 'B', 'C', 'D'].includes(respuesta_correcta)) {
        return res.status(400).json({ error: 'La respuesta correcta debe ser A, B, C o D.' });
    }

    try {
        await db.query(
            `INSERT INTO banco_preguntas (nivel, sesion, materia, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [nivel, sesion, materia, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen || null, correo]
        );
        console.log('🎉 ¡Pregunta creada con éxito por', correo + '!');
        res.json({ mensaje: '¡Pregunta guardada con éxito!' });
    } catch (err) {
        console.error('❌ Error al crear la pregunta:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al crear la pregunta.' });
    }
});

// (versión anterior, por compatibilidad)
app.get('/api/preguntas-creadas', async (req, res) => {
    const { correo } = req.query;

    if (!correo) {
        return res.status(400).json({ error: 'Falta el correo del profesor.' });
    }

    try {
        const [filas] = await db.query(
            `SELECT id, nivel, sesion, materia, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen FROM banco_preguntas WHERE creado_por = ? ORDER BY id DESC`,
            [correo]
        );
        res.json({ preguntas: filas });
    } catch (err) {
        console.error('❌ Error al obtener las preguntas creadas:', err.message);
        res.status(500).json({ error: 'Error interno al obtener las preguntas creadas.' });
    }
});

// ===================================================
// 🛡️ ADMINISTRADOR: crear y modificar las preguntas de los niveles B, A y S
// ===================================================

// ¿El correo pertenece a un administrador registrado?
async function esAdmin(correo) {
    if (!correo || typeof correo !== 'string') return false;
    const [filas] = await db.query('SELECT id FROM administradores WHERE correo = ?', [correo]);
    return filas.length > 0;
}

// ===================================================
// 🗄️ BASE DE DATOS - REGISTROS (administrador)
// ===================================================
app.get('/api/admin/estudiantes', async (req, res) => {
    const { correo } = req.query;
    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden ver esta información.' });
        }
       const [filas] = await db.query(
    'SELECT nombre, correo, contrasena, grado, codigo_unico FROM estudiantes ORDER BY nombre'
        );
        res.json({ estudiantes: filas });
    } catch (err) {
        console.error('❌ Error al obtener los estudiantes:', err.message);
        res.status(500).json({ error: 'Error interno al obtener los estudiantes.' });
    }
});
app.get('/api/admin/profesores', async (req, res) => {
    const { correo } = req.query;
    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden ver esta información.' });
        }
        const [filas] = await db.query(
            'SELECT nombre, correo, contrasena, codigo_unico FROM profesores ORDER BY nombre'
        );
        res.json({ profesores: filas });
    } catch (err) {
        console.error('❌ Error al obtener los profesores:', err.message);
        res.status(500).json({ error: 'Error interno al obtener los profesores.' });
    }
});

app.get('/api/admin/administradores', async (req, res) => {
    const { correo } = req.query;
    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden ver esta información.' });
        }
        const [filas] = await db.query(
            'SELECT nombre, correo, contrasena FROM administradores ORDER BY nombre'
        );
        res.json({ administradores: filas });
    } catch (err) {
        console.error('❌ Error al obtener los administradores:', err.message);
        res.status(500).json({ error: 'Error interno al obtener los administradores.' });
    }
});
async function eliminarUsuarioAdmin(tabla, etiqueta, req, res) {
    const { correo } = req.query;
    const correoUsuario = req.params.correoUsuario;

    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden eliminar usuarios.' });
        }

        if (tabla === 'administradores' && correoUsuario === correo) {
            return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta de administrador.' });
        }

        const [resultado] = await db.query('DELETE FROM ' + tabla + ' WHERE correo = ?', [correoUsuario]);
        if (resultado.affectedRows === 0) {
            return res.status(404).json({ error: 'Ese usuario ya no existe.' });
        }

        console.log(`🗑️ [Admin] ${correo} eliminó al ${etiqueta} ${correoUsuario}.`);
        res.json({ mensaje: 'Usuario eliminado.' });
    } catch (err) {
        console.error('❌ Error al eliminar el ' + etiqueta + ':', err.message);
        res.status(500).json({ error: 'Error interno al eliminar el usuario.' });
    }
}
app.delete('/api/admin/estudiantes/:correoUsuario', (req, res) =>
    eliminarUsuarioAdmin('estudiantes', 'estudiante', req, res));

app.delete('/api/admin/profesores/:correoUsuario', (req, res) =>
    eliminarUsuarioAdmin('profesores', 'profesor', req, res));

app.delete('/api/admin/administradores/:correoUsuario', (req, res) =>
    eliminarUsuarioAdmin('administradores', 'administrador', req, res));

function mezclar(lista) {
    const copia = [...lista];
    for (let i = copia.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
}

function validarDestinoNivel(nivel, sesion, materia) {
    if (!NIVELES_VALIDOS.includes(nivel)) return 'Selecciona el nivel (B, A o S).';
    if (![1, 2].includes(Number(sesion))) return 'Selecciona la sesión (1 o 2).';
    if (!MATERIAS_NIVEL.includes(materia) || !MATERIAS_POR_SESION[Number(sesion)].includes(materia)) {
        return 'Esa materia no forma parte de la sesión elegida.';
    }
    return null;
}

function prepararPreguntaAdmin(p) {
    if (!p || typeof p !== 'object') return { error: 'Una de las preguntas no es válida.' };

    const enunciado = limpiarHtmlRico(p.enunciado);
    if (!textoPlano(enunciado)) return { error: 'Todas las preguntas necesitan enunciado.' };

    let textos;
    let correcta;

    if (p.modo === 'aleatoria') {
        const textoCorrecta = limpiarHtmlRico(p.texto_correcta);
        const incorrectas = Array.isArray(p.incorrectas) ? p.incorrectas.map(limpiarHtmlRico) : [];
        if (!textoPlano(textoCorrecta) || incorrectas.length !== 3 || incorrectas.some(t => !textoPlano(t))) {
            return { error: 'En modo aleatorio escribe el texto de la respuesta correcta y las 3 opciones incorrectas.' };
        }

        const mezcladas = mezclar([
            { texto: textoCorrecta, ok: true },
            ...incorrectas.map(t => ({ texto: t, ok: false }))
        ]);
        textos = mezcladas.map(m => m.texto);
        correcta = 'ABCD'[mezcladas.findIndex(m => m.ok)];
    } else {
        textos = [p.opcion_a, p.opcion_b, p.opcion_c, p.opcion_d].map(limpiarHtmlRico);
        if (textos.some(t => !textoPlano(t)) || !['A', 'B', 'C', 'D'].includes(p.respuesta_correcta)) {
            return { error: 'Todas las preguntas necesitan 4 opciones y una respuesta correcta (A, B, C o D).' };
        }
        correcta = p.respuesta_correcta;
    }

    if (textos.some(t => t.length > MAX_LARGO_OPCION)) {
        return { error: 'Cada opción es demasiado larga (máximo ' + MAX_LARGO_OPCION + ' caracteres contando el formato).' };
    }
    if (new Set(textos.map(t => t.toLowerCase())).size < 4) {
        return { error: 'Las 4 opciones de cada pregunta deben ser distintas entre sí.' };
    }

    return {
        pregunta: {
            enunciado,
            opcion_a: textos[0],
            opcion_b: textos[1],
            opcion_c: textos[2],
            opcion_d: textos[3],
            respuesta_correcta: correcta
        }
    };
}

function prepararPreguntasAdmin(preguntas) {
    if (!Array.isArray(preguntas) || preguntas.length === 0) {
        return { error: 'Debes tener al menos una pregunta.' };
    }
    const preparadas = [];
    for (const p of preguntas) {
        const r = prepararPreguntaAdmin(p);
        if (r.error) return { error: r.error };
        preparadas.push(r.pregunta);
    }
    return { preparadas };
}

app.get('/api/admin/grupos', async (req, res) => {
    const { correo } = req.query;

    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden ver estas preguntas.' });
        }

        const [filas] = await db.query(
            `SELECT nivel, sesion, materia, COUNT(*) AS num_preguntas
             FROM banco_preguntas
             GROUP BY nivel, sesion, materia`
        );

        const grupos = filas
            .map(f => ({ nivel: f.nivel, sesion: Number(f.sesion), materia: f.materia, num_preguntas: Number(f.num_preguntas) }))
            .filter(g => NIVELES_VALIDOS.includes(g.nivel))
            .sort((a, b) =>
                NIVELES_VALIDOS.indexOf(a.nivel) - NIVELES_VALIDOS.indexOf(b.nivel) ||
                a.sesion - b.sesion ||
                MATERIAS_NIVEL.indexOf(a.materia) - MATERIAS_NIVEL.indexOf(b.materia)
            );

        res.json({ grupos });
    } catch (err) {
        console.error('❌ Error al obtener los grupos de preguntas:', err.message);
        res.status(500).json({ error: 'Error interno al obtener las preguntas.' });
    }
});

app.get('/api/admin/grupo', async (req, res) => {
    const { correo, nivel, sesion, materia } = req.query;
    if (!nivel || !sesion || !materia) {
        return res.status(400).json({ error: 'Faltan el nivel, la sesión y la materia.' });
    }

    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden editar estas preguntas.' });
        }

        const [preguntas] = await db.query(
            `SELECT id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen
             FROM banco_preguntas
             WHERE nivel = ? AND sesion = ? AND materia = ?
             ORDER BY id`,
            [nivel, Number(sesion), materia]
        );
        if (preguntas.length === 0) {
            return res.status(404).json({ error: 'No hay preguntas en ese grupo.' });
        }

        res.json({ nivel, sesion: Number(sesion), materia, preguntas });
    } catch (err) {
        console.error('❌ Error al abrir el grupo de preguntas:', err.message);
        res.status(500).json({ error: 'Error interno al abrir las preguntas.' });
    }
});

app.post('/api/admin/grupo', async (req, res) => {
    const { correo, nivel, sesion, materia, preguntas } = req.body;

    let conexion;
    const archivosGuardados = [];
    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden crear preguntas de nivel.' });
        }

        const errorDestino = validarDestinoNivel(nivel, sesion, materia);
        if (errorDestino) return res.status(400).json({ error: errorDestino });

        const validacion = prepararPreguntasAdmin(preguntas);
        if (validacion.error) return res.status(400).json({ error: validacion.error });
        const { preparadas } = validacion;

        const rutasImagenes = [];
        for (const p of preguntas) {
            if (typeof p.imagen === 'string' && p.imagen.startsWith('data:image/')) {
                const guardada = await guardarImagenDataUrl(p.imagen, 'niveles');
                archivosGuardados.push(guardada.archivo);
                rutasImagenes.push(guardada.ruta);
            } else {
                rutasImagenes.push(null);
            }
        }

        conexion = await db.getConnection();
        await conexion.beginTransaction();

        const filas = preparadas.map((q, i) => [
            nivel, Number(sesion), materia, q.enunciado,
            q.opcion_a, q.opcion_b, q.opcion_c, q.opcion_d,
            q.respuesta_correcta, rutasImagenes[i], correo
        ]);
        await conexion.query(
            `INSERT INTO banco_preguntas (nivel, sesion, materia, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen, creado_por) VALUES ?`,
            [filas]
        );

        await conexion.commit();
        console.log(`🛡️ [Admin] ${correo} añadió ${preparadas.length} preguntas a Nivel ${nivel} · Sesión ${sesion} · ${materia} (${archivosGuardados.length} con imagen).`);
        res.json({ mensaje: '¡Preguntas guardadas con éxito!' });
    } catch (err) {
        if (conexion) { try { await conexion.rollback(); } catch (e) { /* ignorar */ } }
        for (const archivo of archivosGuardados) {
            try { await fs.promises.unlink(archivo); } catch (e) { /* ignorar */ }
        }
        if (err.codigoHttp) {
            return res.status(err.codigoHttp).json({ error: err.message });
        }
        console.error('❌ Error al crear preguntas de nivel:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al guardar las preguntas.' });
    } finally {
        if (conexion) conexion.release();
    }
});

app.put('/api/admin/grupo', async (req, res) => {
    const { correo, original, nivel, sesion, materia, preguntas } = req.body;

    let conexion;
    const archivosNuevos = [];
    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden editar preguntas de nivel.' });
        }

        if (!original || !NIVELES_VALIDOS.includes(original.nivel) || !original.sesion || !original.materia) {
            return res.status(400).json({ error: 'Falta indicar qué preguntas se están editando.' });
        }

        const errorDestino = validarDestinoNivel(nivel, sesion, materia);
        if (errorDestino) return res.status(400).json({ error: errorDestino });

        const validacion = prepararPreguntasAdmin(preguntas);
        if (validacion.error) return res.status(400).json({ error: validacion.error });
        const { preparadas } = validacion;

        const [existentes] = await db.query(
            'SELECT id, imagen FROM banco_preguntas WHERE nivel = ? AND sesion = ? AND materia = ?',
            [original.nivel, Number(original.sesion), original.materia]
        );
        if (existentes.length === 0) {
            return res.status(404).json({ error: 'Esas preguntas ya no existen. Vuelve a "Pruebas creadas" e inténtalo de nuevo.' });
        }
        const imagenPorId = new Map(existentes.map(f => [f.id, f.imagen]));

        const usados = new Set();
        const plan = [];
        for (const p of preguntas) {
            let idExistente = imagenPorId.has(Number(p.id)) ? Number(p.id) : null;
            if (idExistente !== null && usados.has(idExistente)) idExistente = null;
            if (idExistente !== null) usados.add(idExistente);

            const imagenVieja = idExistente !== null ? imagenPorId.get(idExistente) : null;
            let rutaFinal = null;

            if (typeof p.imagen === 'string' && p.imagen.startsWith('data:image/')) {
                const guardada = await guardarImagenDataUrl(p.imagen, 'niveles');
                archivosNuevos.push(guardada.archivo);
                rutaFinal = guardada.ruta;
            } else if (typeof p.imagen === 'string' && imagenVieja && p.imagen === imagenVieja) {
                rutaFinal = imagenVieja;
            }

            plan.push({ idExistente, rutaFinal });
        }

        conexion = await db.getConnection();
        await conexion.beginTransaction();

        if (usados.size > 0) {
            await conexion.query(
                'DELETE FROM banco_preguntas WHERE nivel = ? AND sesion = ? AND materia = ? AND id NOT IN (?)',
                [original.nivel, Number(original.sesion), original.materia, [...usados]]
            );
        } else {
            await conexion.query(
                'DELETE FROM banco_preguntas WHERE nivel = ? AND sesion = ? AND materia = ?',
                [original.nivel, Number(original.sesion), original.materia]
            );
        }

        for (let i = 0; i < preparadas.length; i++) {
            const q = preparadas[i];
            const { idExistente, rutaFinal } = plan[i];

            if (idExistente !== null) {
                await conexion.query(
                    `UPDATE banco_preguntas
                     SET nivel = ?, sesion = ?, materia = ?, enunciado = ?,
                         opcion_a = ?, opcion_b = ?, opcion_c = ?, opcion_d = ?,
                         respuesta_correcta = ?, imagen = ?
                     WHERE id = ?`,
                    [nivel, Number(sesion), materia, q.enunciado,
                     q.opcion_a, q.opcion_b, q.opcion_c, q.opcion_d,
                     q.respuesta_correcta, rutaFinal, idExistente]
                );
            } else {
                await conexion.query(
                    `INSERT INTO banco_preguntas (nivel, sesion, materia, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen, creado_por)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [nivel, Number(sesion), materia, q.enunciado,
                     q.opcion_a, q.opcion_b, q.opcion_c, q.opcion_d,
                     q.respuesta_correcta, rutaFinal, correo]
                );
            }
        }

        await conexion.commit();
        console.log(`✏️ [Admin] ${correo} editó Nivel ${original.nivel} · Sesión ${original.sesion} · ${original.materia} -> Nivel ${nivel} · Sesión ${sesion} · ${materia} (${preparadas.length} preguntas).`);
        res.json({ mensaje: '¡Cambios guardados con éxito!' });
    } catch (err) {
        if (conexion) { try { await conexion.rollback(); } catch (e) { /* ignorar */ } }
        for (const archivo of archivosNuevos) {
            try { await fs.promises.unlink(archivo); } catch (e) { /* ignorar */ }
        }
        if (err.codigoHttp) {
            return res.status(err.codigoHttp).json({ error: err.message });
        }
        console.error('❌ Error al editar preguntas de nivel:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al editar las preguntas.' });
    } finally {
        if (conexion) conexion.release();
    }
});

app.delete('/api/admin/grupo', async (req, res) => {
    const { correo, nivel, sesion, materia } = req.query;
    if (!nivel || !sesion || !materia) {
        return res.status(400).json({ error: 'Faltan el nivel, la sesión y la materia.' });
    }

    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden eliminar preguntas de nivel.' });
        }

        const [resultado] = await db.query(
            'DELETE FROM banco_preguntas WHERE nivel = ? AND sesion = ? AND materia = ?',
            [nivel, Number(sesion), materia]
        );
        if (resultado.affectedRows === 0) {
            return res.status(404).json({ error: 'Esas preguntas ya no existen.' });
        }

        console.log(`🗑️ [Admin] ${correo} eliminó ${resultado.affectedRows} preguntas de Nivel ${nivel} · Sesión ${sesion} · ${materia}.`);
        res.json({ mensaje: 'Preguntas eliminadas.' });
    } catch (err) {
        console.error('❌ Error al eliminar preguntas de nivel:', err.message);
        res.status(500).json({ error: 'Error interno al eliminar las preguntas.' });
    }
});

const PASOS_DE_NIVEL = [
    { nivel: 'B', siguiente: 'A' },
    { nivel: 'A', siguiente: 'S' }
];

app.get('/api/admin/promedio', async (req, res) => {
    const { correo } = req.query;
    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden ver esta información.' });
        }

        const niveles = [];
        for (const paso of PASOS_DE_NIVEL) {
            const [[conteo]] = await db.query('SELECT COUNT(*) AS total FROM banco_preguntas WHERE nivel = ?', [paso.nivel]);
            const [config] = await db.query('SELECT minimo_correctas FROM config_niveles WHERE nivel = ?', [paso.nivel]);
            const total = Number(conteo.total);
            niveles.push({
                nivel: paso.nivel,
                siguiente: paso.siguiente,
                total_preguntas: total,
                minimo_correctas: config.length > 0 ? Number(config[0].minimo_correctas) : null,
                por_defecto: Math.ceil((total * Math.round(UMBRAL_APROBACION * 100)) / 100)
            });
        }
        res.json({ niveles });
    } catch (err) {
        console.error('❌ Error al obtener el promedio:', err.message);
        res.status(500).json({ error: 'Error interno al obtener el promedio.' });
    }
});

app.put('/api/admin/promedio', async (req, res) => {
    console.log('🎯 [Promedio] Cuerpo recibido:', JSON.stringify(req.body));

    const { correo } = req.body;
    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden cambiar el promedio.' });
        }

        let minimos = {};
        if (req.body.minimos && typeof req.body.minimos === 'object') {
            minimos = req.body.minimos;
        } else if (Array.isArray(req.body.niveles)) {
            req.body.niveles.forEach(n => {
                const v = n.minimo_correctas ?? n.minimo ?? n.valor;
                if (n && n.nivel && v !== undefined) minimos[n.nivel] = v;
            });
        } else {
            for (const paso of PASOS_DE_NIVEL) {
                const v = req.body[paso.nivel] ?? req.body['minimo_' + paso.nivel] ?? req.body['nivel' + paso.nivel];
                if (v !== undefined) minimos[paso.nivel] = v;
            }
        }

        if (Object.keys(minimos).length === 0) {
            return res.status(400).json({ error: 'Faltan los valores del promedio.' });
        }

        for (const paso of PASOS_DE_NIVEL) {
            if (minimos[paso.nivel] === undefined) continue;

            const valor = Number(minimos[paso.nivel]);
            const [[conteo]] = await db.query('SELECT COUNT(*) AS total FROM banco_preguntas WHERE nivel = ?', [paso.nivel]);
            const total = Number(conteo.total);

            if (total === 0) {
                return res.status(400).json({ error: 'El Nivel ' + paso.nivel + ' aún no tiene preguntas.' });
            }
            if (!Number.isInteger(valor) || valor < 1 || valor > total) {
                return res.status(400).json({ error: 'En el Nivel ' + paso.nivel + ' escribe un número entre 1 y ' + total + '.' });
            }

            await db.query(
                `INSERT INTO config_niveles (nivel, minimo_correctas) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE minimo_correctas = VALUES(minimo_correctas)`,
                [paso.nivel, valor]
            );
        }

        console.log(`🎯 [Admin] ${correo} actualizó el promedio para pasar de nivel.`);
        res.json({ mensaje: '¡Promedio guardado con éxito!' });
    } catch (err) {
        console.error('❌ Error al guardar el promedio:', err.message);
        res.status(500).json({ error: 'Error interno al guardar el promedio.' });
    }
});

function prepararPreguntasProfesor(preguntas) {
    if (!Array.isArray(preguntas) || preguntas.length === 0) {
        return { error: 'La prueba debe tener al menos una pregunta.' };
    }

    const preparadas = [];
    for (const p of preguntas) {
        if (!p || typeof p !== 'object') {
            return { error: 'Una de las preguntas no es válida.' };
        }

        const enunciado = limpiarHtmlRico(p.enunciado);
        if (!textoPlano(enunciado)) {
            return { error: 'Todas las preguntas necesitan enunciado.' };
        }

        let opciones;
        let correcta;

        if (p.modo === 'aleatoria') {
            const textoCorrecta = limpiarHtmlRico(p.texto_correcta);
            const incorrectas = Array.isArray(p.incorrectas) ? p.incorrectas.map(limpiarHtmlRico) : [];

            if (!textoPlano(textoCorrecta) || incorrectas.length !== 3 || incorrectas.some(t => !textoPlano(t))) {
                return { error: 'En modo aleatorio escribe el texto de la respuesta correcta y las 3 opciones incorrectas.' };
            }

            const mezcladas = mezclar([
                { texto: textoCorrecta, ok: true },
                ...incorrectas.map(t => ({ texto: t, ok: false }))
            ]);
            opciones = mezcladas.map(m => m.texto);
            correcta = 'ABCD'[mezcladas.findIndex(m => m.ok)];
        } else {
            opciones = [p.opcion_a, p.opcion_b, p.opcion_c, p.opcion_d].map(limpiarHtmlRico);

            if (opciones.some(o => !textoPlano(o)) || !['A', 'B', 'C', 'D'].includes(p.respuesta_correcta)) {
                return { error: 'Todas las preguntas necesitan enunciado, 4 opciones y una respuesta correcta (A, B, C o D).' };
            }
            correcta = p.respuesta_correcta;
        }

        if (opciones.some(o => o.length > MAX_LARGO_OPCION)) {
            return { error: 'Cada opción es demasiado larga (máximo ' + MAX_LARGO_OPCION + ' caracteres contando el formato).' };
        }

        preparadas.push({
            enunciado,
            opcion_a: opciones[0],
            opcion_b: opciones[1],
            opcion_c: opciones[2],
            opcion_d: opciones[3],
            respuesta_correcta: correcta
        });
    }
    return { preparadas };
}

app.post('/api/pruebas-profesor', async (req, res) => {
    const { correo, materia, titulo, preguntas } = req.body;

    if (!correo || !titulo || !titulo.trim()) {
        return res.status(400).json({ error: 'Faltan el correo y el título de la prueba.' });
    }
    if (!MATERIAS_PROFESOR.includes(materia)) {
        return res.status(400).json({ error: 'Selecciona la materia de la prueba.' });
    }
    const validacion = prepararPreguntasProfesor(preguntas);
    if (validacion.error) {
        return res.status(400).json({ error: validacion.error });
    }
    const { preparadas } = validacion;

    let conexion;
    const archivosGuardados = [];
    try {
        const [prof] = await db.query('SELECT nombre, materia FROM profesores WHERE correo = ?', [correo]);
        if (prof.length === 0) {
            return res.status(403).json({ error: 'Solo los profesores pueden crear pruebas.' });
        }

        const rutasImagenes = [];
        for (const p of preguntas) {
            if (typeof p.imagen === 'string' && p.imagen.startsWith('data:image/')) {
                const guardada = await guardarImagenDataUrl(p.imagen);
                archivosGuardados.push(guardada.archivo);
                rutasImagenes.push(guardada.ruta);
            } else {
                rutasImagenes.push(null);
            }
        }

        conexion = await db.getConnection();
        await conexion.beginTransaction();

        const [r] = await conexion.query(
            `INSERT INTO pruebas_profesor (titulo, materia, creado_por, nombre_profesor, fecha) VALUES (?, ?, ?, ?, ?)`,
            [titulo.trim(), materia, correo, prof[0].nombre, new Date().toISOString()]
        );

        const filas = preparadas.map((q, i) => [
            r.insertId, q.enunciado, q.opcion_a, q.opcion_b, q.opcion_c, q.opcion_d,
            q.respuesta_correcta, rutasImagenes[i]
        ]);
        await conexion.query(
            `INSERT INTO preguntas_profesor (prueba_id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen) VALUES ?`,
            [filas]
        );

        await conexion.commit();
        console.log(`🎉 Prueba "${titulo}" (${materia}) creada por ${correo} con ${preparadas.length} preguntas (${archivosGuardados.length} con imagen).`);
        res.json({ mensaje: '¡Prueba guardada con éxito!', id: r.insertId });
    } catch (err) {
        if (conexion) { try { await conexion.rollback(); } catch (e) { /* ignorar */ } }
        for (const archivo of archivosGuardados) {
            try { await fs.promises.unlink(archivo); } catch (e) { /* ignorar */ }
        }
        if (err.codigoHttp) {
            return res.status(err.codigoHttp).json({ error: err.message });
        }
        console.error('❌ Error al crear la prueba de profesor:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al crear la prueba.' });
    } finally {
        if (conexion) conexion.release();
    }
});

app.get('/api/pruebas-profesor/creadas', async (req, res) => {
    const { correo } = req.query;
    if (!correo) return res.status(400).json({ error: 'Falta el correo del profesor.' });

    try {
        const [filas] = await db.query(
            `SELECT p.id, p.titulo, p.materia, p.fecha, p.fecha_inicio, p.fecha_fin, p.fecha_subida, p.grados,
                    COALESCE(p.hora_inicio, '00:00') AS hora_inicio,
                    COALESCE(p.hora_fin, '23:59') AS hora_fin,
                    (SELECT COUNT(*) FROM preguntas_profesor q WHERE q.prueba_id = p.id) AS num_preguntas,
                    (SELECT COUNT(*) FROM resultados_profesor r WHERE r.prueba_id = p.id) AS num_presentaciones,
                    EXISTS(SELECT 1 FROM pruebas_almacenadas a WHERE a.origen_id = p.id AND a.creado_por = p.creado_por) AS almacenada
             FROM pruebas_profesor p
             WHERE p.creado_por = ?
             ORDER BY p.id DESC`,
            [correo]
        );

        const ahora = ahoraLocal();
        const pruebas = filas.map(f => ({
            ...f,
            grados: parsearGrados(f.grados),
            estado: calcularEstadoPrueba(f.fecha_inicio, f.fecha_fin, f.hora_inicio, f.hora_fin, ahora)
        }));
        res.json({ pruebas });
    } catch (err) {
        console.error('❌ Error al obtener pruebas creadas:', err.message);
        res.status(500).json({ error: 'Error interno al obtener las pruebas creadas.' });
    }
});

app.post('/api/pruebas-profesor/:id/subir', async (req, res) => {
    const { id } = req.params;
    const { correo, fecha_inicio, fecha_fin, hora_inicio, hora_fin, grados } = req.body;

    if (!correo) {
        return res.status(400).json({ error: 'Falta el correo del profesor.' });
    }

    const listaGrados = normalizarGrados(grados);
    if (listaGrados.length === 0) {
        return res.status(400).json({ error: 'Debes elegir al menos un grado o curso (9°, 10° u 11°).' });
    }

    if (!esFechaValida(fecha_inicio) || !esFechaValida(fecha_fin)) {
        return res.status(400).json({ error: 'Debes indicar una fecha de inicio y una de finalización válidas.' });
    }
    if (!esHoraValida(hora_inicio) || !esHoraValida(hora_fin)) {
        return res.status(400).json({ error: 'Debes indicar una hora de inicio y una de finalización válidas.' });
    }

    const hoy = hoyLocal();
    if (fecha_inicio < hoy) {
        return res.status(400).json({ error: 'La fecha de inicio no puede ser anterior a hoy.' });
    }
    if (fecha_fin < fecha_inicio) {
        return res.status(400).json({ error: 'La fecha de finalización no puede ser anterior a la fecha de inicio.' });
    }

    const inicioCompleto = fecha_inicio + ' ' + hora_inicio;
    const finCompleto = fecha_fin + ' ' + hora_fin;
    if (finCompleto <= inicioCompleto) {
        return res.status(400).json({ error: 'La hora de finalización debe ser posterior a la hora de inicio.' });
    }
    if (finCompleto < ahoraLocal()) {
        return res.status(400).json({ error: 'La fecha y hora de finalización ya pasaron.' });
    }

    try {
        const [filas] = await db.query(
            'SELECT id, titulo, creado_por, fecha_inicio FROM pruebas_profesor WHERE id = ?', [id]
        );
        if (filas.length === 0) {
            return res.status(404).json({ error: 'La prueba no existe.' });
        }
        if (filas[0].creado_por !== correo) {
            return res.status(403).json({ error: 'Solo puedes subir tus propias pruebas.' });
        }
        if (filas[0].fecha_inicio) {
            return res.status(409).json({ error: 'Esta prueba ya fue subida.' });
        }

        await db.query(
            'UPDATE pruebas_profesor SET fecha_inicio = ?, fecha_fin = ?, hora_inicio = ?, hora_fin = ?, fecha_subida = ?, grados = ? WHERE id = ?',
            [fecha_inicio, fecha_fin, hora_inicio, hora_fin, new Date().toISOString(), listaGrados.join(','), id]
        );

        const estado = calcularEstadoPrueba(fecha_inicio, fecha_fin, hora_inicio, hora_fin, ahoraLocal());
        console.log(`⬆️ [Subir prueba] ${correo} subió la prueba ${id} para ${palabraGrado(listaGrados)} ${textoGrados(listaGrados)} (${inicioCompleto} -> ${finCompleto}), estado: ${estado}.`);
        res.json({ mensaje: '¡Prueba subida con éxito!', estado, grados: listaGrados });
    } catch (err) {
        console.error('❌ Error al subir la prueba:', err.message);
        res.status(500).json({ error: 'Error interno al subir la prueba.' });
    }
});

const MENSAJE_PRUEBA_PRESENTADA = 'Esta prueba ya fue presentada por estudiantes, por eso ya no se puede editar. Si necesitas cambiarla, crea una prueba nueva.';

app.get('/api/pruebas-profesor/:id/editar', async (req, res) => {
    const { id } = req.params;
    const { correo } = req.query;
    if (!correo) return res.status(400).json({ error: 'Falta el correo del profesor.' });

    try {
        const [prueba] = await db.query(
            'SELECT id, titulo, materia, creado_por FROM pruebas_profesor WHERE id = ?', [id]
        );
        if (prueba.length === 0) return res.status(404).json({ error: 'La prueba no existe.' });
        if (prueba[0].creado_por !== correo) {
            return res.status(403).json({ error: 'Solo puedes editar tus propias pruebas.' });
        }

        const [presentaciones] = await db.query(
            'SELECT COUNT(*) AS total FROM resultados_profesor WHERE prueba_id = ?', [id]
        );
        if (presentaciones[0].total > 0) {
            return res.status(409).json({ error: MENSAJE_PRUEBA_PRESENTADA });
        }

        const [preguntas] = await db.query(
            `SELECT id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen
             FROM preguntas_profesor WHERE prueba_id = ? ORDER BY id`,
            [id]
        );

        res.json({
            prueba: { id: prueba[0].id, titulo: prueba[0].titulo, materia: prueba[0].materia },
            preguntas
        });
    } catch (err) {
        console.error('❌ Error al abrir la prueba para editarla:', err.message);
        res.status(500).json({ error: 'Error interno al abrir la prueba.' });
    }
});

app.put('/api/pruebas-profesor/:id', async (req, res) => {
    const { id } = req.params;
    const { correo, materia, titulo, preguntas } = req.body;

    if (!correo || !titulo || !titulo.trim()) {
        return res.status(400).json({ error: 'Faltan el correo y el título de la prueba.' });
    }
    if (!MATERIAS_PROFESOR.includes(materia)) {
        return res.status(400).json({ error: 'Selecciona la materia de la prueba.' });
    }
    const validacion = prepararPreguntasProfesor(preguntas);
    if (validacion.error) {
        return res.status(400).json({ error: validacion.error });
    }
    const { preparadas } = validacion;

    let conexion;
    const archivosNuevos = [];
    const rutasABorrar = [];
    try {
        const [prueba] = await db.query('SELECT id, creado_por FROM pruebas_profesor WHERE id = ?', [id]);
        if (prueba.length === 0) return res.status(404).json({ error: 'La prueba no existe.' });
        if (prueba[0].creado_por !== correo) {
            return res.status(403).json({ error: 'Solo puedes editar tus propias pruebas.' });
        }

        const [presentaciones] = await db.query(
            'SELECT COUNT(*) AS total FROM resultados_profesor WHERE prueba_id = ?', [id]
        );
        if (presentaciones[0].total > 0) {
            return res.status(409).json({ error: MENSAJE_PRUEBA_PRESENTADA });
        }

        const [existentes] = await db.query(
            'SELECT id, imagen FROM preguntas_profesor WHERE prueba_id = ?', [id]
        );
        const imagenPorId = new Map(existentes.map(f => [f.id, f.imagen]));

        const usados = new Set();
        const plan = [];
        for (const p of preguntas) {
            let idExistente = imagenPorId.has(Number(p.id)) ? Number(p.id) : null;
            if (idExistente !== null && usados.has(idExistente)) idExistente = null;
            if (idExistente !== null) usados.add(idExistente);

            const imagenVieja = idExistente !== null ? imagenPorId.get(idExistente) : null;
            let rutaFinal = null;

            if (typeof p.imagen === 'string' && p.imagen.startsWith('data:image/')) {
                const guardada = await guardarImagenDataUrl(p.imagen);
                archivosNuevos.push(guardada.archivo);
                rutaFinal = guardada.ruta;
            } else if (typeof p.imagen === 'string' && imagenVieja && p.imagen === imagenVieja) {
                rutaFinal = imagenVieja;
            }

            if (imagenVieja && rutaFinal !== imagenVieja) rutasABorrar.push(imagenVieja);
            plan.push({ idExistente, rutaFinal });
        }

        existentes.forEach(f => {
            if (!usados.has(f.id) && f.imagen) rutasABorrar.push(f.imagen);
        });

        conexion = await db.getConnection();
        await conexion.beginTransaction();

        await conexion.query(
            'UPDATE pruebas_profesor SET titulo = ?, materia = ? WHERE id = ?',
            [titulo.trim(), materia, id]
        );

        if (usados.size > 0) {
            await conexion.query(
                'DELETE FROM preguntas_profesor WHERE prueba_id = ? AND id NOT IN (?)',
                [id, [...usados]]
            );
        } else {
            await conexion.query('DELETE FROM preguntas_profesor WHERE prueba_id = ?', [id]);
        }

        for (let i = 0; i < preparadas.length; i++) {
            const q = preparadas[i];
            const { idExistente, rutaFinal } = plan[i];

            if (idExistente !== null) {
                await conexion.query(
                    `UPDATE preguntas_profesor
                     SET enunciado = ?, opcion_a = ?, opcion_b = ?, opcion_c = ?, opcion_d = ?, respuesta_correcta = ?, imagen = ?
                     WHERE id = ? AND prueba_id = ?`,
                    [q.enunciado, q.opcion_a, q.opcion_b, q.opcion_c, q.opcion_d, q.respuesta_correcta, rutaFinal, idExistente, id]
                );
            } else {
                await conexion.query(
                    `INSERT INTO preguntas_profesor (prueba_id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, q.enunciado, q.opcion_a, q.opcion_b, q.opcion_c, q.opcion_d, q.respuesta_correcta, rutaFinal]
                );
            }
        }

        await conexion.commit();

        for (const ruta of rutasABorrar) {
            await borrarImagenDeRuta(ruta);
        }

        console.log(`✏️ [Editar prueba] ${correo} editó la prueba ${id} ("${titulo.trim()}", ${materia}) - ${preparadas.length} preguntas.`);
        res.json({ mensaje: '¡Cambios guardados con éxito!' });
    } catch (err) {
        if (conexion) { try { await conexion.rollback(); } catch (e) { /* ignorar */ } }
        for (const archivo of archivosNuevos) {
            try { await fs.promises.unlink(archivo); } catch (e) { /* ignorar */ }
        }
        if (err.codigoHttp) {
            return res.status(err.codigoHttp).json({ error: err.message });
        }
        console.error('❌ Error al editar la prueba:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al editar la prueba.' });
    } finally {
        if (conexion) conexion.release();
    }
});

app.post('/api/pruebas-profesor/:id/almacenar', async (req, res) => {
    const { id } = req.params;
    const { correo } = req.body;
    if (!correo) return res.status(400).json({ error: 'Falta el correo del profesor.' });

    let conexion;
    const imagenesCopiadas = [];
    try {
        const [prueba] = await db.query(
            'SELECT id, titulo, materia, creado_por FROM pruebas_profesor WHERE id = ?', [id]
        );
        if (prueba.length === 0) return res.status(404).json({ error: 'La prueba no existe.' });
        if (prueba[0].creado_por !== correo) {
            return res.status(403).json({ error: 'Solo puedes almacenar tus propias pruebas.' });
        }

        const [yaAlmacenada] = await db.query(
            'SELECT id FROM pruebas_almacenadas WHERE origen_id = ? AND creado_por = ?', [id, correo]
        );
        if (yaAlmacenada.length > 0) {
            return res.status(409).json({ error: 'Esta prueba ya está almacenada.' });
        }

        const [preguntas] = await db.query(
            `SELECT enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen
             FROM preguntas_profesor WHERE prueba_id = ? ORDER BY id`, [id]
        );
        if (preguntas.length === 0) {
            return res.status(400).json({ error: 'La prueba no tiene preguntas para almacenar.' });
        }

        const rutas = [];
        for (const p of preguntas) {
            const nueva = await copiarImagenAlmacenada(p.imagen);
            if (nueva) imagenesCopiadas.push(nueva);
            rutas.push(nueva);
        }

        conexion = await db.getConnection();
        await conexion.beginTransaction();

        const [r] = await conexion.query(
            `INSERT INTO pruebas_almacenadas (origen_id, titulo, materia, creado_por, fecha_almacenada) VALUES (?, ?, ?, ?, ?)`,
            [id, prueba[0].titulo, prueba[0].materia, correo, new Date().toISOString()]
        );

        const filas = preguntas.map((q, i) => [
            r.insertId, q.enunciado, q.opcion_a, q.opcion_b, q.opcion_c, q.opcion_d, q.respuesta_correcta, rutas[i]
        ]);
        await conexion.query(
            `INSERT INTO preguntas_almacenadas (almacenada_id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen) VALUES ?`,
            [filas]
        );

        await conexion.commit();
        console.log(`🗂️ [Almacenar] ${correo} almacenó la prueba ${id} ("${prueba[0].titulo}").`);
        res.json({ mensaje: 'Prueba almacenada. Ya la puedes ver en "Pruebas almacenadas".' });
    } catch (err) {
        if (conexion) { try { await conexion.rollback(); } catch (e) { /* ignorar */ } }
        for (const ruta of imagenesCopiadas) await borrarImagenAlmacenada(ruta);
        console.error('❌ Error al almacenar la prueba:', err.message);
        res.status(500).json({ error: 'Error interno al almacenar la prueba.' });
    } finally {
        if (conexion) conexion.release();
    }
});

app.get('/api/pruebas-almacenadas', async (req, res) => {
    const { correo } = req.query;
    if (!correo) return res.status(400).json({ error: 'Falta el correo del profesor.' });

    try {
        const [filas] = await db.query(
            `SELECT a.id, a.titulo, a.materia, a.fecha_almacenada,
                    (SELECT COUNT(*) FROM preguntas_almacenadas q WHERE q.almacenada_id = a.id) AS num_preguntas
             FROM pruebas_almacenadas a
             WHERE a.creado_por = ?
             ORDER BY a.id DESC`,
            [correo]
        );
        res.json({ pruebas: filas });
    } catch (err) {
        console.error('❌ Error al obtener pruebas almacenadas:', err.message);
        res.status(500).json({ error: 'Error interno al obtener las pruebas almacenadas.' });
    }
});

app.delete('/api/pruebas-almacenadas/:id', async (req, res) => {
    const { id } = req.params;
    const { correo } = req.query;
    if (!correo) return res.status(400).json({ error: 'Falta el correo del profesor.' });

    try {
        const [filas] = await db.query('SELECT id, titulo, creado_por FROM pruebas_almacenadas WHERE id = ?', [id]);
        if (filas.length === 0) return res.status(404).json({ error: 'La prueba almacenada no existe.' });
        if (filas[0].creado_por !== correo) {
            return res.status(403).json({ error: 'Solo puedes eliminar tus propias pruebas almacenadas.' });
        }

        const [imagenes] = await db.query(
            'SELECT imagen FROM preguntas_almacenadas WHERE almacenada_id = ? AND imagen IS NOT NULL', [id]
        );

        await db.query('DELETE FROM pruebas_almacenadas WHERE id = ?', [id]);
        for (const f of imagenes) await borrarImagenAlmacenada(f.imagen);

        console.log(`🗑️ [Almacenadas] ${correo} eliminó la prueba almacenada ${id} ("${filas[0].titulo}").`);
        res.json({ mensaje: 'Prueba almacenada eliminada.' });
    } catch (err) {
        console.error('❌ Error al eliminar la prueba almacenada:', err.message);
        res.status(500).json({ error: 'Error interno al eliminar la prueba almacenada.' });
    }
});

app.delete('/api/pruebas-profesor/:id', async (req, res) => {
    const { id } = req.params;
    const { correo } = req.query;

    if (!correo) {
        return res.status(400).json({ error: 'Falta el correo del profesor.' });
    }

    try {
        const [filas] = await db.query('SELECT id, titulo, creado_por FROM pruebas_profesor WHERE id = ?', [id]);
        if (filas.length === 0) {
            return res.status(404).json({ error: 'La prueba no existe.' });
        }
        if (filas[0].creado_por !== correo) {
            return res.status(403).json({ error: 'Solo puedes eliminar tus propias pruebas.' });
        }

        const [imagenes] = await db.query(
            'SELECT imagen FROM preguntas_profesor WHERE prueba_id = ? AND imagen IS NOT NULL', [id]
        );

        await db.query('DELETE FROM pruebas_profesor WHERE id = ?', [id]);

        for (const fila of imagenes) {
            await borrarImagenDeRuta(fila.imagen);
        }

        console.log(`🗑️ [Eliminar prueba] ${correo} eliminó la prueba ${id} ("${filas[0].titulo}").`);
        res.json({ mensaje: 'Prueba eliminada.' });
    } catch (err) {
        console.error('❌ Error al eliminar la prueba:', err.message);
        res.status(500).json({ error: 'Error interno al eliminar la prueba.' });
    }
});

app.get('/api/pruebas-profesor/resultados', async (req, res) => {
    const { correo } = req.query;
    if (!correo) return res.status(400).json({ error: 'Falta el correo del profesor.' });

    try {
        const [filas] = await db.query(
            `SELECT r.nombre, r.correctas, r.total, r.fecha, e.grado,
                    COALESCE(r.titulo_prueba, p.titulo) AS titulo,
                    COALESCE(r.materia_prueba, p.materia) AS materia,
                    (r.prueba_id IS NULL) AS prueba_eliminada
             FROM resultados_profesor r
             LEFT JOIN pruebas_profesor p ON p.id = r.prueba_id
             LEFT JOIN estudiantes e ON e.correo = r.correo
             WHERE COALESCE(r.profesor_correo, p.creado_por) = ?
             ORDER BY r.fecha DESC`,
            [correo]
        );
        res.json({ resultados: filas });
    } catch (err) {
        console.error('❌ Error al obtener resultados de pruebas de profesor:', err.message);
        res.status(500).json({ error: 'Error interno al obtener los resultados.' });
    }
});

app.get('/api/pruebas-profesor/disponibles', async (req, res) => {
    const { correo } = req.query;
    if (!correo) return res.status(400).json({ error: 'Falta el correo del estudiante.' });

    try {
        const gradoEstudiante = await obtenerGradoEstudiante(correo);

        const [filas] = await db.query(
            `SELECT p.id, p.titulo, p.materia, p.nombre_profesor, p.fecha, p.fecha_inicio, p.fecha_fin, p.grados,
                    COALESCE(p.hora_inicio, '00:00') AS hora_inicio,
                    COALESCE(p.hora_fin, '23:59') AS hora_fin,
                    (SELECT COUNT(*) FROM preguntas_profesor q WHERE q.prueba_id = p.id) AS num_preguntas,
                    r.correctas, r.total
             FROM pruebas_profesor p
             LEFT JOIN resultados_profesor r ON r.prueba_id = p.id AND r.correo = ?
             WHERE p.fecha_inicio IS NOT NULL AND p.fecha_fin IS NOT NULL
             ORDER BY p.id DESC`,
            [correo]
        );

        const ahora = ahoraLocal();
        const pruebas = filas.map(f => {
            const grados = parsearGrados(f.grados);
            return {
                ...f,
                grados,
                grado_permitido: estudianteEnGrados(gradoEstudiante, grados),
                estado: calcularEstadoPrueba(f.fecha_inicio, f.fecha_fin, f.hora_inicio, f.hora_fin, ahora)
            };
        });
        res.json({ pruebas });
    } catch (err) {
        console.error('❌ Error al obtener pruebas disponibles:', err.message);
        res.status(500).json({ error: 'Error interno al obtener las pruebas.' });
    }
});

app.get('/api/pruebas-profesor/:id/preguntas', async (req, res) => {
    const { id } = req.params;
    const { correo } = req.query;
    if (!correo) return res.status(400).json({ error: 'Falta el correo del estudiante.' });

    try {
        const [yaPresento] = await db.query(
            'SELECT id FROM resultados_profesor WHERE prueba_id = ? AND correo = ?', [id, correo]
        );
        if (yaPresento.length > 0) {
            return res.status(409).json({ error: 'Ya presentaste esta prueba.' });
        }

        const [prueba] = await db.query(
            `SELECT id, titulo, materia, fecha_inicio, fecha_fin, grados,
                    COALESCE(hora_inicio, '00:00') AS hora_inicio,
                    COALESCE(hora_fin, '23:59') AS hora_fin
             FROM pruebas_profesor WHERE id = ?`, [id]
        );
        if (prueba.length === 0) return res.status(404).json({ error: 'La prueba no existe.' });

        const estado = calcularEstadoPrueba(prueba[0].fecha_inicio, prueba[0].fecha_fin, prueba[0].hora_inicio, prueba[0].hora_fin, ahoraLocal());
        if (estado === 'sin_subir') {
            return res.status(403).json({ error: 'Esta prueba todavía no está disponible.' });
        }

        const gradosPrueba = parsearGrados(prueba[0].grados);
        const gradoEstudiante = await obtenerGradoEstudiante(correo);
        if (!estudianteEnGrados(gradoEstudiante, gradosPrueba)) {
            return res.status(403).json({
                error: 'Esta prueba es solo para estudiantes de ' + palabraGrado(gradosPrueba) + ' ' + textoGrados(gradosPrueba) + '.'
            });
        }

        if (estado === 'programada') {
            return res.status(403).json({ error: 'Esta prueba está bloqueada. Se desbloquea el ' + fechaParaMensaje(prueba[0].fecha_inicio) + ' a las ' + prueba[0].hora_inicio + '.' });
        }
        if (estado === 'finalizada') {
            return res.status(403).json({ error: 'El plazo para presentar esta prueba terminó el ' + fechaParaMensaje(prueba[0].fecha_fin) + ' a las ' + prueba[0].hora_fin + '.' });
        }

        const [preguntas] = await db.query(
            `SELECT id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, imagen FROM preguntas_profesor WHERE prueba_id = ? ORDER BY id`,
            [id]
        );
        res.json({
            prueba: { id: prueba[0].id, titulo: prueba[0].titulo, materia: prueba[0].materia },
            preguntas
        });
    } catch (err) {
        console.error('❌ Error al obtener preguntas de la prueba:', err.message);
        res.status(500).json({ error: 'Error interno al obtener las preguntas.' });
    }
});

app.post('/api/pruebas-profesor/:id/calificar', async (req, res) => {
    const { id } = req.params;
    const { correo, nombre, respuestas } = req.body;

    if (!correo || !nombre || !Array.isArray(respuestas)) {
        return res.status(400).json({ error: 'Faltan datos para calificar la prueba.' });
    }

    try {
        const [prueba] = await db.query(
            `SELECT titulo, materia, creado_por, fecha_inicio, fecha_fin, grados,
                    COALESCE(hora_inicio, '00:00') AS hora_inicio,
                    COALESCE(hora_fin, '23:59') AS hora_fin
             FROM pruebas_profesor WHERE id = ?`, [id]
        );
        if (prueba.length === 0) return res.status(404).json({ error: 'La prueba no existe o no tiene preguntas.' });

        const estado = calcularEstadoPrueba(prueba[0].fecha_inicio, prueba[0].fecha_fin, prueba[0].hora_inicio, prueba[0].hora_fin, ahoraLocal());
        if (estado === 'sin_subir' || estado === 'programada') {
            return res.status(403).json({ error: 'Esta prueba todavía no está disponible.' });
        }

        const gradosPrueba = parsearGrados(prueba[0].grados);
        const gradoEstudiante = await obtenerGradoEstudiante(correo);
        if (!estudianteEnGrados(gradoEstudiante, gradosPrueba)) {
            return res.status(403).json({
                error: 'Esta prueba es solo para estudiantes de ' + palabraGrado(gradosPrueba) + ' ' + textoGrados(gradosPrueba) + '.'
            });
        }

        const [preguntas] = await db.query(
            'SELECT id, respuesta_correcta FROM preguntas_profesor WHERE prueba_id = ?', [id]
        );
        if (preguntas.length === 0) return res.status(404).json({ error: 'La prueba no existe o no tiene preguntas.' });

        const elegidas = {};
        respuestas.forEach(r => { elegidas[r.pregunta_id] = r.opcion_elegida; });

        let correctas = 0;
        preguntas.forEach(p => { if (elegidas[p.id] === p.respuesta_correcta) correctas++; });
        const total = preguntas.length;

        await db.query(
            `INSERT INTO resultados_profesor (prueba_id, correo, nombre, correctas, total, fecha, titulo_prueba, materia_prueba, profesor_correo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, correo, nombre, correctas, total, new Date().toISOString(), prueba[0].titulo, prueba[0].materia, prueba[0].creado_por]
        );
        console.log(`🎯 [Prueba profesor ${id}] ${correo}: ${correctas}/${total}`);
        res.json({ correctas, total });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Ya presentaste esta prueba.' });
        }
        console.error('❌ Error al calificar prueba de profesor:', err.message);
        res.status(500).json({ error: 'Error interno al calificar.' });
    }
});

app.post('/api/examen/incidente', async (req, res) => {
    const { correo, tipo, referencia, motivo } = req.body;

    if (!correo || !motivo) {
        return res.status(400).json({ error: 'Faltan datos del incidente.' });
    }

    try {
        const [est] = await db.query('SELECT nombre FROM estudiantes WHERE correo = ?', [correo]);
        if (est.length === 0) {
            return res.status(403).json({ error: 'Solo se registran incidentes de estudiantes.' });
        }

        await db.query(
            `INSERT INTO incidentes_examen (correo, nombre, tipo_examen, referencia, motivo, fecha) VALUES (?, ?, ?, ?, ?, ?)`,
            [
                correo,
                est[0].nombre,
                String(tipo || '').slice(0, 20),
                String(referencia || '').slice(0, 255),
                String(motivo).slice(0, 100),
                new Date().toISOString()
            ]
        );
        console.log(`⛔ [Incidente] ${correo} (${tipo}, ${referencia}): ${motivo}`);
        res.json({ mensaje: 'Incidente registrado.' });
    } catch (err) {
        console.error('❌ Error al registrar el incidente:', err.message);
        res.status(500).json({ error: 'Error interno al registrar el incidente.' });
    }
});

app.post('/api/calificar', async (req, res) => {
    const { respuestas, correo, nombre, nivel, sesion } = req.body;
    console.log(`\n✅ [Calificar] ${nombre} (${correo}) - Nivel ${nivel}, Sesión ${sesion} - ${respuestas ? respuestas.length : 0} respuestas.`);

    if (!Array.isArray(respuestas) || respuestas.length === 0) {
        return res.status(400).json({ error: 'No se recibieron respuestas para calificar.' });
    }

    try {
        if (correo && nivel && sesion) {
            const intentoActual = await obtenerIntentoActual(correo, nivel);
            const [yaExiste] = await db.query(
                'SELECT id FROM resultados WHERE correo = ? AND nivel = ? AND sesion = ? AND intento = ?',
                [correo, nivel, sesion, intentoActual]
            );
            if (yaExiste.length > 0) {
                console.log(`⛔ [Calificar] ${correo} ya había presentado la Sesión ${sesion} del Nivel ${nivel} (intento ${intentoActual}). Petición rechazada.`);
                return res.status(409).json({
                    error: 'Ya presentaste esta sesión. Usa "Repetir prueba" si quieres intentarlo de nuevo.'
                });
            }
        }

        const ids = respuestas.map(r => r.pregunta_id);
        const placeholders = ids.map(() => '?').join(',');
        const [filas] = await db.query(
            `SELECT id, materia, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen FROM banco_preguntas WHERE id IN (${placeholders})`,
            ids
        );

        const infoPorId = {};
        filas.forEach(f => infoPorId[f.id] = f);

        let correctas = 0;
        respuestas.forEach(r => {
            const info = infoPorId[r.pregunta_id];
            if (info && info.respuesta_correcta === r.opcion_elegida) correctas++;
        });

        const total = respuestas.length;
        console.log(`🎯 Resultado: ${correctas}/${total} correctas.`);

        if (correo && nombre && nivel && sesion) {
            const fecha = new Date().toISOString();
            const intentoActual = await obtenerIntentoActual(correo, nivel);
            const [insertResult] = await db.query(
                `INSERT INTO resultados (correo, nombre, nivel, sesion, intento, correctas, total, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [correo, nombre, nivel, sesion, intentoActual, correctas, total, fecha]
            );
            const resultadoId = insertResult.insertId;
            console.log(`💾 Resultado guardado en la tabla resultados (intento ${intentoActual}, id ${resultadoId}).`);

            const filasDetalle = respuestas
                .map(r => {
                    const info = infoPorId[r.pregunta_id];
                    if (!info) return null;
                    const esCorrecta = info.respuesta_correcta === r.opcion_elegida ? 1 : 0;
                    return [
                        resultadoId, r.pregunta_id, info.materia, info.enunciado,
                        info.opcion_a, info.opcion_b, info.opcion_c, info.opcion_d,
                        r.opcion_elegida, info.respuesta_correcta, esCorrecta, info.imagen || null
                    ];
                })
                .filter(Boolean);

            if (filasDetalle.length > 0) {
                await db.query(
                    `INSERT INTO respuestas_detalle (resultado_id, pregunta_id, materia, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, opcion_elegida, respuesta_correcta, es_correcta, imagen) VALUES ?`,
                    [filasDetalle]
                );
                console.log(`💾 Detalle de ${filasDetalle.length} preguntas guardado para el resultado ${resultadoId}.`);
            }
        } else {
            console.log("⚠️ No se guardó el resultado: faltan correo, nombre, nivel o sesión en la petición.");
        }

        res.json({ correctas, total });
    } catch (err) {
        console.error("❌ Error al calificar:", err.message);
        res.status(500).json({ error: 'Error interno al calificar.' });
    }
});

app.get('/api/sesion-completada', async (req, res) => {
    const { correo, nivel, sesion } = req.query;

    if (!correo || !nivel || !sesion) {
        return res.status(400).json({ error: 'Faltan parámetros: correo, nivel y sesion son obligatorios.' });
    }

    try {
        const intentoActual = await obtenerIntentoActual(correo, nivel);
        const [filas] = await db.query(
            `SELECT COUNT(*) AS total FROM resultados WHERE correo = ? AND nivel = ? AND sesion = ? AND intento = ?`,
            [correo, nivel, sesion, intentoActual]
        );
        res.json({ completada: filas[0].total > 0 });
    } catch (err) {
        console.error("❌ Error al verificar sesión completada:", err.message);
        res.status(500).json({ error: 'Error interno al verificar la sesión.' });
    }
});

async function obtenerMinimoNivel(nivel, totalPreguntas) {
    const [filas] = await db.query('SELECT minimo_correctas FROM config_niveles WHERE nivel = ?', [nivel]);
    if (filas.length > 0) {
        return Math.min(Number(filas[0].minimo_correctas), totalPreguntas);
    }
    return Math.ceil((totalPreguntas * Math.round(UMBRAL_APROBACION * 100)) / 100);
}

app.get('/api/nivel-aprobado', async (req, res) => {
    const { correo, nivel } = req.query;

    if (!correo || !nivel) {
        return res.status(400).json({ error: 'Faltan parámetros: correo y nivel son obligatorios.' });
    }

    try {
        const intentoActual = await obtenerIntentoActual(correo, nivel);

        const [filas] = await db.query(
            `SELECT r.sesion, r.correctas, r.total
             FROM resultados r
             WHERE r.correo = ? AND r.nivel = ? AND r.intento = ?
               AND r.id = (
                   SELECT MAX(r2.id) FROM resultados r2
                   WHERE r2.correo = r.correo AND r2.nivel = r.nivel
                     AND r2.intento = r.intento AND r2.sesion = r.sesion
               )
             ORDER BY r.sesion`,
            [correo, nivel, intentoActual]
        );

        const totalCorrectas = filas.reduce((acc, f) => acc + Number(f.correctas), 0);
        const totalPreguntas = filas.reduce((acc, f) => acc + Number(f.total), 0);
        const tieneIntento = totalPreguntas > 0;
        const porcentaje = tieneIntento ? totalCorrectas / totalPreguntas : 0;

        const ambasSesiones = filas.some(f => Number(f.sesion) === 1) && filas.some(f => Number(f.sesion) === 2);
        const minimoCorrectas = await obtenerMinimoNivel(nivel, totalPreguntas);
        const aprobado = tieneIntento && ambasSesiones && totalCorrectas >= minimoCorrectas;

        res.json({
            tieneIntento,
            aprobado,
            porcentaje,
            totalCorrectas,
            totalPreguntas,
            minimoCorrectas,
            sesiones: filas.map(f => ({
                sesion: f.sesion,
                correctas: Number(f.correctas),
                total: Number(f.total)
            }))
        });
    } catch (err) {
        console.error("❌ Error al verificar aprobación del nivel:", err.message);
        res.status(500).json({ error: 'Error interno al verificar la aprobación del nivel.' });
    }
});

app.post('/api/repetir-nivel', async (req, res) => {
    const { correo, nivel } = req.body;
    console.log(`\n🔄 [Repetir nivel] ${correo} quiere repetir el nivel ${nivel}.`);

    if (!correo || !nivel) {
        return res.status(400).json({ error: 'Faltan parámetros: correo y nivel son obligatorios.' });
    }

    try {
        await db.query(
            `INSERT INTO intentos_nivel (correo, nivel, intento_actual) VALUES (?, ?, 2)
             ON DUPLICATE KEY UPDATE intento_actual = intento_actual + 1`,
            [correo, nivel]
        );
        console.log(`🔁 Nuevo intento activado para ${correo} en el nivel ${nivel}. Los resultados anteriores se conservan intactos.`);
        res.json({ mensaje: 'Nivel reiniciado. La Sesión 2 quedó bloqueada nuevamente y puedes presentar la Sesión 1 desde cero.\nTu historial y tu puntaje actual anteriores NO se perdieron.' });
    } catch (err) {
        console.error("❌ Error al repetir nivel:", err.message);
        res.status(500).json({ error: 'Error interno al repetir el nivel.' });
    }
});

app.get('/api/mis-puntajes', async (req, res) => {
    const { correo } = req.query;
    if (!correo) {
        return res.status(400).json({ error: 'Falta el correo del estudiante.' });
    }

    try {
        const [filas] = await db.query(
            `SELECT id, nivel, sesion, correctas, total, fecha FROM resultados WHERE correo = ? ORDER BY fecha DESC`,
            [correo]
        );
        res.json({ puntajes: filas });
    } catch (err) {
        console.error("❌ Error al obtener puntajes:", err.message);
        res.status(500).json({ error: 'Error interno al obtener los puntajes.' });
    }
});

app.get('/api/resultado-materias', async (req, res) => {
    const { resultado_id, correo } = req.query;

    if (!resultado_id || !correo) {
        return res.status(400).json({ error: 'Faltan parámetros: resultado_id y correo son obligatorios.' });
    }

    try {
        const [propietario] = await db.query('SELECT correo FROM resultados WHERE id = ?', [resultado_id]);
        if (propietario.length === 0 || propietario[0].correo !== correo) {
            return res.status(403).json({ error: 'No autorizado para ver este resultado.' });
        }

        const [filas] = await db.query(
            `SELECT materia, SUM(es_correcta) AS correctas, COUNT(*) AS total FROM respuestas_detalle WHERE resultado_id = ? GROUP BY materia`,
            [resultado_id]
        );
        res.json({ materias: filas });
    } catch (err) {
        console.error("❌ Error al obtener materias del resultado:", err.message);
        res.status(500).json({ error: 'Error interno al obtener las materias.' });
    }
});

app.get('/api/resultado-preguntas', async (req, res) => {
    const { resultado_id, materia, correo } = req.query;

    if (!resultado_id || !materia || !correo) {
        return res.status(400).json({ error: 'Faltan parámetros: resultado_id, materia y correo son obligatorios.' });
    }

    try {
        const [propietario] = await db.query('SELECT correo FROM resultados WHERE id = ?', [resultado_id]);
        if (propietario.length === 0 || propietario[0].correo !== correo) {
            return res.status(403).json({ error: 'No autorizado para ver este resultado.' });
        }

        const [filas] = await db.query(
            `SELECT pregunta_id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, opcion_elegida, respuesta_correcta, es_correcta, imagen FROM respuestas_detalle WHERE resultado_id = ? AND materia = ? ORDER BY id`,
            [resultado_id, materia]
        );
        res.json({ preguntas: filas });
    } catch (err) {
        console.error("❌ Error al obtener preguntas del resultado:", err.message);
        res.status(500).json({ error: 'Error interno al obtener las preguntas.' });
    }
});

app.get('/api/todos-los-resultados', async (req, res) => {
    try {
        const [filas] = await db.query(
            `SELECT r.correo, r.nombre, r.nivel, r.sesion, r.correctas, r.total, r.fecha, e.grado
             FROM resultados r
             LEFT JOIN estudiantes e ON e.correo = r.correo
             ORDER BY r.fecha DESC`
        );
        res.json({ resultados: filas });
    } catch (err) {
        console.error("❌ Error al obtener todos los resultados:", err.message);
        res.status(500).json({ error: 'Error interno al obtener los resultados.' });
    }
});

app.get('/api/ranking', async (req, res) => {
    try {
        const niveles = ['B', 'A', 'S'];
        const rankingPorNivel = {};

        for (const nivel of niveles) {
            const [intentos] = await db.query(
                'SELECT correo, intento_actual FROM intentos_nivel WHERE nivel = ?',
                [nivel]
            );
            const intentoMap = {};
            intentos.forEach(i => { intentoMap[i.correo] = i.intento_actual; });

            const [filas] = await db.query(
                `SELECT r.correo, r.nombre, r.sesion, r.intento, r.correctas, r.total, e.grado
                 FROM resultados r
                 LEFT JOIN estudiantes e ON e.correo = r.correo
                 WHERE r.nivel = ?
                   AND r.id = (
                       SELECT MAX(r2.id) FROM resultados r2
                       WHERE r2.correo = r.correo AND r2.nivel = r.nivel
                         AND r2.intento = r.intento AND r2.sesion = r.sesion
                   )`,
                [nivel]
            );

            const porEstudiante = {};
            filas.forEach(f => {
                const intentoActual = intentoMap[f.correo] || 1;
                if (f.intento !== intentoActual) return;

                if (!porEstudiante[f.correo]) {
                    porEstudiante[f.correo] = {
                        nombre: f.nombre,
                        grado: f.grado,
                        sesiones: new Set(),
                        correctas: 0,
                        total: 0
                    };
                }
                porEstudiante[f.correo].sesiones.add(f.sesion);
                porEstudiante[f.correo].correctas += f.correctas;
                porEstudiante[f.correo].total += f.total;
            });

            const lista = Object.values(porEstudiante)
                .filter(e => e.sesiones.has(1) && e.sesiones.has(2))
                .map(e => ({
                    nombre: e.nombre,
                    grado: e.grado,
                    correctas: e.correctas,
                    total: e.total,
                    porcentaje: e.total > 0 ? e.correctas / e.total : 0
                }))
                .sort((a, b) => b.porcentaje - a.porcentaje || b.correctas - a.correctas);

            rankingPorNivel[nivel] = lista;
        }

        res.json({ ranking: rankingPorNivel });
    } catch (err) {
        console.error("❌ Error al obtener ranking:", err.message);
        res.status(500).json({ error: 'Error interno al obtener el ranking.' });
    }
});

// ===================================================
// ARRANCAR: primero la base de datos, luego el servidor
// ===================================================
(async () => {
    try {
        await iniciarBaseDeDatos();
        app.listen(3000, () => {
            console.log('===================================================');
            console.log(' ✨  ¡PLATAFORMA PRE-ICFES ONLINE ACTIVA CON ÉXITO! ✨ ');
            console.log(' 🚀  Ingresa aquí para programar: http://localhost:3000');
            console.log('===================================================');
        });
    } catch (err) {
        console.error('❌ No se pudo iniciar la base de datos:', err.message);
        console.error('   Verifica que MySQL esté corriendo en XAMPP (módulo en verde).');
    }
})();