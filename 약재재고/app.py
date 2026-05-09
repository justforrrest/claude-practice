# -*- coding: utf-8 -*-
from flask import Flask, render_template, request, redirect, url_for, jsonify
import sqlite3
import os
from datetime import date

app = Flask(__name__)
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'inventory.db')

HERBS = [
    ("가자", 6.7), ("갈근", 18.3), ("감국", 19.5), ("감수", 45.2), ("감초", 30),
    ("강활1", 40), ("강활2", 45.7), ("강황", 8.3), ("건강", 9.5), ("건율", 34.7),
    ("건지황", 18.3), ("결명자", 0), ("계지", 4.8), ("계혈등", 4.7), ("고량강", 17),
    ("고본", 64), ("고삼", 9), ("과루인", 10.8), ("곽향1", 13.8), ("곽향2", 7),
    ("관동화", 121.7), ("구기자", 13.7), ("구척", 23.8), ("귀판", 31.7), ("금은화", 43),
    ("길경", 11.5), ("나복자", 6), ("남성1", 52), ("남성2", 26), ("단삼", 12.5),
    ("담두시", 13.3), ("당귀1", 31.7), ("당귀2", 23), ("당삼", 51), ("대두황권", 26),
    ("대복피", 5.3), ("대추", 21.2), ("대황", 13), ("도인", 13.3), ("독활", 31.2),
    ("두충", 21.4), ("등심초", 65), ("마자인", 8), ("마황", 8.5), ("만형자", 22.5),
    ("망초", 5), ("맥문동", 39.2), ("맥아", 7.5), ("모과", 9.8), ("모려", 8),
    ("목단피", 33.7), ("목통", 10.7), ("목향", 12.2), ("몰약", 17.5), ("문합", 15),
    ("박하", 21.8), ("반하", 41), ("방기1", 70.2), ("방기2", 5.8), ("방기3", 23.8),
    ("방풍1", 11.7), ("방풍2", 22.6), ("백강잠", 33), ("백개자", 6.3), ("백두구", 21),
    ("백부근", 23.3), ("백선피", 0), ("백자인", 39.8), ("백작약", 19.6), ("백지", 26.4),
    ("백질려", 16), ("백출", 13), ("백편두", 10.5), ("백하수오", 49.8), ("백합", 16.7),
    ("복령", 8.7), ("복분자", 10.4), ("봉출", 10.8), ("부소맥", 10.3), ("부자", 18.3),
    ("비파엽", 9), ("빈랑", 9), ("사삼", 27.2), ("사인", 21.8), ("산사", 7),
    ("산수유", 26), ("산약", 18.3), ("산조인", 251.6), ("삼릉", 9.2), ("상백피", 35),
    ("생강", 20), ("생지황", 19), ("석고", 5.5), ("석곡", 20.8), ("석창포", 31.3),
    ("선복화", 33.3), ("세신", 145.2), ("소목", 6.2), ("소엽", 12), ("소자", 7.5),
    ("소회향", 8.3), ("속단", 10.8), ("숙지황", 20), ("승마", 31.7), ("시호1", 74.8),
    ("시호2", 15.3), ("신곡", 8), ("신이화", 36), ("아교", 26.7), ("애엽", 24.7),
    ("야교등", 11.3), ("여정자", 6.7), ("연교", 28), ("연육", 9.2), ("오가피", 16.5),
    ("오공", 936), ("오매", 11.7), ("오미자", 23.5), ("오수유", 15.2), ("오약", 9.2),
    ("용골", 14), ("용담초", 47.2), ("우방자", 10.2), ("우슬", 17.7), ("울금", 11.2),
    ("원육", 20.5), ("원지", 68), ("위령선", 29), ("유백피", 33.6), ("유향", 14.7),
    ("육계", 14.8), ("육두구", 25.8), ("육종용", 22), ("음양곽", 31), ("의이인", 15.8),
    ("익모초", 12.5), ("익지인", 22.8), ("인삼", 120), ("인진", 12), ("자완", 38),
    ("자충", 52), ("저근백피", 23.3), ("저령", 46.7), ("적석지", 8.2), ("적하수오", 20),
    ("전호", 23), ("조협", 13), ("조구등", 18.3), ("죽여1", 15.4), ("죽여2", 0),
    ("죽엽", 7.5), ("지각", 10), ("지골피", 21.7), ("지룡", 50.8), ("지모", 16.7),
    ("지부자", 9.3), ("지실", 16.7), ("진교", 23.3), ("진피1", 17.6), ("진피2", 68.3),
    ("차전자", 23.3), ("창이자", 6.8), ("창출1", 25), ("창출2", 21.7), ("천궁1", 10.8),
    ("천궁2", 20.8), ("천련자", 11.6), ("천마", 52.8), ("천문동", 29.8), ("천오", 22),
    ("천초", 22.6), ("천화분", 23.5), ("청상자", 14.2), ("청피", 7.3), ("초두구", 11.7),
    ("치자", 26), ("택사1", 28.2), ("택사2", 11), ("토사자", 17.2), ("파고지", 14.2),
    ("파극천", 35), ("패모", 32), ("포공영", 8.7), ("합환피", 18.2), ("해동피", 8),
    ("행인", 12), ("향부자", 14.7), ("향시", 39), ("현삼", 27.5), ("현호색", 59.7),
    ("형개", 17.6), ("홍화", 44.2), ("활석", 8.5), ("황금", 22.5), ("황기", 16.8),
    ("황련", 136.8), ("황백", 30.8), ("황정", 15.8), ("후박", 8.8),
]

