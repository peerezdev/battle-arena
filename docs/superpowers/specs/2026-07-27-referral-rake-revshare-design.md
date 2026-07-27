# Rev-share del rake para referidores — Diseño

**Fecha:** 2026-07-27
**Estado:** aprobado en brainstorming (pendiente de plan de implementación)

## Objetivo

Que el dueño de un código de referido cobre **dinero real (USDC)** cuando sus referidos
generan rake en batallas, en lugar de (solo) puntos Gimmighoul. Alinea al referidor con el
ingreso de la plataforma: cobra cuando la plataforma cobra.

## Decisiones (cerradas con el usuario)

| Decisión | Valor |
|---|---|
| Origen del dinero | **Del rake existente** (rev-share). El jugador paga lo mismo que hoy (0,5%/jugador, cap 3%). |
| Porcentaje | **25% por defecto**, configurable **por código** (`rake_share_pct`). |
| Acumulación y pago | **Ledger en BD + claim** del referidor cuando supera un mínimo. |
| Mínimo de claim | **$5** (`referral_claim_min_base_units = 5_000_000`, en Settings/env). |
| Duración | **De por vida** del referido. |
| Quién tiene código | **Solo curados**, creados por CLI (`scripts/referrals.py`), como hoy. |
| Gimmighouls | El **referido** conserva su `boost_pct` de puntos. El **referidor** deja de cobrar puntos (`referrer_pct` queda en 0 para códigos nuevos; el campo sigue existiendo) y pasa a cobrar USDC. |
| Atribución | **Por jugador** (ver abajo), no por ganador. |
| Alcance del ingreso | **Solo rake de batallas** (pack + royale). Ni fee de retiro (incentivo perverso: cobrar cuando el referido se va) ni gacha (sin margen propio; es ingreso de CC). |

### Atribución por jugador

El rake se cobra al ganador, pero su cuantía es por jugador (0,5% × N, cap 3%). El fee
**realmente cobrado** se divide en N partes iguales; el referidor de cada participante
referido cobra `rake_share_pct` de la parte de su referido — gane o pierda ese referido.

Ejemplo (pack 4 jugadores, botín recompra $400 → fee 2% = $8 cobrados al ganador):

```
parte por jugador: $2
Ana   (ref. IBAI, ganó)    → IBAI  +$0.50
Bruno (ref. IBAI, perdió)  → IBAI  +$0.50
Carla (ref. MAURO, perdió) → MAURO +$0.50
David (sin código)         → nadie
plataforma neta: $6.50
```

Caso borde: si el ganador no cubría el fee completo, se devenga sobre **lo cobrado**
(`charged`), nunca sobre el teórico. Nunca se reparte dinero que no entró.

## Datos

### Columna nueva

- `ReferralCode.rake_share_pct: float` default `0.25`. Migración vía `_ENSURE_COLUMNS`
  en `db.py` (patrón existente).

### Tablas nuevas

```python
class ReferralEarning(Base):
    """Una fila por (batalla, participante referido): el devengo auditable."""
    __tablename__ = "referral_earnings"
    id: int (PK autoincrement)
    code: str                      # ReferralCode.code
    referrer_wallet: str  (index)  # dueño del código al devengar
    referred_wallet: str           # el participante que generó el rake
    battle_id: str        (index)
    amount_base_units: int         # USDC base units (6 dec)
    payout_id: Optional[int]       # null = sin cobrar; FK lógica a ReferralPayout
    created_at: datetime

class ReferralPayout(Base):
    __tablename__ = "referral_payouts"
    id: int (PK autoincrement)
    wallet: str (index)            # referidor cobrado
    amount_base_units: int
    signature: Optional[str]       # tx de Solana
    status: str                    # 'pending' | 'sent' | 'failed'
    created_at: datetime
```

## Devengo (gancho en `collect_battle_fee`)

En `backend/app/services/battle_fees.py`, en el punto de éxito donde hoy se hace
`battle.fee_charged = True; battle.fee_base_units = charged` — **misma sesión, mismo
commit** — se llama a una función pura nueva en `referrals.py`:

```python
def accrue_rake_earnings(session, battle_id, charged_base_units, participant_wallets) -> list[ReferralEarning]
```

Lógica:
1. `per_player = charged_base_units // len(participant_wallets)`
2. Para cada participante con `User.referred_by` apuntando a un código existente:
   - `earning = floor(per_player * code.rake_share_pct)`
   - Guardas: saltar si `referred_wallet == code.owner_wallet` (auto-referido),
     si el código no tiene `owner_wallet`, o si `earning <= 0`.
   - Insertar `ReferralEarning`.
