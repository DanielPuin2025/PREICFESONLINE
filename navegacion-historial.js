// =====================================================================
// navegacion-historial.js  (va DESPUÉS de editor-seguro.js)
// Hace que la flecha "atrás" del navegador regrese a la pantalla anterior
// de la app en lugar de salir de la página.
// =====================================================================
(function () {
    const $ = id => document.getElementById(id);
    const visible = id => { const el = $(id); return !!el && !el.classList.contains('oculto'); };

    let restaurando = false;   // true mientras se restaura una pantalla desde "atrás"
    let profundidad = 0;       // evita empujar estados en llamadas internas
    let ultimoEstado = null;

    // ---------- Foto de la pantalla actual ----------
    function seccionActiva() {
        const sec = Array.from(document.querySelectorAll('.seccion-app')).find(s => !s.classList.contains('oculto'));
        return sec ? sec.id.replace('seccion-', '') : 'pruebas';
    }

    function snapshot() {
        if (visible('pantalla-app')) {
            const s = seccionActiva();
            const st = { v: 'app', s };

            if (s === 'pruebas' && rolActual === 'estudiante') {
                if (visible('vista-sesiones') || visible('vista-prueba')) {
                    st.sub = 'sesiones'; st.nivel = nivelActual; st.prueba = pruebaActual;
                } else if (visible('vista-pruebas-nivel')) {
                    st.sub = 'pruebasNivel'; st.nivel = nivelActual;
                } else {
                    st.sub = 'niveles';
                }
            }
            if (s === 'puntaje' && rolActual === 'admin') {
                st.nivel = adminNivelSel || null;
                st.prueba = adminPruebaSel || null;
            }
            if (s === 'registros') {
                st.tipo = registrosTipoActual || null;
            }
            return st;
        }
        if (visible('pantalla-ingreso-codigo') || visible('pantalla-login')) {
            return { v: 'form', rol: rolActual };
        }
        return { v: 'roles' };
    }

    function empujar() {
        if (restaurando || profundidad > 0) return;
        const s = snapshot();
        if (JSON.stringify(s) === JSON.stringify(ultimoEstado)) return;
        history.pushState(s, '');
        ultimoEstado = s;
    }

    // Estado inicial (pantalla de roles)
    ultimoEstado = { v: 'roles' };
    history.replaceState(ultimoEstado, '');

    // ---------- Envolver las funciones de navegación ----------
    function envolver(nombre, despues) {
        const original = window[nombre];
        if (typeof original !== 'function') return null;
        window[nombre] = function () {
            const r = original.apply(this, arguments);
            if (despues) despues(); else empujar();
            return r;
        };
        return original;
    }

    // Cambio de sección (menú lateral y login). Las llamadas internas no empujan.
    const mostrarSeccionOriginal = window.mostrarSeccion;
    window.mostrarSeccion = function () {
        profundidad++;
        try { return mostrarSeccionOriginal.apply(this, arguments); }
        finally { profundidad--; empujar(); }
    };

    envolver('mostrarFormulario');          // ingreso (código o admin)
    envolver('mostrarPruebasDeNivel');      // niveles -> pruebas del nivel
    envolver('mostrarSesiones');            // pruebas -> sesiones
    envolver('elegirNivelAdmin');           // admin: nivel
    envolver('elegirPruebaAdmin');          // admin: prueba
    envolver('cargarRegistros');            // admin: tabla de registros

    // Botones "← Volver": van SIEMPRE a la pantalla que dice el botón
    // (ya no usan history.back(), que podía llevar a otra sección del menú).
    // Después de volver se registra la pantalla nueva en el historial, así la
    // flecha "atrás" del navegador sigue funcionando.
    const volverARolesOriginal = window.volverARoles;
    window.volverARoles = function () {
        volverARolesOriginal();
        empujar();
    };

    const volverANivelesOriginal = window.volverANiveles;
    window.volverANiveles = function () {
        volverANivelesOriginal();
        empujar();
    };

    const volverAPruebasNivelOriginal = window.volverAPruebasNivel;
    window.volverAPruebasNivel = function () {
        volverAPruebasNivelOriginal();   // llama a mostrarPruebasDeNivel, que ya registra el historial
    };

    const volverAPruebasAdminOriginal = window.volverAPruebasAdmin;
    window.volverAPruebasAdmin = function () {
        volverAPruebasAdminOriginal();
        empujar();
    };

    const mostrarMenuRegistrosOriginal = window.mostrarMenuRegistros;
    window.mostrarMenuRegistros = function () {
        // Llamada interna desde mostrarSeccion: no tocar el historial
        if (profundidad > 0) return mostrarMenuRegistrosOriginal();
        mostrarMenuRegistrosOriginal();
        empujar();
    };

    // ---------- Restaurar una pantalla al presionar "atrás" / "adelante" ----------
    function restaurarApp(st) {
        restaurando = true;
        try {
            if (st.s === 'pruebas' && rolActual === 'estudiante') {
                mostrarSeccion('pruebas');
                if (st.sub === 'sesiones') {
                    nivelActual = st.nivel; pruebaActual = st.prueba;
                    mostrarSesiones(st.nivel);
                } else if (st.sub === 'pruebasNivel') {
                    nivelActual = st.nivel;
                    mostrarPruebasDeNivel(st.nivel);
                } else {
                    volverANivelesOriginal();
                }
            } else if (st.s === 'puntaje' && rolActual === 'admin') {
                adminNivelSel = st.nivel || null;
                adminPruebaSel = st.prueba || null;
                mostrarSeccion('puntaje');
            } else if (st.s === 'registros') {
                mostrarSeccion('registros');
                if (st.tipo) cargarRegistros(st.tipo);
            } else {
                mostrarSeccion(st.s);
            }
        } finally {
            restaurando = false;
        }
        ultimoEstado = st;
    }

    window.addEventListener('popstate', e => {
        const st = e.state;
        const logueado = !!(usuarioActual && usuarioActual.correo) && visible('pantalla-app');

        if (logueado) {
            const enExamen = visible('vista-prueba') || visible('vista-prueba-pp');

            // Durante un examen, o al intentar salir de la app: nos quedamos y preguntamos
            if (enExamen || !st || st.v !== 'app') {
                history.pushState(ultimoEstado, '');
                if (visible('vista-prueba')) confirmarSalirPrueba();
                else if (visible('vista-prueba-pp')) confirmarSalirPruebaPP();
                else confirmarCerrarSesion();
                return;
            }

            restaurarApp(st);
            return;
        }

        // Sin sesión iniciada
        restaurando = true;
        try {
            if (st && st.v === 'form') {
                mostrarFormulario(st.rol);
                ultimoEstado = st;
            } else {
                volverARolesOriginal();
                ultimoEstado = { v: 'roles' };
                history.replaceState(ultimoEstado, '');
            }
        } finally {
            restaurando = false;
        }
    });
})();