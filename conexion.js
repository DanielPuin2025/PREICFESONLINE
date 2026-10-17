require('dotenv').config();

const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// Limpia el HTML que llega del editor enriquecido (Quill). Instalar con:  npm install sanitize-html
const sanitizeHtml = require('sanitize-html');

const app = express();
// Límite alto porque las imágenes de las pruebas viajan en base64
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
    if (/\.(?:db|sqlite|sql|zip)$/i.test(req.path)) {
        return res.sendStatus(404);
    }
    next();
});

let db; // pool de conexiones a MySQL, se asigna en iniciarBaseDeDatos()

// Porcentaje mínimo para aprobar un nivel si el administrador NO configuró el botón "Promedio".
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

// ===================================================
// 🧪 PRUEBAS DE CADA NIVEL (Prueba 1, 2 y 3)
// Cada nivel (B, A, S) tiene varias pruebas; cada prueba tiene sus 2 sesiones.
// Los intentos ("Repetir prueba"), los resultados y las preguntas se manejan por prueba.
// ===================================================
const PRUEBAS_VALIDAS = [1, 2, 3];

function numeroPrueba(valor, porDefecto = 1) {
    const n = Number(valor);
    return PRUEBAS_VALIDAS.includes(n) ? n : porDefecto;
}

// Intento actualmente activo de un estudiante en un nivel y prueba (1 si nunca repitió).
async function obtenerIntentoActual(correo, nivel, prueba = 1) {
    const [filas] = await db.query(
        'SELECT intento_actual FROM intentos_nivel WHERE correo = ? AND nivel = ? AND prueba = ?',
        [correo, nivel, numeroPrueba(prueba)]
    );
    return filas.length > 0 ? filas[0].intento_actual : 1;
}

// ===================================================
// ✏️ TEXTO ENRIQUECIDO (HTML del editor Quill)
// ===================================================
const CONFIG_HTML_RICO = {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'ul', 'ol', 'li', 'blockquote'],
    allowedAttributes: {}
};
const CONFIG_SOLO_TEXTO = { allowedTags: [], allowedAttributes: {} };

function limpiarHtmlRico(html) {
    if (typeof html !== 'string') return '';
    return sanitizeHtml(html, CONFIG_HTML_RICO).trim();
}

// Texto visible sin etiquetas (un editor vacío de Quill devuelve "<p><br></p>")
function textoPlano(html) {
    return sanitizeHtml(String(html || ''), CONFIG_SOLO_TEXTO).replace(/&nbsp;|\u00a0/g, ' ').trim();
}

// ===================================================
// 📅 FECHAS Y HORAS DE LAS PRUEBAS DE PROFESORES
// ===================================================
const ZONA_HORARIA = 'America/Bogota';

function partesAhora() {
    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: ZONA_HORARIA,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date());

    const resultado = {};
    partes.forEach(parte => { resultado[parte.type] = parte.value; });
    return resultado;
}

function hoyLocal() {
    const ahora = partesAhora();
    return `${ahora.year}-${ahora.month}-${ahora.day}`;
}

function ahoraLocal() {
    const ahora = partesAhora();
    return `${ahora.year}-${ahora.month}-${ahora.day} ${ahora.hour}:${ahora.minute}`;
}

function esFechaValida(texto) {
    if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
    const [a, m, d] = texto.split('-').map(Number);
    const f = new Date(a, m - 1, d);
    return f.getFullYear() === a && f.getMonth() === m - 1 && f.getDate() === d;
}

function esHoraValida(texto) {
    return typeof texto === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(texto);
}

function fechaParaMensaje(texto) {
    return texto ? texto.split('-').reverse().join('/') : '';
}

// 'sin_subir' | 'programada' | 'activa' | 'finalizada'
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
// ===================================================
const GRADOS_VALIDOS = [9, 10, 11];
const GRADOS_REGISTRO = ['9-A', '9-B', '9-C', '10-A', '10-B', '10-C', '11-A', '11-B', '11-C'];

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

const TIPOS_PQRS = ['Ayuda', 'Petición', 'Queja', 'Reclamo', 'Sugerencia'];

// ===================================================
// 🛡️ BANCO DE PREGUNTAS DE LOS NIVELES (B, A, S) — administrador
// ===================================================
const NIVELES_VALIDOS = ['B', 'A', 'S'];
const MATERIAS_NIVEL = ['Lectura Crítica', 'Matemáticas', 'C. Ciudadanas', 'C. Naturales', 'Inglés'];
const MATERIAS_POR_SESION = {
    1: ['Lectura Crítica', 'Matemáticas', 'C. Ciudadanas', 'C. Naturales'],
    2: ['Matemáticas', 'C. Ciudadanas', 'C. Naturales', 'Inglés']
};

const MAX_LARGO_OPCION = 5000;
const LETRAS_CURSO = ['A', 'B', 'C'];
const LETRAS_BANCO = 'ABCDEFGH';
const PREFIJO_BANCO = 'BANCO::';
const LETRAS_RESPUESTA = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

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

function parsearGrados(texto) {
    if (!texto) return [];
    return normalizarGrados(String(texto).split(','));
}

function textoGrados(lista) {
    const partes = lista.map(g => (/^\d+$/.test(g) ? g + '°' : g));
    if (partes.length <= 1) return partes.join('');
    return partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1];
}

function palabraGrado(lista) {
    return lista.length === 1 ? 'grado' : 'grados';
}

async function obtenerGradoEstudiante(correo) {
    const [filas] = await db.query('SELECT grado FROM estudiantes WHERE correo = ?', [correo]);
    if (filas.length === 0) return null;
    return String(filas[0].grado).trim().toUpperCase();
}

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
// ===================================================
const DATA_DIR = path.resolve(process.env.DATA_DIR || __dirname);
const CARPETA_IMAGENES = path.join(DATA_DIR, 'imagenes-profesores');
const CARPETA_IMAGENES_NIVELES = path.join(DATA_DIR, 'imagenes-preguntas');
const CARPETA_IMAGENES_ALMACENADAS = path.join(DATA_DIR, 'imagenes-almacenadas');
const CARPETA_IMAGENES_OPCIONES = path.join(DATA_DIR, 'imagenes-opciones');

app.use('/imagenes-profesores', express.static(CARPETA_IMAGENES));
app.use('/imagenes-preguntas', express.static(CARPETA_IMAGENES_NIVELES));
app.use('/imagenes-almacenadas', express.static(CARPETA_IMAGENES_ALMACENADAS));
app.use('/imagenes-opciones', express.static(CARPETA_IMAGENES_OPCIONES));
app.use(express.static(__dirname));

async function copiarImagenAlmacenada(ruta) {
    if (!ruta) return null;
    const origen = path.join(CARPETA_IMAGENES, path.basename(ruta));
    const extension = path.extname(origen) || '.jpg';
    const nombre = `al-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`;
    try {
        await fs.promises.copyFile(origen, path.join(CARPETA_IMAGENES_ALMACENADAS, nombre));
    } catch (e) {
        return null;
    }
    return '/imagenes-almacenadas/' + nombre;
}

async function borrarImagenAlmacenada(ruta) {
    if (!ruta) return;
    try {
        await fs.promises.unlink(path.join(CARPETA_IMAGENES_ALMACENADAS, path.basename(ruta)));
    } catch (e) { /* si ya no existe, no pasa nada */ }
}

async function copiarImagenDesdeAlmacenada(ruta) {
    if (!ruta) return null;
    const origen = path.join(CARPETA_IMAGENES_ALMACENADAS, path.basename(ruta));
    const extension = path.extname(origen) || '.jpg';
    const nombre = `pp-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`;
    try {
        await fs.promises.copyFile(origen, path.join(CARPETA_IMAGENES, nombre));
    } catch (e) {
        return null;
    }
    return '/imagenes-profesores/' + nombre;
}

const MAX_BYTES_IMAGEN = 8 * 1024 * 1024; // 8 MB por imagen

const DESTINOS_IMAGEN = {
    profesores: { carpeta: CARPETA_IMAGENES, urlBase: '/imagenes-profesores/', prefijo: 'pp' },
    niveles: { carpeta: CARPETA_IMAGENES_NIVELES, urlBase: '/imagenes-preguntas/', prefijo: 'nv' },
    almacenadas: { carpeta: CARPETA_IMAGENES_ALMACENADAS, urlBase: '/imagenes-almacenadas/', prefijo: 'al' },
    opciones: { carpeta: CARPETA_IMAGENES_OPCIONES, urlBase: '/imagenes-opciones/', prefijo: 'op' }
};

function errorImagen(mensaje) {
    const e = new Error(mensaje);
    e.codigoHttp = 400;
    return e;
}

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

const REGEX_RUTA_IMAGEN_OPCION = /^\/imagenes-opciones\/op-[A-Za-z0-9-]+\.(png|jpg|gif|webp)$/;

function imagenOpcionCruda(valor) {
    if (typeof valor !== 'string' || !valor) return null;
    if (valor.startsWith('data:image/') || REGEX_RUTA_IMAGEN_OPCION.test(valor)) return valor;
    return null;
}

// Guarda las imágenes nuevas de las opciones y las pega al final del HTML de cada opción.
async function resolverImagenesOpciones(preparadas, archivosGuardados) {
    const letras = ['a', 'b', 'c', 'd'];
    for (const q of preparadas) {
        for (let i = 0; i < 4; i++) {
            const cruda = q.imagenes ? q.imagenes[i] : null;
            if (!cruda) continue;

            let ruta = cruda;
            if (cruda.startsWith('data:image/')) {
                const guardada = await guardarImagenDataUrl(cruda, 'opciones');
                archivosGuardados.push(guardada.archivo);
                ruta = guardada.ruta;
            }
            q['opcion_' + letras[i]] +=
                '<img class="opcion-img" src="' + ruta + '" alt="Imagen de la opción" draggable="false">';
        }
    }
}

async function borrarImagenDeRuta(ruta) {
    if (!ruta) return;
    try {
        await fs.promises.unlink(path.join(CARPETA_IMAGENES, path.basename(ruta)));
    } catch (e) { /* si ya no existe, no pasa nada */ }
}

// ===================================================
// CONEXIÓN E INICIALIZACIÓN DE LA BASE DE DATOS
// ===================================================

// Convierte a TEXT las opciones que en instalaciones anteriores eran VARCHAR(500)
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

// Añade la columna "prueba" (Prueba 1, 2, 3) a las tablas de los niveles.
// Todo lo que ya existía queda como Prueba 1.
async function agregarColumnaPrueba() {
    for (const tabla of ['banco_preguntas', 'resultados']) {
        try {
            await db.query('ALTER TABLE ' + tabla + ' ADD COLUMN prueba INT NOT NULL DEFAULT 1');
            console.log('🔧 Columna "prueba" añadida a la tabla ' + tabla + ' (lo existente queda como Prueba 1).');
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') {
                console.error('❌ Error al añadir la columna prueba en ' + tabla + ':', err.message);
            }
        }
    }

    // intentos_nivel: la llave primaria pasa de (correo, nivel) a (correo, nivel, prueba)
    try {
        const [cols] = await db.query(
            `SELECT 1 FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'intentos_nivel' AND COLUMN_NAME = 'prueba'`
        );
        if (cols.length === 0) {
            await db.query('ALTER TABLE intentos_nivel ADD COLUMN prueba INT NOT NULL DEFAULT 1');
            await db.query('ALTER TABLE intentos_nivel DROP PRIMARY KEY, ADD PRIMARY KEY (correo, nivel, prueba)');
            console.log('🔧 Tabla intentos_nivel actualizada: ahora los intentos se llevan por prueba.');
        }
    } catch (err) {
        console.error('❌ Error al actualizar intentos_nivel:', err.message);
    }
}

