import json, os, sys
from access_parser import AccessParser
from fpdf import FPDF

class QuotePDF(FPDF):
    def header(self):
        self.set_font('Helvetica', 'B', 18)
        self.set_text_color(0, 51, 102)
        self.cell(0, 10, 'Portes et Fenetres LGC', 0, 1, 'L')
        self.set_font('Helvetica', '', 9)
        self.set_text_color(100, 100, 100)
        self.cell(0, 5, '1292, boul. Saint-Paul, Chicoutimi, QC G7J 3C5  |  (418) 549-7837', 0, 1, 'L')
        self.line(10, self.get_y()+2, 200, self.get_y()+2)
        self.ln(6)

    def footer(self):
        self.set_y(-15)
        self.set_font('Helvetica', 'I', 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 10, f'Page {self.page_no()}/{{nb}}', 0, 0, 'C')

def safe(s):
    if not s or s == 'None':
        return ''
    return s.replace('\x00','').strip().encode('latin-1', errors='replace').decode('latin-1')

def get_table(db, name):
    try:
        t = db.parse_table(name)
        if not t:
            return []
        cols = list(t.keys())
        nrows = len(t[cols[0]]) if cols else 0
        clean = lambda v: str(v).replace('\x00','').strip() if v is not None else ''
        return [{c: clean(t[c][i]) for c in cols} for i in range(nrows)]
    except:
        return []

