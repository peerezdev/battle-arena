"""Volumen y caja, separado por producto. Solo lee: no escribe nada ni mueve dinero.

Uso (desde backend/):
  PYTHONPATH=. .venv/bin/python3 scripts/volumen.py
  PYTHONPATH=. .venv/bin/python3 scripts/volumen.py --dias 1     # solo las últimas 24 h
  PYTHONPATH=. .venv/bin/python3 scripts/volumen.py --detalle    # además, por máquina

Con APP_NETWORK=mainnet trabaja sobre mainnet. En producción: `sudo ba volumen`.

QUÉ CUENTA COMO VOLUMEN: cajas pagadas, en bruto. Cada sobre de gacha y cada tirada de batalla
suman el precio de SU caja — el de la ronda, no el de la partida, porque una batalla puede mezclar
cajas de distinto precio (battle_packs.price manda sobre pack_battles.price).

Es bruto a propósito: no descuenta lo que el jugador recupera en cartas ni en auto-ventas. Esas
dos cifras salen aparte, abajo, para que se puedan restar si se quiere otra medida.

Los sobres de gacha y las tiradas de batalla son flujos SEPARADOS: sus memos no se solapan (se
comprueba y se avisa si algún día dejan de estarlo), así que no hay doble conteo.
"""
import argparse
import sys

from app.config import get_settings
from app.db import make_engine, make_session_factory
from scripts._destino import anunciar

USDC = 1_000_000


def usd(base_units) -> str:
    return f"{(base_units or 0) / USDC:>12,.2f}"


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="volumen y caja por producto")
    p.add_argument("--dias", type=float, default=None,
                   help="limita a los últimos N días (por defecto, todo el histórico)")
    p.add_argument("--detalle", action="store_true", help="desglosa también por máquina")
    args = p.parse_args(argv)

    st = get_settings()
    anunciar(st)
    Session = make_session_factory(make_engine(st.database_url))

    # El filtro temporal se aplica a la fecha de creación de cada cosa.
    corte = f"and created_at >= datetime('now', '-{args.dias} days')" if args.dias else ""
    corte_pb = corte.replace("created_at", "pb.created_at")

    with Session() as s:
        def uno(sql):
            return s.execute(__import__("sqlalchemy").text(sql)).fetchall()

        # ── Gacha ────────────────────────────────────────────────────────────────
        # submitted_at marca que el pago se envió: un sobre generado y nunca comprado no cuenta.
        g = uno(f"""select count(*), coalesce(sum(price),0), coalesce(sum(buyback_amount),0),
                           sum(case when auto_sold then 1 else 0 end)
                    from gacha_packs where submitted_at is not null {corte}""")[0]

        # ── Batallas ─────────────────────────────────────────────────────────────
        filas = uno(f"""select pb.mode, pb.status, count(*),
                               coalesce(sum(coalesce(bpk.price, pb.price)),0),
                               coalesce(sum(bp.buyback_amount),0)
                        from battle_pulls bp
                        join pack_battles pb on pb.id = bp.battle_id
                        left join battle_packs bpk
                             on bpk.battle_id = bp.battle_id and bpk.sequence = bp.round_number
                        where 1=1 {corte_pb}
                        group by pb.mode, pb.status""")

        # ── Comisión cobrada ─────────────────────────────────────────────────────
        fee = uno(f"""select count(*), coalesce(sum(fee_base_units),0)
                      from pack_battles pb where fee_charged = 1 {corte_pb}""")[0]

        # ── Salud del conteo: los dos flujos no deben compartir memo ─────────────
        solape = uno("""select count(*) from gacha_packs g
                        join battle_pulls p on p.memo = g.memo""")[0][0]

        ambito = f"últimos {args.dias:g} días" if args.dias else "todo el histórico"
        print(f"\n  VOLUMEN — {ambito}\n")
        print(f"  {'producto':<28}{'cajas':>8}{'volumen USDC':>16}")
        print(f"  {'-' * 52}")

        vol_gacha, cajas_gacha = g[1], g[0]
        print(f"  {'Gacha':<28}{cajas_gacha:>8}{usd(vol_gacha)}")

        por_modo = {}
        for modo, estado, n, vol, buy in filas:
            por_modo.setdefault(modo, []).append((estado, n, vol, buy))

        vol_batallas = 0
        for modo in sorted(por_modo):
            sub = por_modo[modo]
            n_total = sum(x[1] for x in sub)
            v_total = sum(x[2] for x in sub)
            vol_batallas += v_total
            etiqueta = "Pack Battles" if modo == "pack" else "Battle Royale"
            print(f"  {etiqueta:<28}{n_total:>8}{usd(v_total)}")
            for estado, n, vol, _ in sorted(sub, key=lambda x: -x[2]):
                print(f"    · {estado:<24}{n:>8}{usd(vol)}")
        for modo, etiqueta in (("pack", "Pack Battles"), ("royale", "Battle Royale")):
            if modo not in por_modo:
                print(f"  {etiqueta:<28}{0:>8}{usd(0)}")

        print(f"  {'-' * 52}")
        print(f"  {'TOTAL':<28}{cajas_gacha + sum(x[1] for v in por_modo.values() for x in v):>8}"
              f"{usd(vol_gacha + vol_batallas)}")

        # ── Lo que no es volumen, pero es la siguiente pregunta ─────────────────
        buy_gacha = g[2]
        buy_batallas = sum(x[3] for v in por_modo.values() for x in v)
        print(f"\n  DEVUELTO A JUGADORES EN AUTO-VENTAS (no se resta arriba)")
        print(f"    gacha    {usd(buy_gacha)}   ({g[3] or 0} sobres auto-vendidos)")
        print(f"    batallas {usd(buy_batallas)}")

        print(f"\n  COMISIÓN COBRADA")
        print(f"    {fee[0]} partidas con fee   {usd(fee[1])}")

        if solape:
            print(f"\n  AVISO: {solape} memos aparecen a la vez en gacha_packs y battle_pulls."
                  f"\n  El volumen estaría contando esas cajas DOS veces. Revisar antes de fiarse.",
                  file=sys.stderr)

        if args.detalle:
            print(f"\n  POR MÁQUINA")
            print(f"    {'máquina':<20}{'gacha':>8}{'batallas':>10}{'USDC':>14}")
            det = uno(f"""select maquina, sum(g), sum(b), sum(v) from (
                            select pack_type as maquina, count(*) as g, 0 as b,
                                   coalesce(sum(price),0) as v
                            from gacha_packs where submitted_at is not null {corte}
                            group by pack_type
                            union all
                            select coalesce(bpk.machine_code, pb.machine_code), 0, count(*),
                                   coalesce(sum(coalesce(bpk.price, pb.price)),0)
                            from battle_pulls bp
                            join pack_battles pb on pb.id = bp.battle_id
                            left join battle_packs bpk
                                 on bpk.battle_id = bp.battle_id and bpk.sequence = bp.round_number
                            where 1=1 {corte_pb}
                            group by 1)
                          group by maquina order by 4 desc""")
            for maquina, ng, nb, v in det:
                print(f"    {maquina:<20}{ng or 0:>8}{nb or 0:>10}{usd(v)}")

        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