async function iniciarBaseDeDatos() {
    // 0) Carpetas de imágenes
    await fs.promises.mkdir(CARPETA_IMAGENES, { recursive: true });
    await fs.promises.mkdir(CARPETA_IMAGENES_NIVELES, { recursive: true });
    await fs.promises.mkdir(CARPETA_IMAGENES_ALMACENADAS, { recursive: true });
    await fs.promises.mkdir(CARPETA_IMAGENES_OPCIONES, { recursive: true });

    const dbHost = process.env.DB_HOST || 'localhost';
    const dbUser = process.env.DB_USER || 'root';
    const dbPassword = process.env.DB_PASSWORD ?? '';
    const dbName = process.env.DB_NAME || 'preicfes';

    if (!/^[A-Za-z0-9_$]+$/.test(dbName)) {
        throw new Error('DB_NAME solo puede contener letras, números, guion bajo y signo de dólar.');
    }

    if (process.env.NODE_ENV === 'production') {
        if (!process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) {
            throw new Error('En producción configura DB_USER, DB_PASSWORD y DB_NAME en el archivo .env.');
        }
    } else {
        const conexionInicial = await mysql.createConnection({
            host: dbHost,
            user: dbUser,
            password: dbPassword
        });
        await conexionInicial.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
        await conexionInicial.end();
    }

    db = await mysql.createPool({
        host: dbHost,
        user: dbUser,
        password: dbPassword,
        database: dbName,
        waitForConnections: true,
        connectionLimit: 10
    });

    console.log(`✅ Conectado a MySQL, base de datos: ${dbName}`);

    // 3) Tablas de usuarios
    await db.query(`CREATE TABLE IF NOT EXISTS estudiantes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        contrasena VARCHAR(255) NOT NULL,
        grado VARCHAR(20) NOT NULL,
        codigo_unico VARCHAR(100) DEFAULT NULL,
        correo VARCHAR(255) UNIQUE NOT NULL
    )`);

    try {
        await db.query('ALTER TABLE estudiantes ADD COLUMN codigo_unico VARCHAR(100) DEFAULT NULL');
        console.log('🔧 Columna "codigo_unico" añadida a la tabla estudiantes.');
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
        console.log('🔧 Columna "codigo_unico" añadida a la tabla profesores.');
    } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('❌ Error al verificar/añadir la columna codigo_unico en profesores:', err.message);
        }
    }

    await db.query(`CREATE TABLE IF NOT EXISTS administradores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        contrasena VARCHAR(255) NOT NULL,
        codigo_unico VARCHAR(100) DEFAULT NULL,
        correo VARCHAR(255) UNIQUE NOT NULL
    )`);

    try {
        await db.query('ALTER TABLE administradores ADD COLUMN codigo_unico VARCHAR(100) DEFAULT NULL');
        console.log('🔧 Columna "codigo_unico" añadida a la tabla administradores.');
    } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('❌ Error al verificar/añadir codigo_unico en administradores:', err.message);
        }
    }

    // Banco de preguntas de los niveles. 'prueba' = Prueba 1, 2 o 3 del nivel.
    await db.query(`CREATE TABLE IF NOT EXISTS banco_preguntas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nivel VARCHAR(5) NOT NULL,
        prueba INT NOT NULL DEFAULT 1,
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
        await db.query('ALTER TABLE banco_preguntas ADD COLUMN aleatoria TINYINT(1) NOT NULL DEFAULT 0');
        console.log('🔧 Columna "aleatoria" añadida a banco_preguntas.');
    } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('❌ Error al añadir la columna aleatoria:', err.message);
        }
    }

    // "con_anterior" = 1 significa que la pregunta depende del texto de la pregunta
    // anterior. Al ordenar al azar, esa pregunta se queda pegada a la anterior (forman un bloque).
    try {
        await db.query('ALTER TABLE banco_preguntas ADD COLUMN con_anterior TINYINT(1) NOT NULL DEFAULT 0');
        console.log('🔧 Columna "con_anterior" añadida a banco_preguntas.');
        // Marca las preguntas que ya existían y que dependen del texto anterior
        await db.query(
            `UPDATE banco_preguntas SET con_anterior = 1
             WHERE enunciado LIKE '%texto anterior%' OR enunciado LIKE 'En la frase del texto%'`
        );
    } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('❌ Error al añadir la columna con_anterior:', err.message);
        }
    }

    try {
        await db.query('ALTER TABLE banco_preguntas ADD COLUMN imagen VARCHAR(500) DEFAULT NULL');
    } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('❌ Error al añadir la columna imagen en banco_preguntas:', err.message);
        }
    }

    try {
        await db.query('ALTER TABLE banco_preguntas ADD COLUMN creado_por VARCHAR(255) DEFAULT NULL');
    } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('❌ Error al añadir la columna creado_por en banco_preguntas:', err.message);
        }
    }

    await db.query(`CREATE TABLE IF NOT EXISTS resultados (
        id INT AUTO_INCREMENT PRIMARY KEY,
        correo VARCHAR(255) NOT NULL,
        nombre VARCHAR(255) NOT NULL,
        nivel VARCHAR(5) NOT NULL,
        prueba INT NOT NULL DEFAULT 1,
        sesion INT NOT NULL,
        intento INT NOT NULL DEFAULT 1,
        correctas INT NOT NULL,
        total INT NOT NULL,
        duracion_segundos INT DEFAULT NULL,
        fecha VARCHAR(50) NOT NULL
    )`);

    try {
        await db.query('ALTER TABLE resultados ADD COLUMN duracion_segundos INT DEFAULT NULL');
    } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            throw err;
        }
    }

    try {
        await db.query('ALTER TABLE resultados ADD COLUMN intento INT NOT NULL DEFAULT 1');
    } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('❌ Error al añadir la columna intento:', err.message);
        }
    }

    // Intento "en curso" por (estudiante, nivel, prueba)
    await db.query(`CREATE TABLE IF NOT EXISTS intentos_nivel (
        correo VARCHAR(255) NOT NULL,
        nivel VARCHAR(5) NOT NULL,
        prueba INT NOT NULL DEFAULT 1,
        intento_actual INT NOT NULL DEFAULT 1,
        PRIMARY KEY (correo, nivel, prueba)
    )`);

    // Añade "prueba" a las instalaciones anteriores
    await agregarColumnaPrueba();

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
    } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
            console.error('❌ Error al añadir la columna imagen en respuestas_detalle:', err.message);
        }
    }

    // ===================================================
    // PRUEBAS DE PROFESORES
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
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') {
                console.error('❌ Error al añadir la columna ' + columna.split(' ')[0] + ':', err.message);
            }
        }
    }

    try {
        await db.query('ALTER TABLE pruebas_profesor MODIFY grados VARCHAR(100) DEFAULT NULL');
    } catch (err) {
        console.error('❌ Error al ampliar la columna grados:', err.message);
    }

    try {
        await db.query(`UPDATE pruebas_profesor SET grados = '9,10,11' WHERE fecha_inicio IS NOT NULL AND grados IS NULL`);
    } catch (err) {
        console.error('❌ Error al asignar grados a las pruebas ya subidas:', err.message);
    }

    try {
        const [resultadoRenombre] = await db.query(
            `UPDATE pruebas_profesor SET materia = 'Ciencias Económicas y Políticas/Sociales' WHERE materia = 'Ciencias Económicas y Políticas'`
        );
        if (resultadoRenombre.affectedRows > 0) {
            console.log('🔧 ' + resultadoRenombre.affectedRows + ' prueba(s) con la materia de Ciencias Económicas actualizada(s).');
        }
    } catch (err) {
        console.error('❌ Error al renombrar la materia de Ciencias Económicas:', err.message);
    }

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
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') {
                console.error('❌ Error al añadir la columna ' + columna.split(' ')[0] + ' en resultados_profesor:', err.message);
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

    await db.query(`CREATE TABLE IF NOT EXISTS incidentes_examen (
        id INT AUTO_INCREMENT PRIMARY KEY,
        correo VARCHAR(255) NOT NULL,
        nombre VARCHAR(255) NOT NULL,
        tipo_examen VARCHAR(20) NOT NULL,
        referencia VARCHAR(255) DEFAULT NULL,
        motivo VARCHAR(100) NOT NULL,
        fecha VARCHAR(50) NOT NULL
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS pqrs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        correo VARCHAR(255) NOT NULL,
        nombre VARCHAR(255) NOT NULL,
        rol VARCHAR(20) NOT NULL,
        tipo VARCHAR(20) NOT NULL,
        mensaje TEXT NOT NULL,
        fecha VARCHAR(50) NOT NULL,
        respuesta TEXT DEFAULT NULL,
        fecha_respuesta VARCHAR(50) DEFAULT NULL,
        respondido_por VARCHAR(255) DEFAULT NULL
    )`);

    // Mínimo de respuestas correctas sumando todas las pruebas del nivel.
    await db.query(`CREATE TABLE IF NOT EXISTS config_niveles (
        nivel VARCHAR(5) NOT NULL PRIMARY KEY,
        minimo_correctas INT NOT NULL
    )`);

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

    // ✏️ NUEVO: "con_anterior" también en las pruebas de profesores y en las almacenadas.
    // 1 = la pregunta va con el texto de la anterior y se mantiene seguida al barajar.
    for (const tabla of ['preguntas_profesor', 'preguntas_almacenadas']) {
        try {
            await db.query('ALTER TABLE ' + tabla + ' ADD COLUMN con_anterior TINYINT(1) NOT NULL DEFAULT 0');
            console.log('🔧 Columna "con_anterior" añadida a ' + tabla + '.');
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') {
                console.error('❌ Error al añadir con_anterior en ' + tabla + ':', err.message);
            }
        }
    }

    await ampliarColumnasATexto();

    // 4) Sembrar el banco de preguntas (Prueba 1) solo si está vacío
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
        console.log('🌱 Banco de preguntas creado: 24 preguntas (niveles B, S y A, sesión 1, Prueba 1).');
    }

    // Pregunta de Gaturro (Nivel A, Sesión 1) con su imagen
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

    try {
        await db.query(
            `UPDATE banco_preguntas SET imagen = ? WHERE nivel = 'A' AND sesion = 1 AND materia = 'Lectura Crítica' AND enunciado LIKE ? AND (imagen IS NULL OR imagen = '')`,
            ['/public/images/gaturro-acentuacion.jpg', '%círculos que aparecen sobre la cabeza%']
        );
    } catch (err) {
        console.error('❌ Error al asignar la imagen de la pregunta de Gaturro:', err.message);
    }

    try {
        await db.query(
            `UPDATE banco_preguntas
             SET imagen = ?
             WHERE imagen = ?`,
            ['/public/images/gaturro-acentuacion.jpg', '/gaturro-acentuacion.jpg']
        );
    } catch (err) {
        console.error('❌ Error al actualizar la ruta de la imagen de Gaturro:', err.message);
    }

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
            console.log('🔧 Pregunta 2 de Lectura Crítica (Nivel A, Sesión 1) actualizada.');
        }
    } catch (err) {
        console.error('❌ Error al actualizar la pregunta de tecnología:', err.message);
    }

    // 5) Sembrar la SESIÓN 2 (Prueba 1) solo si aún no existe
    const [filasConteoS2] = await db.query("SELECT COUNT(*) AS total FROM banco_preguntas WHERE sesion = 2");
    if (filasConteoS2[0].total === 0) {
        const preguntasSesion2 = [
            // ---------- NIVEL S - Sesión 2 ----------
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

            // ---------- NIVEL A - Sesión 2 ----------
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

            // ---------- NIVEL B - Sesión 2 ----------
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
        console.log('🌱 Banco de preguntas creado: 24 preguntas de SESIÓN 2 (niveles B, A y S, Prueba 1).');
    }

    console.log('✅ Todas las tablas están listas.');
}

// ===================================================
// LOGIN
// ===================================================

// Login del administrador: correo + contraseña + código único.
app.post('/api/login', async (req, res) => {
    const { correo, contrasena, rol } = req.body;
    const codigo = typeof req.body.codigo_unico === 'string' ? req.body.codigo_unico.trim() : '';
    console.log(`\n🔑 [Login] Intento de acceso para Rol: ${rol}, Correo: ${correo}`);

    if (rol !== 'admin') {
        return res.status(400).json({ error: 'Perfil no válido.' });
    }
    if (!correo || !contrasena) {
        return res.status(400).json({ error: 'Escribe tu correo y tu contraseña.' });
    }
    if (!codigo) {
        return res.status(400).json({ error: 'Escribe tu código único.' });
    }

    try {
        const [filas] = await db.query(
            'SELECT * FROM administradores WHERE correo = ? AND contrasena = ? AND codigo_unico = ?',
            [correo, contrasena, codigo]
        );
        const usuario = filas[0];

        if (!usuario) {
            return res.status(400).json({ error: 'Correo, contraseña o código único incorrectos.' });
        }

        console.log(`🎉 ¡Ingreso exitoso! Admin: ${usuario.nombre}`);
        res.json({
            mensaje: '¡Inicio de sesión exitoso!',
            usuario: {
                nombre: usuario.nombre,
                correo: usuario.correo,
                grado: null,
                materia: null
            }
        });
    } catch (err) {
        console.error("❌ Error en login:", err.message);
        res.status(500).json({ error: 'Error interno del servidor en la base de datos.' });
    }
});

// Estudiantes y profesores entran solo con su código único.
app.post('/api/ingreso-codigo', async (req, res) => {
    const { codigo_unico, rol } = req.body;
    const tablas = { estudiante: 'estudiantes', profesor: 'profesores' };
    const tabla = tablas[rol];

    if (!tabla) {
        return res.status(400).json({ error: 'Perfil no válido.' });
    }

    const codigo = typeof codigo_unico === 'string' ? codigo_unico.trim() : '';
    if (!codigo) {
        return res.status(400).json({ error: 'Escribe tu código único.' });
    }

    try {
        const [filas] = await db.query(`SELECT * FROM ${tabla} WHERE codigo_unico = ?`, [codigo]);
        const usuario = filas[0];

        if (!usuario) {
            return res.status(400).json({ error: 'Código único incorrecto. Si no lo tienes, pídeselo al administrador.' });
        }

        console.log(`🎉 [Ingreso por código] ${rol}: ${usuario.nombre}`);
        res.json({
            mensaje: '¡Ingreso exitoso!',
            usuario: {
                nombre: usuario.nombre,
                correo: usuario.correo,
                grado: usuario.grado || null,
                materia: usuario.materia || null
            }
        });
    } catch (err) {
        console.error('❌ Error en ingreso por código:', err.message);
        res.status(500).json({ error: 'Error interno del servidor en la base de datos.' });
    }
});

// ===================================================
// 📝 PREGUNTAS DE LOS NIVELES (estudiantes; SIN la respuesta correcta)
// ===================================================

// Lista de pruebas (1, 2, 3) de un nivel con su cantidad de preguntas.
// Es lo que dibuja la pantalla "PRUEBAS DE NIVEL X".
app.get('/api/pruebas-nivel', async (req, res) => {
    const { nivel } = req.query;
    if (!NIVELES_VALIDOS.includes(nivel)) {
        return res.status(400).json({ error: 'Nivel no válido.' });
    }

    try {
        const [filas] = await db.query(
            'SELECT prueba, COUNT(*) AS total FROM banco_preguntas WHERE nivel = ? GROUP BY prueba',
            [nivel]
        );
        const totales = {};
        filas.forEach(f => { totales[Number(f.prueba)] = Number(f.total); });

        res.json({
            pruebas: PRUEBAS_VALIDAS.map(p => ({ prueba: p, total: totales[p] || 0 }))
        });
    } catch (err) {
        console.error('❌ Error al obtener las pruebas del nivel:', err.message);
        res.status(500).json({ error: 'Error interno al obtener las pruebas.' });
    }
});

// ===================================================
// 🔀 OPCIONES ALEATORIAS AL REPETIR LA PRUEBA
// El orden es determinista: mismo estudiante + pregunta + intento = mismo orden.
// Así lo que el estudiante ve al presentar coincide con lo que se califica.
// Además, la respuesta correcta SIEMPRE cambia de letra respecto al intento anterior.
// ===================================================
function permutacionOpciones(correo, preguntaId, intento, indiceCorrecto, posicionPrevia) {
    let idx = [0, 1, 2, 3];

    for (let sal = 0; sal < 50; sal++) {
        const h = crypto.createHash('sha256')
            .update(`${correo}|${preguntaId}|${intento}|${sal}`)
            .digest();
        idx = [0, 1, 2, 3];
        for (let i = 3; i > 0; i--) {
            const j = h[i] % (i + 1);
            [idx[i], idx[j]] = [idx[j], idx[i]];
        }
        // idx[k] = posición original de la opción que queda en la letra k
        // idx.indexOf(indiceCorrecto) = letra donde queda la respuesta correcta
        if (idx.indexOf(indiceCorrecto) !== posicionPrevia) return idx;
    }

    // Respaldo (prácticamente imposible llegar aquí): rotar una posición
    return [idx[3], idx[0], idx[1], idx[2]];
}

// ===================================================
// 🔀 ORDEN ALEATORIO DE LAS PREGUNTAS
// El orden es estable: la misma semilla siempre da el mismo orden. Así el estudiante ve el
// mismo orden si recarga la página, pero cada estudiante (y cada intento) tiene el suyo.
// ===================================================

// Baraja una lista de preguntas simples.
function ordenarAleatorio(lista, semilla) {
    return lista
        .map(item => ({
            item,
            clave: crypto.createHash('sha256').update(`${semilla}|${item.id}`).digest('hex')
        }))
        .sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0))
        .map(x => x.item);
}

// Baraja por bloques (pruebas de nivel y pruebas de profesores): una pregunta con
// con_anterior = 1 se pega a la anterior (por id) y conserva su orden. Los bloques
// cambian de lugar entre sí, así que un bloque puede quedar al inicio, en medio o al final.
function ordenarPorBloques(lista, semilla) {
    const bloques = [];
    [...lista].sort((a, b) => a.id - b.id).forEach(p => {
        if (Number(p.con_anterior) && bloques.length > 0) {
            bloques[bloques.length - 1].push(p);
        } else {
            bloques.push([p]);
        }
    });

    return bloques
        .map(b => ({
            b,
            clave: crypto.createHash('sha256').update(`${semilla}|${b[0].id}`).digest('hex')
        }))
        .sort((x, y) => (x.clave < y.clave ? -1 : x.clave > y.clave ? 1 : 0))
        .flatMap(x => x.b);
}

// Solo reordena preguntas marcadas como aleatorias y solo desde el 2.º intento
function aplicarAleatoriedad(p, correo, intento) {
   if (!p || !correo || intento <= 1 || !Number(p.aleatoria)) return p;

    const ops = [p.opcion_a, p.opcion_b, p.opcion_c, p.opcion_d];
    const original = 'ABCD'.indexOf(p.respuesta_correcta);
    if (original < 0) return p;

    // Se recorren los intentos 2..N para que cada uno sea distinto del anterior
    let posicionPrevia = original;
    let idx = [0, 1, 2, 3];
    for (let n = 2; n <= intento; n++) {
        idx = permutacionOpciones(correo, p.id, n, original, posicionPrevia);
        posicionPrevia = idx.indexOf(original);
    }

    const nuevas = idx.map(i => ops[i]);
    return {
        ...p,
        opcion_a: nuevas[0],
        opcion_b: nuevas[1],
        opcion_c: nuevas[2],
        opcion_d: nuevas[3],
        respuesta_correcta: 'ABCD'[posicionPrevia]
    };
}

app.get('/api/preguntas', async (req, res) => {
    const { nivel, sesion, materia, correo } = req.query;
    const prueba = numeroPrueba(req.query.prueba);
    console.log(`\n📝 [Preguntas] nivel: ${nivel}, prueba: ${prueba}, sesión: ${sesion}, materia: ${materia}`);

    if (!nivel || !sesion || !materia) {
        return res.status(400).json({ error: 'Faltan parámetros: nivel, sesion y materia son obligatorios.' });
    }

    try {
        const [filas] = await db.query(
            `SELECT id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen, aleatoria, con_anterior
             FROM banco_preguntas
             WHERE nivel = ? AND prueba = ? AND sesion = ? AND materia = ?
             ORDER BY id`,
            [nivel, prueba, sesion, materia]
        );

        const intento = correo ? await obtenerIntentoActual(correo, nivel, prueba) : 1;

        // Orden aleatorio por bloques: las preguntas "con la anterior" se quedan seguidas
        const ordenadas = ordenarPorBloques(
            filas,
            `${correo || 'anonimo'}|${nivel}|${prueba}|${sesion}|${materia}|${intento}`
        );

        const preguntas = ordenadas.map(f => {
            const p = aplicarAleatoriedad(f, correo, intento);
            // La respuesta correcta NUNCA se envía al estudiante
            return {
                id: p.id,
                enunciado: p.enunciado,
                opcion_a: p.opcion_a,
                opcion_b: p.opcion_b,
                opcion_c: p.opcion_c,
                opcion_d: p.opcion_d,
                imagen: p.imagen
            };
        });

        // El orden cambia en cada intento: que el navegador no reutilice respuestas viejas
        res.set('Cache-Control', 'no-store');
        res.json({ preguntas });
    } catch (err) {
        console.error("❌ Error al obtener preguntas:", err.message);
        res.status(500).json({ error: 'Error interno al obtener las preguntas.' });
    }
});

app.get('/api/conteo-preguntas', async (req, res) => {
    const { nivel, sesion } = req.query;
    const prueba = numeroPrueba(req.query.prueba);
    if (!nivel || !sesion) {
        return res.status(400).json({ error: 'Faltan parámetros: nivel y sesion son obligatorios.' });
    }

    try {
        const [filas] = await db.query(
            `SELECT materia, COUNT(*) AS total FROM banco_preguntas
             WHERE nivel = ? AND prueba = ? AND sesion = ? GROUP BY materia`,
            [nivel, prueba, sesion]
        );
        const conteo = {};
        filas.forEach(f => { conteo[f.materia] = Number(f.total); });
        res.json({ conteo });
    } catch (err) {
        console.error("❌ Error al contar preguntas:", err.message);
        res.status(500).json({ error: 'Error interno al contar las preguntas.' });
    }
});

// (versión anterior, por compatibilidad)
app.post('/api/crear-pregunta', async (req, res) => {
    const { correo, nivel, sesion, materia, respuesta_correcta, imagen } = req.body;
    const prueba = numeroPrueba(req.body.prueba);
    console.log(`\n👩‍🏫 [Crear pregunta] ${correo} -> nivel: ${nivel}, prueba: ${prueba}, sesión: ${sesion}, materia: ${materia}`);

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
            `INSERT INTO banco_preguntas (nivel, prueba, sesion, materia, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [nivel, prueba, sesion, materia, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen || null, correo]
        );
        res.json({ mensaje: '¡Pregunta guardada con éxito!' });
    } catch (err) {
        console.error('❌ Error al crear la pregunta:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al crear la pregunta.' });
    }
});