SUPPLIERS = ["옴니허브", "신우한방", "한퓨어", "바른한약"]


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS herbs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            unit_price REAL DEFAULT 0,
            min_stock REAL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS inbound (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            herb_id INTEGER NOT NULL,
            quantity REAL NOT NULL,
            date TEXT NOT NULL,
            supplier TEXT NOT NULL,
            note TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (herb_id) REFERENCES herbs(id)
        );
        CREATE TABLE IF NOT EXISTS outbound (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            herb_id INTEGER NOT NULL,
            quantity REAL NOT NULL,
            date TEXT NOT NULL,
            purpose TEXT NOT NULL,
            note TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (herb_id) REFERENCES herbs(id)
        );
    """)
    for name, price in HERBS:
        conn.execute(
            "INSERT OR IGNORE INTO herbs (name, unit_price) VALUES (?, ?)",
            (name, price)
        )
    conn.commit()
    conn.close()


def get_stock_query():
    return """
        SELECT h.id, h.name, h.unit_price, h.min_stock,
               COALESCE(i.total, 0) - COALESCE(o.total, 0) AS stock
        FROM herbs h
        LEFT JOIN (SELECT herb_id, SUM(quantity) AS total FROM inbound GROUP BY herb_id) i
            ON h.id = i.herb_id
        LEFT JOIN (SELECT herb_id, SUM(quantity) AS total FROM outbound GROUP BY herb_id) o
            ON h.id = o.herb_id
    """


@app.route('/')
def dashboard():
    search = request.args.get('q', '').strip()
    filter_low = request.args.get('low', '')
    conn = get_db()
    query = get_stock_query()
    params = []
    conditions = []
    if search:
        conditions.append("h.name LIKE ?")
        params.append(f'%{search}%')
    if filter_low == '1':
        conditions.append("h.min_stock > 0 AND (COALESCE(i.total,0) - COALESCE(o.total,0)) < h.min_stock")
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY h.name"
    herbs = conn.execute(query, params).fetchall()
    low_count = conn.execute(
        get_stock_query() +
        " WHERE h.min_stock > 0 AND (COALESCE(i.total,0) - COALESCE(o.total,0)) < h.min_stock"
    ).fetchall()
    conn.close()
    return render_template('dashboard.html',
                           herbs=herbs,
                           low_count=len(low_count),
                           search=search,
                           filter_low=filter_low)


@app.route('/inbound', methods=['GET', 'POST'])
def inbound():
    conn = get_db()
    if request.method == 'POST':
        herb_id = request.form['herb_id']
        quantity = float(request.form['quantity'])
        rec_date = request.form['date']
        supplier = request.form['supplier']
        note = request.form.get('note', '')
        conn.execute(
            "INSERT INTO inbound (herb_id, quantity, date, supplier, note) VALUES (?,?,?,?,?)",
            (herb_id, quantity, rec_date, supplier, note)
        )
        conn.commit()
        conn.close()
        return redirect(url_for('inbound'))
    herbs = conn.execute("SELECT id, name FROM herbs ORDER BY name").fetchall()
    history = conn.execute("""
        SELECT i.id, h.name, i.quantity, i.date, i.supplier, i.note, i.created_at
        FROM inbound i JOIN herbs h ON i.herb_id = h.id
        ORDER BY i.date DESC, i.created_at DESC LIMIT 50
    """).fetchall()
    conn.close()
    return render_template('inbound.html', herbs=herbs, history=history,
                           suppliers=SUPPLIERS, today=date.today().isoformat())


@app.route('/inbound/delete/<int:rid>', methods=['POST'])
def inbound_delete(rid):
    conn = get_db()
    conn.execute("DELETE FROM inbound WHERE id=?", (rid,))
    conn.commit()
    conn.close()
    return redirect(url_for('inbound'))


@app.route('/outbound', methods=['GET', 'POST'])
def outbound():
    conn = get_db()
    if request.method == 'POST':
        herb_id = request.form['herb_id']
        quantity = float(request.form['quantity'])
        rec_date = request.form['date']
        purpose = request.form['purpose']
        note = request.form.get('note', '')
        conn.execute(
            "INSERT INTO outbound (herb_id, quantity, date, purpose, note) VALUES (?,?,?,?,?)",
            (herb_id, quantity, rec_date, purpose, note)
        )
        conn.commit()
        conn.close()
        return redirect(url_for('outbound'))
    herbs = conn.execute("SELECT id, name FROM herbs ORDER BY name").fetchall()
    history = conn.execute("""
        SELECT o.id, h.name, o.quantity, o.date, o.purpose, o.note, o.created_at
        FROM outbound o JOIN herbs h ON o.herb_id = h.id
        ORDER BY o.date DESC, o.created_at DESC LIMIT 50
    """).fetchall()
    conn.close()
    return render_template('outbound.html', herbs=herbs, history=history,
                           today=date.today().isoformat())


@app.route('/outbound/delete/<int:rid>', methods=['POST'])
def outbound_delete(rid):
    conn = get_db()
    conn.execute("DELETE FROM outbound WHERE id=?", (rid,))
    conn.commit()
    conn.close()
    return redirect(url_for('outbound'))


@app.route('/settings', methods=['GET', 'POST'])
def settings():
    conn = get_db()
    if request.method == 'POST':
        for key, val in request.form.items():
            if key.startswith('price_'):
                hid = key.split('_')[1]
                conn.execute("UPDATE herbs SET unit_price=? WHERE id=?", (float(val or 0), hid))
            elif key.startswith('min_'):
                hid = key.split('_')[1]
                conn.execute("UPDATE herbs SET min_stock=? WHERE id=?", (float(val or 0), hid))
        conn.commit()
        conn.close()
        return redirect(url_for('settings'))
    herbs = conn.execute("SELECT id, name, unit_price, min_stock FROM herbs ORDER BY name").fetchall()
    conn.close()
    return render_template('settings.html', herbs=herbs)


@app.route('/api/herbs')
def api_herbs():
    conn = get_db()
    herbs = conn.execute("SELECT id, name FROM herbs ORDER BY name").fetchall()
    conn.close()
    return jsonify([dict(h) for h in herbs])


if __name__ == '__main__':
    try:
        init_db()
        print("=" * 40)
        print(" 한의원 약재 재고 관리 시스템")
        print(" http://localhost:5000 에서 접속하세요")
        print(" 종료: Ctrl+C")
        print("=" * 40)
        app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False)
    except Exception as e:
        print(f"\n[오류] {e}")
        input("\nEnter 키를 눌러 종료...")
