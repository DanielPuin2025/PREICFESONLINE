const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(__dirname)); 

const dbPath = path.join(__dirname, 'preicfes.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) return console.error('❌ Error al conectar SQLite:', err.message);
    console.log(`✅ Base de datos conector en: ${dbPath}`);
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS estudiantes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        contrasena TEXT NOT NULL,
        grado TEXT NOT NULL,
        correo TEXT UNIQUE NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS profesores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        contrasena TEXT NOT NULL,
        materia TEXT NOT NULL,
        correo TEXT UNIQUE NOT NULL
    )`);

    // Tabla de preguntas: guarda las 4 opciones y cuál es la correcta (A, B, C o D)
    db.run(`CREATE TABLE IF NOT EXISTS preguntas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nivel TEXT NOT NULL,
        sesion INTEGER NOT NULL,
        materia TEXT NOT NULL,
        enunciado TEXT NOT NULL,
        opcion_a TEXT NOT NULL,
        opcion_b TEXT NOT NULL,
        opcion_c TEXT NOT NULL,
        opcion_d TEXT NOT NULL,
        respuesta_correcta TEXT NOT NULL
    )`, () => {
        // Sembramos preguntas solo si la tabla está vacía
        db.get('SELECT COUNT(*) AS total FROM preguntas', (err, fila) => {
            if (err || fila.total > 0) return;

            const ejemplos = [
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

                ['A', 1, 'Matemáticas',
                    'Un servicio de taxi cobra una tarifa fija de $3.000 por abordar el vehículo y $1.200 por cada kilómetro recorrido. Si x representa los kilómetros recorridos, ¿cuál de las siguientes expresiones modela el costo total (C) del viaje?',
                    'C = 3.000x + 1.200', 'C = 1.200x + 3.000', 'C = 4.200x', 'C = 3.000x / 1.200', 'B'],
                ['A', 1, 'Matemáticas',
                    'Una caja de zapatos tiene forma de prisma rectangular con las siguientes dimensiones: 30 cm de largo, 20 cm de ancho y 10 cm de alto. ¿Cuál es el volumen total de la caja?',
                    '600 cm³', '60 cm³', '6.000 cm³', '120 cm³', 'C'],
                ['A', 1, 'Lectura Crítica',
                    '"La tecnología avanza a pasos agigantados, simplificando tareas que antes tomaban días. Sin embargo, este ritmo frenético ha creado una dependencia invisible: hoy nos cuesta recordar un número telefónico o guiarnos por las calles sin una pantalla encendida. No cabe duda de que ganamos eficiencia, pero es imperativo preguntarnos qué habilidades humanas estamos dejando morir en el camino." A partir del texto, se puede inferir que para el autor la tecnología es:',
                    'Un peligro absoluto que debe ser eliminado de la vida cotidiana.', 'Una herramienta que solo trae beneficios de eficiencia a la humanidad.', 'Un avance positivo que, no obstante, conlleva un costo en capacidades humanas.', 'La única causa del deterioro de la memoria en los jóvenes actuales.', 'C'],
                ['A', 1, 'Lectura Crítica',
                    'En el fragmento anterior, cuando el autor utiliza la expresión "dependencia invisible", su intención principal es:',
                    'Resaltar que los aparatos tecnológicos se han vuelto físicamente más pequeños y difíciles de ver.', 'Advertir sobre un hábito de subordinación tecnológica del cual las personas no son plenamente conscientes.', 'Demostrar científicamente que las pantallas causan problemas graves en la visión de los usuarios.', 'Elogiar la manera sutil y elegante en que los ingenieros diseñan los nuevos dispositivos móviles.', 'B'],
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
                    'Rama Ejecutiva', 'Rama Judicial', 'Rama Legislativa', 'Órganos de Control', 'C'],

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
                    'Acción de Tutela', 'Derecho de Petición', 'Acción Popular', 'Habeas Corpus', 'C']
            ];

            const stmt = db.prepare(`INSERT INTO preguntas 
                (nivel, sesion, materia, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

            ejemplos.forEach(p => stmt.run(p));
            stmt.finalize(() => console.log('🌱 Preguntas insertadas (niveles B, A y S, sesión 1).'));
        });
    });
});

function esCorreoValido(correo) {
    if (!correo) return false;
    return correo.endsWith('.com') || correo.endsWith('.edu.co');
}

function esContrasenaSegura(pass) {
    if (!pass) return false;
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.])[A-Za-z\d@$!%*?&.]{8,}$/;
    return regex.test(pass);
}

app.post('/api/registro/estudiante', (req, res) => {
    console.log("\n📥 [Estudiante] Datos recibidos en el servidor:", req.body);
    const { nombre, contrasena, grado, correo } = req.body;

    if (!esCorreoValido(correo)) {
        return res.status(400).json({ error: 'El correo debe terminar en .com o .edu.co' });
    }
    if (!esContrasenaSegura(contrasena)) {
        return res.status(400).json({ error: 'Contraseña débil. Requiere mínimo 8 caracteres, una mayúscula, una minúscula, un número y un símbolo.' });
    }

    db.run(`INSERT INTO estudiantes (nombre, contrasena, grado, correo) VALUES (?, ?, ?, ?)`, 
    [nombre, contrasena, grado, correo], (err) => {
        if (err) {
            return res.status(400).json({ error: 'Este correo ya se encuentra registrado.' });
        }
        console.log("🎉 ¡Estudiante guardado con éxito en preicfes.db!");
        res.json({ mensaje: '¡Estudiante guardado con éxito!' });
    });
});

