// The invoice as it looks on screen (same content as the PDF/image) and the "Invoice Preview" modal.
import { esc } from '../core.js';
import { invoiceModel } from '../invoice_model.js';
import { S, acts, t, btn, openSheet } from './ctx.js';
import { downloadInvoice, sharePdf } from './output.js';

export function invoiceHtml(sale) {
  const m = invoiceModel(S.shop, sale, t);
  return `<div class="inv" id="invoicePaper">
    <header class="inv-head"><img class="inv-logo" src="img/logo-256.png" alt=""><h1>${esc(m.shop.name)}</h1>${m.shop.address ? `<p>${esc(m.shop.address)}</p>` : ''}${m.shop.phone ? `<p>${t('phone')}: ${esc(m.shop.phone)}</p>` : ''}</header>
    <div class="inv-meta"><b>${esc(m.title)} #${esc(m.no)}</b><span>${esc(m.date)}</span></div>
    ${m.customer ? `<div class="inv-meta"><span>${t('customer')}: <b>${esc(m.customer.name)}</b></span><span>${esc(m.customer.phone)}</span></div>` : ''}
    ${m.cancelled ? '<p class="inv-cancel">CANCELLED</p>' : ''}
    <table class="inv-table"><thead><tr>${m.heads.map((h, i) => `<th class="${i ? 'r' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${m.lines.map((l) => `<tr><td>${esc(l.desc)}${l.note ? `<small>» ${esc(l.note)}</small>` : ''}</td><td class="r">${esc(l.qty)}</td><td class="r">${esc(l.price)}</td><td class="r">${esc(l.total)}</td></tr>`).join('')}</tbody></table>
    <div class="inv-totals">${m.totals.map((x) => `<div class="${x.hl ? 'grand' : ''} ${x.bold ? 'b' : ''}"><span>${esc(x.label)}</span><span>${esc(x.value)}</span></div>`).join('')}</div>
    <footer class="inv-foot"><p class="thanks">${esc(m.thanks)}</p><p class="policy">${esc(m.policy)}</p></footer></div>`;
}

/** two prominent buttons (Save / Download, Share) + the smaller extras */
export function invoiceButtons(sale, { close = false } = {}) {
  const d = { id: sale.id };
  return `<div class="inv-actions">${btn('invDownload', '💾 ' + t('save_download'), { cls: 'pri big', data: { ...d, fmt: 'pdf' } })}${btn('invShare', '📤 ' + t('share'), { cls: 'big', data: d })}</div>
    <div class="row wrap center">${btn('invDownload', '🖼 ' + t('download_image'), { cls: 'link', data: { ...d, fmt: 'png' } })}${btn('doThermal', '🖨 ' + t('thermal_print'), { cls: 'link', data: d })}${btn('doA4', '📄 ' + t('print_a4'), { cls: 'link', data: d })}${btn('doWaText', '💬 ' + t('send_text_whatsapp'), { cls: 'link', data: d })}${close ? btn('closeSheet', t('close'), { cls: 'link' }) : ''}</div>`;
}

/** shown when "Finalize Bill" (or save estimate) is pressed: the real invoice + Save/Download + Share */
export function openInvoicePreview(sale) {
  return openSheet(`<h3>${t('invoice_preview')}</h3><div class="inv-scroll">${invoiceHtml(sale)}</div>${invoiceButtons(sale, { close: true })}`, 'preview');
}

const load = (el) => S.shop.store.get('sales', el.dataset.id);
acts.invDownload = async (el) => downloadInvoice(await load(el), el.dataset.fmt || 'pdf');
acts.invShare = async (el) => sharePdf(await load(el));