app.get('/api/preguntas-creadas', async (req, res) => {
    const { correo } = req.query;

    if (!correo) {
        return res.status(400).json({ error: 'Falta el correo del profesor.' });
    }

    try {
        const [filas] = await db.query(
            `SELECT id, nivel, prueba, sesion, materia, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen FROM banco_preguntas WHERE creado_por = ? ORDER BY id DESC`,
            [correo]
        );
        res.json({ preguntas: filas });
    } catch (err) {
        console.error('❌ Error al obtener las preguntas creadas:', err.message);
        res.status(500).json({ error: 'Error interno al obtener las preguntas creadas.' });
    }
});

// ===================================================
// 🛡️ ADMINISTRADOR
// ===================================================
async function esAdmin(correo) {
    if (!correo || typeof correo !== 'string') return false;
    const [filas] = await db.query('SELECT id FROM administradores WHERE correo = ?', [correo]);
    return filas.length > 0;
}

// 🗄️ BASE DE DATOS - REGISTROS
app.get('/api/admin/estudiantes', async (req, res) => {
    const { correo } = req.query;
    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden ver esta información.' });
        }
        const [filas] = await db.query(
            'SELECT nombre, correo, grado, codigo_unico FROM estudiantes ORDER BY nombre'
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
            'SELECT nombre, correo, codigo_unico FROM profesores ORDER BY nombre'
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
            'SELECT nombre, correo, contrasena, codigo_unico FROM administradores ORDER BY nombre'
        );
        res.json({ administradores: filas });
    } catch (err) {
        console.error('❌ Error al obtener los administradores:', err.message);
        res.status(500).json({ error: 'Error interno al obtener los administradores.' });
    }
});

// "9a", "9 - A", "9-a" -> "9-A" (o null si no es un grado válido)
function normalizarGradoRegistro(valor) {
    const t = String(valor || '').trim().toUpperCase().replace(/[\s°º]/g, '');
    const m = /^(\d+)-?([A-C])$/.exec(t);
    if (!m) return null;
    const grado = m[1] + '-' + m[2];
    return GRADOS_REGISTRO.includes(grado) ? grado : null;
}

// Importar estudiantes / profesores / administradores desde un Excel
app.post('/api/admin/importar-usuarios', async (req, res) => {
    const { correo, tipo, filas } = req.body;

    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden importar usuarios.' });
        }
        if (!['estudiantes', 'profesores', 'administradores'].includes(tipo)) {
            return res.status(400).json({ error: 'Tipo de usuario no válido.' });
        }
        if (!Array.isArray(filas) || filas.length === 0) {
            return res.status(400).json({ error: 'El archivo no tiene filas para registrar.' });
        }
        if (filas.length > 2000) {
            return res.status(400).json({ error: 'El archivo tiene demasiadas filas (máximo 2000).' });
        }

       const [codigos] = await db.query(
       tipo === 'administradores'
        ? `SELECT codigo_unico AS c FROM administradores WHERE codigo_unico IS NOT NULL`
        : `SELECT codigo_unico AS c FROM estudiantes WHERE codigo_unico IS NOT NULL
           UNION SELECT codigo_unico FROM profesores WHERE codigo_unico IS NOT NULL`
);
        const codigosUsados = new Set(codigos.map(f => String(f.c).toLowerCase()));
        const [correosAdmin] = await db.query('SELECT correo FROM administradores');
        const correosUsados = new Set(correosAdmin.map(f => String(f.correo).toLowerCase()));

        let registrados = 0;
        const errores = [];
        const rechazar = (f, motivo) => errores.push({ fila: f.fila, motivo });

        for (const f of filas) {
            const nombre = String(f.nombre || '').trim();
            const codigo = String(f.codigo_unico || '').trim();

            if (!nombre) { rechazar(f, 'falta el nombre'); continue; }
            if (nombre.length > 255) { rechazar(f, 'el nombre es demasiado largo'); continue; }
            if (!codigo) { rechazar(f, 'falta el código único'); continue; }
            if (codigo.length > 100) { rechazar(f, 'el código único es demasiado largo'); continue; }
            if (codigosUsados.has(codigo.toLowerCase())) {
                rechazar(f, 'el código "' + codigo + '" ya existe o está repetido en el archivo');
                continue;
            }

            try {
                if (tipo === 'estudiantes') {
                    const grado = normalizarGradoRegistro(f.grado);
                    if (!grado) { rechazar(f, 'grado no válido (usa 9-A, 10-B, 11-C...)'); continue; }

                    await db.query(
                        `INSERT INTO estudiantes (nombre, contrasena, grado, codigo_unico, correo) VALUES (?, '', ?, ?, ?)`,
                        [nombre, grado, codigo, codigo]
                    );
                } else if (tipo === 'profesores') {
                    await db.query(
                        `INSERT INTO profesores (nombre, contrasena, materia, codigo_unico, correo) VALUES (?, '', '', ?, ?)`,
                        [nombre, codigo, codigo]
                    );
                } else {
                    const correoNuevo = String(f.correo_nuevo || '').trim();
                    const contrasena = String(f.contrasena || '');

                    if (!esCorreoValido(correoNuevo)) { rechazar(f, 'el correo debe terminar en .com o .edu.co'); continue; }
                    if (correosUsados.has(correoNuevo.toLowerCase())) { rechazar(f, 'el correo ya está registrado'); continue; }
                    if (!esContrasenaSegura(contrasena)) {
                        rechazar(f, 'contraseña débil (mínimo 8 caracteres, mayúscula, minúscula, número y símbolo)');
                        continue;
                    }

                    await db.query(
                        `INSERT INTO administradores (nombre, contrasena, codigo_unico, correo) VALUES (?, ?, ?, ?)`,
                        [nombre, contrasena, codigo, correoNuevo]
                    );
                    correosUsados.add(correoNuevo.toLowerCase());
                }

                codigosUsados.add(codigo.toLowerCase());
                registrados++;
            } catch (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    rechazar(f, 'ya existe alguien con ese código o correo');
                } else {
                    console.error('❌ Error al importar una fila:', err.message);
                    rechazar(f, 'no se pudo guardar');
                }
            }
        }

        console.log(`📥 [Admin] ${correo} importó ${tipo}: ${registrados} registrados, ${errores.length} omitidos.`);
        res.json({ registrados, omitidos: errores.length, errores: errores.slice(0, 50) });
    } catch (err) {
        console.error('❌ Error al importar usuarios:', err.message);
        res.status(500).json({ error: 'Error interno al importar el archivo.' });
    }
});

