# Separar en proyectos independientes por rubro

La plataforma soporta **"modo rubro fijo"**: una copia del código puede quedar bloqueada a un solo
rubro (su landing es la home, el registro entra directo a ese rubro, y solo se muestran sus módulos).
Con esto, cada rubro puede vivir como un **proyecto/repo/deploy independiente** sin cambiar el código.

## 1. Generar el proyecto de un rubro
Desde la raíz de este repo:
```
node tools/crear-proyecto-rubro.mjs supermercado
```
Crea `../turno-supermercado/` — copia del código sin `node_modules`, `.git`, `_legacy` ni secretos,
ya configurada con `RUBRO_FIJO=supermercado` / `VITE_RUBRO_FIJO=supermercado`.

Rubros: `barberia · taller · restaurante · supermercado · ferreteria · vape_shop · farmacia · granja_avicola · prestamista`

## 2. Convertirlo en su propio repo
```
cd ../turno-supermercado
git init && git add -A && git commit -m "init proyecto supermercado"
git remote add origin <URL_DEL_NUEVO_REPO>
git push -u origin main
```

## 3. Desplegarlo (igual que Turno)
- **Base de datos:** su propio proyecto Supabase (independiente).
- **Backend (Railway):** variables normales + `RUBRO_FIJO=supermercado`.
- **Frontend (Cloudflare Pages):** conectar el repo + variable `VITE_RUBRO_FIJO=supermercado` y `VITE_API_URL=<backend>`.

## Cómo funciona el modo rubro fijo
| Sin `RUBRO_FIJO` (plataforma) | Con `RUBRO_FIJO=<rubro>` (producto único) |
|---|---|
| Home `/` = hub multi-rubro | Home `/` = landing de ese rubro |
| `/perfiles` devuelve los 9 | `/perfiles` devuelve solo ese |
| Al crear negocio eliges rubro | El negocio se fuerza a ese rubro |
| Enlace "Soluciones" visible | Oculto |

## Nota importante
Cada proyecto separado **duplica** la plataforma (auth, cobros, planes…) y se mantiene por separado.
Si prefieres **un solo código con varias marcas/dominios**, no hace falta separar repos: basta
desplegar este mismo repo varias veces, cada una con su `RUBRO_FIJO`. Mismo resultado de cara al
cliente, con un solo lugar donde mantener el código.