app.post('/api/registro/profesor', (req, res) => {
    console.log("\n📥 [Profesor] Datos recibidos en el servidor:", req.body);
    const { nombre, contrasena, materia, correo } = req.body;

    if (!esCorreoValido(correo)) {
        return res.status(400).json({ error: 'El correo debe terminar en .com o .edu.co' });
    }
    if (!esContrasenaSegura(contrasena)) {
        return res.status(400).json({ error: 'Contraseña débil. Requiere mínimo 8 caracteres, una mayúscula, una minúscula, un número y un símbolo.' });
    }

    db.run(`INSERT INTO profesores (nombre, contrasena, materia, correo) VALUES (?, ?, ?, ?)`, 
    [nombre, contrasena, materia, correo], (err) => {
        if (err) {
            return res.status(400).json({ error: 'Este correo ya se encuentra registrado.' });
        }
        console.log("🎉 ¡Profesor/a guardado con éxito en preicfes.db!");
        res.json({ mensaje: '¡Profesor/a guardado con éxito!' });
    });
});

app.post('/api/login', (req, res) => {
    const { correo, contrasena, rol } = req.body;
    console.log(`\n🔑 [Login] Intento de acceso para Rol: ${rol}, Correo: ${correo}`);

    const tabla = rol === 'estudiante' ? 'estudiantes' : 'profesores';
    const sql = `SELECT * FROM ${tabla} WHERE correo = ? AND contrasena = ?`;

    db.get(sql, [correo, contrasena], (err, usuario) => {
        if (err) {
            return res.status(500).json({ error: 'Error interno del servidor en la base de datos.' });
        }
        
        if (!usuario) {
            return res.status(400).json({ error: 'Correo o contraseña incorrectos.' });
        }

        console.log(`🎉 ¡Ingreso exitoso! Validado correctamente: ${usuario.nombre}`);
        res.json({ 
            mensaje: '¡Inicio de sesión exitoso!', 
            usuario: { nombre: usuario.nombre, correo: usuario.correo, grado: usuario.grado || null } 
        });
    });
});

// ===================================================
// 📝 PREGUNTAS: obtener preguntas de una materia (SIN la respuesta correcta)
// ===================================================
app.get('/api/preguntas', (req, res) => {
    const { nivel, sesion, materia } = req.query;
    console.log(`\n📝 [Preguntas] Solicitud -> nivel: ${nivel}, sesión: ${sesion}, materia: ${materia}`);

    if (!nivel || !sesion || !materia) {
        return res.status(400).json({ error: 'Faltan parámetros: nivel, sesion y materia son obligatorios.' });
    }

    const sql = `SELECT id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d 
                 FROM preguntas 
                 WHERE nivel = ? AND sesion = ? AND materia = ?`;

    db.all(sql, [nivel, sesion, materia], (err, filas) => {
        if (err) {
            console.error("❌ Error al obtener preguntas:", err.message);
            return res.status(500).json({ error: 'Error interno al obtener las preguntas.' });
        }
        res.json({ preguntas: filas });
    });
});

// ===================================================
// ✅ CALIFICAR: recibe las respuestas del estudiante y las compara con la BD
// ===================================================
app.post('/api/calificar', (req, res) => {
    const { respuestas } = req.body; // [{ pregunta_id, opcion_elegida }, ...]
    console.log(`\n✅ [Calificar] Recibidas ${respuestas ? respuestas.length : 0} respuestas.`);

    if (!Array.isArray(respuestas) || respuestas.length === 0) {
        return res.status(400).json({ error: 'No se recibieron respuestas para calificar.' });
    }

    const ids = respuestas.map(r => r.pregunta_id);
    const placeholders = ids.map(() => '?').join(',');
    const sql = `SELECT id, respuesta_correcta FROM preguntas WHERE id IN (${placeholders})`;

    db.all(sql, ids, (err, filas) => {
        if (err) {
            console.error("❌ Error al calificar:", err.message);
            return res.status(500).json({ error: 'Error interno al calificar.' });
        }

        const correctasPorId = {};
        filas.forEach(f => correctasPorId[f.id] = f.respuesta_correcta);

        let correctas = 0;
        respuestas.forEach(r => {
            if (correctasPorId[r.pregunta_id] === r.opcion_elegida) correctas++;
        });

        const total = respuestas.length;
        console.log(`🎯 Resultado: ${correctas}/${total} correctas.`);

        res.json({ correctas, total });
    });
});

app.listen(3000, () => {
    console.log('===================================================');
    console.log(' ✨  ¡PLATAFORMA PRE-ICFES ONLINE ACTIVA CON ÉXITO! ✨ ');
    console.log(' 🚀  Ingresa aquí para programar: http://localhost:3000');
    console.log('===================================================');
});