// Registro manual desde el botón "＋ Agregar"
app.post('/api/admin/registrar-usuario', async (req, res) => {
    const { correo, tipo, grado, correo_nuevo, contrasena } = req.body;

    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden registrar usuarios.' });
        }
        if (!['estudiantes', 'profesores', 'administradores'].includes(tipo)) {
            return res.status(400).json({ error: 'Tipo de usuario no válido.' });
        }

        const nombre = String(req.body.nombre || '').trim();
        const codigo = String(req.body.codigo_unico || '').trim();

        if (!nombre) return res.status(400).json({ error: 'Escribe el nombre completo.' });
        if (!codigo) return res.status(400).json({ error: 'Escribe el código único.' });

        const [repetido] = await db.query(
    tipo === 'administradores'
        ? `SELECT 1 FROM administradores WHERE codigo_unico = ?`
        : `SELECT 1 FROM estudiantes WHERE codigo_unico = ?
           UNION SELECT 1 FROM profesores WHERE codigo_unico = ?`,
    tipo === 'administradores' ? [codigo] : [codigo, codigo]
        );
        if (repetido.length > 0) {
            return res.status(400).json({ error: 'Ese código único ya está registrado.' });
        }

        if (tipo === 'estudiantes') {
            const gradoNorm = normalizarGradoRegistro(grado);
            if (!gradoNorm) return res.status(400).json({ error: 'Selecciona un grado válido.' });

            await db.query(
                `INSERT INTO estudiantes (nombre, contrasena, grado, codigo_unico, correo) VALUES (?, '', ?, ?, ?)`,
                [nombre, gradoNorm, codigo, codigo]
            );
        } else if (tipo === 'profesores') {
            await db.query(
                `INSERT INTO profesores (nombre, contrasena, materia, codigo_unico, correo) VALUES (?, '', '', ?, ?)`,
                [nombre, codigo, codigo]
            );
        } else {
            const correoNuevo = String(correo_nuevo || '').trim();
            if (!esCorreoValido(correoNuevo)) {
                return res.status(400).json({ error: 'El correo debe terminar en .com o .edu.co' });
            }
            if (!esContrasenaSegura(contrasena)) {
                return res.status(400).json({ error: 'Contraseña débil. Requiere mínimo 8 caracteres, una mayúscula, una minúscula, un número y un símbolo.' });
            }

            await db.query(
                `INSERT INTO administradores (nombre, contrasena, codigo_unico, correo) VALUES (?, ?, ?, ?)`,
                [nombre, contrasena, codigo, correoNuevo]
            );
        }

        console.log(`➕ [Admin] ${correo} registró un ${tipo}: ${nombre}.`);
        res.json({ mensaje: 'Usuario registrado.' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Ya existe alguien con ese código o correo.' });
        }
        console.error('❌ Error al registrar el usuario:', err.message);
        res.status(500).json({ error: 'Error interno al registrar el usuario.' });
    }
});
// Borra todo lo que un usuario hizo en la plataforma.
// Estudiantes: resultados (y su detalle), intentos, pruebas de profesores presentadas, incidentes y PQRS.
// Profesores: sus pruebas (con preguntas e imágenes), pruebas almacenadas, los resultados de esas pruebas y sus PQRS.
// Administradores: no se borra nada extra (las preguntas de los niveles se conservan).
async function borrarDatosDeUsuario(tipo, correos) {
    if (!Array.isArray(correos) || correos.length === 0) return;
    if (tipo === 'administradores') return;

    const imagenesPruebas = [];
    const imagenesAlmacenadas = [];
    const conexion = await db.getConnection();

    try {
        await conexion.beginTransaction();

        if (tipo === 'estudiantes') {
            // respuestas_detalle se borra sola (ON DELETE CASCADE)
            await conexion.query('DELETE FROM resultados WHERE correo IN (?)', [correos]);
            await conexion.query('DELETE FROM intentos_nivel WHERE correo IN (?)', [correos]);
            await conexion.query('DELETE FROM resultados_profesor WHERE correo IN (?)', [correos]);
            await conexion.query('DELETE FROM incidentes_examen WHERE correo IN (?)', [correos]);
        } else if (tipo === 'profesores') {
            const [imgP] = await conexion.query(
                `SELECT q.imagen FROM preguntas_profesor q
                 JOIN pruebas_profesor p ON p.id = q.prueba_id
                 WHERE p.creado_por IN (?) AND q.imagen IS NOT NULL`, [correos]
            );
            imgP.forEach(f => imagenesPruebas.push(f.imagen));

            const [imgA] = await conexion.query(
                `SELECT q.imagen FROM preguntas_almacenadas q
                 JOIN pruebas_almacenadas a ON a.id = q.almacenada_id
                 WHERE a.creado_por IN (?) AND q.imagen IS NOT NULL`, [correos]
            );
            imgA.forEach(f => imagenesAlmacenadas.push(f.imagen));

            // Los resultados de sus pruebas (también los de pruebas ya eliminadas)
            await conexion.query('DELETE FROM resultados_profesor WHERE profesor_correo IN (?)', [correos]);
            // preguntas_profesor / preguntas_almacenadas se borran solas (CASCADE)
            await conexion.query('DELETE FROM pruebas_profesor WHERE creado_por IN (?)', [correos]);
            await conexion.query('DELETE FROM pruebas_almacenadas WHERE creado_por IN (?)', [correos]);
        }

        await conexion.query('DELETE FROM pqrs WHERE correo IN (?)', [correos]);
        await conexion.commit();
    } catch (err) {
        try { await conexion.rollback(); } catch (e) { /* ignorar */ }
        throw err;
    } finally {
        conexion.release();
    }

    // Las imágenes se borran al final, cuando la base de datos ya quedó limpia
    for (const ruta of imagenesPruebas) await borrarImagenDeRuta(ruta);
    for (const ruta of imagenesAlmacenadas) await borrarImagenAlmacenada(ruta);
}
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

await borrarDatosDeUsuario(tabla, [correoUsuario]);

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
// ✏️ Cambiar el código único de un usuario (solo administradores).
// Estudiantes y profesores usan el código también como correo, así que
// se actualiza ese correo en todas las tablas donde aparece su historial.
app.put('/api/admin/cambiar-codigo', async (req, res) => {
    const { correo, tipo, correo_usuario } = req.body;
    const nuevo = String(req.body.nuevo_codigo || '').trim();

    let conexion;
    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden cambiar códigos.' });
        }
        if (!['estudiantes', 'profesores', 'administradores'].includes(tipo)) {
            return res.status(400).json({ error: 'Tipo de usuario no válido.' });
        }
        if (!correo_usuario) return res.status(400).json({ error: 'Falta indicar el usuario.' });
        if (!nuevo) return res.status(400).json({ error: 'Escribe el nuevo código único.' });
        if (nuevo.length > 100) return res.status(400).json({ error: 'El código único es demasiado largo.' });

        const [filas] = await db.query(
            'SELECT codigo_unico, correo FROM ' + tipo + ' WHERE correo = ?', [correo_usuario]
        );
        if (filas.length === 0) return res.status(404).json({ error: 'Ese usuario ya no existe.' });

        const actual = filas[0];
        if (String(actual.codigo_unico || '') === nuevo) {
            return res.status(400).json({ error: 'Ese ya es el código actual de este usuario.' });
        }

        // Unicidad: admins solo contra admins; estudiantes y profesores entre sí
        const [repetido] = await db.query(
            tipo === 'administradores'
                ? `SELECT 1 FROM administradores WHERE codigo_unico = ?`
                : `SELECT 1 FROM estudiantes WHERE codigo_unico = ?
                   UNION SELECT 1 FROM profesores WHERE codigo_unico = ?`,
            tipo === 'administradores' ? [nuevo] : [nuevo, nuevo]
        );
        if (repetido.length > 0) {
            return res.status(400).json({ error: 'Ese código único ya lo tiene otra persona.' });
        }

        // En estudiantes/profesores el correo era igual al código: se cambia también
        const cambiaCorreo = tipo !== 'administradores' && actual.correo === actual.codigo_unico;
        if (cambiaCorreo) {
            const [correoUsado] = await db.query('SELECT 1 FROM ' + tipo + ' WHERE correo = ?', [nuevo]);
            if (correoUsado.length > 0) {
                return res.status(400).json({ error: 'Ese código ya está en uso.' });
            }
        }

        conexion = await db.getConnection();
        await conexion.beginTransaction();

        if (cambiaCorreo) {
            await conexion.query('UPDATE ' + tipo + ' SET codigo_unico = ?, correo = ? WHERE correo = ?',
                [nuevo, nuevo, correo_usuario]);

            const v = [nuevo, correo_usuario];
            if (tipo === 'estudiantes') {
                await conexion.query('UPDATE resultados SET correo = ? WHERE correo = ?', v);
                await conexion.query('UPDATE intentos_nivel SET correo = ? WHERE correo = ?', v);
                await conexion.query('UPDATE resultados_profesor SET correo = ? WHERE correo = ?', v);
                await conexion.query('UPDATE incidentes_examen SET correo = ? WHERE correo = ?', v);
            } else {
                await conexion.query('UPDATE pruebas_profesor SET creado_por = ? WHERE creado_por = ?', v);
                await conexion.query('UPDATE pruebas_almacenadas SET creado_por = ? WHERE creado_por = ?', v);
                await conexion.query('UPDATE resultados_profesor SET profesor_correo = ? WHERE profesor_correo = ?', v);
                await conexion.query('UPDATE banco_preguntas SET creado_por = ? WHERE creado_por = ?', v);
            }
            await conexion.query('UPDATE pqrs SET correo = ? WHERE correo = ?', v);
        } else {
            await conexion.query('UPDATE ' + tipo + ' SET codigo_unico = ? WHERE correo = ?',
                [nuevo, correo_usuario]);
        }

        await conexion.commit();
        console.log(`✏️ [Admin] ${correo} cambió el código de ${tipo} ${correo_usuario}.`);
        res.json({ mensaje: 'Código actualizado.' });
    } catch (err) {
        if (conexion) { try { await conexion.rollback(); } catch (e) { /* ignorar */ } }
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Ese código ya está en uso.' });
        }
        console.error('❌ Error al cambiar el código único:', err.message);
        res.status(500).json({ error: 'Error interno al cambiar el código.' });
    } finally {
        if (conexion) conexion.release();
    }
});
// ☑️ ELIMINACIÓN MÚLTIPLE de usuarios
app.post('/api/admin/eliminar-usuarios', async (req, res) => {
    const { correo, tipo, correos } = req.body;

    const tablas = { estudiantes: 'estudiantes', profesores: 'profesores', administradores: 'administradores' };
    const tabla = tablas[tipo];

    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden eliminar usuarios.' });
        }
        if (!tabla) {
            return res.status(400).json({ error: 'Tipo de usuario no válido.' });
        }
        if (!Array.isArray(correos) || correos.length === 0) {
            return res.status(400).json({ error: 'Selecciona al menos un usuario.' });
        }

        const lista = [...new Set(
            correos.filter(c => typeof c === 'string' && c.trim()).map(c => c.trim())
        )];
        if (lista.length === 0 || lista.length > 2000) {
            return res.status(400).json({ error: 'La selección no es válida.' });
        }

        if (tabla === 'administradores' && lista.includes(correo)) {
            return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta de administrador.' });
        }

        const [resultado] = await db.query('DELETE FROM ' + tabla + ' WHERE correo IN (?)', [lista]);
         await borrarDatosDeUsuario(tabla, lista);
        console.log(`🗑️ [Admin] ${correo} eliminó ${resultado.affectedRows} ${tipo} (eliminación múltiple).`);
        res.json({ mensaje: 'Usuarios eliminados.', eliminados: resultado.affectedRows });
    } catch (err) {
        console.error('❌ Error en la eliminación múltiple de usuarios:', err.message);
        res.status(500).json({ error: 'Error interno al eliminar los usuarios.' });
    }
});

