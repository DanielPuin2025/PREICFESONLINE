#!/bin/bash

# Script de despliegue para PRE-ICFES ONLINE en VPS
# Uso: bash deploy.sh

echo "=========================================="
echo "  DESPLIEGUE PRE-ICFES ONLINE"
echo "=========================================="
echo ""

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Variables
APP_DIR="/var/www/PRE-ICFES_ONLINE"
APP_NAME="preicfes"
DOMAIN="programamega.com"

# Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: Debes ejecutar este script desde la raíz del proyecto${NC}"
    exit 1
fi

# Actualizar código
echo -e "${YELLOW}📦 Actualizando código desde Git...${NC}"
git pull origin main
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Error al actualizar desde Git${NC}"
    exit 1
fi

# Instalar dependencias
echo -e "${YELLOW}📦 Instalando dependencias...${NC}"
npm install
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Error al instalar dependencias${NC}"
    exit 1
fi

# Verificar archivo .env
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️  Archivo .env no encontrado. Copiando desde .env.example...${NC}"
    cp .env.example .env
    echo -e "${RED}❗ IMPORTANTE: Edita el archivo .env con tus credenciales antes de continuar${NC}"
    echo "nano .env"
    exit 1
fi

# Reiniciar aplicación con PM2
echo -e "${YELLOW}🔄 Reiniciando aplicación...${NC}"
pm2 restart $APP_NAME 2>/dev/null
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠️  Aplicación no encontrada en PM2. Iniciando por primera vez...${NC}"
    pm2 start conexion.js --name $APP_NAME
    pm2 save
fi

# Verificar estado
echo -e "${YELLOW}📊 Verificando estado...${NC}"
pm2 status $APP_NAME

echo ""
echo -e "${GREEN}✅ Despliegue completado exitosamente!${NC}"
echo ""
echo "Comandos útiles:"
echo "  pm2 logs $APP_NAME       # Ver logs"
echo "  pm2 monit               # Monitor en tiempo real"
echo "  pm2 restart $APP_NAME   # Reiniciar"
echo ""
echo "Accede a la aplicación en: https://$DOMAIN"
echo ""
