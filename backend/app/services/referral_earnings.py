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
from typing import List

from sqlalchemy.orm import Session

from ..models import BattlePlayer, ReferralCode, ReferralEarning, User

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

        rows: List[ReferralEarning] = []
        for wallet in wallets:
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
