-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Servidor: 127.0.0.1
-- Tiempo de generación: 03-10-2026 a las 01:16:24
-- Versión del servidor: 10.4.32-MariaDB
-- Versión de PHP: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";

START TRANSACTION;

SET time_zone = "+00:00";



/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;

/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;

/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;

/*!40101 SET NAMES utf8mb4 */;


--
-- Base de datos: `preicfes`
--

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `administradores`
--

CREATE TABLE `administradores` (
  `id` int(11) NOT NULL,
  `nombre` varchar(255) NOT NULL,
  `contrasena` varchar(255) NOT NULL,
  `correo` varchar(255) NOT NULL,
  `codigo_unico` varchar(100) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `banco_preguntas`
--

CREATE TABLE `banco_preguntas` (
  `id` int(11) NOT NULL,
  `nivel` varchar(5) NOT NULL,
  `sesion` int(11) NOT NULL,
  `materia` varchar(100) NOT NULL,
  `enunciado` text NOT NULL,
  `opcion_a` text NOT NULL,
  `opcion_b` text NOT NULL,
  `opcion_c` text NOT NULL,
  `opcion_d` text NOT NULL,
  `respuesta_correcta` varchar(1) NOT NULL,
  `imagen` varchar(500) DEFAULT NULL,
  `creado_por` varchar(255) DEFAULT NULL,
  `prueba` int(11) NOT NULL DEFAULT 1,
  `aleatoria` tinyint(1) NOT NULL DEFAULT 0,
  `con_anterior` tinyint(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `config_niveles`
--

CREATE TABLE `config_niveles` (
  `nivel` varchar(5) NOT NULL,
  `minimo_correctas` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `estudiantes`
--

CREATE TABLE `estudiantes` (
  `id` int(11) NOT NULL,
  `nombre` varchar(255) NOT NULL,
  `contrasena` varchar(255) NOT NULL,
  `grado` varchar(50) NOT NULL,
  `correo` varchar(255) NOT NULL,
  `codigo_unico` varchar(100) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `incidentes_examen`
--

CREATE TABLE `incidentes_examen` (
  `id` int(11) NOT NULL,
  `correo` varchar(255) NOT NULL,
  `nombre` varchar(255) NOT NULL,
  `tipo_examen` varchar(20) NOT NULL,
  `referencia` varchar(255) DEFAULT NULL,
  `motivo` varchar(100) NOT NULL,
  `fecha` varchar(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `intentos_nivel`
--

CREATE TABLE `intentos_nivel` (
  `correo` varchar(255) NOT NULL,
  `nivel` varchar(5) NOT NULL,
  `intento_actual` int(11) NOT NULL DEFAULT 1,
  `prueba` int(11) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `logs`
--

CREATE TABLE `logs` (
  `id` int(11) NOT NULL,
  `usuario` varchar(100) DEFAULT NULL,
  `accion` varchar(255) DEFAULT NULL,
  `estado` varchar(50) DEFAULT NULL,
  `fecha` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `pqrs`
--

CREATE TABLE `pqrs` (
  `id` int(11) NOT NULL,
  `correo` varchar(255) NOT NULL,
  `nombre` varchar(255) NOT NULL,
  `rol` varchar(20) NOT NULL,
  `tipo` varchar(20) NOT NULL,
  `mensaje` text NOT NULL,
  `fecha` varchar(50) NOT NULL,
  `respuesta` text DEFAULT NULL,
  `fecha_respuesta` varchar(50) DEFAULT NULL,
  `respondido_por` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `preguntas_almacenadas`
--

CREATE TABLE `preguntas_almacenadas` (
  `id` int(11) NOT NULL,
  `almacenada_id` int(11) NOT NULL,
  `enunciado` text NOT NULL,
  `opcion_a` text NOT NULL,
  `opcion_b` text NOT NULL,
  `opcion_c` text NOT NULL,
  `opcion_d` text NOT NULL,
  `respuesta_correcta` varchar(1) NOT NULL,
  `imagen` varchar(500) DEFAULT NULL,
  `con_anterior` tinyint(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `preguntas_profesor`
--

CREATE TABLE `preguntas_profesor` (
  `id` int(11) NOT NULL,
  `prueba_id` int(11) NOT NULL,
  `enunciado` text NOT NULL,
  `opcion_a` text NOT NULL,
  `opcion_b` text NOT NULL,
  `opcion_c` text NOT NULL,
  `opcion_d` text NOT NULL,
  `respuesta_correcta` varchar(1) NOT NULL,
  `imagen` varchar(500) DEFAULT NULL,
  `con_anterior` tinyint(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `profesores`
--

CREATE TABLE `profesores` (
  `id` int(11) NOT NULL,
  `nombre` varchar(255) NOT NULL,
  `contrasena` varchar(255) NOT NULL,
  `materia` varchar(255) NOT NULL,
  `correo` varchar(255) NOT NULL,
  `codigo_unico` varchar(100) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `pruebas_almacenadas`
--

CREATE TABLE `pruebas_almacenadas` (
  `id` int(11) NOT NULL,
  `origen_id` int(11) DEFAULT NULL,
  `titulo` varchar(255) NOT NULL,
  `materia` varchar(255) NOT NULL,
  `creado_por` varchar(255) NOT NULL,
  `fecha_almacenada` varchar(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `pruebas_profesor`
--

CREATE TABLE `pruebas_profesor` (
  `id` int(11) NOT NULL,
  `titulo` varchar(255) NOT NULL,
  `materia` varchar(255) NOT NULL,
  `creado_por` varchar(255) NOT NULL,
  `nombre_profesor` varchar(255) NOT NULL,
  `fecha` varchar(50) NOT NULL,
  `fecha_inicio` varchar(10) DEFAULT NULL,
  `fecha_fin` varchar(10) DEFAULT NULL,
  `fecha_subida` varchar(50) DEFAULT NULL,
  `grados` varchar(100) DEFAULT NULL,
  `hora_inicio` varchar(5) DEFAULT NULL,
  `hora_fin` varchar(5) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `respuestas_detalle`
--

CREATE TABLE `respuestas_detalle` (
  `id` int(11) NOT NULL,
  `resultado_id` int(11) NOT NULL,
  `pregunta_id` int(11) NOT NULL,
  `materia` varchar(100) NOT NULL,
  `enunciado` text NOT NULL,
  `opcion_a` text NOT NULL,
  `opcion_b` text NOT NULL,
  `opcion_c` text NOT NULL,
  `opcion_d` text NOT NULL,
  `opcion_elegida` varchar(1) NOT NULL,
  `respuesta_correcta` varchar(1) NOT NULL,
  `es_correcta` tinyint(1) NOT NULL,
  `imagen` varchar(500) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `resultados`
--

CREATE TABLE `resultados` (
  `id` int(11) NOT NULL,
  `correo` varchar(255) NOT NULL,
  `nombre` varchar(255) NOT NULL,
  `nivel` varchar(5) NOT NULL,
  `sesion` int(11) NOT NULL,
  `correctas` int(11) NOT NULL,
  `total` int(11) NOT NULL,
  `duracion_segundos` int(11) DEFAULT NULL,
  `fecha` varchar(50) NOT NULL,
  `intento` int(11) NOT NULL DEFAULT 1,
  `prueba` int(11) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `resultados_profesor`
--

CREATE TABLE `resultados_profesor` (
  `id` int(11) NOT NULL,
  `prueba_id` int(11) DEFAULT NULL,
  `correo` varchar(255) NOT NULL,
  `nombre` varchar(255) NOT NULL,
  `correctas` int(11) NOT NULL,
  `total` int(11) NOT NULL,
  `fecha` varchar(50) NOT NULL,
  `titulo_prueba` varchar(255) DEFAULT NULL,
  `materia_prueba` varchar(255) DEFAULT NULL,
  `profesor_correo` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `usuarios`
--

CREATE TABLE `usuarios` (
  `id` int(11) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `apellido` varchar(100) NOT NULL,
  `email` varchar(150) NOT NULL,
  `password` varchar(255) NOT NULL,
  `telefono` varchar(20) DEFAULT NULL,
  `whatsapp` varchar(20) DEFAULT NULL,
  `departamento` varchar(100) DEFAULT NULL,
  `ciudad` varchar(100) DEFAULT NULL,
  `tipo` enum('admin','cliente') NOT NULL DEFAULT 'cliente',
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


--
-- Índices para tablas volcadas
--

--
-- Indices de la tabla `administradores`
--
ALTER TABLE `administradores`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `correo` (`correo`);


--
-- Indices de la tabla `banco_preguntas`
--
ALTER TABLE `banco_preguntas`
  ADD PRIMARY KEY (`id`);


--
-- Indices de la tabla `config_niveles`
--
ALTER TABLE `config_niveles`
  ADD PRIMARY KEY (`nivel`);


--
-- Indices de la tabla `estudiantes`
--
ALTER TABLE `estudiantes`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `correo` (`correo`);


--
-- Indices de la tabla `incidentes_examen`
--
ALTER TABLE `incidentes_examen`
  ADD PRIMARY KEY (`id`);


--
-- Indices de la tabla `intentos_nivel`
--
ALTER TABLE `intentos_nivel`
  ADD PRIMARY KEY (`correo`,`nivel`,`prueba`);


--
-- Indices de la tabla `logs`
--
ALTER TABLE `logs`
  ADD PRIMARY KEY (`id`);


--
-- Indices de la tabla `pqrs`
--
ALTER TABLE `pqrs`
  ADD PRIMARY KEY (`id`);


--
-- Indices de la tabla `preguntas_almacenadas`
--
ALTER TABLE `preguntas_almacenadas`
  ADD PRIMARY KEY (`id`),
  ADD KEY `almacenada_id` (`almacenada_id`);


--
-- Indices de la tabla `preguntas_profesor`
--
ALTER TABLE `preguntas_profesor`
  ADD PRIMARY KEY (`id`),
  ADD KEY `prueba_id` (`prueba_id`);


--
-- Indices de la tabla `profesores`
--
ALTER TABLE `profesores`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `correo` (`correo`);


--
-- Indices de la tabla `pruebas_almacenadas`
--
ALTER TABLE `pruebas_almacenadas`
  ADD PRIMARY KEY (`id`);


--
-- Indices de la tabla `pruebas_profesor`
--
ALTER TABLE `pruebas_profesor`
  ADD PRIMARY KEY (`id`);


--
-- Indices de la tabla `respuestas_detalle`
--
ALTER TABLE `respuestas_detalle`
  ADD PRIMARY KEY (`id`),
  ADD KEY `resultado_id` (`resultado_id`);


--
-- Indices de la tabla `resultados`
--
ALTER TABLE `resultados`
  ADD PRIMARY KEY (`id`);


--
-- Indices de la tabla `resultados_profesor`
--
ALTER TABLE `resultados_profesor`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unico_estudiante_prueba` (`prueba_id`,`correo`);


--
-- Indices de la tabla `usuarios`
--
ALTER TABLE `usuarios`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`);


--
-- AUTO_INCREMENT de las tablas volcadas
--

--
-- AUTO_INCREMENT de la tabla `administradores`
--
ALTER TABLE `administradores`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;


--
-- AUTO_INCREMENT de la tabla `banco_preguntas`
--
ALTER TABLE `banco_preguntas`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=69;


--
-- AUTO_INCREMENT de la tabla `estudiantes`
--
ALTER TABLE `estudiantes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=954;


--
-- AUTO_INCREMENT de la tabla `incidentes_examen`
--
ALTER TABLE `incidentes_examen`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=73;


--
-- AUTO_INCREMENT de la tabla `logs`
--
ALTER TABLE `logs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;


--
-- AUTO_INCREMENT de la tabla `pqrs`
--
ALTER TABLE `pqrs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;


--
-- AUTO_INCREMENT de la tabla `preguntas_almacenadas`
--
ALTER TABLE `preguntas_almacenadas`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;


--
-- AUTO_INCREMENT de la tabla `preguntas_profesor`
--
ALTER TABLE `preguntas_profesor`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=35;


--
-- AUTO_INCREMENT de la tabla `profesores`
--
ALTER TABLE `profesores`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=27;


--
-- AUTO_INCREMENT de la tabla `pruebas_almacenadas`
--
ALTER TABLE `pruebas_almacenadas`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;


--
-- AUTO_INCREMENT de la tabla `pruebas_profesor`
--
ALTER TABLE `pruebas_profesor`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=32;


--
-- AUTO_INCREMENT de la tabla `respuestas_detalle`
--
ALTER TABLE `respuestas_detalle`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=578;


--
-- AUTO_INCREMENT de la tabla `resultados`
--
ALTER TABLE `resultados`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=105;


--
-- AUTO_INCREMENT de la tabla `resultados_profesor`
--
ALTER TABLE `resultados_profesor`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=18;


--
-- AUTO_INCREMENT de la tabla `usuarios`
--
ALTER TABLE `usuarios`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;


--
-- Restricciones para tablas volcadas
--

--
-- Filtros para la tabla `preguntas_almacenadas`
--
ALTER TABLE `preguntas_almacenadas`
  ADD CONSTRAINT `preguntas_almacenadas_ibfk_1` FOREIGN KEY (`almacenada_id`) REFERENCES `pruebas_almacenadas` (`id`) ON DELETE CASCADE;


--
-- Filtros para la tabla `preguntas_profesor`
--
ALTER TABLE `preguntas_profesor`
  ADD CONSTRAINT `preguntas_profesor_ibfk_1` FOREIGN KEY (`prueba_id`) REFERENCES `pruebas_profesor` (`id`) ON DELETE CASCADE;


--
-- Filtros para la tabla `respuestas_detalle`
--
ALTER TABLE `respuestas_detalle`
  ADD CONSTRAINT `respuestas_detalle_ibfk_1` FOREIGN KEY (`resultado_id`) REFERENCES `resultados` (`id`) ON DELETE CASCADE;


--
-- Filtros para la tabla `resultados_profesor`
--
ALTER TABLE `resultados_profesor`
  ADD CONSTRAINT `fk_resultados_profesor_prueba` FOREIGN KEY (`prueba_id`) REFERENCES `pruebas_profesor` (`id`) ON DELETE SET NULL;

COMMIT;


/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;

/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;

/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;