def generate_pdf(quote_path, clients_json_path, output_path):
    quote_num = os.path.basename(quote_path).replace('.Mdb','')

    db = AccessParser(quote_path)
    soum = get_table(db, 'Soumissions')
    info = get_table(db, 'InfoV3')
    produits = get_table(db, 'Produit')
    options = get_table(db, 'Option')

    # Load client
    with open(clients_json_path, 'r', encoding='utf-8') as f:
        clients = json.load(f)
    client_id = soum[0].get('SCLIENT','') if soum else ''
    client = {}
    for c in clients:
        if c.get('IDESTIMATEUR') == client_id:
            client = c
            break

    pdf = QuotePDF()
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # Title
    pdf.set_font('Helvetica', 'B', 14)
    pdf.set_text_color(0, 51, 102)
    pdf.cell(0, 10, safe(f'SOUMISSION  {quote_num}'), 0, 1, 'C')
    pdf.ln(2)

    # Client info + Details boxes
    pdf.set_fill_color(240, 245, 250)
    pdf.set_draw_color(200, 210, 220)
    pdf.rect(10, pdf.get_y(), 90, 38, 'DF')
    pdf.rect(110, pdf.get_y(), 90, 38, 'DF')

    y_start = pdf.get_y()

    # Client box
    pdf.set_xy(12, y_start + 2)
    pdf.set_font('Helvetica', 'B', 9)
    pdf.set_text_color(0, 51, 102)
    pdf.cell(0, 5, 'CLIENT', 0, 1)
    pdf.set_x(12)
    pdf.set_font('Helvetica', '', 10)
    pdf.set_text_color(30, 30, 30)
    cname = safe(client.get('CNOM', info[0].get('CliName','') if info else ''))
    pdf.cell(0, 5, cname, 0, 1)
    pdf.set_x(12)
    pdf.set_font('Helvetica', '', 8)
    pdf.cell(0, 4, safe(client.get('CADRESSE1', '')), 0, 1)
    pdf.set_x(12)
    addr2 = client.get('CADRESSE2','')
    codep = client.get('CCODEP','')
    pdf.cell(0, 4, safe(f'{addr2}  {codep}'), 0, 1)
    pdf.set_x(12)
    pdf.cell(0, 4, safe(client.get('TEL1', '')), 0, 1)

    # Details box
    pdf.set_xy(112, y_start + 2)
    pdf.set_font('Helvetica', 'B', 9)
    pdf.set_text_color(0, 51, 102)
    pdf.cell(0, 5, 'DETAILS', 0, 1)
    pdf.set_x(112)
    pdf.set_font('Helvetica', '', 9)
    pdf.set_text_color(30, 30, 30)
    date_soum = soum[0].get('SDATE1','')[:10] if soum else ''
    date_exp = soum[0].get('SEXIGIBLE','')[:10] if soum else ''
    date_liv = soum[0].get('SLIVRE','')[:10] if soum else ''
    type_order = safe(info[0].get('TypeOrder','')) if info else ''
    pdf.cell(0, 5, f'Date: {date_soum}', 0, 1)
    pdf.set_x(112)
    pdf.cell(0, 5, f"Valide jusqu'au: {date_exp}", 0, 1)
    pdf.set_x(112)
    pdf.cell(0, 5, f'Livraison estimee: {date_liv}', 0, 1)
    pdf.set_x(112)
    pdf.cell(0, 5, f'Type: {type_order}', 0, 1)

    pdf.set_y(y_start + 42)

    # Products table header
    pdf.set_font('Helvetica', 'B', 11)
    pdf.set_text_color(0, 51, 102)
    pdf.cell(0, 8, 'PRODUITS', 0, 1)

    pdf.set_fill_color(0, 51, 102)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font('Helvetica', 'B', 8)
    col_w = [8, 90, 15, 30, 30]
    headers = ['#', 'Description', 'Qte', 'Prix unit.', 'Total']
    for i, h in enumerate(headers):
        align = 'C' if i < 3 else 'R'
        if i == 1: align = 'L'
        pdf.cell(col_w[i], 7, h, 1, 0, align, True)
    pdf.ln()

    # Product rows
    pdf.set_text_color(30, 30, 30)
    pdf.set_font('Helvetica', '', 8)

    for p in produits:
        ligne = p.get('NOLIGNE','')
        desc = safe(p.get('DESCRIP',''))
        qte = p.get('QTE','1')
        prix = p.get('PRIX','0')
        try:
            prix_f = float(prix)
        except:
            prix_f = 0
        try:
            qte_f = int(float(qte))
        except:
            qte_f = 1
        total_line = prix_f * qte_f

        if pdf.get_y() > 255:
            pdf.add_page()

        # Alternating row color
        fill = False
        try:
            fill = int(ligne) % 2 == 0
        except:
            pass
        if fill:
            pdf.set_fill_color(245, 248, 252)

        pdf.set_font('Helvetica', 'B', 8)
        pdf.cell(col_w[0], 6, safe(ligne), 1, 0, 'C', fill)
        pdf.set_font('Helvetica', '', 8)
        pdf.cell(col_w[1], 6, desc[:55], 1, 0, 'L', fill)
        pdf.cell(col_w[2], 6, str(qte_f), 1, 0, 'C', fill)
        pdf.cell(col_w[3], 6, f'{prix_f:,.2f} $', 1, 0, 'R', fill)
        pdf.cell(col_w[4], 6, f'{total_line:,.2f} $', 1, 0, 'R', fill)
        pdf.ln()

        # Options for this product line
        prod_opts = [o for o in options if o.get('OPNOLIGNE') == ligne]
        if prod_opts:
            pdf.set_font('Helvetica', '', 6.5)
            pdf.set_text_color(90, 90, 90)
            for o in prod_opts:
                od = safe(o.get('OPDESC',''))
                op = o.get('OPPRIX','0')
                if not od:
                    continue
                try:
                    op_f = float(op)
                except:
                    op_f = 0

                if pdf.get_y() > 268:
                    pdf.add_page()

                txt = f'  {od[:75]}'
                if op_f > 0:
                    txt += f'  (+{op_f:,.2f}$)'
                pdf.set_x(20)
                pdf.cell(0, 3.2, txt, 0, 1)

            pdf.set_font('Helvetica', '', 8)
            pdf.set_text_color(30, 30, 30)
            pdf.ln(1)

    # Totals section
    pdf.ln(4)
    subtotal = float(info[0].get('SubTotal','0')) if info else 0
    tps = float(info[0].get('TaxAmount1','0')) if info else 0
    tvq = float(info[0].get('TaxAmount2','0')) if info else 0
    total = float(info[0].get('Total','0')) if info else 0

    x_tot = 130
    pdf.set_font('Helvetica', '', 9)
    pdf.set_text_color(60, 60, 60)

    pdf.set_x(x_tot)
    pdf.cell(40, 6, 'Sous-total:', 0, 0, 'R')
    pdf.cell(30, 6, f'{subtotal:,.2f} $', 0, 1, 'R')

    pdf.set_x(x_tot)
    pdf.cell(40, 6, 'TPS (5%):', 0, 0, 'R')
    pdf.cell(30, 6, f'{tps:,.2f} $', 0, 1, 'R')

    pdf.set_x(x_tot)
    pdf.cell(40, 6, 'TVQ (9.975%):', 0, 0, 'R')
    pdf.cell(30, 6, f'{tvq:,.2f} $', 0, 1, 'R')

    # Total line with background
    pdf.set_x(x_tot)
    pdf.set_fill_color(0, 51, 102)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font('Helvetica', 'B', 11)
    pdf.cell(40, 8, 'TOTAL:', 1, 0, 'R', True)
    pdf.cell(30, 8, f'{total:,.2f} $', 1, 1, 'R', True)

    # Conditions
    pdf.ln(8)
    pdf.set_font('Helvetica', 'B', 9)
    pdf.set_text_color(0, 51, 102)
    pdf.cell(0, 6, 'CONDITIONS', 0, 1)
    pdf.set_font('Helvetica', '', 8)
    pdf.set_text_color(80, 80, 80)
    pdf.multi_cell(0, 4, 'Paiement: Payable sur livraison\nCette soumission est valide 30 jours.\nLes prix sont sujets a changement sans preavis.\nInstallation non incluse sauf si mentionnee.')

    pdf.output(output_path)
    return output_path

if __name__ == '__main__':
    quote_file = sys.argv[1] if len(sys.argv) > 1 else 'P:/Mec-Inov/Quotes/001-00265.Mdb'
    clients_file = 'C:/Users/Utilisateur/Portes et Fen\xeatres LGC/Mec-inov - Documents/CRM-LGC/data/mecinov-clients.json'

    quote_num = os.path.basename(quote_file).replace('.Mdb','')
    output = f'C:/Users/Utilisateur/Portes et Fen\xeatres LGC/Mec-inov - Documents/CRM-LGC/data/soumission-{quote_num}.pdf'

    os.makedirs(os.path.dirname(output), exist_ok=True)
    result = generate_pdf(quote_file, clients_file, output)
    size = os.path.getsize(result) / 1024
    print(f'PDF genere: {result} ({size:.1f} KB)')