function mezclar(lista) {
    const copia = [...lista];
    for (let i = copia.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
}

function validarDestinoNivel(nivel, prueba, sesion, materia) {
    if (!NIVELES_VALIDOS.includes(nivel)) return 'Selecciona el nivel (B, A o S).';
    if (!PRUEBAS_VALIDAS.includes(Number(prueba))) return 'Selecciona la prueba (1, 2 o 3).';
    if (![1, 2].includes(Number(sesion))) return 'Selecciona la sesión (1 o 2).';
    if (!MATERIAS_NIVEL.includes(materia) || !MATERIAS_POR_SESION[Number(sesion)].includes(materia)) {
        return 'Esa materia no forma parte de la sesión elegida.';
    }
    return null;
}

function prepararPreguntaAdmin(p) {
    if (!p || typeof p !== 'object') return { error: 'Una de las preguntas no es válida.' };

    const enunciado = limpiarHtmlRico(p.enunciado);
    if (!textoPlano(enunciado)) {
        return { error: 'Todas las preguntas necesitan enunciado (en el emparejamiento, todas las frases).' };
    }

    if (p.tipo === 'banco') {
        const banco = Array.isArray(p.banco)
            ? p.banco.map(w => String(w === null || w === undefined ? '' : w).replace(/[<>]/g, '').trim())
            : [];

        if (banco.length < 2 || banco.length > 8 || banco.some(w => !w)) {
            return { error: 'El banco necesita entre 2 y 8 palabras, todas con texto.' };
        }
        if (banco.some(w => w.length > 100)) {
            return { error: 'Una palabra del banco es demasiado larga (máximo 100 caracteres).' };
        }
        if (new Set(banco.map(w => w.toLowerCase())).size < banco.length) {
            return { error: 'Las palabras del banco deben ser distintas entre sí.' };
        }
        if (!p.respuesta_correcta || !LETRAS_BANCO.slice(0, banco.length).includes(p.respuesta_correcta)) {
            return { error: 'Elige la letra correcta de cada frase del emparejamiento.' };
        }

        return {
            pregunta: {
                enunciado,
                opcion_a: PREFIJO_BANCO + JSON.stringify(banco),
                opcion_b: '',
                opcion_c: '',
                opcion_d: '',
                respuesta_correcta: p.respuesta_correcta,
                imagenes: [null, null, null, null],
                aleatoria: 0,
                con_anterior: p.con_anterior ? 1 : 0
            }
        };
    }

    const io = (p.imagenes_opciones && typeof p.imagenes_opciones === 'object') ? p.imagenes_opciones : {};
    const esTres = p.tipo === 'tres';
    const cantidad = esTres ? 3 : 4;
    let textos;
    let imgs;
    let correcta;

    if (p.modo === 'aleatoria' && !esTres) {
        const textoCorrecta = limpiarHtmlRico(p.texto_correcta);
        const incorrectas = Array.isArray(p.incorrectas) ? p.incorrectas.map(limpiarHtmlRico) : [];
        const imgCorrecta = imagenOpcionCruda(io.texto_correcta);
        const imgIncorrectas = [io.inc1, io.inc2, io.inc3].map(imagenOpcionCruda);

        if ((!textoPlano(textoCorrecta) && !imgCorrecta) ||
            incorrectas.length !== 3 ||
            incorrectas.some((t, i) => !textoPlano(t) && !imgIncorrectas[i])) {
            return { error: 'En modo aleatorio la respuesta correcta y las 3 incorrectas necesitan texto o imagen.' };
        }

        const mezcladas = mezclar([
            { texto: textoCorrecta, img: imgCorrecta, ok: true },
            ...incorrectas.map((t, i) => ({ texto: t, img: imgIncorrectas[i], ok: false }))
        ]);
        textos = mezcladas.map(m => m.texto);
        imgs = mezcladas.map(m => m.img);
        correcta = 'ABCD'[mezcladas.findIndex(m => m.ok)];
    } else {
        textos = [p.opcion_a, p.opcion_b, p.opcion_c, esTres ? '' : p.opcion_d].map(limpiarHtmlRico);
        imgs = [io.a, io.b, io.c, esTres ? null : io.d].map(imagenOpcionCruda);
        const faltaAlguna = textos.slice(0, cantidad).some((t, i) => !textoPlano(t) && !imgs[i]);
        if (faltaAlguna || !p.respuesta_correcta || !'ABCD'.slice(0, cantidad).includes(p.respuesta_correcta)) {
            return {
                error: esTres
                    ? 'Las preguntas de 3 opciones necesitan las opciones A, B y C (con texto o imagen) y una respuesta correcta (A, B o C).'
                    : 'Todas las preguntas necesitan 4 opciones (con texto o imagen) y una respuesta correcta (A, B, C o D).'
            };
        }
        correcta = p.respuesta_correcta;
    }

    if (textos.some(t => t.length > MAX_LARGO_OPCION)) {
        return { error: 'Cada opción es demasiado larga (máximo ' + MAX_LARGO_OPCION + ' caracteres contando el formato).' };
    }
    const claves = textos.slice(0, cantidad).map((t, i) => t.toLowerCase() + '|' + (imgs[i] || ''));
    if (new Set(claves).size < cantidad) {
        return { error: 'Las opciones de cada pregunta deben ser distintas entre sí.' };
    }

    return {
        pregunta: {
            enunciado,
            opcion_a: textos[0],
            opcion_b: textos[1],
            opcion_c: textos[2],
            opcion_d: textos[3],
            respuesta_correcta: correcta,
            imagenes: imgs,
            // 1 = al repetir la prueba, las opciones se reordenan para el estudiante
            aleatoria: (p.modo === 'aleatoria' && !esTres) ? 1 : 0,
            // 1 = la pregunta depende del texto de la anterior: al barajar se queda pegada a ella
            con_anterior: p.con_anterior ? 1 : 0
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

// Grupos de preguntas: (nivel, prueba, sesión, materia)
app.get('/api/admin/grupos', async (req, res) => {
    const { correo } = req.query;

    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden ver estas preguntas.' });
        }

        const [filas] = await db.query(
            `SELECT nivel, prueba, sesion, materia, COUNT(*) AS num_preguntas
             FROM banco_preguntas
             GROUP BY nivel, prueba, sesion, materia`
        );

        const grupos = filas
            .map(f => ({
                nivel: f.nivel,
                prueba: Number(f.prueba),
                sesion: Number(f.sesion),
                materia: f.materia,
                num_preguntas: Number(f.num_preguntas)
            }))
            .filter(g => NIVELES_VALIDOS.includes(g.nivel))
            .sort((a, b) =>
                NIVELES_VALIDOS.indexOf(a.nivel) - NIVELES_VALIDOS.indexOf(b.nivel) ||
                a.prueba - b.prueba ||
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
    const prueba = numeroPrueba(req.query.prueba);
    if (!nivel || !sesion || !materia) {
        return res.status(400).json({ error: 'Faltan el nivel, la sesión y la materia.' });
    }

    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden editar estas preguntas.' });
        }

        const [preguntas] = await db.query(
            `SELECT id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen, aleatoria, con_anterior
             FROM banco_preguntas
             WHERE nivel = ? AND prueba = ? AND sesion = ? AND materia = ?
             ORDER BY id`,
            [nivel, prueba, Number(sesion), materia]
        );
        if (preguntas.length === 0) {
            return res.status(404).json({ error: 'No hay preguntas en ese grupo.' });
        }

        res.json({ nivel, prueba, sesion: Number(sesion), materia, preguntas });
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

        const errorDestino = validarDestinoNivel(nivel, req.body.prueba, sesion, materia);
        if (errorDestino) return res.status(400).json({ error: errorDestino });
        const prueba = numeroPrueba(req.body.prueba);

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
        await resolverImagenesOpciones(preparadas, archivosGuardados);

        conexion = await db.getConnection();
        await conexion.beginTransaction();

        const filas = preparadas.map((q, i) => [
            nivel, prueba, Number(sesion), materia, q.enunciado,
            q.opcion_a, q.opcion_b, q.opcion_c, q.opcion_d,
            q.respuesta_correcta, rutasImagenes[i], correo, q.aleatoria, q.con_anterior
        ]);
        await conexion.query(
            `INSERT INTO banco_preguntas (nivel, prueba, sesion, materia, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen, creado_por, aleatoria, con_anterior) VALUES ?`,
            [filas]
        );

        await conexion.commit();
        console.log(`🛡️ [Admin] ${correo} añadió ${preparadas.length} preguntas a Nivel ${nivel} · Prueba ${prueba} · Sesión ${sesion} · ${materia}.`);
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
        const pruebaOriginal = numeroPrueba(original.prueba);

        const errorDestino = validarDestinoNivel(nivel, req.body.prueba, sesion, materia);
        if (errorDestino) return res.status(400).json({ error: errorDestino });
        const prueba = numeroPrueba(req.body.prueba);

        const validacion = prepararPreguntasAdmin(preguntas);
        if (validacion.error) return res.status(400).json({ error: validacion.error });
        const { preparadas } = validacion;

        const [existentes] = await db.query(
            'SELECT id, imagen FROM banco_preguntas WHERE nivel = ? AND prueba = ? AND sesion = ? AND materia = ?',
            [original.nivel, pruebaOriginal, Number(original.sesion), original.materia]
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
        await resolverImagenesOpciones(preparadas, archivosNuevos);

        conexion = await db.getConnection();
        await conexion.beginTransaction();

        if (usados.size > 0) {
            await conexion.query(
                'DELETE FROM banco_preguntas WHERE nivel = ? AND prueba = ? AND sesion = ? AND materia = ? AND id NOT IN (?)',
                [original.nivel, pruebaOriginal, Number(original.sesion), original.materia, [...usados]]
            );
        } else {
            await conexion.query(
                'DELETE FROM banco_preguntas WHERE nivel = ? AND prueba = ? AND sesion = ? AND materia = ?',
                [original.nivel, pruebaOriginal, Number(original.sesion), original.materia]
            );
        }

        for (let i = 0; i < preparadas.length; i++) {
            const q = preparadas[i];
            const { idExistente, rutaFinal } = plan[i];

            if (idExistente !== null) {
                await conexion.query(
                    `UPDATE banco_preguntas
                     SET nivel = ?, prueba = ?, sesion = ?, materia = ?, enunciado = ?,
                         opcion_a = ?, opcion_b = ?, opcion_c = ?, opcion_d = ?,
                         respuesta_correcta = ?, imagen = ?, aleatoria = ?, con_anterior = ?
                     WHERE id = ?`,
                    [nivel, prueba, Number(sesion), materia, q.enunciado,
                     q.opcion_a, q.opcion_b, q.opcion_c, q.opcion_d,
                     q.respuesta_correcta, rutaFinal, q.aleatoria, q.con_anterior, idExistente]
                );
            } else {
                await conexion.query(
                    `INSERT INTO banco_preguntas (nivel, prueba, sesion, materia, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen, creado_por, aleatoria, con_anterior)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [nivel, prueba, Number(sesion), materia, q.enunciado,
                     q.opcion_a, q.opcion_b, q.opcion_c, q.opcion_d,
                     q.respuesta_correcta, rutaFinal, correo, q.aleatoria, q.con_anterior]
                );
            }
        }

        await conexion.commit();
        console.log(`✏️ [Admin] ${correo} editó Nivel ${original.nivel} · Prueba ${pruebaOriginal} · Sesión ${original.sesion} · ${original.materia} -> Nivel ${nivel} · Prueba ${prueba} · Sesión ${sesion} · ${materia} (${preparadas.length} preguntas).`);
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
    const prueba = numeroPrueba(req.query.prueba);
    if (!nivel || !sesion || !materia) {
        return res.status(400).json({ error: 'Faltan el nivel, la sesión y la materia.' });
    }

    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden eliminar preguntas de nivel.' });
        }

        const [resultado] = await db.query(
            'DELETE FROM banco_preguntas WHERE nivel = ? AND prueba = ? AND sesion = ? AND materia = ?',
            [nivel, prueba, Number(sesion), materia]
        );
        if (resultado.affectedRows === 0) {
            return res.status(404).json({ error: 'Esas preguntas ya no existen.' });
        }

        console.log(`🗑️ [Admin] ${correo} eliminó ${resultado.affectedRows} preguntas de Nivel ${nivel} · Prueba ${prueba} · Sesión ${sesion} · ${materia}.`);
        res.json({ mensaje: 'Preguntas eliminadas.' });
    } catch (err) {
        console.error('❌ Error al eliminar preguntas de nivel:', err.message);
        res.status(500).json({ error: 'Error interno al eliminar las preguntas.' });
    }
});

// ===================================================
// 🎯 PROMEDIO PARA PASAR DE NIVEL
// El mínimo se define por nivel y aplica a cada prueba. El "total" que se
// muestra al administrador es el de la prueba con más preguntas del nivel.
// ===================================================
const PASOS_DE_NIVEL = [
    { nivel: 'B', siguiente: 'A' },
    { nivel: 'A', siguiente: 'S' }
];

async function totalPreguntasNivel(nivel) {
    const [filas] = await db.query(
        'SELECT COUNT(*) AS total FROM banco_preguntas WHERE nivel = ?',
        [nivel]
    );
    return Number(filas[0].total);
}

app.get('/api/admin/promedio', async (req, res) => {
    const { correo } = req.query;
    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden ver esta información.' });
        }

        const niveles = [];
        for (const paso of PASOS_DE_NIVEL) {
            const total = await totalPreguntasNivel(paso.nivel);
            const [config] = await db.query('SELECT minimo_correctas FROM config_niveles WHERE nivel = ?', [paso.nivel]);
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
            const total = await totalPreguntasNivel(paso.nivel);

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

// ===================================================
// 👩‍🏫 PRUEBAS DE PROFESORES
// ===================================================
function prepararPreguntasProfesor(preguntas) {
    return prepararPreguntasAdmin(preguntas);
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
        await resolverImagenesOpciones(preparadas, archivosGuardados);
        conexion = await db.getConnection();
        await conexion.beginTransaction();

        const [r] = await conexion.query(
            `INSERT INTO pruebas_profesor (titulo, materia, creado_por, nombre_profesor, fecha) VALUES (?, ?, ?, ?, ?)`,
            [titulo.trim(), materia, correo, prof[0].nombre, new Date().toISOString()]
        );

        const filas = preparadas.map((q, i) => [
            r.insertId, q.enunciado, q.opcion_a, q.opcion_b, q.opcion_c, q.opcion_d,
            q.respuesta_correcta, rutasImagenes[i], q.con_anterior
        ]);
        await conexion.query(
            `INSERT INTO preguntas_profesor (prueba_id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen, con_anterior) VALUES ?`,
            [filas]
        );

        await conexion.commit();
        console.log(`🎉 Prueba "${titulo}" (${materia}) creada por ${correo} con ${preparadas.length} preguntas.`);
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
            `SELECT id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen, con_anterior
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
        await resolverImagenesOpciones(preparadas, archivosNuevos);
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
                     SET enunciado = ?, opcion_a = ?, opcion_b = ?, opcion_c = ?, opcion_d = ?, respuesta_correcta = ?, imagen = ?, con_anterior = ?
                     WHERE id = ? AND prueba_id = ?`,
                    [q.enunciado, q.opcion_a, q.opcion_b, q.opcion_c, q.opcion_d, q.respuesta_correcta, rutaFinal, q.con_anterior, idExistente, id]
                );
            } else {
                await conexion.query(
                    `INSERT INTO preguntas_profesor (prueba_id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen, con_anterior)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, q.enunciado, q.opcion_a, q.opcion_b, q.opcion_c, q.opcion_d, q.respuesta_correcta, rutaFinal, q.con_anterior]
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
            `SELECT enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen, con_anterior
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
            r.insertId, q.enunciado, q.opcion_a, q.opcion_b, q.opcion_c, q.opcion_d, q.respuesta_correcta, rutas[i], q.con_anterior
        ]);
        await conexion.query(
            `INSERT INTO preguntas_almacenadas (almacenada_id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen, con_anterior) VALUES ?`,
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

app.get('/api/pruebas-almacenadas/:id/editar', async (req, res) => {
    const { id } = req.params;
    const { correo } = req.query;
    if (!correo) return res.status(400).json({ error: 'Falta el correo del profesor.' });

    try {
        const [almacenada] = await db.query(
            'SELECT id, titulo, materia, creado_por FROM pruebas_almacenadas WHERE id = ?', [id]
        );
        if (almacenada.length === 0) return res.status(404).json({ error: 'La prueba almacenada no existe.' });
        if (almacenada[0].creado_por !== correo) {
            return res.status(403).json({ error: 'Solo puedes editar tus propias pruebas almacenadas.' });
        }

        const [preguntas] = await db.query(
            `SELECT id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen, con_anterior
             FROM preguntas_almacenadas WHERE almacenada_id = ? ORDER BY id`,
            [id]
        );

        res.json({
            almacenada: { id: almacenada[0].id, titulo: almacenada[0].titulo, materia: almacenada[0].materia },
            preguntas
        });
    } catch (err) {
        console.error('❌ Error al abrir la prueba almacenada para editarla:', err.message);
        res.status(500).json({ error: 'Error interno al abrir la prueba almacenada.' });
    }
});

app.put('/api/pruebas-almacenadas/:id', async (req, res) => {
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
        const [almacenada] = await db.query('SELECT id, creado_por FROM pruebas_almacenadas WHERE id = ?', [id]);
        if (almacenada.length === 0) return res.status(404).json({ error: 'La prueba almacenada no existe.' });
        if (almacenada[0].creado_por !== correo) {
            return res.status(403).json({ error: 'Solo puedes editar tus propias pruebas almacenadas.' });
        }

        const [existentes] = await db.query(
            'SELECT id, imagen FROM preguntas_almacenadas WHERE almacenada_id = ?', [id]
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
                const guardada = await guardarImagenDataUrl(p.imagen, 'almacenadas');
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
        await resolverImagenesOpciones(preparadas, archivosNuevos);
        conexion = await db.getConnection();
        await conexion.beginTransaction();

        await conexion.query(
            'UPDATE pruebas_almacenadas SET titulo = ?, materia = ? WHERE id = ?',
            [titulo.trim(), materia, id]
        );

        if (usados.size > 0) {
            await conexion.query(
                'DELETE FROM preguntas_almacenadas WHERE almacenada_id = ? AND id NOT IN (?)',
                [id, [...usados]]
            );
        } else {
            await conexion.query('DELETE FROM preguntas_almacenadas WHERE almacenada_id = ?', [id]);
        }

        for (let i = 0; i < preparadas.length; i++) {
            const q = preparadas[i];
            const { idExistente, rutaFinal } = plan[i];

            if (idExistente !== null) {
                await conexion.query(
                    `UPDATE preguntas_almacenadas
                     SET enunciado = ?, opcion_a = ?, opcion_b = ?, opcion_c = ?, opcion_d = ?, respuesta_correcta = ?, imagen = ?, con_anterior = ?
                     WHERE id = ? AND almacenada_id = ?`,
                    [q.enunciado, q.opcion_a, q.opcion_b, q.opcion_c, q.opcion_d, q.respuesta_correcta, rutaFinal, q.con_anterior, idExistente, id]
                );
            } else {
                await conexion.query(
                    `INSERT INTO preguntas_almacenadas (almacenada_id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen, con_anterior)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, q.enunciado, q.opcion_a, q.opcion_b, q.opcion_c, q.opcion_d, q.respuesta_correcta, rutaFinal, q.con_anterior]
                );
            }
        }

        await conexion.commit();

        for (const ruta of rutasABorrar) {
            await borrarImagenAlmacenada(ruta);
        }

        console.log(`✏️ [Editar almacenada] ${correo} editó la prueba almacenada ${id} ("${titulo.trim()}", ${materia}) - ${preparadas.length} preguntas.`);
        res.json({ mensaje: '¡Cambios guardados con éxito!' });
    } catch (err) {
        if (conexion) { try { await conexion.rollback(); } catch (e) { /* ignorar */ } }
        for (const archivo of archivosNuevos) {
            try { await fs.promises.unlink(archivo); } catch (e) { /* ignorar */ }
        }
        if (err.codigoHttp) {
            return res.status(err.codigoHttp).json({ error: err.message });
        }
        console.error('❌ Error al editar la prueba almacenada:', err.message);
        res.status(500).json({ error: 'Error interno del servidor al editar la prueba almacenada.' });
    } finally {
        if (conexion) conexion.release();
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

// "Resubir": crea una copia de la almacenada como prueba nueva (sin fechas)
app.post('/api/pruebas-almacenadas/:id/resubir', async (req, res) => {
    const { id } = req.params;
    const { correo } = req.body;
    if (!correo) return res.status(400).json({ error: 'Falta el correo del profesor.' });

    let conexion;
    const imagenesCopiadas = [];
    try {
        const [almacenada] = await db.query(
            'SELECT id, titulo, materia, creado_por FROM pruebas_almacenadas WHERE id = ?', [id]
        );
        if (almacenada.length === 0) return res.status(404).json({ error: 'La prueba almacenada no existe.' });
        if (almacenada[0].creado_por !== correo) {
            return res.status(403).json({ error: 'Solo puedes resubir tus propias pruebas almacenadas.' });
        }

        const [prof] = await db.query('SELECT nombre FROM profesores WHERE correo = ?', [correo]);
        if (prof.length === 0) return res.status(403).json({ error: 'Solo los profesores pueden resubir pruebas.' });

        const [preguntas] = await db.query(
            `SELECT enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen, con_anterior
             FROM preguntas_almacenadas WHERE almacenada_id = ? ORDER BY id`, [id]
        );
        if (preguntas.length === 0) {
            return res.status(400).json({ error: 'La prueba almacenada no tiene preguntas.' });
        }

        const rutas = [];
        for (const p of preguntas) {
            const nueva = await copiarImagenDesdeAlmacenada(p.imagen);
            if (nueva) imagenesCopiadas.push(nueva);
            rutas.push(nueva);
        }

        conexion = await db.getConnection();
        await conexion.beginTransaction();

        const [r] = await conexion.query(
            `INSERT INTO pruebas_profesor (titulo, materia, creado_por, nombre_profesor, fecha) VALUES (?, ?, ?, ?, ?)`,
            [almacenada[0].titulo, almacenada[0].materia, correo, prof[0].nombre, new Date().toISOString()]
        );

        const filas = preguntas.map((q, i) => [
            r.insertId, q.enunciado, q.opcion_a, q.opcion_b, q.opcion_c, q.opcion_d, q.respuesta_correcta, rutas[i], q.con_anterior
        ]);
        await conexion.query(
            `INSERT INTO preguntas_profesor (prueba_id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen, con_anterior) VALUES ?`,
            [filas]
        );

        await conexion.commit();
        console.log(`🔁 [Resubir] ${correo} preparó de nuevo la prueba almacenada ${id} ("${almacenada[0].titulo}") como la prueba ${r.insertId}.`);
        res.json({
            mensaje: 'Prueba lista para subir de nuevo.',
            id: r.insertId,
            titulo: almacenada[0].titulo,
            materia: almacenada[0].materia,
            num_preguntas: preguntas.length
        });
    } catch (err) {
        if (conexion) { try { await conexion.rollback(); } catch (e) { /* ignorar */ } }
        for (const ruta of imagenesCopiadas) await borrarImagenDeRuta(ruta);
        console.error('❌ Error al resubir la prueba almacenada:', err.message);
        res.status(500).json({ error: 'Error interno al preparar la prueba para resubir.' });
    } finally {
        if (conexion) conexion.release();
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
            `SELECT r.id, r.nombre, r.correctas, r.total, r.fecha, e.grado,
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

// "Eliminación múltiple" de resultados (solo el profesor dueño de la prueba)
app.post('/api/pruebas-profesor/resultados/eliminar', async (req, res) => {
    const { correo, ids } = req.body;

    if (!correo) return res.status(400).json({ error: 'Falta el correo del profesor.' });
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Selecciona al menos un resultado.' });
    }

    const idsLimpios = [...new Set(ids.map(Number))].filter(n => Number.isInteger(n) && n > 0);
    if (idsLimpios.length === 0 || idsLimpios.length > 1000) {
        return res.status(400).json({ error: 'La selección no es válida.' });
    }

    try {
        const [prof] = await db.query('SELECT id FROM profesores WHERE correo = ?', [correo]);
        if (prof.length === 0) {
            return res.status(403).json({ error: 'Solo los profesores pueden eliminar resultados.' });
        }

        const [resultado] = await db.query(
            `DELETE r FROM resultados_profesor r
             LEFT JOIN pruebas_profesor p ON p.id = r.prueba_id
             WHERE r.id IN (?) AND COALESCE(r.profesor_correo, p.creado_por) = ?`,
            [idsLimpios, correo]
        );

        console.log(`🗑️ [Resultados] ${correo} eliminó ${resultado.affectedRows} resultado(s).`);
        res.json({ mensaje: 'Resultados eliminados.', eliminados: resultado.affectedRows });
    } catch (err) {
        console.error('❌ Error al eliminar resultados:', err.message);
        res.status(500).json({ error: 'Error interno al eliminar los resultados.' });
    }
});

// Pruebas de profesores DISPONIBLES (para estudiantes)
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
               AND EXISTS (SELECT 1 FROM profesores pr WHERE pr.correo = p.creado_por)
             ORDER BY p.id DESC`,
            [correo]
        );

        const ahora = ahoraLocal();
        const pruebas = filas
            .map(f => {
                const grados = parsearGrados(f.grados);
                return {
                    ...f,
                    grados,
                    grado_permitido: estudianteEnGrados(gradoEstudiante, grados),
                    estado: calcularEstadoPrueba(f.fecha_inicio, f.fecha_fin, f.hora_inicio, f.hora_fin, ahora)
                };
            })
            .filter(p => p.correctas !== null || p.grado_permitido || p.estado !== 'finalizada');

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

        const [preguntasBD] = await db.query(
            `SELECT id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, imagen, con_anterior FROM preguntas_profesor WHERE prueba_id = ? ORDER BY id`,
            [id]
        );

        // Orden aleatorio estable por bloques: las preguntas "con la anterior" se quedan
        // seguidas, y cada estudiante ve los bloques en un orden distinto
        const preguntas = ordenarPorBloques(preguntasBD, `${correo}|pp|${id}`);

        res.set('Cache-Control', 'no-store');
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

// ⛔ Incidentes de examen (el estudiante perdió el foco)
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

// ===================================================
// 📩 AYUDAS Y PQRS
// ===================================================
app.post('/api/pqrs', async (req, res) => {
    const { correo, nombre, rol, tipo, mensaje } = req.body;

    if (!correo || !nombre || !['estudiante', 'profesor'].includes(rol)) {
        return res.status(400).json({ error: 'Faltan datos del remitente.' });
    }
    if (!TIPOS_PQRS.includes(tipo)) {
        return res.status(400).json({ error: 'Selecciona un tipo válido (Ayuda, Petición, Queja, Reclamo o Sugerencia).' });
    }

    const texto = typeof mensaje === 'string' ? mensaje.trim() : '';
    if (!texto) {
        return res.status(400).json({ error: 'Escribe tu mensaje.' });
    }
    if (texto.length > 3000) {
        return res.status(400).json({ error: 'El mensaje es demasiado largo (máximo 3000 caracteres).' });
    }

    try {
        await db.query(
            `INSERT INTO pqrs (correo, nombre, rol, tipo, mensaje, fecha) VALUES (?, ?, ?, ?, ?, ?)`,
            [correo, nombre, rol, tipo, texto, new Date().toISOString()]
        );
        console.log(`📩 [PQRS] ${nombre} (${correo}, ${rol}) envió una ${tipo}.`);
        res.json({ mensaje: 'Se envió correctamente su ' + tipo + '.', tipo });
    } catch (err) {
        console.error('❌ Error al enviar la PQRS:', err.message);
        res.status(500).json({ error: 'Error interno al enviar el mensaje.' });
    }
});

app.get('/api/pqrs/mis', async (req, res) => {
    const { correo } = req.query;
    if (!correo) return res.status(400).json({ error: 'Falta el correo.' });

    try {
        const [filas] = await db.query(
            `SELECT id, tipo, mensaje, fecha, respuesta, fecha_respuesta
             FROM pqrs WHERE correo = ? ORDER BY id DESC`,
            [correo]
        );
        res.json({ pqrs: filas });
    } catch (err) {
        console.error('❌ Error al obtener las PQRS del usuario:', err.message);
        res.status(500).json({ error: 'Error interno al obtener sus mensajes.' });
    }
});

app.get('/api/admin/pqrs', async (req, res) => {
    const { correo } = req.query;
    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden ver esta información.' });
        }
        const [filas] = await db.query(
            `SELECT id, correo, nombre, rol, tipo, mensaje, fecha, respuesta, fecha_respuesta
             FROM pqrs ORDER BY (respuesta IS NULL) DESC, id DESC`
        );
        res.json({ pqrs: filas });
    } catch (err) {
        console.error('❌ Error al obtener las PQRS:', err.message);
        res.status(500).json({ error: 'Error interno al obtener los mensajes.' });
    }
});

app.put('/api/admin/pqrs/:id/responder', async (req, res) => {
    const { id } = req.params;
    const { correo, respuesta } = req.body;

    try {
        if (!(await esAdmin(correo))) {
            return res.status(403).json({ error: 'Solo los administradores pueden responder.' });
        }

        const texto = typeof respuesta === 'string' ? respuesta.trim() : '';
        if (!texto) return res.status(400).json({ error: 'Escribe una respuesta.' });
        if (texto.length > 3000) return res.status(400).json({ error: 'La respuesta es demasiado larga (máximo 3000 caracteres).' });

        const [resultado] = await db.query(
            `UPDATE pqrs SET respuesta = ?, fecha_respuesta = ?, respondido_por = ? WHERE id = ?`,
            [texto, new Date().toISOString(), correo, id]
        );
        if (resultado.affectedRows === 0) {
            return res.status(404).json({ error: 'Ese mensaje ya no existe.' });
        }

        console.log(`📩 [PQRS] ${correo} respondió el mensaje ${id}.`);
        res.json({ mensaje: 'Respuesta enviada.' });
    } catch (err) {
        console.error('❌ Error al responder la PQRS:', err.message);
        res.status(500).json({ error: 'Error interno al responder el mensaje.' });
    }
});

// El autor o cualquier administrador puede eliminar un mensaje
app.delete('/api/pqrs/:id', async (req, res) => {
    const { id } = req.params;
    const { correo } = req.query;

    if (!correo) {
        return res.status(400).json({ error: 'Falta el correo.' });
    }

    try {
        const [filas] = await db.query('SELECT correo FROM pqrs WHERE id = ?', [id]);
        if (filas.length === 0) {
            return res.status(404).json({ error: 'Ese mensaje ya no existe.' });
        }

        const esPropio = filas[0].correo === correo;
        const esAdminUsuario = esPropio ? false : await esAdmin(correo);

        if (!esPropio && !esAdminUsuario) {
            return res.status(403).json({ error: 'No puedes eliminar este mensaje.' });
        }

        await db.query('DELETE FROM pqrs WHERE id = ?', [id]);
        console.log(`🗑️ [PQRS] ${correo} eliminó el mensaje ${id}.`);
        res.json({ mensaje: 'Mensaje eliminado.' });
    } catch (err) {
        console.error('❌ Error al eliminar la PQRS:', err.message);
        res.status(500).json({ error: 'Error interno al eliminar el mensaje.' });
    }
});

// ===================================================================
// 🎯 RESULTADOS DE LOS NIVELES (calificar, historial, aprobación, ranking)
//
// Estas rutas guardan y devuelven "duracion_segundos" (el tiempo que
// tardó el estudiante en cada sesión).
// ===================================================================

// Convierte lo que manda el navegador en segundos válidos (o null si no hay dato).
function limpiarDuracion(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = Math.round(Number(valor));
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.min(n, 86400); // máximo 24 horas
}

// ¿El estudiante ya presentó esa sesión en su intento actual?
async function sesionYaPresentada(correo, nivel, prueba, sesion) {
    const intento = await obtenerIntentoActual(correo, nivel, prueba);
    const [filas] = await db.query(
        'SELECT id FROM resultados WHERE correo = ? AND nivel = ? AND prueba = ? AND sesion = ? AND intento = ? LIMIT 1',
        [correo, nivel, prueba, Number(sesion), intento]
    );
    return filas.length > 0;
}

// Mínimo de respuestas correctas para aprobar: el que fijó el administrador con el
// botón "Promedio" o, si no hay ninguno, el 60% del total de preguntas del nivel.
async function minimoParaAprobar(nivel, totalPreguntas) {
    const [config] = await db.query('SELECT minimo_correctas FROM config_niveles WHERE nivel = ?', [nivel]);
    if (config.length > 0) return Number(config[0].minimo_correctas);
    return Math.ceil((totalPreguntas * Math.round(UMBRAL_APROBACION * 100)) / 100);
}

// Agrupa los resultados por (prueba, intento). Si una sesión se repitió dentro del mismo
// intento, se queda con la más reciente.
function agruparPorIntento(filas) {
    const grupos = new Map();
    for (const f of filas) {
        const clave = f.prueba + '|' + f.intento;
        if (!grupos.has(clave)) {
            grupos.set(clave, { prueba: Number(f.prueba), intento: Number(f.intento), sesiones: {} });
        }
        grupos.get(clave).sesiones[Number(f.sesion)] = f;
    }
    return [...grupos.values()];
}

// Un grupo está completo cuando tiene la sesión 1 y la sesión 2.
function totalesDeGrupo(grupo) {
    const sesiones = [grupo.sesiones[1], grupo.sesiones[2]].filter(Boolean);
    return {
        completo: !!(grupo.sesiones[1] && grupo.sesiones[2]),
        correctas: sesiones.reduce((a, s) => a + Number(s.correctas), 0),
        total: sesiones.reduce((a, s) => a + Number(s.total), 0)
    };
}

// Califica una sesión y guarda el resultado, el detalle y el tiempo que tardó.
app.post('/api/calificar', async (req, res) => {
    const { correo, nivel, respuestas } = req.body;
    const prueba = numeroPrueba(req.body.prueba);
    const sesion = Number(req.body.sesion);
    const duracion = limpiarDuracion(req.body.duracion_segundos);

    if (!correo || !NIVELES_VALIDOS.includes(nivel) || ![1, 2].includes(sesion) || !Array.isArray(respuestas)) {
        return res.status(400).json({ error: 'Faltan datos para calificar la sesión.' });
    }

    let conexion;
    try {
        const [est] = await db.query('SELECT nombre FROM estudiantes WHERE correo = ?', [correo]);
        if (est.length === 0) {
            return res.status(403).json({ error: 'Solo los estudiantes pueden presentar estas pruebas.' });
        }

        if (await sesionYaPresentada(correo, nivel, prueba, sesion)) {
            return res.status(409).json({ error: 'Ya presentaste esta sesión.' });
        }
        if (sesion === 2 && !(await sesionYaPresentada(correo, nivel, prueba, 1))) {
            return res.status(403).json({ error: 'Primero debes presentar la Sesión 1.' });
        }

        const intento = await obtenerIntentoActual(correo, nivel, prueba);

        const [preguntasBD] = await db.query(
            `SELECT id, materia, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, imagen, aleatoria
             FROM banco_preguntas
             WHERE nivel = ? AND prueba = ? AND sesion = ?
             ORDER BY id`,
            [nivel, prueba, sesion]
        );
        if (preguntasBD.length === 0) {
            return res.status(404).json({ error: 'Esta sesión todavía no tiene preguntas.' });
        }

        // Se aceptan las letras A-H (el emparejamiento usa hasta 8)
        const elegidas = {};
        respuestas.forEach(r => {
            if (r && r.pregunta_id !== undefined) {
                elegidas[Number(r.pregunta_id)] = LETRAS_RESPUESTA.includes(r.opcion_elegida) ? r.opcion_elegida : '';
            }
        });

        // Las opciones se califican igual que como las vio el estudiante (con la aleatoriedad del intento)
        const detalle = preguntasBD.map(f => {
            const p = aplicarAleatoriedad(f, correo, intento);
            const elegida = elegidas[p.id] || '';
            return { p, elegida, esCorrecta: elegida !== '' && elegida === p.respuesta_correcta };
        });

        const correctas = detalle.filter(d => d.esCorrecta).length;
        const total = detalle.length;

        conexion = await db.getConnection();
        await conexion.beginTransaction();

        const [r] = await conexion.query(
            `INSERT INTO resultados (correo, nombre, nivel, prueba, sesion, intento, correctas, total, fecha, duracion_segundos)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [correo, est[0].nombre, nivel, prueba, sesion, intento, correctas, total, new Date().toISOString(), duracion]
        );

        const filasDetalle = detalle.map(d => [
            r.insertId, d.p.id, d.p.materia, d.p.enunciado,
            d.p.opcion_a, d.p.opcion_b, d.p.opcion_c, d.p.opcion_d,
            d.elegida, d.p.respuesta_correcta, d.esCorrecta ? 1 : 0, d.p.imagen || null
        ]);
        await conexion.query(
            `INSERT INTO respuestas_detalle (resultado_id, pregunta_id, materia, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, opcion_elegida, respuesta_correcta, es_correcta, imagen) VALUES ?`,
            [filasDetalle]
        );

        await conexion.commit();
        console.log(`🎯 [Calificar] ${correo} · Nivel ${nivel} · Prueba ${prueba} · Sesión ${sesion} · intento ${intento}: ${correctas}/${total}` +
            (duracion !== null ? ` en ${duracion} s` : ''));
        res.json({ correctas, total, duracion_segundos: duracion });
    } catch (err) {
        if (conexion) {
            try {
                await conexion.rollback();
            } catch (rollbackError) {
                console.error('❌ Error al revertir la calificación:', rollbackError.message);
            }
        }
        console.error('❌ Error al calificar la sesión:', err.message);
        res.status(500).json({ error: 'Error interno al calificar la sesión.' });
    } finally {
        if (conexion) conexion.release();
    }
});

// Historial del estudiante (lo más reciente primero). Incluye duracion_segundos.
app.get('/api/mis-puntajes', async (req, res) => {
    const { correo } = req.query;
    if (!correo) return res.status(400).json({ error: 'Falta el correo del estudiante.' });

    try {
        const [filas] = await db.query(
            `SELECT id, nivel, prueba, sesion, intento, correctas, total, fecha, duracion_segundos
             FROM resultados
             WHERE correo = ?
             ORDER BY id DESC`,
            [correo]
        );
        res.json({ puntajes: filas });
    } catch (err) {
        console.error('❌ Error al obtener el historial de puntajes:', err.message);
        res.status(500).json({ error: 'Error interno al obtener el historial.' });
    }
});

// Eliminación múltiple del historial (el estudiante solo borra lo suyo).
app.post('/api/mis-puntajes/eliminar', async (req, res) => {
    const { correo, ids } = req.body;
    if (!correo) return res.status(400).json({ error: 'Falta el correo del estudiante.' });
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Selecciona al menos un resultado.' });
    }

    const idsLimpios = [...new Set(ids.map(Number))].filter(n => Number.isInteger(n) && n > 0);
    if (idsLimpios.length === 0 || idsLimpios.length > 1000) {
        return res.status(400).json({ error: 'La selección no es válida.' });
    }

    try {
        const [est] = await db.query('SELECT id FROM estudiantes WHERE correo = ?', [correo]);
        if (est.length === 0) {
            return res.status(403).json({ error: 'Solo los estudiantes pueden borrar su historial.' });
        }

        // respuestas_detalle se borra sola (ON DELETE CASCADE)
        const [resultado] = await db.query(
            'DELETE FROM resultados WHERE id IN (?) AND correo = ?',
            [idsLimpios, correo]
        );
        console.log(`🗑️ [Historial] ${correo} eliminó ${resultado.affectedRows} resultado(s).`);
        res.json({ mensaje: 'Resultados eliminados.', eliminados: resultado.affectedRows });
    } catch (err) {
        console.error('❌ Error al eliminar el historial:', err.message);
        res.status(500).json({ error: 'Error interno al eliminar los resultados.' });
    }
});

// Menú ⋮ del historial: puntaje por materia de un resultado.
app.get('/api/resultado-materias', async (req, res) => {
    const { resultado_id, correo } = req.query;
    if (!resultado_id || !correo) return res.status(400).json({ error: 'Faltan parámetros.' });

    try {
        const [propietario] = await db.query('SELECT correo FROM resultados WHERE id = ?', [resultado_id]);
        if (propietario.length === 0 || propietario[0].correo !== correo) {
            return res.status(403).json({ error: 'No autorizado para ver este resultado.' });
        }

        const [filas] = await db.query(
            `SELECT materia, SUM(es_correcta) AS correctas, COUNT(*) AS total
             FROM respuestas_detalle
             WHERE resultado_id = ?
             GROUP BY materia
             ORDER BY MIN(id)`,
            [resultado_id]
        );
        res.json({
            materias: filas.map(f => ({ materia: f.materia, correctas: Number(f.correctas), total: Number(f.total) }))
        });
    } catch (err) {
        console.error('❌ Error al obtener las materias del resultado:', err.message);
        res.status(500).json({ error: 'Error interno al obtener las materias.' });
    }
});

// Detalle pregunta por pregunta de una materia de un resultado.
app.get('/api/resultado-preguntas', async (req, res) => {
    const { resultado_id, materia, correo } = req.query;
    if (!resultado_id || !materia || !correo) return res.status(400).json({ error: 'Faltan parámetros.' });

    try {
        const [propietario] = await db.query('SELECT correo FROM resultados WHERE id = ?', [resultado_id]);
        if (propietario.length === 0 || propietario[0].correo !== correo) {
            return res.status(403).json({ error: 'No autorizado para ver este resultado.' });
        }

        const [filas] = await db.query(
            `SELECT pregunta_id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, opcion_elegida, respuesta_correcta, es_correcta, imagen
             FROM respuestas_detalle
             WHERE resultado_id = ? AND materia = ?
             ORDER BY id`,
            [resultado_id, materia]
        );
        res.json({ preguntas: filas.map(f => ({ ...f, es_correcta: !!f.es_correcta })) });
    } catch (err) {
        console.error('❌ Error al obtener las preguntas del resultado:', err.message);
        res.status(500).json({ error: 'Error interno al obtener las preguntas.' });
    }
});

// ¿Ya presentó esa sesión (en su intento actual)? Define qué ventana de sesión se desbloquea.
app.get('/api/sesion-completada', async (req, res) => {
    const { correo, nivel, sesion } = req.query;
    const prueba = numeroPrueba(req.query.prueba);
    if (!correo || !NIVELES_VALIDOS.includes(nivel) || ![1, 2].includes(Number(sesion))) {
        return res.status(400).json({ error: 'Faltan parámetros.' });
    }

    try {
        res.set('Cache-Control', 'no-store');
        res.json({ completada: await sesionYaPresentada(correo, nivel, prueba, sesion) });
    } catch (err) {
        console.error('❌ Error al verificar la sesión:', err.message);
        res.status(500).json({ error: 'Error interno al verificar la sesión.' });
    }
});

// "Repetir prueba": empieza un intento nuevo. El historial anterior se conserva.
app.post('/api/repetir-nivel', async (req, res) => {
    const { correo, nivel } = req.body;
    const prueba = numeroPrueba(req.body.prueba);
    if (!correo || !NIVELES_VALIDOS.includes(nivel)) {
        return res.status(400).json({ error: 'Faltan datos para repetir la prueba.' });
    }

    try {
        const s1 = await sesionYaPresentada(correo, nivel, prueba, 1);
        const s2 = await sesionYaPresentada(correo, nivel, prueba, 2);
        if (!s1 || !s2) {
            return res.status(400).json({ error: 'Primero debes presentar las dos sesiones para poder repetir la prueba.' });
        }

        const intentoNuevo = (await obtenerIntentoActual(correo, nivel, prueba)) + 1;
        await db.query(
            `INSERT INTO intentos_nivel (correo, nivel, prueba, intento_actual) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE intento_actual = VALUES(intento_actual)`,
            [correo, nivel, prueba, intentoNuevo]
        );

        console.log(`🔄 [Repetir] ${correo} · Nivel ${nivel} · Prueba ${prueba} -> intento ${intentoNuevo}.`);
        res.json({ mensaje: 'Listo. La Sesión 1 está disponible de nuevo y la Sesión 2 quedó bloqueada.', intento: intentoNuevo });
    } catch (err) {
        console.error('❌ Error al repetir la prueba:', err.message);
        res.status(500).json({ error: 'Error interno al repetir la prueba.' });
    }
});

// ¿Aprobó el nivel?
// Se SUMAN las respuestas correctas de TODAS las pruebas del nivel (de cada prueba cuenta su
// intento más reciente) y se comparan con el mínimo que fijó el administrador con "Promedio".
// Siempre devuelve: aprobado, correctasNivel, totalNivel y minimoCorrectas.
// Con "prueba" también devuelve las sesiones del intento más reciente de esa prueba.
app.get('/api/nivel-aprobado', async (req, res) => {
    const { correo, nivel } = req.query;
    const pruebaPedida = req.query.prueba ? numeroPrueba(req.query.prueba) : null;
    if (!correo || !NIVELES_VALIDOS.includes(nivel)) {
        return res.status(400).json({ error: 'Faltan parámetros.' });
    }

    try {
        const [filas] = await db.query(
            `SELECT id, prueba, sesion, intento, correctas, total
             FROM resultados
             WHERE correo = ? AND nivel = ?
             ORDER BY id`,
            [correo, nivel]
        );

        const grupos = agruparPorIntento(filas);

        // Suma de las correctas del nivel: intento más reciente de cada prueba
        let correctasNivel = 0;
        for (const numero of PRUEBAS_VALIDAS) {
            const delaPrueba = grupos
                .filter(g => g.prueba === numero)
                .sort((a, b) => b.intento - a.intento);
            if (delaPrueba.length === 0) continue;
            correctasNivel += totalesDeGrupo(delaPrueba[0]).correctas;
        }

        const totalNivel = await totalPreguntasNivel(nivel);
        const minimoCorrectas = totalNivel > 0 ? await minimoParaAprobar(nivel, totalNivel) : null;
        const aprobado = minimoCorrectas !== null && correctasNivel >= minimoCorrectas;

        const respuesta = { aprobado, correctasNivel, totalNivel, minimoCorrectas };

        if (pruebaPedida) {
            const ultimo = grupos
                .filter(g => g.prueba === pruebaPedida)
                .sort((a, b) => b.intento - a.intento)[0];
            const sesiones = ultimo
                ? [1, 2].filter(n => ultimo.sesiones[n]).map(n => ({
                    sesion: n,
                    correctas: Number(ultimo.sesiones[n].correctas),
                    total: Number(ultimo.sesiones[n].total)
                }))
                : [];

            respuesta.sesiones = sesiones;
            respuesta.totalCorrectas = sesiones.reduce((a, s) => a + s.correctas, 0);
            respuesta.totalPreguntas = sesiones.reduce((a, s) => a + s.total, 0);
        }

        res.set('Cache-Control', 'no-store');
        res.json(respuesta);
    } catch (err) {
        console.error('❌ Error al verificar la aprobación del nivel:', err.message);
        res.status(500).json({ error: 'Error interno al verificar el nivel.' });
    }
});

// Ranking por nivel: solo estudiantes que presentaron las dos sesiones de las 3 pruebas.
// De cada prueba cuenta el intento completo más reciente.
// Puntaje global (1 a 500) = correctas de las 3 pruebas / total de preguntas de las 3 pruebas * 500.
app.get('/api/ranking', async (req, res) => {
    try {
        const ranking = {};

        for (const nivel of NIVELES_VALIDOS) {
            const [filas] = await db.query(
                `SELECT r.id, r.correo, r.prueba, r.sesion, r.intento, r.correctas, r.total, e.nombre, e.grado
                 FROM resultados r
                 JOIN estudiantes e ON e.correo = r.correo
                 WHERE r.nivel = ?
                 ORDER BY r.id`,
                [nivel]
            );

            const porEstudiante = new Map();
            for (const f of filas) {
                if (!porEstudiante.has(f.correo)) {
                    porEstudiante.set(f.correo, { nombre: f.nombre, grado: f.grado, filas: [] });
                }
                porEstudiante.get(f.correo).filas.push(f);
            }

            const lista = [];
            for (const est of porEstudiante.values()) {
                const grupos = agruparPorIntento(est.filas);
                const pruebas = [];

                for (const numero of PRUEBAS_VALIDAS) {
                    const completos = grupos
                        .filter(g => g.prueba === numero && totalesDeGrupo(g).completo)
                        .sort((a, b) => b.intento - a.intento);
                    if (completos.length === 0) break;

                    const t = totalesDeGrupo(completos[0]);
                    pruebas.push({ prueba: numero, correctas: t.correctas, total: t.total });
                }

                if (pruebas.length === PRUEBAS_VALIDAS.length) {
                    const correctas = pruebas.reduce((a, p) => a + p.correctas, 0);
                    const total = pruebas.reduce((a, p) => a + p.total, 0);
                    const puntajeGlobal = total > 0
                        ? Math.min(500, Math.max(1, Math.round((correctas / total) * 500)))
                        : 1;

                    lista.push({
                        nombre: est.nombre,
                        grado: est.grado,
                        pruebas,
                        correctas,
                        total,
                        porcentaje: total > 0 ? correctas / total : 0,
                        puntaje: puntajeGlobal   // 1 a 500
                    });
                }
            }

            // Más puntaje global primero; si empatan, más correctas; luego por nombre
            lista.sort((a, b) =>
                b.puntaje - a.puntaje ||
                b.correctas - a.correctas ||
                String(a.nombre).localeCompare(String(b.nombre), 'es'));
            ranking[nivel] = lista;
        }

        res.set('Cache-Control', 'no-store');
        res.json({ ranking });
    } catch (err) {
        console.error('❌ Error al obtener el ranking:', err.message);
        res.status(500).json({ error: 'Error interno al obtener el ranking.' });
    }
});

// ===================================================

app.get('/api/todos-los-resultados', async (req, res) => {
    try {
        const [filas] = await db.query(
            `SELECT r.correo, r.nombre, r.nivel, r.prueba, r.sesion, r.correctas, r.total, r.fecha, r.duracion_segundos, e.grado
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


// ===================================================
// ARRANCAR: primero la base de datos, luego el servidor
// ===================================================
(async () => {
    try {
        await iniciarBaseDeDatos();
        const port = Number(process.env.PORT || 3000);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error('PORT debe ser un número entre 1 y 65535.');
        }
        app.listen(port, () => {
            console.log('===================================================');
            console.log(' ✨  ¡PLATAFORMA PRE-ICFES ONLINE ACTIVA CON ÉXITO! ✨ ');
            console.log(` 🚀  Ingresa aquí para programar: http://localhost:${port}`);
            console.log('===================================================');
        });
    } catch (err) {
        console.error('❌ No se pudo iniciar la aplicación:', err.message);
        process.exitCode = 1;
    }
})();