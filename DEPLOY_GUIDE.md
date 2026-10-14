# 🚀 GUÍA RÁPIDA DE DESPLIEGUE - programamega.com

## Despliegue recomendado con EasyPanel

### 1. Crear MySQL

En el mismo proyecto de EasyPanel, crea un servicio **MySQL** con la base de datos
`preicfes`. No expongas el puerto de MySQL a Internet. En **Credentials**, copia
el host interno, el usuario, la contraseña y el nombre de la base.

Si vas a conservar los registros de tu MySQL local, impórtalos mediante
phpMyAdmin/DbGate habilitado desde el servicio MySQL. El archivo local
`preicfes.sql` contiene datos y está excluido de GitHub; no lo reemplaces por
`database/preicfes.sql`, que solo conserva el esquema. `preicfes.db` es SQLite y
no lo usa esta aplicación.

### 2. Crear la aplicación desde GitHub

1. En EasyPanel, crea un servicio **App**.
2. En **Source**, elige GitHub, repositorio `DanielPuin2025/PREICFESONLINE`,
   rama `main` y ruta de compilación `/`.
3. Usa el builder Nixpacks o Railpack con Node.js 22.x (el proyecto declara esta
   versión en `package.json`). El comando de inicio es
   `npm start` y el puerto interno de la aplicación es `3000`.
4. En **Environment**, define estas variables usando los valores de **Credentials**
   de MySQL (no las guardes en el repositorio):

   ```env
   NODE_ENV=production
   PORT=3000
   DB_HOST=<host-interno-mysql>
   DB_USER=<usuario-mysql>
   DB_PASSWORD=<password-mysql>
   DB_NAME=preicfes
   DATA_DIR=/data
   ```

5. En almacenamiento persistente de la App, monta un volumen en `/data`. Allí
   se guardarán las imágenes que suban profesores y administradores, incluso
   después de volver a desplegar.
6. Pulsa **Deploy** y revisa los logs. La aplicación crea las tablas que falten
   al iniciar; la cuenta MySQL debe tener permisos sobre `preicfes`.

### 3. Conectar `programamega.com`

1. En **Domains** de la App, añade `programamega.com` y
   `www.programamega.com`, ambos dirigidos al puerto `3000`.
2. En el proveedor DNS del dominio, crea registros `A` para `@` y `www` que
   apunten a la IP pública del VPS.
3. Espera a que el DNS resuelva al VPS y activa/solicita HTTPS desde EasyPanel.
4. Comprueba `https://programamega.com` y `https://www.programamega.com`, luego
   revisa los logs de la App y MySQL en EasyPanel.

Activa Auto Deploy en EasyPanel si quieres que los próximos cambios publicados
en la rama `main` vuelvan a desplegarse automáticamente.

## Despliegue manual en Ubuntu sin EasyPanel

## ⚡ Paso a Paso (Copiar y pegar)

### 1️⃣ Conectarse al VPS
```bash
ssh usuario@ip-del-vps
```

### 2️⃣ Instalar Node.js y PM2
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
node --version  # Verificar instalación
```

### 3️⃣ Configurar MySQL
```bash
sudo apt install mysql-server -y
sudo mysql_secure_installation
```

Crear base de datos:
```bash
sudo mysql -u root -p
```

Ejecutar en MySQL:
```sql
CREATE DATABASE preicfes CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'preicfes_user'@'localhost' IDENTIFIED BY 'CambiaEstaPassword123!';
GRANT ALL PRIVILEGES ON preicfes.* TO 'preicfes_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### 4️⃣ Clonar el proyecto
```bash
cd /var/www
sudo git clone https://github.com/TU-USUARIO/PRE-ICFES_ONLINE.git
cd PRE-ICFES_ONLINE
sudo chown -R $USER:$USER /var/www/PRE-ICFES_ONLINE
```

### 5️⃣ Configurar variables de entorno
```bash
cp .env.example .env
nano .env
```

Editar y guardar (Ctrl+O, Enter, Ctrl+X):
```env
DB_HOST=localhost
DB_USER=preicfes_user
DB_PASSWORD=CambiaEstaPassword123!
DB_NAME=preicfes
PORT=3000
NODE_ENV=production
```

### 6️⃣ Instalar dependencias e iniciar
```bash
npm install
pm2 start conexion.js --name preicfes
pm2 save
pm2 startup
# Copiar y ejecutar el comando que muestre PM2
```

### 7️⃣ Configurar Nginx
```bash
sudo apt install nginx -y
sudo cp nginx.conf /etc/nginx/sites-available/preicfes
sudo ln -s /etc/nginx/sites-available/preicfes /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 8️⃣ Configurar DNS en Hostinger

**En el panel de Hostinger:**
1. Ir a **Dominios** → **programamega.com**
2. Click en **DNS / Nameservers**
3. Agregar/modificar estos registros:

| Tipo | Nombre | Apunta a | TTL |
|------|---------|----------|-----|
| A    | @       | IP_DEL_VPS | 3600 |
| A    | www     | IP_DEL_VPS | 3600 |

4. Guardar cambios
5. Esperar 1-24 horas para propagación

### 9️⃣ Instalar SSL (HTTPS)
```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d programamega.com -d www.programamega.com
```

Seleccionar opción **2** (Redirigir HTTP a HTTPS)

### 🔟 Verificar que funcione
```bash
pm2 status
pm2 logs preicfes
curl http://localhost:3000
```

Abrir en navegador:
- http://programamega.com
- https://programamega.com

---

## 🔄 Para actualizar después

```bash
cd /var/www/PRE-ICFES_ONLINE
git pull origin main
npm install
pm2 restart preicfes
```

O usar el script automático:
```bash
bash deploy.sh
```

---

## 🆘 Solución de problemas comunes

### Error: "Cannot connect to MySQL"
```bash
sudo systemctl status mysql
sudo systemctl restart mysql
# Verificar credenciales en .env
```

### Error: "Port 3000 already in use"
```bash
pm2 list
pm2 delete preicfes
pm2 start conexion.js --name preicfes
```

### Error: "502 Bad Gateway"
```bash
pm2 logs preicfes --err
# Ver qué error muestra la aplicación
```

### DNS no resuelve
```bash
dig programamega.com
nslookup programamega.com
# Verificar que apunte a la IP correcta
```

---

## 📝 Comandos útiles

```bash
# Ver logs en tiempo real
pm2 logs preicfes

# Ver estado
pm2 status

# Reiniciar
pm2 restart preicfes

# Detener
pm2 stop preicfes

# Ver uso de recursos
pm2 monit

# Ver logs de Nginx
sudo tail -f /var/log/nginx/preicfes-error.log
sudo tail -f /var/log/nginx/preicfes-access.log
```

---

## ✅ Checklist final

- [ ] Node.js instalado
- [ ] MySQL configurado con base de datos
- [ ] Proyecto clonado en /var/www/PRE-ICFES_ONLINE
- [ ] Archivo .env configurado
- [ ] Dependencias instaladas (npm install)
- [ ] PM2 corriendo la aplicación
- [ ] Nginx configurado como proxy
- [ ] DNS apuntando a la IP del VPS
- [ ] SSL instalado con Certbot
- [ ] Aplicación accesible en https://programamega.com

---

**¡Listo! Tu aplicación PRE-ICFES ONLINE está en producción** 🎉