3. Redondeo siempre a la baja; el polvo queda en plataforma.

Propiedades:
- **Idempotente por herencia**: `fee_charged` ya guarda contra settles repetidos; el
  devengo vive dentro de ese mismo guard/commit.
- Fee no cobrado (retries agotados, saldo 0) → no hay devengo. Fee parcial → devengo
  proporcional a lo cobrado.
- `participant_wallets` = wallets de `BattlePlayer` de la batalla (el `n_players` que ya
  recibe `collect_battle_fee` debe coincidir; usar la lista, no el número, como fuente).

## Claim

### Endpoints (auth Privy, patrón `current_user` existente)

- `GET /users/me/referrer` → para el authed:
  ```json
  { "codes": [{"code": "IBAI", "rake_share_pct": 0.25, "referred_count": 12}],
    "unclaimed_base_units": 12400000, "lifetime_base_units": 87000000,
    "claim_min_base_units": 5000000 }
  ```
  Sin códigos en propiedad → misma forma con listas/importes a cero (no 404).

- `POST /users/me/referrer/claim`:
  1. `unclaimed < claim_min` → 409.
  2. Lock en memoria por wallet (un claim en vuelo).
  3. Crear `ReferralPayout(status='pending', amount=unclaimed)`.
  4. Transferir USDC **desde la operator wallet** (`privy_operator_wallet_id`) al wallet
     del referidor, por el camino de transferencia existente (`distribute_usdc` /
     `build_usdc_transfer`), con confirmación.
  5. Éxito → marcar las `ReferralEarning` con `payout_id`, payout `status='sent'` +
     `signature`. Devolver `{signature, amount_base_units}`.
  6. Fallo → payout `status='failed'`, earnings intactas (reclamables), 502.

Ventana de crash entre enviar y marcar: se resuelve a mano con la fila `pending` y la
firma en cadena. Aceptable en esta fase; se documenta en el propio endpoint.

### Nota operativa (no bloquea el diseño)

El rake aterriza en `fee_wallet_address` (solo dirección, sin firma), pero el claim paga
desde la **operator wallet**. En devnet: apuntar `FEE_WALLET_ADDRESS` al operador o
mantener al operador fondeado. En mainnet, decidir antes de lanzar: fee wallet como
wallet Privy firmable, o float en el operador.

## Superficie

### CLI (`backend/scripts/referrals.py`)

- `add CODE --name X --boost 0.10 --rake-share 0.25 --owner WALLET`
  (nuevo flag `--rake-share`; `--referrer` sigue existiendo, default 0.0, ya no se
  recomienda en la ayuda).
- `list` → añade por código: nº de referidos, unclaimed y lifetime en USDC.

### Panel del referidor (frontend)

Tarjeta en el **Perfil propio** (Overview), visible **solo** si el wallet authed posee
algún código (la respuesta de `GET /users/me/referrer` trae códigos):

- Nº de referidos, **Unclaimed** (grande), Lifetime.
- Botón **Claim** — deshabilitado bajo el mínimo, con el mínimo indicado.
- Éxito → toast `success` con el importe; fallo → toast `error`.

Cliente nuevo: `src/onchain/referrerClient.ts` (patrón de `leaderboardClient.ts`).

## Tests

**Backend**
- `accrue_rake_earnings` (pura): reparto por jugador, redondeo a la baja, auto-referido
  se salta, sin owner_wallet se salta, fee parcial proporcional, 0 referidos → 0 filas.
- Integración con `collect_battle_fee`: settle repetido no duplica devengos; fee no
  cobrado no devenga.
- Endpoints: auth requerido, resumen correcto, claim bajo mínimo → 409, claim feliz marca
  filas y crea payout `sent`, doble claim concurrente → uno gana, fallo de transferencia
  deja earnings reclamables.
- Migración: `rake_share_pct` aparece en BD existente con default 0.25.

**Frontend**
- Panel invisible sin códigos; visible con ellos.
- Botón Claim deshabilitado bajo mínimo; claim feliz → toast + refresco de importes.

## Fuera de alcance (fase 2, spec aparte si se quiere)

- Self-serve de códigos + anti-fraude (mínimos de actividad, revisión).
- Tramos por volumen (20→30→40%).
- Rev-share sobre otros ingresos (retiro, futuros).
- Rake on-chain (`rake_bps` del programa Anchor sin desplegar; no se toca).
