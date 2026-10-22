# P0 — Correctitud de ejecución (flashloan-bot)

## Objetivo
Cerrar los bugs de correctitud verificados en la lista de mejoras, y eliminar el
código muerto que los contiene (arreglar bugs de código inalcanzable no aporta).

## Hallazgos verificados (evidencia real)

1. **Premium de Aave hardcodeado en 7 sitios** (`(amount * 5n) / 10000n`).
   El contrato repaga `amount + premium`, donde `premium` lo fija el pool de Aave
   (`contracts/src/Flashloan.sol:104`). Si el fee del pool cambia, todos los
   `netProfit` quedan mal y el bot puede ejecutar a pérdida.
   → Centralizar en `src/flashloanPremium.js`, overridable por
   `AAVE_FLASHLOAN_PREMIUM_BPS`.

2. **`src/arbitrageFinder.js` (194 líneas) es CÓDIGO MUERTO con bugs.**
   `flashloanBot.js:198` lo instancia y **nunca** llama `scanForOpportunities`.
   El bot real usa `smartFinder`. Sus bugs:
   - `buildArbitrageParams` (líneas 143-180) fuerza routers `SUSHISWAP`/`CAMELOT`
     para triangulares, ignorando las venues reales de la ruta.
   - Todo marcado `dexType: 0` (V2) aunque la ruta sea V3.
   → Eliminar el módulo y su instanciación.

3. **`src/oneinch.js` (227 líneas) es código muerto y con require roto.**
   Solo lo referencia `scripts/test-1inch.js`, que hace `require('./oneinch')`
   desde `scripts/` — donde no existe (está en `src/`). El script nunca corrió.
   → Eliminar ambos.

4. **`config/base.js` es código muerto.** Nadie lo importa; todos usan
   `src/chains.js`. Contiene un `AERODROME` que `chains.js` no tiene (origen de
   confusión). → Eliminar.

## Fuera de alcance (van en PRs siguientes)
- P1.5: Base roto (`AERODROME` en `dexPairs` pero no en `dexes` de `chains.js`).
- P1.7: ampliar venues (PancakeSwap V3, etc.).
- P2.11: ESLint real.
- P2.12: testabilidad de `index.js`.

## Criterio de aceptación
- `node --test test/*.test.js` sigue verde (41/41) + tests nuevos del premium.
- `node -e "require('./src/flashloanBot.js')"` carga sin error.
- Ningún módulo borrado queda referenciado.
