# 🚀 GUÍA RÁPIDA DE DESPLIEGUE - programamega.com

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
