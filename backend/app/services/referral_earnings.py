"""Rev-share del rake: dinero real (USDC) para el dueño de un código de referido.

Separado de `referrals.py` a propósito: aquél reparte puntos Gimmighoul, éste reparte
dinero. Mezclarlos haría que un cambio en la economía de puntos tocase el camino del dinero.

Atribución POR JUGADOR: el rake se cobra al ganador, pero su cuantía es por jugador
(0,5% × N, con tope). Así que el fee cobrado se divide en N partes iguales y el referidor
de cada participante referido cobra su corte de la parte de SU referido — gane o pierda.
Con atribución al ganador, un referido que juega mucho y gana poco no generaría nada, que
es justo lo contrario de lo que se quiere premiar.
"""
from __future__ import annotations

import logging
from typing import List, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (BattlePlayer, ReferralCode, ReferralEarning, ReferralPayout,
                      User)

logger = logging.getLogger(__name__)


def accrue_rake_earnings(session: Session, battle_id: str,
                         charged_base_units: int) -> List[ReferralEarning]:
    """Devenga el rev-share de UNA batalla sobre el fee REALMENTE cobrado.

    No commitea: se llama dentro del commit del cobro del fee, para heredar su guard de
    idempotencia (`battle.fee_charged`) — un settle repetido no puede duplicar devengos.

    Devuelve las filas creadas (lista vacía si no había nada que devengar). Nunca lanza:
    esto vive en el camino del dinero y un fallo aquí no puede tumbar un settle.
    """
    try:
        if charged_base_units <= 0:
            return []
        wallets = [p.player_wallet for p in
                   session.query(BattlePlayer).filter_by(battle_id=battle_id).all()]
        if not wallets:
            return []
        per_player = charged_base_units // len(wallets)
        if per_player <= 0:
            return []

        # Lo ya devengado de esta batalla. El guard `fee_charged` del cobro ya impide llegar aquí
        # dos veces, pero esa protección es PRESTADA: si alguien mueve esta llamada de sitio o
        # cambia el guard, el referidor acumularía el doble y nadie se enteraría. Esto lo hace
        # imposible en vez de improbable, y el índice único de la tabla es la última red.
        ya = {e.referred_wallet for e in
              session.query(ReferralEarning).filter_by(battle_id=battle_id).all()}

        rows: List[ReferralEarning] = []
        for wallet in wallets:
            if wallet in ya:
                continue
            user = session.get(User, wallet)
            if user is None or not user.referred_by:
                continue
            code = session.get(ReferralCode, user.referred_by)
            # Sin dueño no hay a quién pagar; auto-referido sería crear una segunda cuenta
            # para recuperar parte del propio rake.
            if code is None or not code.owner_wallet or code.owner_wallet == wallet:
                continue
            amount = int(per_player * code.rake_share_pct)   # trunca: el polvo queda en plataforma
            if amount <= 0:
                continue
            row = ReferralEarning(code=code.code, referrer_wallet=code.owner_wallet,
                                  referred_wallet=wallet, battle_id=battle_id,
                                  amount_base_units=amount)
            session.add(row)
            rows.append(row)
        return rows
    except Exception:
        logger.exception("rev-share: devengo falló en la batalla %s — se omite", battle_id)
        return []


def referrer_summary(session: Session, wallet: str) -> dict:
    """Resumen para el panel del referidor. Devuelve ceros (no error) si no posee códigos."""
    codes = session.query(ReferralCode).filter_by(owner_wallet=wallet).all()
    code_rows = []
    for c in codes:
        referred = session.query(User).filter_by(referred_by=c.code).count()
        code_rows.append({"code": c.code, "rake_share_pct": c.rake_share_pct,
                          "referred_count": referred})

    def _sum(*conditions) -> int:
        return int(session.scalar(
            select(func.coalesce(func.sum(ReferralEarning.amount_base_units), 0))
            .where(ReferralEarning.referrer_wallet == wallet, *conditions)) or 0)

    return {
        "codes": code_rows,
        "unclaimed_base_units": _sum(ReferralEarning.payout_id.is_(None)),
        "lifetime_base_units": _sum(),
    }


