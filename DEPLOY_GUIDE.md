# Guía para desplegar Flashloan Bot + Métricas en servidor

Esta guía está pensada para que un agente remoto la siga paso a paso.

## Requisitos
- Servidor Linux con Docker + Docker Compose v2
- Clave privada con ETH en Arbitrum/Base para gas (si vas a poner `DRY_RUN=false`)
- Contrato `Flashloan` desplegado y dirección
- RPC HTTP/WS (Alchemy/QuickNode/etc)
- Puertos libres: 3000 (dashboard) y opcional 5432 (solo si quieres acceder desde fuera; mejor solo interno)

## 1) Clonar repo
```bash
git clone <REPO_URL> flashloan-bot
cd flashloan-bot
```

## 2) Configurar variables
```bash
cp .env.prod.example .env
nano .env  # o tu editor
```

Rellenar:
- `CHAIN=arbitrum|base`
- `ARBITRUM_RPC_URL`, `ARBITRUM_WSS_URL` (o los de Base)
- `PRIVATE_KEY` (0x...)
- `FLASHLOAN_CONTRACT`
- `DRY_RUN=true` (recomendado primero) / `false` (en producción real)
- `DATABASE_URL` ya lo usa docker internamente (no cambiar si usas compose prod)

## 3) Levantar todo
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Esto levanta: `postgres` (healthcheck), `bot`, `dashboard`.

## 4) Verificar
```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f bot  # ver oportunidades/dry-run
docker compose -f docker-compose.prod.yml logs -f dashboard
```

Dashboard: `http://<IP_SERVIDOR>:3000`

## 5) Comprobar métricas
La tabla `opportunities` guarda: chain, mode(dryrun/live), pair/dexes, flashloan_amount, profit/premium/gas/net_profit, simulated, executed, tx_hash, raw_json, created_at.

## 6) Parar/reiniciar
```bash
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml restart bot
```

## 7) Actualizar código
```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## Tips seguridad
- NO expongas 5432 públicamente si no es necesario
- Usa `.env` con permisos restrictivos (`chmod 600 .env`)
- Empieza SIEMPRE en `DRY_RUN=true` y revisa logs/dashboard antes de pasar a `false`
