# PRE-ICFES ONLINE

Plataforma de preparación para exámenes Pre-ICFES con gestión de estudiantes, profesores y administradores.

## 🚀 Características

- Sistema de niveles (Básico, Alto, Superior)
- Gestión de estudiantes, profesores y administradores
- Creación de pruebas personalizadas
- Editor de texto enriquecido para preguntas
- Soporte de imágenes en preguntas
- Sistema de resultados e historial
- Modo examen seguro

## 📋 Requisitos

- Node.js 14+ 
- MySQL 5.7+
- npm o yarn

## 📁 Estructura del Proyecto

```
PRE-ICFES_ONLINE/
├── conexion.js              # Servidor Express y API
├── index.html               # Frontend principal
├── server.js                # Archivo de inicio
├── package.json             # Dependencias
├── .env.example             # Ejemplo de configuración
├── README.md                # Este archivo
├── database/                # Scripts SQL
│   └── preicfes.sql
├── public/                  # Archivos estáticos
│   ├── css/                 # Estilos
│   ├── js/                  # JavaScript
│   └── images/              # Imágenes públicas
├── imagenes-profesores/     # Imágenes de pruebas
├── imagenes-preguntas/      # Imágenes de preguntas
└── imagenes-almacenadas/    # Imágenes almacenadas
```

## 🔧 Instalación en VPS (programamega.com)

### 1. Conectarse al VPS
```bash
ssh usuario@tu-ip-vps
```

### 2. Clonar el repositorio
```bash
cd /var/www
git clone https://github.com/tu-usuario/PRE-ICFES_ONLINE.git
cd PRE-ICFES_ONLINE
```

### 3. Instalar dependencias
```bash
npm install
```

### 4. Configurar MySQL
```bash
mysql -u root -p
```

Ejecutar en MySQL:
```sql
CREATE DATABASE preicfes CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'preicfes_user'@'localhost' IDENTIFIED BY 'TuPasswordSeguro123!';
GRANT ALL PRIVILEGES ON preicfes.* TO 'preicfes_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### 5. Configurar variables de entorno
```bash
cp .env.example .env
nano .env
```

Editar con tus credenciales:
```env
DB_HOST=localhost
DB_USER=preicfes_user
DB_PASSWORD=TuPasswordSeguro123!
DB_NAME=preicfes
PORT=3000
NODE_ENV=production
```

### 6. Iniciar la aplicación con PM2
```bash
# Instalar PM2 globalmente si no lo tienes
npm install -g pm2

# Iniciar la aplicación
pm2 start conexion.js --name preicfes

# Guardar configuración
pm2 save

# Configurar inicio automático
pm2 startup
# Copiar y ejecutar el comando que PM2 te muestre
```

### 7. Configurar Nginx para programamega.com

Crear archivo de configuración:
```bash
sudo nano /etc/nginx/sites-available/preicfes
```

Contenido del archivo:
```nginx
server {
    listen 80;
    server_name programamega.com www.programamega.com;

    # Logs
    access_log /var/log/nginx/preicfes-access.log;
    error_log /var/log/nginx/preicfes-error.log;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Archivos estáticos
    location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
        proxy_pass http://localhost:3000;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Activar el sitio:
```bash
sudo ln -s /etc/nginx/sites-available/preicfes /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 8. Configurar DNS en Hostinger

1. Ir al panel de Hostinger
2. Seleccionar **programamega.com**
3. Ir a **DNS/Nameservers**
4. Agregar/modificar registros:
   - **Tipo A**: `@` → `IP_DE_TU_VPS`
   - **Tipo A**: `www` → `IP_DE_TU_VPS`
5. Esperar propagación DNS (1-24 horas)

### 9. Instalar SSL (HTTPS) con Certbot
```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d programamega.com -d www.programamega.com
```

Seguir las instrucciones y seleccionar redirigir HTTP a HTTPS.

### 10. Verificar que todo funcione
```bash
# Ver logs del servidor
pm2 logs preicfes

# Ver estado
pm2 status

# Probar el sitio
curl http://localhost:3000
curl https://programamega.com
```

## 🔄 Actualizar la aplicación

```bash
cd /var/www/PRE-ICFES_ONLINE
git pull origin main
npm install
pm2 restart preicfes
```

## 📊 Comandos útiles PM2

```bash
pm2 list                # Ver apps corriendo
pm2 logs preicfes       # Ver logs en tiempo real
pm2 logs preicfes --lines 100  # Ver últimas 100 líneas
pm2 restart preicfes    # Reiniciar
pm2 stop preicfes       # Detener
pm2 delete preicfes     # Eliminar
pm2 monit               # Monitor en tiempo real
```

## 🔐 Credenciales por defecto

### Administrador
- **Correo:** edialvarado@gmail.com
- **Contraseña:** Edith1234*

### Profesor
- **Correo:** amelialedes@gmail.com
- **Contraseña:** Amelia123*

### Estudiante
- **Correo:** amanda12@gmail.com
- **Contraseña:** Amanda12*

## 🛠️ Desarrollo Local

```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm start

# Abrir en navegador
http://localhost:3000
```

## 📝 Notas Importantes

- Las imágenes se almacenan en carpetas locales del servidor
- La base de datos MySQL debe tener codificación UTF-8
- El servidor Node.js corre en el puerto 3000 por defecto
- Nginx hace de proxy inverso y maneja SSL
- PM2 reinicia automáticamente si hay un error

## 🐛 Solución de problemas

### El servidor no inicia
```bash
pm2 logs preicfes --err
# Revisar errores de conexión a MySQL
```

### No se puede conectar a MySQL
```bash
sudo systemctl status mysql
# Verificar credenciales en .env
```

### Nginx devuelve 502 Bad Gateway
```bash
pm2 status
# Verificar que la app esté corriendo en puerto 3000
```

### DNS no resuelve
```bash
dig programamega.com
# Verificar que apunte a la IP correcta del VPS
```

## 📧 Soporte

Para problemas o preguntas, contactar al administrador del sistema.

---

**Versión:** 1.0.0  
**Última actualización:** Septiembre 2024