def claim_earnings(session: Session, wallet: str) -> Tuple[Optional[ReferralPayout], List[int]]:
    """Abre un claim: crea el payout 'pending' con el total pendiente y devuelve sus earning ids.

    NO marca las earnings todavía. Se marcan sólo cuando la transferencia confirma
    (mark_payout_sent), para que un pago fallido deje el dinero reclamable.
    """
    pending = session.query(ReferralEarning).filter(
        ReferralEarning.referrer_wallet == wallet,
        ReferralEarning.payout_id.is_(None)).all()
    if not pending:
        return None, []
    total = sum(e.amount_base_units for e in pending)
    payout = ReferralPayout(wallet=wallet, amount_base_units=total, status="pending")
    session.add(payout)
    session.flush()          # necesitamos payout.id
    return payout, [e.id for e in pending]


def mark_payout_sent(session: Session, payout: ReferralPayout, earning_ids: List[int],
                     signature: str) -> None:
    session.query(ReferralEarning).filter(ReferralEarning.id.in_(earning_ids)).update(
        {ReferralEarning.payout_id: payout.id}, synchronize_session=False)
    payout.status = "sent"
    payout.signature = signature
    session.commit()


def mark_payout_failed(session: Session, payout: ReferralPayout) -> None:
    """El pago no salió: las earnings siguen sin payout_id, así que se pueden volver a reclamar."""
    payout.status = "failed"
    session.commit()


class ClaimEnVuelo(Exception):
    """Hay un cobro a medias: no se sabe todavía de quién es ese dinero."""


def cambiar_dueño(session: Session, code: str, nuevo: str) -> dict:
    """Reasigna un código de referido a otra wallet, con su dinero pendiente.

    POR QUÉ NO BASTA CON TOCAR `referral_codes`. Cada devengo guarda una COPIA de la dirección
    (`referrer_wallet`) en el momento de generarse, y el cobro filtra por esa copia. Cambiar solo
    el código dejaría lo ya devengado apuntando a la wallet vieja: invisible y no reclamable para
    la nueva, sin ningún error que lo explicase.

    QUÉ SE MUEVE Y QUÉ NO:

      · devengos sin cobrar de ESE código  → se mueven; siguen reclamables por la nueva.
      · pagos ya enviados                  → se quedan. Son el registro de a quién se le pagó,
                                             y reescribirlo sería falsear el histórico.
      · gimmighouls del referidor          → no se tocan. Son un contador ya sumado a un usuario;
                                             moverlos es cosa aparte, y a mano.

    SE NIEGA SI HAY UN COBRO EN VUELO. Un `ReferralPayout` en `pending` todavía NO ha marcado sus
    devengos —a propósito, para que un pago fallido los deje reclamables—, así que están con
    `payout_id` a nulo y entrarían en la mudanza. Si la transferencia confirma después, marcaría
    como pagados unos devengos que ya son de otra wallet; si falla, quedarían reclamables por las
    dos. No hay forma de acertar: solo se sabe de quién es ese dinero cuando el pago resuelve. Así
    que se para y se avisa, que cuesta minutos, en vez de adivinar, que cuesta pagar dos veces.
    """
    rc = session.get(ReferralCode, code)
    if rc is None:
        raise ValueError(f"no existe el código {code!r}")
    antiguo = rc.owner_wallet
    if antiguo == nuevo:
        return {"code": code, "antes": antiguo, "ahora": nuevo, "movidos": 0, "importe": 0}

    if antiguo:
        en_vuelo = session.query(ReferralPayout).filter(
            ReferralPayout.wallet == antiguo, ReferralPayout.status == "pending").all()
        if en_vuelo:
            ids = ", ".join(str(p.id) for p in en_vuelo)
            total = sum(p.amount_base_units for p in en_vuelo)
            raise ClaimEnVuelo(
                f"{antiguo} tiene {len(en_vuelo)} cobro(s) sin resolver (payout {ids}, "
                f"${total / 1e6:.2f}). Espera a que confirme o falle y repite.")

    pendientes = session.query(ReferralEarning).filter(
        ReferralEarning.code == code,
        ReferralEarning.referrer_wallet == antiguo,
        ReferralEarning.payout_id.is_(None)).all()
    importe = sum(e.amount_base_units for e in pendientes)
    for e in pendientes:
        e.referrer_wallet = nuevo
    rc.owner_wallet = nuevo
    session.flush()
    return {"code": code, "antes": antiguo, "ahora": nuevo,
            "movidos": len(pendientes), "importe": importe}
